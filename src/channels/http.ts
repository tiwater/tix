/**
 * HTTP SSE channel for TiClaw.
 *
 * Routes:
 *   POST /runs                — send a message to an agent
 *   GET  /runs/:id/stream     — SSE stream for a session
 *   GET  /agents              — agent info
 *   GET  /api/mind            — mind state
 *   GET  /api/agents          — list agents
 *   POST /api/agents          — create agent
 *   GET  /api/sessions        — list sessions
 *   POST /api/sessions        — create session
 *   GET  /api/schedules       — list schedules
 *   POST /api/schedules       — create schedule
 *   DEL  /api/schedules/:id   — delete schedule
 *   POST /api/schedules/:id/toggle — toggle schedule
 *   GET  /api/skills          — list skills
 *   POST /api/skills/:name/*  — enable/disable skills
 *   GET  /api/tasks           — list active tasks
 *   GET  /api/node            — node status
 *   POST /api/node/trust      — trust node
 *   GET  /api/enroll/*        — enrollment endpoints
 *   GET  /health              — health check
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

import {
  ACP_ENABLED,
  AGENTS_DIR,
  NODE_HOSTNAME,
  HTTP_ENABLED,
  HTTP_PORT,
  SKILLS_CONFIG,
  agentPaths,
} from '../core/config.js';

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  };
  return mimes[ext] || 'application/octet-stream';
}
import {
  ensureAgent,
  ensureSession,
  getAllAgents,
  getAllSchedules,
  getAllSessions,
  getAgent,
  getRecentMessages,
  getSession,
  getSessionsForAgent,
  getSchedulesForAgent,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '../core/store.js';
import { SkillsRegistry } from '../skills/registry.js';
import {
  createEnrollmentToken,
  readEnrollmentState,
  setTrustState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { logger } from '../core/logger.js';
import { getTaskLogPath } from '../core/utils.js';
import { getExecutorStats, listActiveTasks } from '../task-executor.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { maybeHandleAcpRequest } from './acp.js';
import type {
  Channel,
  NewMessage,
  RegisteredProject,
  SessionContext,
} from '../core/types.js';

import { app } from '../core/app.js';
import { forceSchedulerCheck } from '../task-scheduler.js';

const WEB_JID_PREFIX = 'web:';

const sseClients = new Map<string, Set<http.ServerResponse | WebSocket>>();

// Hook into global app and dispatcher
app.on('broadcast', (data: { chatJid: string; event: object }) => {
  if (data.chatJid.startsWith(WEB_JID_PREFIX)) {
    broadcastToChat(data.chatJid, data.event);
  }
});

app.on('send', async (data: { jid: string; text: string }) => {
  if (data.jid.startsWith(WEB_JID_PREFIX)) {
    broadcastToChat(data.jid, {
      type: 'message',
      chat_jid: data.jid,
      text: data.text,
    });
  }
});

function buildHttpSessionId(agentId: string, sessionId: string): string {
  return `${WEB_JID_PREFIX}${agentId}:${sessionId}`;
}

function addClient(
  chatJid: string,
  res: http.ServerResponse | WebSocket,
): void {
  if (!sseClients.has(chatJid)) sseClients.set(chatJid, new Set());
  sseClients.get(chatJid)!.add(res);
}

function removeClient(
  chatJid: string,
  res: http.ServerResponse | WebSocket,
): void {
  sseClients.get(chatJid)?.delete(res);
}

export function broadcastToChat(chatJid: string, event: object): void {
  const clients = sseClients.get(chatJid);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const wsPayload = JSON.stringify(event);

  for (const client of clients) {
    try {
      if (client instanceof http.ServerResponse) {
        client.write(payload);
      } else {
        client.send(wsPayload);
      }
    } catch {
      clients.delete(client);
    }
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-API-Key',
  );
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(payload));
}

function writeProtocolError(
  res: http.ServerResponse,
  statusCode: number,
  classification: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  writeJson(res, statusCode, {
    error: {
      classification,
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function protocolErrorFromUnknown(err: unknown): {
  statusCode: number;
  classification: string;
  code: string;
  message: string;
} {
  if (err && typeof err === 'object') {
    const e = err as any;
    if (typeof e.statusCode === 'number' && typeof e.message === 'string') {
      return {
        statusCode: e.statusCode,
        classification: e.classification || 'internal_error',
        code: e.code || 'internal_error',
        message: e.message,
      };
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase().includes('not found')) {
    return {
      statusCode: 404,
      classification: 'input_error',
      code: 'not_found',
      message,
    };
  }
  return {
    statusCode: 500,
    classification: 'internal_error',
    code: 'internal_error',
    message,
  };
}

export class HttpChannel implements Channel {
  name = 'http';

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private opts: ChannelOpts;
  private _connected = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => {
      this.handleWebSocket(ws, req);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(HTTP_PORT, () => resolve());
      this.server!.on('error', reject);
    });

    this._connected = true;
    logger.info({ port: HTTP_PORT }, 'HTTP/WS channel listening');
    console.log(
      `\n  HTTP SSE: http://localhost:${HTTP_PORT}/runs/{id}/stream\n  WebSocket: ws://localhost:${HTTP_PORT}/\n`,
    );
  }

  private handleWebSocket(ws: WebSocket, _req: http.IncomingMessage): void {
    let chatJid: string | null = null;

    ws.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString());
        const { type, agent_id, session_id, content, sender, sender_name } =
          payload;

        if (type === 'auth') {
          if (!agent_id || !session_id) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'agent_id and session_id required',
              }),
            );
            return;
          }
          chatJid = buildHttpSessionId(agent_id, session_id);

          // Check trust status
          const enrollState = readEnrollmentState(NODE_HOSTNAME || undefined);
          if (enrollState.trust_state !== 'trusted') {
            ws.send(
              JSON.stringify({
                type: 'error',
                error: 'node_not_trusted',
                trust_state: enrollState.trust_state,
              }),
            );
            return;
          }

          addClient(chatJid, ws);
          ws.send(JSON.stringify({ type: 'authenticated', chat_jid: chatJid }));
          return;
        }

        if (type === 'message') {
          if (!chatJid) {
            ws.send(
              JSON.stringify({ type: 'error', message: 'not authenticated' }),
            );
            return;
          }

          if (!content) return;

          const taskId = payload.task_id || randomUUID();
          const timestamp = new Date().toISOString();

          // Ensure session and project
          ensureSession({
            agent_id,
            session_id,
            channel: 'http',
            agent_name: agent_id,
          });

          const msg: NewMessage = {
            id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chat_jid: chatJid,
            sender: sender || 'ws-user',
            sender_name: sender_name || 'WS User',
            content,
            timestamp,
            is_from_me: false,
            agent_id,
            session_id,
            task_id: taskId,
          };

          this.opts.onMessage(chatJid, msg);
          ws.send(
            JSON.stringify({ type: 'accepted', id: msg.id, task_id: taskId }),
          );
        }
      } catch (err) {
        logger.error({ err }, 'WS message handling failed');
      }
    });

    ws.on('close', () => {
      if (chatJid) removeClient(chatJid, ws);
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    setCorsHeaders(res);

    try {
      if (await maybeHandleAcpRequest(req, res, url)) {
        return;
      }

      if (pathname === '/health') {
        writeJson(res, 200, { status: 'ok' });
        return;
      }

      // ── Workspace file access ──
      const workspaceMatch = pathname.match(/^\/api\/workspace\/(.+)$/);
      if (workspaceMatch && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        if (!agentId) {
          writeJson(res, 400, { error: 'agent_id query parameter is required' });
          return;
        }
        const relPath = decodeURIComponent(workspaceMatch[1]);
        // Prevent path traversal
        const normalized = path.normalize(relPath);
        if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
          writeJson(res, 400, { error: 'Invalid path' });
          return;
        }
        const workspace = agentPaths(agentId).workspace;
        const filePath = path.join(workspace, normalized);
        // Verify resolved path is within workspace
        if (!filePath.startsWith(workspace + path.sep) && filePath !== workspace) {
          writeJson(res, 403, { error: 'Path outside workspace' });
          return;
        }
        if (!fs.existsSync(filePath)) {
          writeJson(res, 404, { error: 'File not found' });
          return;
        }
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          // List directory contents
          const entries = fs.readdirSync(filePath).map((name) => {
            const entryPath = path.join(filePath, name);
            const entryStat = fs.statSync(entryPath);
            return {
              name,
              type: entryStat.isDirectory() ? 'directory' : 'file',
              size: entryStat.isDirectory() ? undefined : entryStat.size,
              modified: entryStat.mtime.toISOString(),
            };
          });
          writeJson(res, 200, { path: relPath, entries });
          return;
        }
        const mime = inferMimeType(filePath);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=60',
          'Content-Disposition': mime === 'application/octet-stream'
            ? `attachment; filename="${path.basename(filePath)}"`
            : 'inline',
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (pathname === '/api/mind' && req.method === 'GET') {
        // Mind state is now defined by Markdown files (SOUL.md, MEMORY.md)
        const agentId = url.searchParams.get('agent_id');
        const baseDir = agentId ? agentPaths(agentId).base : AGENTS_DIR;
        const soul = fs.existsSync(path.join(baseDir, 'SOUL.md'))
          ? fs.readFileSync(path.join(baseDir, 'SOUL.md'), 'utf-8')
          : '';
        const memory = fs.existsSync(path.join(baseDir, 'MEMORY.md'))
          ? fs.readFileSync(path.join(baseDir, 'MEMORY.md'), 'utf-8')
          : '';
        writeJson(res, 200, { soul, memory });
        return;
      }

      // ── Mind Files (SOUL, MEMORY, IDENTITY, USER) ──

      if (pathname === '/api/mind/files' && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        const baseDir = agentId ? agentPaths(agentId).base : AGENTS_DIR;
        const MIND_FILES = ['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'USER.md'];
        const files: Record<string, { content: string; mtimeMs: number }> = {};
        for (const name of MIND_FILES) {
          const filePath = path.join(baseDir, name);
          try {
            if (fs.existsSync(filePath)) {
              const stat = fs.statSync(filePath);
              files[name] = {
                content: fs.readFileSync(filePath, 'utf-8'),
                mtimeMs: stat.mtimeMs,
              };
            }
          } catch {
            /* skip unreadable files */
          }
        }
        writeJson(res, 200, { files });
        return;
      }

      if (pathname === '/agents' && req.method === 'GET') {
        writeJson(res, 200, {
          name: 'TiClaw',
          description: 'TiClaw AI Agent',
          version: '1.0.0',
        });
        return;
      }

      // ── Enrollment endpoints ──

      if (pathname === '/api/enroll/status' && req.method === 'GET') {
        const state = readEnrollmentState(NODE_HOSTNAME || undefined);
        writeJson(res, 200, {
          node_id: state.node_id,
          fingerprint: state.node_fingerprint,
          trust_state: state.trust_state,
          token_expires_at: state.token_expires_at || null,
          failed_attempts: state.failed_attempts,
          frozen_until: state.frozen_until || null,
          trusted_at: state.trusted_at || null,
          revoked_at: state.revoked_at || null,
        });
        return;
      }

      if (pathname === '/api/enroll/token' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const ttlMinutes = Number(parsed.ttl_minutes);
        const result = createEnrollmentToken({
          ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : undefined,
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 201, result);
        return;
      }

      if (pathname === '/api/enroll/verify' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const token = parsed.token;
        const nodeFingerprint = parsed.node_fingerprint;
        if (!token || !nodeFingerprint) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'bad_request',
            'token and node_fingerprint are required',
          );
          return;
        }

        const result = verifyEnrollmentToken({
          token,
          nodeFingerprint,
          nodeId: NODE_HOSTNAME || undefined,
        });
        if (!result.ok) {
          const statusCode =
            result.code === 'frozen'
              ? 423
              : result.code === 'expired'
                ? 410
                : 401;
          writeJson(res, statusCode, {
            ok: false,
            code: result.code,
            trust_state: result.state.trust_state,
          });
          return;
        }

        writeJson(res, 200, {
          ok: true,
          code: 'ok',
          trust_state: result.state.trust_state,
          trusted_at: result.state.trusted_at,
        });
        return;
      }

      if (pathname === '/api/enroll/revoke' && req.method === 'POST') {
        const state = setTrustState('revoked', {
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/api/enroll/suspend' && req.method === 'POST') {
        const state = setTrustState('suspended', {
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/api/enroll/reenroll' && req.method === 'POST') {
        const state = setTrustState('discovered_untrusted', {
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      // ── SSE Stream ──

      if (
        pathname.startsWith('/runs/') &&
        pathname.endsWith('/stream') &&
        req.method === 'GET'
      ) {
        const agentId = url.searchParams.get('agent_id');
        const sessionId = url.searchParams.get('session_id');

        if (!agentId || !sessionId) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'missing_scope',
            'agent_id and session_id are required',
          );
          return;
        }

        const chatJid = buildHttpSessionId(agentId, sessionId);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(
          `data: ${JSON.stringify({
            type: 'connected',
            chat_jid: chatJid,
            agent_id: agentId,
            session_id: sessionId,
          })}\n\n`,
        );

        addClient(chatJid, res);
        const heartbeat = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            clearInterval(heartbeat);
          }
        }, 20_000);

        req.on('close', () => {
          clearInterval(heartbeat);
          removeClient(chatJid, res);
        });
        return;
      }

      // ── POST /runs — send a message ──

      if (pathname === '/runs' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const {
          agent_id: rawAgentId,
          session_id: rawSessionId,
          task_id: rawTaskId,
          sender,
          sender_name,
          content,
        } = parsed;

        if (!content || typeof content !== 'string') {
          writeProtocolError(
            res,
            400,
            'input_error',
            'content_required',
            'content is required',
          );
          return;
        }

        const agentId =
          typeof rawAgentId === 'string' && rawAgentId.trim()
            ? rawAgentId.trim()
            : null;
        const sessionId =
          typeof rawSessionId === 'string' && rawSessionId.trim()
            ? rawSessionId.trim()
            : null;
        const taskId =
          typeof rawTaskId === 'string' && rawTaskId.trim()
            ? rawTaskId.trim()
            : randomUUID();

        if (!agentId || !sessionId) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'missing_scope',
            'agent_id and session_id are required',
          );
          return;
        }

        const chatJid = buildHttpSessionId(agentId, sessionId);
        const senderId = sender || 'web-user';
        const senderName = sender_name || sender || 'Web User';
        const timestamp = new Date().toISOString();

        const enrollState = readEnrollmentState(NODE_HOSTNAME || undefined);
        if (enrollState.trust_state !== 'trusted') {
          writeJson(res, 403, {
            error: 'node_not_trusted',
            trust_state: enrollState.trust_state,
          });
          return;
        }

        const projects = this.opts.registeredProjects();
        if (!projects[chatJid] && this.opts.onGroupRegistered) {
          const project: RegisteredProject = {
            name: agentId,
            folder: agentId,
            agent_id: agentId,
            trigger: '',
            added_at: timestamp,
            requiresTrigger: false,
            isMain: false,
          };
          this.opts.onGroupRegistered(chatJid, project);
        }

        ensureSession({
          agent_id: agentId,
          session_id: sessionId,
          channel: 'http',
          agent_name: agentId,
        });

        this.opts.onChatMetadata(chatJid, timestamp, undefined, 'http', false);

        const msg: NewMessage = {
          id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          chat_jid: chatJid,
          sender: senderId,
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
          agent_id: agentId,
          session_id: sessionId,
          task_id: taskId,
        };

        // Store message and let the polling loop handle agent execution
        this.opts.onMessage(chatJid, msg);

        writeJson(res, 202, {
          ok: true,
          agent_id: agentId,
          session_id: sessionId,
          task_id: taskId,
          chat_jid: chatJid,
          id: msg.id,
        });
        return;
      }

      // ── Web UI API: Skills ──

      if (pathname === '/api/skills' && req.method === 'GET') {
        const registry = new SkillsRegistry(SKILLS_CONFIG);
        const skills = registry.listAvailable();
        writeJson(res, 200, {
          skills: skills.map((s) => {
            const installed = !!s.installed;
            const enabled = s.installed?.enabled ?? false;
            const status = installed
              ? enabled
                ? 'installed_enabled'
                : 'installed_disabled'
              : 'discovered';
            return {
              name: s.skill.name,
              version: s.skill.version,
              description: s.skill.description,
              source: s.skill.source,
              installed,
              enabled,
              status,
              runtimeUsable: installed && enabled,
              permissionLevel: s.skill.permission.level,
              directory: s.skill.directory,
              diagnostics: s.skill.diagnostics,
            };
          }),
        });
        return;
      }

      if (
        pathname.startsWith('/api/skills/') &&
        (pathname.endsWith('/enable') || pathname.endsWith('/disable')) &&
        req.method === 'POST'
      ) {
        const parts = pathname.split('/');
        const skillName = parts[3];
        const action = parts[4] as 'enable' | 'disable';
        const registry = new SkillsRegistry(SKILLS_CONFIG);
        const ctx = { actor: 'web-ui', isAdmin: true, approveLevel3: true };
        try {
          let result;
          if (action === 'enable') {
            // Auto-install if discovered but not yet installed
            if (!registry.getInstalled(skillName)) {
              registry.installSkill(skillName, ctx);
            }
            result = registry.enableSkill(skillName, ctx);
          } else {
            result = registry.disableSkill(skillName, ctx);
          }
          writeJson(res, 200, { ok: true, skill: result });
        } catch (err: any) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'skill_action_failed',
            err.message,
          );
        }
        return;
      }

      // ── Web UI API: Messages ──

      if (pathname === '/api/messages' && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        const sessionId = url.searchParams.get('session_id');
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        if (!agentId || !sessionId) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'missing_params',
            'agent_id and session_id required',
          );
          return;
        }
        const chatJid = buildHttpSessionId(agentId, sessionId);
        const msgs = getRecentMessages(chatJid, limit);
        writeJson(res, 200, {
          messages: msgs.map((m) => ({
            id: m.id,
            role: m.is_from_me ? 'bot' : 'user',
            text: m.content,
            sender: m.sender_name || m.sender,
            time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '',
            attachments: m.attachments,
          })),
        });
        return;
      }

      // ── Web UI API: Agents ──

      if (pathname === '/api/agents' && req.method === 'GET') {
        const allAgents = getAllAgents();
        const allSessions = getAllSessions();
        // Enrich with session counts
        const agentList = allAgents.map((a) => {
          const agentSessions = allSessions.filter(
            (s) => s.agent_id === a.agent_id,
          );
          return {
            agent_id: a.agent_id,
            name: a.name,
            session_count: agentSessions.length,
            created_at: a.created_at,
            updated_at: a.updated_at,
          };
        });
        writeJson(res, 200, { agents: agentList });
        return;
      }

      if (pathname === '/api/agents' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          writeProtocolError(
            res,
            400,
            'validation_error',
            'name_required',
            'Agent name is required',
          );
          return;
        }
        const agentId = name
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/-+/g, '-');
        const agent = ensureAgent({ agent_id: agentId, name });
        writeJson(res, 201, { agent });
        return;
      }

      // ── Web UI API: Sessions ──

      if (pathname === '/api/sessions' && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        const sessions = agentId
          ? getSessionsForAgent(agentId)
          : getAllSessions();
        writeJson(res, 200, { sessions });
        return;
      }

      if (pathname === '/api/sessions' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const agentId =
          typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
        if (!agentId) {
          writeProtocolError(
            res,
            400,
            'validation_error',
            'agent_id_required',
            'agent_id is required',
          );
          return;
        }
        const sessionId =
          typeof body.session_id === 'string' && body.session_id.trim()
            ? body.session_id.trim()
            : randomUUID();
        const session = ensureSession({
          agent_id: agentId,
          session_id: sessionId,
          channel: 'web',
          agent_name: agentId,
        });
        writeJson(res, 201, { session });
        return;
      }

      const sessionDeleteMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionDeleteMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(sessionDeleteMatch[1]);
        const dbPath = path.join(AGENTS_DIR, '.sessions', `${id}.json`);
        
        try {
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
          }
          // Also try removing the messages file just in case it's stored similarly, but we only have a clean mapping for sessions right now
        } catch (e) {
          logger.warn({ id, error: e }, 'Failed to delete session file');
        }

        writeJson(res, 200, { ok: true });
        return;
      }

      // ── Web UI API: Schedules ──

      if (pathname === '/api/schedules' && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        const schedules = agentId
          ? getSchedulesForAgent(agentId)
          : getAllSchedules();
        writeJson(res, 200, { schedules });
        return;
      }

      if (pathname === '/api/schedules' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const agentId =
          typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
        const prompt =
          typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const cron = typeof body.cron === 'string' ? body.cron.trim() : '';
        const targetJid = typeof body.target_jid === 'string' ? body.target_jid.trim() : undefined;
        if (!agentId || !prompt || !cron) {
          writeProtocolError(
            res,
            400,
            'validation_error',
            'missing_fields',
            'agent_id, prompt, and cron are required',
          );
          return;
        }
        const schedule = createSchedule({
          agent_id: agentId,
          prompt,
          cron,
          target_jid: targetJid,
        });
        writeJson(res, 201, { schedule });
        return;
      }

      if (pathname === '/api/schedules/refresh' && req.method === 'POST') {
        forceSchedulerCheck();
        writeJson(res, 200, { success: true });
        return;
      }

      const scheduleToggleMatch = pathname.match(
        /^\/api\/schedules\/([^/]+)\/toggle$/,
      );
      if (scheduleToggleMatch && req.method === 'POST') {
        const id = decodeURIComponent(scheduleToggleMatch[1]);
        const body = await readJsonBody(req);
        const newStatus =
          typeof body.status === 'string' ? body.status : undefined;
        if (newStatus !== 'active' && newStatus !== 'paused') {
          writeProtocolError(
            res,
            400,
            'validation_error',
            'invalid_status',
            'status must be active or paused',
          );
          return;
        }
        updateSchedule(id, { status: newStatus });
        writeJson(res, 200, { ok: true, status: newStatus });
        return;
      }

      const scheduleDeleteMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
      if (scheduleDeleteMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(scheduleDeleteMatch[1]);
        deleteSchedule(id);
        writeJson(res, 200, { ok: true });
        return;
      }

      // ── Web UI API: Tasks ──

      if (pathname === '/api/tasks' && req.method === 'GET') {
        const tasks = listActiveTasks();
        writeJson(res, 200, { tasks });
        return;
      }

      // ── Web UI API: Node ──

      if (pathname === '/api/node' && req.method === 'GET') {
        const enrollment = readEnrollmentState(NODE_HOSTNAME || undefined);
        const stats = getExecutorStats();
        
        // System Telemetry
        const cpus = os.cpus();
        const memTotal = os.totalmem();
        const memFree = os.freemem();
        const loadAvg = os.loadavg();
        const uptime = os.uptime();

        writeJson(res, 200, {
          hostname: NODE_HOSTNAME,
          enrollment: {
            trust_state: enrollment.trust_state,
            fingerprint: enrollment.node_fingerprint,
            trusted_at: enrollment.trusted_at,
            failed_attempts: enrollment.failed_attempts,
          },
          executor: stats,
          skills: {
            total_available: new SkillsRegistry(SKILLS_CONFIG).listAvailable().filter((a) => a.installed?.enabled).length,
          },
          os: {
            platform: os.platform(),
            arch: os.arch(),
            cpus: cpus.length,
            cpu_model: cpus[0]?.model || 'Unknown',
            load_avg: loadAvg,
            mem_total: memTotal,
            mem_free: memFree,
            mem_used: memTotal - memFree,
            uptime: uptime,
          }
        });
        return;
      }

      // ── Web UI API: Trust Claw ──

      if (pathname === '/api/node/trust' && req.method === 'POST') {
        const result = setTrustState('trusted', {
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 200, {
          ok: true,
          trust_state: result.trust_state,
        });
        return;
      }

      writeProtocolError(res, 404, 'input_error', 'not_found', 'Not found');
    } catch (err) {
      const protocolError = protocolErrorFromUnknown(err);
      logger.error({ err, pathname }, 'HTTP request failed');
      if (!res.headersSent) {
        writeProtocolError(
          res,
          protocolError.statusCode,
          protocolError.classification,
          protocolError.code,
          protocolError.message,
        );
      } else {
        res.end();
      }
    }
  }

  async sendMessage(
    jid: string,
    text: string,
    options?: { embeds?: any[]; message_id?: string },
  ): Promise<void> {
    if (!text.trim()) return;
    const session = getSession(jid);
    broadcastToChat(jid, {
      type: 'message',
      id: options?.message_id,
      chat_jid: jid,
      agent_id: session?.agent_id,
      session_id: session?.session_id,
      text,
      embeds: options?.embeds,
    });
    logger.info(
      {
        agent_id: session?.agent_id,
        session_id: session?.session_id,
        chat_jid: jid,
        length: text.length,
      },
      'HTTP SSE message broadcast',
    );
  }

  async sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    if (!fs.existsSync(filePath)) {
      logger.warn({ jid, filePath }, 'sendFile: file not found');
      return;
    }

    // Resolve file URL relative to the agent's workspace
    const session = getSession(jid);
    const agentId = session?.agent_id || 'default';
    const workspace = agentPaths(agentId).workspace;
    const mime = inferMimeType(filePath);
    const label = caption || path.basename(filePath);

    let ticlawUrl: string;
    if (filePath.startsWith(workspace)) {
      const relPath = path.relative(workspace, filePath);
      ticlawUrl = `ticlaw://workspace/${agentId}/${relPath}`;
    } else {
      // File outside workspace — copy to workspace first
      const destName = `${randomUUID()}${path.extname(filePath)}`;
      const destPath = path.join(workspace, '.files', destName);
      fs.mkdirSync(path.join(workspace, '.files'), { recursive: true });
      fs.copyFileSync(filePath, destPath);
      ticlawUrl = `ticlaw://workspace/${agentId}/.files/${destName}`;
    }

    const text = mime.startsWith('image/')
      ? `![${label}](${ticlawUrl})`
      : `[${label}](${ticlawUrl})`;

    broadcastToChat(jid, {
      type: 'message',
      chat_jid: jid,
      agent_id: agentId,
      session_id: session?.session_id,
      text,
      is_file: true,
    });

    logger.info({ jid, ticlawUrl, mime }, 'File sent to web client');
  }

  isConnected(): boolean {
    return this._connected && this.server !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(WEB_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    for (const clients of sseClients.values()) {
      for (const res of clients) {
        try {
          if (res instanceof http.ServerResponse) {
            res.end();
          } else {
            res.close();
          }
        } catch {
          /* ignore */
        }
      }
    }
    sseClients.clear();
    logger.info('HTTP SSE channel disconnected');
  }
}

function createHttpChannel(opts: ChannelOpts): HttpChannel | null {
  if (!HTTP_ENABLED && !ACP_ENABLED) {
    logger.debug('HTTP channel disabled (HTTP_ENABLED=false)');
    return null;
  }
  if (!HTTP_ENABLED && ACP_ENABLED) {
    logger.info('HTTP listener enabled for ACP endpoints');
  }
  return new HttpChannel(opts);
}

registerChannel('http', createHttpChannel);
