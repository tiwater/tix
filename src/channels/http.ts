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
import { URL } from 'url';

import { HTTP_PORT, HTTP_ENABLED } from '../core/config.js';
import { getMindState } from '../core/db.js';
import { logger } from '../core/logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import type { Channel, NewMessage, RegisteredProject } from '../core/types.js';

const WEB_JID_PREFIX = 'web:';

// ---- SSE connection store --------------------------------------------------

/** All active SSE response streams, keyed by chatJid. */
const sseClients = new Map<string, Set<http.ServerResponse>>();

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

    // SSE stream (ACP: /runs/:id/stream)
    if (
      pathname.startsWith('/runs/') &&
      pathname.endsWith('/stream') &&
      req.method === 'GET'
    ) {
      const parts = pathname.split('/');
      const runId = parts[2]; // /runs/123/stream

      const chatJidParam =
        runId || url.searchParams.get('chat_jid') || 'default';
      const chatJid = chatJidParam.startsWith(WEB_JID_PREFIX)
        ? chatJidParam
        : `${WEB_JID_PREFIX}${chatJidParam}`;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable nginx buffering
      });

      // Initial connected event
      res.write(
        `data: ${JSON.stringify({ type: 'connected', chat_jid: chatJid })}\n\n`,
      );

      addClient(chatJid, res);
      logger.info({ chatJid }, 'SSE client connected');

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
        logger.info({ chatJid }, 'SSE client disconnected');
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
          const { chat_jid: rawJid, sender, sender_name, content } = parsed;
          if (!content || typeof content !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'content is required' }));
            return;
          }

          const chatJid = rawJid
            ? rawJid.startsWith(WEB_JID_PREFIX)
              ? rawJid
              : `${WEB_JID_PREFIX}${rawJid}`
            : `${WEB_JID_PREFIX}default`;

          const senderId = sender || 'web-user';
          const senderName = sender_name || sender || 'Web User';
          const timestamp = new Date().toISOString();

          // Auto-register if needed
          const projects = this.opts.registeredProjects();
          if (!projects[chatJid] && this.opts.onGroupRegistered) {
            const group: RegisteredProject = {
              name: chatJid,
              folder: `web-${chatJid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50)}`,
              trigger: '',
              added_at: timestamp,
              requiresTrigger: false,
              isMain: false,
            };
            this.opts.onGroupRegistered(chatJid, group);
          }

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
          };

          this.opts.onMessage(chatJid, msg);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, chat_jid: chatJid, id: msg.id }));

          logger.info(
            { chatJid, sender: senderId, content: content.slice(0, 80) },
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
    broadcastToChat(jid, {
      type: 'message',
      chat_jid: jid,
      text,
      embeds: options?.embeds,
    });
    logger.info({ jid, length: text.length }, 'HTTP SSE message broadcast');
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
