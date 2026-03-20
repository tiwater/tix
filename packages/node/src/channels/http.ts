/**
 * HTTP SSE channel for TiClaw — REST API v1
 *
 * Node:
 *   GET  /api/v1/node                                      — node status
 *   POST /api/v1/node/trust                                — trust node
 *
 * Agents:
 *   GET    /api/v1/agents                                  — list agents
 *   POST   /api/v1/agents                                  — create agent
 *   GET    /api/v1/agents/:agent_id                        — get agent config
 *   PATCH  /api/v1/agents/:agent_id                        — update agent settings
 *   DELETE /api/v1/agents/:agent_id                        — delete agent
 *   GET    /api/v1/agents/:agent_id/mind                   — core mind files
 *   GET    /api/v1/agents/:agent_id/artifacts              — artifact index
 *   GET    /api/v1/agents/:agent_id/memory                 — memory roll
 *   POST   /api/v1/agents/:agent_id/workspace/upload       — upload files
 *   GET    /api/v1/agents/:agent_id/workspace/*            — read workspace file
 *
 * Sessions (nested under agent):
 *   GET    /api/v1/agents/:agent_id/sessions               — list sessions
 *   POST   /api/v1/agents/:agent_id/sessions               — create session
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id   — get session
 *   PATCH  /api/v1/agents/:agent_id/sessions/:session_id   — update session (title)
 *   DELETE /api/v1/agents/:agent_id/sessions/:session_id   — delete session
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/messages — chat history
 *   POST   /api/v1/agents/:agent_id/sessions/:session_id/messages — send message
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/stream   — SSE stream
 *
 * Skills:
 *   GET    /api/v1/skills                                  — list
 *   GET    /api/v1/skills/:name                            — skill details
 *   POST   /api/v1/skills/:name/enable                     — enable skill
 *   POST   /api/v1/skills/:name/disable                    — disable skill
 *
 * Schedules:
 *   GET    /api/v1/schedules                               — list
 *   POST   /api/v1/schedules                               — create
 *   DELETE /api/v1/schedules/:id                           — delete
 *   POST   /api/v1/schedules/:id/toggle                    — toggle active/paused
 *   POST   /api/v1/schedules/refresh                       — force check
 *
 * System:
 *   GET    /api/v1/models                                  — list LLM models
 *   GET    /api/v1/tasks                                   — active tasks
 *   GET    /api/v1/enroll/*                                — enrollment
 *   GET    /health                                         — health check
 *
 * Legacy (still served for backwards compat — redirect or alias):
 *   POST /runs, GET /runs/:id/stream, GET /agents
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { randomUUID, timingSafeEqual } from 'crypto';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

import Anthropic from '@anthropic-ai/sdk';
import {
  ACP_ENABLED,
  AGENTS_DIR,
  HTTP_API_KEY,
  NODE_HOSTNAME,
  HTTP_ENABLED,
  HTTP_PORT,
  SKILLS_CONFIG,
  agentPaths,
  MODELS_REGISTRY,
  getAgentModelConfig,
  ALLOWED_ORIGINS,
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
  getGlobalUsage,
  getUsageStats,
  getRecentMessages,
  getSession,
  getSessionForAgent,
  getSessionsForAgent,
  getArchivedSessionsForAgent,
  getSchedulesForAgent,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  deleteSession,
  deleteSessionForAgent,
  archiveSessionForAgent,
  restoreSessionForAgent,
  updateSessionMetadata,
  resolveFromChatJid,
} from '../core/store.js';
import { type SessionRecord } from '../core/types.js';
import { SkillsRegistry } from '../skills/registry.js';
import {
  createEnrollmentToken,
  readEnrollmentState,
  setTrustState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { logger } from '../core/logger.js';
import { getTaskLogPath } from '../core/utils.js';
import { isPathWithin } from '../core/security.js';
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

function parseHttpSessionId(chatJid: string): [string, string] {
  // Format: web:agentId:sessionId
  const parts = chatJid.replace(WEB_JID_PREFIX, '').split(':');
  return [parts[0] || '', parts.slice(1).join(':') || ''];
}

function resolveSessionContext(chatJid: string): SessionContext | undefined {
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return undefined;
  return getSessionForAgent(resolved.agentId, resolved.sessionId) as
    | SessionContext
    | undefined;
}

function addClient(
  chatJid: string,
  res: http.ServerResponse | WebSocket,
): void {
  if (!sseClients.has(chatJid)) sseClients.set(chatJid, new Set());
  sseClients.get(chatJid)!.add(res);
}

// Global artifact watcher
function startArtifactWatcher() {
  try {
    fs.watch(AGENTS_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const parts = filename.split(path.sep);
      const agentId = parts[0];
      const relPath = parts.slice(1).join('/');

      if (!agentId || !relPath) return;

      for (const chatJid of sseClients.keys()) {
        if (chatJid.includes(agentId) || chatJid.startsWith('web:')) {
          broadcastToChat(chatJid, {
            type: 'artifact_updated',
            agent_id: agentId,
            file: relPath,
            event: eventType
          });
        }
      }
    });
  } catch (err) {
    if (typeof logger !== 'undefined') logger.warn({ err }, 'Failed to start recursive artifact watcher (possibly OS limitation)');
  }
}

if (fs.existsSync(AGENTS_DIR)) {
  startArtifactWatcher();
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

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS && origin) {
    try {
      const regex = new RegExp(ALLOWED_ORIGINS);
      if (regex.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    } catch {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
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

function readSingleHeaderValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]?.trim();
    return first || null;
  }
  return null;
}

function extractApiKey(req: http.IncomingMessage): string | null {
  const direct = readSingleHeaderValue(req.headers['x-api-key']);
  if (direct) return direct;

  const auth = readSingleHeaderValue(req.headers.authorization);
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
}

function safeEquals(input: string, expected: string): boolean {
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isLoopbackAddress(remote: string | undefined): boolean {
  const value = remote || '';
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1'
  );
}

function requiresAdminApiAccess(pathname: string, method: string): boolean {
  // Legacy run endpoint
  if (pathname === '/runs' && method === 'POST') return true;
  // All new v1 api endpoints require admin access
  if (pathname.startsWith('/api/v1/')) {
    if (method === 'OPTIONS') return false;
    return true;
  }
  // Legacy /api/ paths still require admin access
  if (pathname.startsWith('/api/')) {
    if (method === 'OPTIONS') return false;
    return true;
  }
  return false;
}

type HttpAdminContext = {
  actor: string;
  isAdmin: true;
  approveLevel3: true;
};

function resolveHttpAdminContextFromInput(
  providedApiKey: string | null,
  isLoopback: boolean,
): HttpAdminContext | null {
  const configuredApiKey = HTTP_API_KEY.trim();
  if (configuredApiKey) {
    if (providedApiKey && safeEquals(providedApiKey, configuredApiKey)) {
      return {
        actor: 'http-api-key',
        isAdmin: true,
        approveLevel3: true,
      };
    }
    return null;
  }

  if (isLoopback) {
    return {
      actor: 'http-loopback',
      isAdmin: true,
      approveLevel3: true,
    };
  }

  return null;
}

function resolveHttpAdminContext(
  req: http.IncomingMessage,
): HttpAdminContext | null {
  return resolveHttpAdminContextFromInput(
    extractApiKey(req),
    isLoopbackAddress(req.socket.remoteAddress),
  );
}

function requireHttpAdminContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): HttpAdminContext | null {
  const context = resolveHttpAdminContext(req);
  if (context) return context;

  if (HTTP_API_KEY.trim()) {
    writeProtocolError(
      res,
      401,
      'auth_error',
      'invalid_api_key',
      'Valid API key required. Send X-API-Key or Authorization: Bearer <key>.',
    );
    return null;
  }

  writeProtocolError(
    res,
    403,
    'auth_error',
    'admin_loopback_only',
    'Endpoint is restricted to loopback requests when HTTP_API_KEY is not configured.',
  );
  return null;
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

function generateSessionTitleBackground(agentId: string, sessionId: string, message: string) {
  (async () => {
    try {
      const models = getAgentModelConfig(agentId);
      const modelConfig = models.length > 0 ? models[0] : null;
      if (!modelConfig || !modelConfig.api_key) {
        // Fallback if no LLM configured: use simple truncation
        const fallback = message.slice(0, 30) + (message.length > 30 ? '…' : '');
        updateSessionMetadata(agentId, sessionId, { title: fallback });
        return;
      }

      const client = new Anthropic({
        apiKey: modelConfig.api_key,
        baseURL: modelConfig.base_url || undefined,
      });

      const prompt = `You are an AI tasked with generating a concise, 3-5 word title for a chat session.
Read the user's message and summarize the core topic.
Rules:
- Output ONLY the title text.
- No quotes, no preamble, no markdown.
- Capitalize the title appropriately.

User's message:
${message}`;

      const response = await client.messages.create({
        model: modelConfig.model || 'claude-3-5-sonnet-latest',
        max_tokens: 20,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      });

      if (response.content[0]?.type === 'text') {
        let title = response.content[0].text.trim();
        if (title.startsWith('"') && title.endsWith('"')) {
          title = title.slice(1, -1).trim();
        }
        if (title.length > 60) title = title.slice(0, 60) + '…';
        updateSessionMetadata(agentId, sessionId, { title });
        logger.debug({ agentId, sessionId, title }, 'Generated LLM session title');

        // Broadcast a generic session update event
        broadcastToChat(buildHttpSessionId(agentId, sessionId), {
          type: 'session_updated',
          session: {
            session_id: sessionId,
            title
          }
        });
      }
    } catch (err: any) {
      logger.warn({ err: err.message, agentId, sessionId }, 'Failed to generate LLM session title');
    }
  })();
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

  private handleWebSocket(ws: WebSocket, req: http.IncomingMessage): void {
    let chatJid: string | null = null;
    const remoteAddress = req.socket.remoteAddress;

    ws.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString());
        const { type, agent_id, session_id, content, sender, sender_name } =
          payload;

        if (type === 'auth') {
          const wsApiKey =
            typeof payload.api_key === 'string' && payload.api_key.trim()
              ? payload.api_key.trim()
              : null;
          const wsContext = resolveHttpAdminContextFromInput(
            wsApiKey,
            isLoopbackAddress(remoteAddress),
          );
          if (!wsContext) {
            ws.send(
              JSON.stringify({
                type: 'error',
                error: HTTP_API_KEY.trim()
                  ? 'invalid_api_key'
                  : 'admin_loopback_only',
              }),
            );
            ws.close();
            return;
          }

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

          // Use authenticated agent/session from the WebSocket handshake
          // This ensures the message is associated with the authenticated session, not the payload
          const [authedAgentId, authedSessionId] = parseHttpSessionId(chatJid);
          const taskId = payload.task_id || randomUUID();
          const timestamp = new Date().toISOString();

          // Ensure session and project
          ensureSession({
            agent_id: authedAgentId,
            session_id: authedSessionId,
            channel: 'http',
            agent_name: authedAgentId,
          });

          const msg: NewMessage = {
            id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chat_jid: chatJid,
            sender: sender || 'ws-user',
            sender_name: sender_name || 'WS User',
            content,
            timestamp,
            is_from_me: false,
            agent_id: authedAgentId,
            session_id: authedSessionId,
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
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      setCorsHeaders(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    setCorsHeaders(req, res);

    try {
      if (await maybeHandleAcpRequest(req, res, url)) {
        return;
      }

      const adminGuardRequired = requiresAdminApiAccess(pathname, method);
      const adminContext = adminGuardRequired
        ? requireHttpAdminContext(req, res)
        : null;
      if (adminGuardRequired && !adminContext) {
        return;
      }

      if (pathname === '/health') {
        writeJson(res, 200, { status: 'ok' });
        return;
      }

      // ── Workspace file access ──
      const workspaceMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/(.*)$/)
        ?? pathname.match(/^\/api\/workspace\/(.*)$/);
      if (workspaceMatch && req.method === 'GET') {
        // /api/v1/agents/:agent_id/workspace/<relpath> — agent_id is captured group 1 (v1) or falls back to query param (legacy)
        const agentId = workspaceMatch[2] !== undefined
          ? decodeURIComponent(workspaceMatch[1])
          : (url.searchParams.get('agent_id') ?? '');
        const relRaw = workspaceMatch[2] !== undefined ? workspaceMatch[2] : workspaceMatch[1];
        if (!agentId) {
          writeJson(res, 400, { error: 'agent_id required' });
          return;
        }
        const relPath = decodeURIComponent(relRaw || '.') || '.';
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

      // ── Workspace file upload (JSON with base64-encoded files) ──
      const uploadV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/upload$/);
      const uploadAgentId = uploadV1Match ? decodeURIComponent(uploadV1Match[1]) : url.searchParams.get('agent_id');
      if ((uploadV1Match || pathname === '/api/workspace/upload') && req.method === 'POST') {
        const agentId = uploadAgentId || '';
        if (!agentId) {
          writeJson(res, 400, { error: 'agent_id required' });
          return;
        }

        // Body is already parsed by the gateway relay as JSON
        // Format: { files: [{ name: string, data: string (base64) }] }
        const reqBody = (req as any)._body || await new Promise<any>((resolve) => {
          let raw = '';
          req.on('data', (chunk: Buffer) => { raw += chunk; });
          req.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch { resolve(null); }
          });
        });

        if (!reqBody?.files || !Array.isArray(reqBody.files)) {
          writeJson(res, 400, { error: 'Request body must contain files array with { name, data } objects' });
          return;
        }

        const workspace = agentPaths(agentId).workspace;
        const uploadDir = path.join(workspace, '.uploads');
        fs.mkdirSync(uploadDir, { recursive: true });

        const uploadedFiles: { name: string; path: string; ticlawUrl: string; size: number }[] = [];

        for (const file of reqBody.files) {
          if (!file.name || !file.data) continue;
          const originalName = path.basename(file.name); // sanitize
          const content = Buffer.from(file.data, 'base64');

          // 50MB per-file limit
          if (content.length > 50 * 1024 * 1024) continue;

          const uuid = randomUUID().slice(0, 8);
          const destName = `${uuid}-${originalName}`;
          const destPath = path.join(uploadDir, destName);
          fs.writeFileSync(destPath, content);

          const relPath = `.uploads/${destName}`;
          uploadedFiles.push({
            name: originalName,
            path: relPath,
            ticlawUrl: `ticlaw://workspace/${agentId}/${relPath}`,
            size: content.length,
          });

          logger.info({ agentId, destName, size: content.length }, 'File uploaded to workspace');
        }

        writeJson(res, 200, { files: uploadedFiles });
        return;
      }

      // Legacy /api/mind — also served at /api/v1/agents/:id/mind (handled below)
      if (pathname === '/api/mind' && req.method === 'GET') {
        // Long-term mind view (root files only): SOUL + MEMORY
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

      // ── Root Mind Files (SOUL, MEMORY, IDENTITY, USER) ──

      const mindFilesMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/mind$/);
      if ((mindFilesMatch && req.method === 'GET') || (pathname === '/api/mind/files' && req.method === 'GET')) {
        const agentId = mindFilesMatch ? decodeURIComponent(mindFilesMatch[1]) : url.searchParams.get('agent_id');
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

      // ── API: Workspace File Serving ──
      const workspaceFileMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/(.+)$/);
      if (workspaceFileMatch && req.method === 'GET') {
        const agentId = decodeURIComponent(workspaceFileMatch[1]);
        const relPath = decodeURIComponent(workspaceFileMatch[2]);
        const workspacePath = agentPaths(agentId).workspace;
        const absPath = path.join(workspacePath, relPath);
        
        // Security check: prevent directory traversal
        if (!isPathWithin(workspacePath, absPath)) {
          writeJson(res, 403, { error: 'forbidden' });
          return;
        }
        
        if (fs.existsSync(absPath)) {
          const stat = fs.statSync(absPath);
          if (stat.isFile()) {
            const stream = fs.createReadStream(absPath);
            const ext = path.extname(absPath).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.pdf': 'application/pdf',
              '.txt': 'text/plain',
              '.md': 'text/markdown',
              '.json': 'application/json',
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            stream.pipe(res);
            return;
          }
        }
        
        writeJson(res, 404, { error: 'not_found' });
        return;
      }

      // ── API: AgentSpace Resource Indexing ──

      const artifactsMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/artifacts$/);
      if ((artifactsMatch || pathname === '/api/mind/artifacts') && req.method === 'GET') {
        const agentId = artifactsMatch ? decodeURIComponent(artifactsMatch[1]) : url.searchParams.get('agent_id');
        if (!agentId) {
          writeJson(res, 400, { error: 'agent_id required' });
          return;
        }

        const baseDir = agentPaths(agentId).base;
        const artifacts: Record<string, any> = {};

        const walkSync = (dir: string, filelist: string[] = []) => {
          if (!fs.existsSync(dir)) return filelist;
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const filepath = path.join(dir, item);
            try {
              if (fs.statSync(filepath).isDirectory()) {
                // exclude huge directories or internal stores
                if (item !== '.git' && item !== 'node_modules') {
                  walkSync(filepath, filelist);
                }
              } else {
                filelist.push(filepath);
              }
            } catch { /* ignore stat failures */ }
          }
          return filelist;
        };

        const allFiles = walkSync(baseDir);
        for (const fullPath of allFiles) {
          const relPath = path.relative(baseDir, fullPath);
          try {
            const stat = fs.statSync(fullPath);
            artifacts[relPath] = {
              mime_type: inferMimeType(fullPath),
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            };
          } catch {
            // skip
          }
        }
        writeJson(res, 200, { artifacts });
        return;
      }

      // ── Agent Memory (Core + Roll) ──

      const memoryMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/memory$/) ?? pathname.match(/^\/api\/agents\/([^/]+)\/memory$/);
      if (memoryMatch && req.method === 'GET') {
        const agentId = decodeURIComponent(memoryMatch[1]);
        const baseDir = agentPaths(agentId).base;

        let coreMemory = null;
        const memoryPath = path.join(baseDir, 'MEMORY.md');
        if (fs.existsSync(memoryPath)) {
          try {
            const stat = fs.statSync(memoryPath);
            coreMemory = { content: fs.readFileSync(memoryPath, 'utf-8'), mtimeMs: stat.mtimeMs };
          } catch { /* skip */ }
        }

        const roll: { date: string; content: string; mtimeMs: number }[] = [];
        const memoryDir = path.join(baseDir, 'memory');
        if (fs.existsSync(memoryDir)) {
          try {
            const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md')).sort().reverse();
            for (const file of files) {
              const filePath = path.join(memoryDir, file);
              const stat = fs.statSync(filePath);
              roll.push({
                date: file.replace('.md', ''),
                content: fs.readFileSync(filePath, 'utf-8'),
                mtimeMs: stat.mtimeMs
              });
            }
          } catch { /* skip */ }
        }

        writeJson(res, 200, { core_memory: coreMemory, roll });
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
        // Admin-only endpoint
        const ctx = resolveHttpAdminContext(req);
        if (!ctx?.isAdmin) {
          writeJson(res, 403, { ok: false, error: 'admin_required' });
          return;
        }
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
        // Admin-only endpoint
        const ctx = resolveHttpAdminContext(req);
        if (!ctx?.isAdmin) {
          writeJson(res, 403, { ok: false, error: 'admin_required' });
          return;
        }
        const state = setTrustState('revoked', {
          nodeId: NODE_HOSTNAME || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/api/enroll/suspend' && req.method === 'POST') {
        // Admin-only endpoint
        const ctx = resolveHttpAdminContext(req);
        if (!ctx?.isAdmin) {
          writeJson(res, 403, { ok: false, error: 'admin_required' });
          return;
        }
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

      // ── SSE Stream ── (v1: /api/v1/agents/:agent_id/sessions/:session_id/stream)

      const sseV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/stream$/);
      if (
        (sseV1Match ||
          (pathname.startsWith('/runs/') && pathname.endsWith('/stream'))) &&
        req.method === 'GET'
      ) {
        const agentId = sseV1Match ? decodeURIComponent(sseV1Match[1]) : url.searchParams.get('agent_id');
        const sessionId = sseV1Match ? decodeURIComponent(sseV1Match[2]) : url.searchParams.get('session_id');

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

      // ── POST message (v1: /api/v1/agents/:agent_id/sessions/:session_id/messages | legacy: /runs) ──

      const postMsgV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/messages$/);
      if ((postMsgV1Match || pathname === '/runs') && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const {
          agent_id: rawAgentId,
          session_id: rawSessionId,
          task_id: rawTaskId,
          sender,
          sender_name,
          content,
        } = parsed;
        // v1: override agent_id and session_id from path params
        if (postMsgV1Match) {
          (parsed as any).agent_id = decodeURIComponent(postMsgV1Match[1]);
          (parsed as any).session_id = decodeURIComponent(postMsgV1Match[2]);
        }

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

        const session = ensureSession({
          agent_id: agentId,
          session_id: sessionId,
          channel: 'http',
          agent_name: agentId,
        });

        if (!session.title || content.trim().length > 12) {
          generateSessionTitleBackground(agentId, sessionId, content);
        }

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

      if ((pathname === '/api/v1/skills' || pathname === '/api/skills') && req.method === 'GET') {
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
        (pathname.startsWith('/api/v1/skills/') || pathname.startsWith('/api/skills/')) &&
        (pathname.endsWith('/enable') || pathname.endsWith('/disable')) &&
        method === 'POST'
      ) {
        const parts = pathname.split('/');
        // v1 path: /api/v1/skills/:name/enable → parts[4]=name, parts[5]=action
        // old path: /api/skills/:name/enable   → parts[3]=name, parts[4]=action
        const isV1 = pathname.startsWith('/api/v1/');
        const skillName = isV1 ? parts[4] : parts[3];
        const action = (isV1 ? parts[5] : parts[4]) as 'enable' | 'disable';
        const registry = new SkillsRegistry(SKILLS_CONFIG);
        const ctx = adminContext || {
          actor: 'web-ui',
          isAdmin: false,
          approveLevel3: false,
        };
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

      const msgHistV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/messages$/);
      if ((msgHistV1Match || pathname === '/api/messages') && req.method === 'GET') {
        const agentId = msgHistV1Match ? decodeURIComponent(msgHistV1Match[1]) : url.searchParams.get('agent_id');
        const sessionId = msgHistV1Match ? decodeURIComponent(msgHistV1Match[2]) : url.searchParams.get('session_id');
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
        let chatJid = sessionId;
        if (!sessionId.includes(':')) {
          chatJid = buildHttpSessionId(agentId, sessionId);
        }
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

      // ── Web UI API: System Models ──

      if ((pathname === '/api/v1/models' || pathname === '/api/models') && req.method === 'GET') {
        const publicModels = MODELS_REGISTRY.map(({ api_key, ...rest }) => rest);
        writeJson(res, 200, { models: publicModels });
        return;
      }

      // ── Web UI API: Usage ──

      if ((pathname === '/api/v1/usage' || pathname === '/api/usage') && req.method === 'GET') {
        const globalUsage = getGlobalUsage();
        const allAgents = getAllAgents();
        const agentUsage = allAgents.map((a) => ({
          agent_id: a.agent_id,
          name: a.name,
          usage: getUsageStats(a),
        }));

        writeJson(res, 200, {
          total: globalUsage,
          agents: agentUsage,
        });
        return;
      }

      // ── Web UI API: Agents ──

      if ((pathname === '/api/v1/agents' || pathname === '/api/agents' || pathname === '/agents') && req.method === 'GET') {
        const allAgents = getAllAgents();
        const allSessions = getAllSessions();
        // Enrich with session counts and usage
        const agentList = allAgents.map((a) => {
          const agentSessions = allSessions.filter(
            (s) => s.agent_id === a.agent_id,
          );
          let model: string | undefined;
          try {
            const configPath = agentPaths(a.agent_id).config;
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              model = config.model;
            }
          } catch {
            /* ignore */
          }
          return {
            agent_id: a.agent_id,
            name: a.name,
            session_count: agentSessions.length,
            usage: getUsageStats(a),
            created_at: a.created_at,
            updated_at: a.updated_at,
            model,
            tags: a.tags || [],
          };
        });
        writeJson(res, 200, { agents: agentList });
        return;
      }

      if ((pathname === '/api/v1/agents' || pathname === '/api/agents') && req.method === 'POST') {
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
        const agent = ensureAgent({ agent_id: agentId, name, tags: body.tags });
        writeJson(res, 201, { agent });
        return;
      }

      // GET /api/v1/agents/:id — get agent config + session count
      const agentGetMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
      if (agentGetMatch && req.method === 'GET') {
        const agentId = decodeURIComponent(agentGetMatch[1]);
        const allSessions = getAllSessions();
        const agentSessions = allSessions.filter((s) => s.agent_id === agentId);
        let config: any = {};
        try {
          const configPath = agentPaths(agentId).config;
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          }
        } catch { /* ignore */ }
        writeJson(res, 200, {
          agent_id: agentId,
          session_count: agentSessions.length,
          config,
        });
        return;
      }

      // PATCH /api/v1/agents/:id — update agent configuration
      const agentPatchMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
      if (agentPatchMatch && req.method === 'PATCH') {
        const agentId = decodeURIComponent(agentPatchMatch[1]);
        const body = await readJsonBody(req);
        try {
          const configPath = agentPaths(agentId).config;
          let config: any = {};
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          }
          // Merge in allowed top-level config fields
          const allowed = ['model', 'name', 'llm_base_url', 'system_prompt', 'tags'];
          for (const key of allowed) {
            if (body[key] !== undefined) config[key] = body[key];
          }
          fs.mkdirSync(path.dirname(configPath), { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          writeJson(res, 200, { ok: true, config });
        } catch (err: any) {
          writeProtocolError(res, 500, 'internal_error', 'config_update_failed', err.message);
        }
        return;
      }

      // DELETE /api/v1/agents/:id — delete agent
      if (agentGetMatch && req.method === 'DELETE') {
        const agentId = decodeURIComponent(agentGetMatch[1]);
        const agentDir = agentPaths(agentId).base;
        try {
          if (fs.existsSync(agentDir)) {
            fs.rmSync(agentDir, { recursive: true, force: true });
          }
          writeJson(res, 200, { ok: true });
        } catch (err: any) {
          writeProtocolError(res, 500, 'internal_error', 'delete_failed', err.message);
        }
        return;
      }

      // Legacy: POST /api/agents/:id/model
      const agentModelMatch = pathname.match(/^\/api\/agents\/([^/]+)\/model$/) ?? pathname.match(/^\/api\/v1\/agents\/([^/]+)\/model$/);
      if (agentModelMatch && req.method === 'POST') {
        const agentId = decodeURIComponent(agentModelMatch[1]);
        const body = await readJsonBody(req);
        const modelId = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

        try {
          const configPath = agentPaths(agentId).config;
          let config: any = {};
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          }
          if (modelId) {
            config.model = modelId;
          } else {
            delete config.model;
          }
          // Ensure directory exists
          fs.mkdirSync(path.dirname(configPath), { recursive: true });
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          writeJson(res, 200, { ok: true, model: modelId });
        } catch (err: any) {
          writeProtocolError(res, 500, 'internal_error', 'config_update_failed', err.message);
        }
        return;
      }

      // ── Web UI API: Sessions ──

      // GET /api/v1/agents/:agent_id/sessions
      const sessionsV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions$/);
      if ((sessionsV1Match || pathname === '/api/sessions') && req.method === 'GET') {
        const agentId = sessionsV1Match ? decodeURIComponent(sessionsV1Match[1]) : url.searchParams.get('agent_id');
        const sessions = agentId
          ? getSessionsForAgent(agentId)
          : getAllSessions();
        writeJson(res, 200, { sessions });
        return;
      }

      if ((sessionsV1Match || pathname === '/api/sessions') && req.method === 'POST') {
        const body = await readJsonBody(req);
        const agentId = sessionsV1Match
          ? decodeURIComponent(sessionsV1Match[1])
          : (typeof body.agent_id === 'string' ? body.agent_id.trim() : '');
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

      // /api/v1/agents/:agent_id/sessions/:session_id  or  legacy /api/sessions/:id
      const sessionV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)$/);
      const sessionDeleteMatch = sessionV1Match ?? pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionDeleteMatch && req.method === 'DELETE') {
        const id = sessionV1Match ? decodeURIComponent(sessionV1Match[2]) : decodeURIComponent(sessionDeleteMatch[1]);
        const agentIdRaw = sessionV1Match ? decodeURIComponent(sessionV1Match[1]) : url.searchParams.get('agent_id');
        const agentId =
          typeof agentIdRaw === 'string' && agentIdRaw.trim()
            ? agentIdRaw.trim()
            : '';

        try {
          if (agentId) {
            let deleted = deleteSessionForAgent(agentId, id);
            if (!deleted) {
              deleted = deleteSessionForAgent(agentId, id, true);
            }
            if (!deleted) {
              writeProtocolError(
                res,
                404,
                'input_error',
                'session_not_found',
                `Session "${id}" not found for agent "${agentId}"`,
              );
              return;
            }
          } else {
            // Backward-compatible fallback for older clients.
            deleteSession(id);
          }
        } catch (e) {
          logger.warn(
            { id, agentId: agentId || undefined, error: e },
            'Failed to delete session directory',
          );
        }

        writeJson(res, 200, { ok: true });
        return;
      }

      // PATCH /api/v1/agents/:agent_id/sessions/:session_id — update session metadata/archive status
      if (sessionDeleteMatch && req.method === 'PATCH') {
        const id = sessionV1Match ? decodeURIComponent(sessionV1Match[2]) : decodeURIComponent(sessionDeleteMatch[1]);
        const body = await readJsonBody(req);
        const agentId = sessionV1Match
          ? decodeURIComponent(sessionV1Match[1])
          : (typeof body.agent_id === 'string' ? body.agent_id.trim() : '');
        
        let updated = false;
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const archived = typeof body.archived === 'boolean' ? body.archived : undefined;
        
        if (!agentId) {
          writeJson(res, 400, { error: 'agent_id is required' });
          return;
        }
        
        const updates: Partial<SessionRecord> = {};
        if (title !== undefined) updates.title = title;
        if (archived !== undefined) updates.archived = archived;
        
        if (archived === false) {
          restoreSessionForAgent(agentId, id);
          updated = true;
        }

        if (Object.keys(updates).length > 0) {
          const ok = updateSessionMetadata(agentId, id, updates);
          if (!ok) {
            writeJson(res, 404, { error: 'session not found' });
            return;
          }
          updated = true;
        }

        if (archived === true) {
          archiveSessionForAgent(agentId, id);
          updated = true;
        }
        
        if (updated) {
          writeJson(res, 200, { ok: true, session_id: id });
        } else {
          writeJson(res, 400, { error: 'No valid fields to update provided' });
        }
        return;
      }
      
      // GET /api/v1/agents/:agent_id/archived_sessions
      const archivedSessionsV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/archived_sessions$/);
      if (archivedSessionsV1Match && req.method === 'GET') {
        const agentId = decodeURIComponent(archivedSessionsV1Match[1]);
        const sessions = getArchivedSessionsForAgent(agentId);
        writeJson(res, 200, { sessions });
        return;
      }



      // ── Web UI API: Schedules ──

      if ((pathname === '/api/v1/schedules' || pathname === '/api/schedules') && req.method === 'GET') {
        const agentId = url.searchParams.get('agent_id');
        const schedules = agentId
          ? getSchedulesForAgent(agentId)
          : getAllSchedules();
        writeJson(res, 200, { schedules });
        return;
      }

      if ((pathname === '/api/v1/schedules' || pathname === '/api/schedules') && req.method === 'POST') {
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

        // Validate cron expression before creating schedule
        try {
          const { CronExpressionParser } = await import('cron-parser');
          CronExpressionParser.parse(cron, { tz: 'Asia/Shanghai' });
        } catch (e) {
          writeProtocolError(
            res,
            400,
            'validation_error',
            'invalid_cron',
            `Invalid cron expression: ${cron}`,
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

      if ((pathname === '/api/v1/schedules/refresh' || pathname === '/api/schedules/refresh') && req.method === 'POST') {
        forceSchedulerCheck();
        writeJson(res, 200, { success: true });
        return;
      }

      const scheduleToggleMatch = pathname.match(/^\/api\/v1\/schedules\/([^/]+)\/toggle$/) ?? pathname.match(/^\/api\/schedules\/([^/]+)\/toggle$/);
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

      const scheduleDeleteMatch = pathname.match(/^\/api\/v1\/schedules\/([^/]+)$/) ?? pathname.match(/^\/api\/schedules\/([^/]+)$/);
      if (scheduleDeleteMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(scheduleDeleteMatch[1]);
        deleteSchedule(id);
        writeJson(res, 200, { ok: true });
        return;
      }

      // ── Web UI API: Tasks ──

      if ((pathname === '/api/v1/tasks' || pathname === '/api/tasks') && req.method === 'GET') {
        try {
          const tasks = listActiveTasks();
          writeJson(res, 200, { tasks });
        } catch (err: any) {
          logger.error({ err: err.message }, 'Failed to list active tasks');
          writeJson(res, 500, { error: 'Failed to list tasks', tasks: [] });
        }
        return;
      }
      // ── OpenAPI spec (auto-generated from route registry) ──

      if (pathname === '/api/v1/openapi.json' && req.method === 'GET') {
        const { buildNodeOpenApiSpec } = await import('./http-routes.js');
        const spec = buildNodeOpenApiSpec({
          serverUrl: `http://${req.headers.host || `localhost:${HTTP_PORT}`}`,
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(spec, null, 2));
        return;
      }

      // ── Web UI API: Node ──

      if ((pathname === '/api/v1/node' || pathname === '/api/node') && req.method === 'GET') {
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

      if ((pathname === '/api/v1/node/trust' || pathname === '/api/node/trust') && req.method === 'POST') {
        // Admin-only endpoint - require admin authentication
        const ctx = resolveHttpAdminContext(req);
        if (!ctx?.isAdmin) {
          writeJson(res, 403, { ok: false, error: 'admin_required' });
          return;
        }
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
    const session = resolveSessionContext(jid) || getSession(jid);
    broadcastToChat(jid, {
      type: 'message',
      id: options?.message_id,
      chat_jid: jid,
      agent_id: session?.agent_id,
      session_id: session?.session_id,
      text,
      embeds: options?.embeds,
      usage: session ? getUsageStats(session) : undefined,
    });
    logger.debug(
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
    const session = resolveSessionContext(jid) || getSession(jid);
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
