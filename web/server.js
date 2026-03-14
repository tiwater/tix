/**
 * Custom server entry for the TiClaw Hub.
 *
 * Combines:
 * 1. SvelteKit adapter-node handler (serves the web UI)
 * 2. WebSocket hub server (accepts claw connections)
 * 3. API relay (forwards web UI API calls to connected claws)
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

/** Pending API requests awaiting claw response */
const pendingRequests = new Map();
let requestIdCounter = 0;

/**
 * Get the first trusted claw connection (for API relay).
 * @returns {WebSocket | null}
 */
function getActiveClaw() {
  for (const [ws, info] of claws) {
    if (info.trusted && ws.readyState === WebSocket.OPEN) {
      return ws;
    }
  }
  return null;
}

/**
 * Send an API request to a claw and wait for response.
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: any }>}
 */
function relayToClaw(method, path, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const claw = getActiveClaw();
    if (!claw) {
      resolve({ status: 503, headers: {}, body: { error: 'no_claw_connected', message: 'No claw is currently connected to this hub' } });
      return;
    }

    const reqId = `hub-req-${++requestIdCounter}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      resolve({ status: 504, headers: {}, body: { error: 'timeout', message: 'Claw did not respond in time' } });
    }, timeoutMs);

    pendingRequests.set(reqId, { resolve, timer });

    claw.send(JSON.stringify({
      type: 'api_request',
      request_id: reqId,
      method,
      path,
      body,
    }));
  });
}

// ── HTTP Server ──

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // ── Hub-native API endpoints ──

  // List connected claws
  if (url.pathname === '/api/hub/claws' && req.method === 'GET') {
    const connected = [];
    for (const [, info] of claws) {
      connected.push(info);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ claws: connected }));
    return;
  }

  // ── API relay to claw ──
  // Forward /api/*, /runs/*, /health to the connected claw
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/runs') || url.pathname === '/health') {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // SSE stream — relay via WebSocket
    if (url.pathname.startsWith('/runs/') && url.pathname.endsWith('/stream')) {
      handleSSERelay(req, res, url);
      return;
    }

    // Regular API — relay to claw
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let parsedBody;
      try { parsedBody = body ? JSON.parse(body) : undefined; } catch { parsedBody = body; }

      const result = await relayToClaw(req.method || 'GET', url.pathname + url.search, parsedBody);
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...result.headers,
      });
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
    return;
  }

  // ── Everything else → SvelteKit ──
  handler(req, res, () => {
    res.writeHead(404);
    res.end('Not Found');
  });
});

// ── SSE relay (stream events from claw to browser) ──

/** @type {Map<string, Set<http.ServerResponse>>} */
const sseClients = new Map();

function handleSSERelay(req, res, url) {
  const claw = getActiveClaw();
  if (!claw) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_claw_connected' }));
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const streamKey = url.pathname + url.search;
  if (!sseClients.has(streamKey)) sseClients.set(streamKey, new Set());
  sseClients.get(streamKey).add(res);

  // Ask claw to start the stream
  const reqId = `hub-sse-${++requestIdCounter}`;
  claw.send(JSON.stringify({
    type: 'sse_subscribe',
    request_id: reqId,
    path: url.pathname + url.search,
  }));

  req.on('close', () => {
    sseClients.get(streamKey)?.delete(res);
    if (sseClients.get(streamKey)?.size === 0) sseClients.delete(streamKey);
  });
}

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
      const { claw_id, claw_fingerprint } = msg;
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

    case 'api_response': {
      // Response from claw for a relayed API request
      const pending = pendingRequests.get(msg.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.request_id);
        pending.resolve({
          status: msg.status || 200,
          headers: msg.headers || {},
          body: msg.body,
        });
      }
      break;
    }

    case 'sse_event': {
      // SSE event from claw — forward to subscribed browser clients
      const clients = sseClients.get(msg.stream_key);
      if (clients) {
        const eventData = `data: ${JSON.stringify(msg.event)}\n\n`;
        for (const res of clients) {
          res.write(eventData);
        }
      }
      break;
    }

    case 'message': {
      const info = claws.get(ws);
      if (info) {
        console.log(`[hub] Message from claw ${info.claw_id}: agent=${msg.agent_id} session=${msg.session_id}`);
      }
      break;
    }

    default:
      console.log(`[hub] Unknown message type: ${msg.type}`);
  }
}

// ── Start ──

httpServer.listen(PORT, HOST, () => {
  console.log(`[hub] TiClaw Hub listening on http://${HOST}:${PORT}`);
  console.log(`[hub] WebSocket hub ready for claw connections`);
});
