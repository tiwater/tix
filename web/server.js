/**
 * Custom server entry for the TiClaw Hub.
 *
 * Combines:
 * 1. SvelteKit adapter-node handler (serves the web UI)
 * 2. WebSocket hub server (accepts claw connections)
 *
 * Start with: node server.js  (from the web/ directory after build)
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { handler } from './build/handler.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── Connected Claws ──

/** @type {Map<WebSocket, { claw_id: string, claw_fingerprint: string, trusted: boolean }>} */
const claws = new Map();

// ── HTTP Server ──

const httpServer = http.createServer((req, res) => {
  // SvelteKit handles all HTTP requests
  handler(req, res, () => {
    res.writeHead(404);
    res.end('Not Found');
  });
});

// ── WebSocket Hub Server ──

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[hub] New WebSocket connection from ${ip}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClawMessage(ws, msg);
    } catch (err) {
      console.error('[hub] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    const info = claws.get(ws);
    if (info) {
      console.log(`[hub] Claw disconnected: ${info.claw_id}`);
      claws.delete(ws);
    }
  });

  ws.on('error', (err) => {
    console.error('[hub] WebSocket error:', err.message);
  });
});

/**
 * Handle messages from connected claws.
 * @param {WebSocket} ws
 * @param {any} msg
 */
function handleClawMessage(ws, msg) {
  switch (msg.type) {
    case 'enroll': {
      // Trust on first use — accept the claw
      const { token, claw_id, claw_fingerprint } = msg;
      claws.set(ws, { claw_id, claw_fingerprint, trusted: true });
      console.log(`[hub] Claw enrolled: ${claw_id} (fingerprint: ${claw_fingerprint?.slice(0, 16)}...)`);
      ws.send(JSON.stringify({
        type: 'enrollment_result',
        ok: true,
        claw_id,
        claw_fingerprint,
      }));
      break;
    }

    case 'auth': {
      const { claw_id, claw_fingerprint } = msg;
      claws.set(ws, { claw_id, claw_fingerprint, trusted: true });
      console.log(`[hub] Claw authenticated: ${claw_id}`);
      ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
      break;
    }

    case 'report': {
      const info = claws.get(ws);
      if (info) {
        console.log(`[hub] Status report from ${info.claw_id}: ${msg.status} (trust: ${msg.trust_state})`);
      }
      break;
    }

    case 'message': {
      // Message from claw (agent response) — forward to relevant web clients
      const info = claws.get(ws);
      if (info) {
        console.log(`[hub] Message from claw ${info.claw_id}: agent=${msg.agent_id} session=${msg.session_id}`);
      }
      // TODO: Forward to web UI clients via SSE or another WebSocket channel
      break;
    }

    default:
      console.log(`[hub] Unknown message type: ${msg.type}`);
  }
}

// ── API: List connected claws ──
// Expose /api/hub/claws endpoint for the web UI

const originalHandler = httpServer.listeners('request')[0];
httpServer.removeAllListeners('request');
httpServer.on('request', (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/hub/claws' && req.method === 'GET') {
    const connected = [];
    for (const [, info] of claws) {
      connected.push(info);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ claws: connected }));
    return;
  }

  // Fall through to SvelteKit handler
  if (typeof originalHandler === 'function') {
    originalHandler(req, res);
  }
});

// ── Start ──

httpServer.listen(PORT, HOST, () => {
  console.log(`[hub] TiClaw Hub listening on http://${HOST}:${PORT}`);
  console.log(`[hub] WebSocket hub ready for claw connections`);
});
