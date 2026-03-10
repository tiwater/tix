/**
 * HTTP SSE channel for TiClaw.
 *
 * Exposes TiClaw as a streaming HTTP service so web UIs (e.g. Ticos) can
 * communicate without Discord/Feishu.
 *
 * Routes:
 *   POST /runs              — Start an agent run (send message)
 *   GET  /runs/:id/stream   — SSE stream of agent replies (per chat_jid/run)
 *   GET  /agents            — ACP Agent manifest
 *   GET  /api/mind          — Current MindState (JSON)
 *   GET  /health            — Liveness probe
 *
 * JID format: web:{id}
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';

import {
  HTTP_PORT,
  HTTP_ENABLED,
  CONTROL_PLANE_RUNTIME_ID,
  DEFAULT_RUNTIME_ID,
} from '../core/config.js';
import {
  createEnrollmentToken,
  readEnrollmentState,
  setTrustState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { ensureSession, getMindState, getSessionByChatJid } from '../core/db.js';
import { logger } from '../core/logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import type { Channel, NewMessage, RegisteredProject } from '../core/types.js';

const WEB_JID_PREFIX = 'web:';

// ---- SSE connection store --------------------------------------------------

/** All active SSE response streams, keyed by chatJid. */
const sseClients = new Map<string, Set<http.ServerResponse>>();
const activeHttpJobs = new Map<
  string,
  {
    runtime_id: string;
    agent_id: string;
    session_id: string;
    job_id: string;
  }
>();

function safeAgentFolder(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'agent';
}

function buildHttpChatJid(
  runtimeId: string,
  agentId: string,
  sessionId: string,
): string {
  return `${WEB_JID_PREFIX}${encodeURIComponent(runtimeId)}:${encodeURIComponent(agentId)}:${encodeURIComponent(sessionId)}`;
}

function addClient(chatJid: string, res: http.ServerResponse): void {
  if (!sseClients.has(chatJid)) sseClients.set(chatJid, new Set());
  sseClients.get(chatJid)!.add(res);
}

function removeClient(chatJid: string, res: http.ServerResponse): void {
  sseClients.get(chatJid)?.delete(res);
}

