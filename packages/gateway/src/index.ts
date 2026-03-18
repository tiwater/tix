/**
 * TiClaw Gateway — WebSocket relay that accepts inbound node node connections.
 *
 * Standalone package — no ticlaw core dependencies.
 * Ticos/Supen can `import { attachHub } from '@ticlaw/gateway'` to embed.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

export interface NodeInfo {
  node_id: string;
  node_fingerprint: string;
  trusted: boolean;
}

interface PendingRequest {
  resolve: (result: RelayResult) => void;
  timer: NodeJS.Timeout;
}

export interface RelayResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  encoding?: 'base64';
}

export interface HubOptions {
  /** Optional logger (defaults to console). */
  logger?: Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'>;
  /** Use noServer mode and manually handle upgrades. */
  handleUpgrade?: boolean;
}

// ── State ──

const nodes = new Map<WebSocket, NodeInfo>();
const connectionIps = new Map<WebSocket, string>();
const pendingRequests = new Map<string, PendingRequest>();
const sseClients = new Map<string, Set<http.ServerResponse>>();
let requestIdCounter = 0;

function parseCsvSet(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

const ALLOWED_NODE_IDS = parseCsvSet(process.env.HUB_ALLOWED_NODE_IDS);
const ALLOWED_NODE_FINGERPRINTS = parseCsvSet(
  process.env.HUB_ALLOWED_NODE_FINGERPRINTS,
);

/**
 * GATEWAY_SECRET — pre-shared secret for node authentication.
 * When set, every enroll/auth message MUST include a valid HMAC token.
 * Token format: `${nodeId}.${timestampMs}.${hmacHex}` where hmacHex is
 * HMAC-SHA256(secret, `${nodeId}:${timestampMs}`).
 * Timestamps more than TOKEN_VALIDITY_MS old are rejected (replay protection).
 */
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
const TOKEN_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

function verifyNodeToken(
  token: string | undefined,
  nodeId: string,
): { ok: boolean; code?: string } {
  if (!GATEWAY_SECRET) {
    // No secret configured — gateway is in open mode (warn once at startup)
    return { ok: true };
  }
  if (!token) {
    return { ok: false, code: 'token_required' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, code: 'token_malformed' };
  }
  const [tokenNodeId, tsStr, givenHmac] = parts as [string, string, string];
  if (tokenNodeId !== nodeId) {
    return { ok: false, code: 'token_node_mismatch' };
  }
  const ts = parseInt(tsStr, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOKEN_VALIDITY_MS) {
    return { ok: false, code: 'token_expired' };
  }
  const expected = crypto
    .createHmac('sha256', GATEWAY_SECRET)
    .update(`${nodeId}:${tsStr}`)
    .digest('hex');
  try {
    const givenBuf = Buffer.from(givenHmac, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (
      givenBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(givenBuf, expectedBuf)
    ) {
      return { ok: false, code: 'token_invalid' };
    }
  } catch {
    return { ok: false, code: 'token_invalid' };
  }
  return { ok: true };
}

function isNodeAllowed(nodeId: string, nodeFingerprint: string): boolean {
  if (ALLOWED_NODE_IDS.size > 0 && !ALLOWED_NODE_IDS.has(nodeId)) {
    return false;
  }
  if (
    ALLOWED_NODE_FINGERPRINTS.size > 0 &&
    !ALLOWED_NODE_FINGERPRINTS.has(nodeFingerprint)
  ) {
    return false;
  }
  return true;
}

// ── Public API ──

export function listNodes(): NodeInfo[] {
  return Array.from(nodes.values());
}

export function getActiveNode(): WebSocket | null {
  for (const [ws, info] of nodes) {
    if (info.trusted && ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

export function relayToNode(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 15000,
): Promise<RelayResult> {
  return new Promise((resolve) => {
    const node = getActiveNode();
    if (!node) {
      resolve({
        status: 503,
        headers: {},
        body: {
          error: 'no_node_connected',
          message: 'No node is currently connected to this hub',
        },
      });
      return;
    }

    const reqId = `gateway-req-${++requestIdCounter}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      resolve({
        status: 504,
        headers: {},
        body: { error: 'timeout', message: 'Node did not respond in time' },
      });
    }, timeoutMs);

    pendingRequests.set(reqId, { resolve, timer });
    node.send(
      JSON.stringify({ type: 'api_request', request_id: reqId, method, path, body }),
    );
  });
}

// ── Node message handler ──

function handleNodeMessage(
  ws: WebSocket,
  msg: Record<string, unknown>,
  log: HubOptions['logger'],
): void {
  switch (msg.type) {
    case 'enroll': {
      const node_id = msg.node_id as string;
      const node_fingerprint = msg.node_fingerprint as string;
      // gateway_token = HMAC credential (separate from enrollment trust_token)
      const tokenCheck = verifyNodeToken(msg.gateway_token as string | undefined, node_id);
      if (!tokenCheck.ok) {
        log?.warn?.(
          `[gateway] Rejected node enrollment for id=${node_id}: ${tokenCheck.code}`,
        );
        ws.send(
          JSON.stringify({
            type: 'enrollment_result',
            ok: false,
            code: tokenCheck.code,
          }),
        );
        ws.close();
        break;
      }
      if (!isNodeAllowed(node_id, node_fingerprint)) {
        log?.warn?.(
          `[gateway] Rejected node enrollment for id=${node_id} from ${connectionIps.get(ws) || 'unknown-ip'} due to allowlist policy`,
        );
        ws.send(
          JSON.stringify({
            type: 'enrollment_result',
            ok: false,
            code: 'node_not_allowed',
          }),
        );
        ws.close();
        break;
      }
      nodes.set(ws, { node_id, node_fingerprint, trusted: true });
      log?.info?.(`[gateway] Node enrolled: ${node_id}`);
      ws.send(
        JSON.stringify({
          type: 'enrollment_result',
          ok: true,
          node_id,
          node_fingerprint,
        }),
      );
      break;
    }

    case 'auth': {
      const node_id = msg.node_id as string;
      const node_fingerprint = msg.node_fingerprint as string;
      const tokenCheck = verifyNodeToken(msg.token as string | undefined, node_id);
      if (!tokenCheck.ok) {
        log?.warn?.(
          `[gateway] Rejected node auth for id=${node_id}: ${tokenCheck.code}`,
        );
        ws.send(
          JSON.stringify({
            type: 'auth_result',
            ok: false,
            code: tokenCheck.code,
          }),
        );
        ws.close();
        break;
      }
      if (!isNodeAllowed(node_id, node_fingerprint)) {
        log?.warn?.(
          `[gateway] Rejected node auth for id=${node_id} from ${connectionIps.get(ws) || 'unknown-ip'} due to allowlist policy`,
        );
        ws.send(
          JSON.stringify({
            type: 'auth_result',
            ok: false,
            code: 'node_not_allowed',
          }),
        );
        ws.close();
        break;
      }
      nodes.set(ws, { node_id, node_fingerprint, trusted: true });
      log?.info?.(`[gateway] Node authenticated: ${node_id}`);
      ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
      break;
    }

    case 'report': {
      const info = nodes.get(ws);
      if (info) {
        log?.debug?.(`[gateway] Report from ${info.node_id}: ${msg.status}`);
      }
      break;
    }

    case 'api_response': {
      const reqId = msg.request_id as string;
      const pending = pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(reqId);
        pending.resolve({
          status: (msg.status as number) || 200,
          headers: (msg.headers as Record<string, string>) || {},
          body: msg.body,
          encoding: msg.encoding === 'base64' ? 'base64' : undefined,
        });
      }
      break;
    }

    case 'sse_event': {
      const streamKey = msg.stream_key as string;
      const clients = sseClients.get(streamKey);
      if (clients) {
        const eventData = `data: ${JSON.stringify(msg.event)}\n\n`;
        for (const res of clients) {
          res.write(eventData);
        }
      }
      break;
    }

    default:
      log?.debug?.(`[gateway] Unknown message type: ${msg.type}`);
  }
}

// ── SSE relay ──

function handleSSERelay(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const node = getActiveNode();
  if (!node) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_node_connected' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const streamKey = url.pathname + url.search;
  // streamKey logged at debug level to avoid noise
  if (!sseClients.has(streamKey)) sseClients.set(streamKey, new Set());
  sseClients.get(streamKey)!.add(res);

  const reqId = `gateway-sse-${++requestIdCounter}`;
  node.send(
    JSON.stringify({ type: 'sse_subscribe', request_id: reqId, path: streamKey }),
  );

  req.on('close', () => {
    sseClients.get(streamKey)?.delete(res);
    if (sseClients.get(streamKey)?.size === 0) sseClients.delete(streamKey);
  });
}

// ── Attach hub to HTTP server ──

/**
 * Attach the WebSocket hub to an HTTP server.
 * Call this on any http.Server to enable node connections.
 */
export function attachHub(
  httpServer: http.Server,
  opts: HubOptions = {},
): WebSocketServer {
  const log = opts.logger ?? console;

  const wss = opts.handleUpgrade
    ? new WebSocketServer({ noServer: true })
    : new WebSocketServer({ server: httpServer });

  if (opts.handleUpgrade) {
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url || '/';
      if (url === '/' || url.startsWith('/?')) return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  }

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ipText = Array.isArray(ip) ? ip[0] : String(ip || '');
    connectionIps.set(ws, ipText);
    log.info?.(`[gateway] New node connection from ${ip}`);

    ws.on('message', (data) => {
      try {
        handleNodeMessage(ws, JSON.parse(data.toString()), log);
      } catch (err) {
        log.error?.('[gateway] Parse error:', err);
      }
    });

    ws.on('close', () => {
      const info = nodes.get(ws);
      if (info) log.info?.(`[gateway] Node disconnected: ${info.node_id}`);
      nodes.delete(ws);
      connectionIps.delete(ws);
    });

    ws.on('error', (err) => {
      log.error?.('[gateway] WebSocket error:', err);
    });
  });

  log.info?.('[gateway] WebSocket gateway attached');
  return wss;
}

// ── HTTP request handler (API relay middleware) ──

/**
 * Handle an HTTP request — route hub API or relay to node.
 * Returns true if handled, false to pass through.
 */
export function handleHubRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Gateway-native: list nodes
  if (url.pathname === '/api/gateway/nodes' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ nodes: listNodes() }));
    return true;
  }



  // CORS preflight
  if (
    req.method === 'OPTIONS' &&
    (url.pathname.startsWith('/api/') || url.pathname.startsWith('/runs'))
  ) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  // SSE stream relay
  if (url.pathname.startsWith('/runs/') && url.pathname.endsWith('/stream')) {
    handleSSERelay(req, res, url);
    return true;
  }

  // API relay to node
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/runs') ||
    url.pathname === '/health'
  ) {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
    });
    req.on('end', async () => {
      let parsedBody: unknown;
      try {
        parsedBody = body ? JSON.parse(body) : undefined;
      } catch {
        parsedBody = body;
      }
      const result = await relayToNode(
        req.method || 'GET',
        url.pathname + url.search,
        parsedBody,
      );

      if (result.encoding === 'base64' && typeof result.body === 'string') {
        // Binary response from node — decode base64 and stream
        const buffer = Buffer.from(result.body, 'base64');
        res.writeHead(result.status, {
          'Access-Control-Allow-Origin': '*',
          ...result.headers,
          'Content-Length': String(buffer.length),
        });
        res.end(buffer);
      } else {
        // JSON response
        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          ...result.headers,
        });
        res.end(
          typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
        );
      }
    });
    return true;
  }

  return false;
}

// ── Convenience: create + start a hub server ──

export interface StartHubOptions extends HubOptions {
  port?: number;
  host?: string;
  /** Optional HTTP request handler for non-hub routes (e.g., serving static files). */
  onRequest?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

/**
 * Create and start a standalone hub server.
 * Convenience for quick setup — or use attachHub() for more control.
 */
export function startHub(opts: StartHubOptions = {}): Promise<http.Server> {
  const port = opts.port ?? parseInt(process.env.HUB_PORT || '2755', 10);
  const host = opts.host ?? '0.0.0.0';
  const log = opts.logger ?? console;

  const httpServer = http.createServer((req, res) => {
    if (handleHubRequest(req, res)) return;
    if (opts.onRequest) {
      opts.onRequest(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  attachHub(httpServer, opts);

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      log.info?.(`[gateway] TiClaw Gateway listening on http://${host}:${port}`);
      resolve(httpServer);
    });
  });
}