function broadcastToChat(chatJid: string, event: object): void {
  const clients = sseClients.get(chatJid);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// ---- CORS helper -----------------------------------------------------------

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ---- Channel implementation ------------------------------------------------

export class HttpChannel implements Channel {
  name = 'http';

  private server: http.Server | null = null;
  private opts: ChannelOpts;
  private _connected = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(HTTP_PORT, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });

    this._connected = true;
    logger.info({ port: HTTP_PORT }, 'HTTP SSE channel listening');
    console.log(
      `\n  HTTP SSE: http://localhost:${HTTP_PORT}/runs/{id}/stream\n`,
    );
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = new URL(req.url ?? '/', `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    setCorsHeaders(res);

    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Mind state
    if (pathname === '/api/mind' && req.method === 'GET') {
      try {
        const state = getMindState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get mind state' }));
      }
      return;
    }

    // ACP Manifest
    if (pathname === '/agents' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          name: 'TiClaw',
          description: 'TiClaw AI Agent',
          version: '1.0.0',
        }),
      );
      return;
    }

    // Enrollment status
    if (pathname === '/api/enroll/status' && req.method === 'GET') {
      const state = readEnrollmentState(CONTROL_PLANE_RUNTIME_ID || undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          runtime_id: state.runtime_id,
          runtime_fingerprint: state.runtime_fingerprint,
          trust_state: state.trust_state,
          token_expires_at: state.token_expires_at || null,
          failed_attempts: state.failed_attempts,
          frozen_until: state.frozen_until || null,
          trusted_at: state.trusted_at || null,
          revoked_at: state.revoked_at || null,
        }),
      );
      return;
    }

    // Enrollment token creation (local admin endpoint)
    if (pathname === '/api/enroll/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const ttlMinutes = Number(parsed.ttl_minutes);
          const result = createEnrollmentToken({
            ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : undefined,
            runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
          });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    // Enrollment verify
    if (pathname === '/api/enroll/verify' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const token = parsed.token;
          const runtimeFingerprint = parsed.runtime_fingerprint;
          if (!token || !runtimeFingerprint) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: false,
                code: 'bad_request',
                error: 'token and runtime_fingerprint are required',
              }),
            );
            return;
          }

          const result = verifyEnrollmentToken({
            token,
            runtimeFingerprint,
            runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
          });

          if (!result.ok) {
            const status =
              result.code === 'frozen'
                ? 423
                : result.code === 'expired'
                  ? 410
                  : 401;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: false,
                code: result.code,
                trust_state: result.state.trust_state,
              }),
            );
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              code: 'ok',
              trust_state: result.state.trust_state,
              trusted_at: result.state.trusted_at,
            }),
          );
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    // Enrollment revoke / suspend
    if (pathname === '/api/enroll/revoke' && req.method === 'POST') {
      const state = setTrustState('revoked', {
        runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trust_state: state.trust_state }));
      return;
    }

    if (pathname === '/api/enroll/suspend' && req.method === 'POST') {
      const state = setTrustState('suspended', {
        runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trust_state: state.trust_state }));
      return;
    }

    if (pathname === '/api/enroll/reenroll' && req.method === 'POST') {
      const state = setTrustState('discovered_untrusted', {
        runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trust_state: state.trust_state }));
      return;
    }

    // SSE stream (ACP: /runs/:id/stream)
    if (
      pathname.startsWith('/runs/') &&
      pathname.endsWith('/stream') &&
      req.method === 'GET'
    ) {
      const parts = pathname.split('/');
      const runId = parts[2];
      const runtimeId =
        url.searchParams.get('runtime_id') ||
        CONTROL_PLANE_RUNTIME_ID ||
        DEFAULT_RUNTIME_ID;
      const agentId = url.searchParams.get('agent_id');
      const sessionId = url.searchParams.get('session_id');

      if (!agentId || !sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'runtime_id, agent_id, and session_id are required',
          }),
        );
        return;
      }

      const chatJid = buildHttpChatJid(runtimeId, agentId, sessionId);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable nginx buffering
      });

      // Initial connected event
      res.write(
        `data: ${JSON.stringify({
          type: 'connected',
          chat_jid: chatJid,
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: runId,
        })}\n\n`,
      );

      addClient(chatJid, res);
      logger.info(
        {
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: runId,
          chat_jid: chatJid,
        },
        'SSE client connected',
      );

      // Heartbeat to prevent proxy timeout (every 20s)
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
        logger.info(
          {
            runtime_id: runtimeId,
            agent_id: agentId,
            session_id: sessionId,
            job_id: runId,
            chat_jid: chatJid,
          },
          'SSE client disconnected',
        );
      });
      return;
    }

    // Inbound message (ACP: POST /runs)
    if (pathname === '/runs' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const {
            runtime_id: rawRuntimeId,
            agent_id: rawAgentId,
            session_id: rawSessionId,
            job_id: rawJobId,
            sender,
            sender_name,
            content,
          } = parsed;
          if (!content || typeof content !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'content is required' }));
            return;
          }

          const runtimeId =
            rawRuntimeId || CONTROL_PLANE_RUNTIME_ID || DEFAULT_RUNTIME_ID;
          const agentId =
            typeof rawAgentId === 'string' && rawAgentId.trim()
              ? rawAgentId.trim()
              : null;
          const sessionId =
            typeof rawSessionId === 'string' && rawSessionId.trim()
              ? rawSessionId.trim()
              : null;
          const jobId =
            typeof rawJobId === 'string' && rawJobId.trim()
              ? rawJobId.trim()
              : randomUUID();

          if (!agentId || !sessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'runtime_id, agent_id, and session_id are required',
              }),
            );
            return;
          }

          const chatJid = buildHttpChatJid(runtimeId, agentId, sessionId);

          const senderId = sender || 'web-user';
          const senderName = sender_name || sender || 'Web User';
          const timestamp = new Date().toISOString();

          // Enforce trust state: untrusted runtime cannot run executable jobs.
          const enrollState = readEnrollmentState(
            CONTROL_PLANE_RUNTIME_ID || undefined,
          );
          if (enrollState.trust_state !== 'trusted') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'runtime_not_trusted',
                trust_state: enrollState.trust_state,
              }),
            );
            return;
          }

          // Auto-register if needed
          const projects = this.opts.registeredProjects();
          if (!projects[chatJid] && this.opts.onGroupRegistered) {
            const group: RegisteredProject = {
              name: agentId,
              folder: safeAgentFolder(agentId),
              runtime_id: runtimeId,
              agent_id: agentId,
              trigger: '',
              added_at: timestamp,
              requiresTrigger: false,
              isMain: false,
            };
            this.opts.onGroupRegistered(chatJid, group);
          }

          const group = this.opts.registeredProjects()[chatJid];
          const agentFolder = group?.folder || safeAgentFolder(agentId);
          ensureSession({
            runtime_id: runtimeId,
            agent_id: agentId,
            session_id: sessionId,
            chat_jid: chatJid,
            channel: 'http',
            agent_name: group?.name || agentId,
            agent_folder: agentFolder,
          });
          activeHttpJobs.set(chatJid, {
            runtime_id: runtimeId,
            agent_id: agentId,
            session_id: sessionId,
            job_id: jobId,
          });

          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'http',
            false,
          );

          const msg: NewMessage = {
            id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chat_jid: chatJid,
            sender: senderId,
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: false,
            runtime_id: runtimeId,
            agent_id: agentId,
            session_id: sessionId,
            job_id: jobId,
          };

          this.opts.onMessage(chatJid, msg);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              runtime_id: runtimeId,
              agent_id: agentId,
              session_id: sessionId,
              job_id: jobId,
              chat_jid: chatJid,
              id: msg.id,
            }),
          );

          logger.info(
            {
              runtime_id: runtimeId,
              agent_id: agentId,
              session_id: sessionId,
              job_id: jobId,
              chat_jid: chatJid,
              sender: senderId,
              content: content.slice(0, 80),
            },
            'HTTP message received',
          );
        } catch (err) {
          logger.error({ err }, 'Failed to parse HTTP message body');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  async sendMessage(
    jid: string,
    text: string,
    options?: { embeds?: any[] },
  ): Promise<void> {
    if (!text.trim()) return;
    const session = getSessionByChatJid(jid);
    const activeJob = activeHttpJobs.get(jid);
    broadcastToChat(jid, {
      type: 'message',
      chat_jid: jid,
      runtime_id: activeJob?.runtime_id || session?.runtime_id,
      agent_id: activeJob?.agent_id || session?.agent_id,
      session_id: activeJob?.session_id || session?.session_id,
      job_id: activeJob?.job_id,
      text,
      embeds: options?.embeds,
    });
    logger.info(
      {
        runtime_id: activeJob?.runtime_id || session?.runtime_id,
        agent_id: activeJob?.agent_id || session?.agent_id,
        session_id: activeJob?.session_id || session?.session_id,
        job_id: activeJob?.job_id,
        chat_jid: jid,
        length: text.length,
      },
      'HTTP SSE message broadcast',
    );
  }

  async sendFile(
    jid: string,
    _filePath: string,
    _caption?: string,
  ): Promise<void> {
    logger.warn({ jid }, 'HttpChannel.sendFile not implemented');
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
    // Close all SSE streams
    for (const clients of sseClients.values()) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
    sseClients.clear();
    activeHttpJobs.clear();
    logger.info('HTTP SSE channel disconnected');
  }
}

// ---- Channel registration --------------------------------------------------

function createHttpChannel(opts: ChannelOpts): HttpChannel | null {
  if (!HTTP_ENABLED) {
    logger.debug('HTTP channel disabled (HTTP_ENABLED=false)');
    return null;
  }
  return new HttpChannel(opts);
}

registerChannel('http', createHttpChannel);
