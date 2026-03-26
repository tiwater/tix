/**
 * TiClaw Gateway — WebSocket relay that accepts inbound node node connections.
 *
 * Standalone package — no ticlaw core dependencies.
 * Ticos/Supen can `import { attachGateway } from '@ticlaw/gateway'` to embed.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { listCloudNodes, launchCloudNode, deleteCloudNode, getCloudNodeMeta } from './cloud-nodes.js';

export interface NodeInfo {
  node_id: string;
  node_fingerprint: string;
  trusted: boolean;
  /** True if the WebSocket connection is currently open. */
  online: boolean;
  /** ISO timestamp of last message received from this node. */
  last_seen?: string;
  /** IP address the node connected from. */
  ip?: string;
  /** System telemetry data. */
  telemetry?: any;
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

export interface GatewayOptions {
  /** Optional logger (defaults to console). */
  logger?: Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'>;
  /** Use noServer mode and manually handle upgrades. */
  handleUpgrade?: boolean;
}

// ── State ──

interface NodeState {
  info: NodeInfo;
  lastSeen: number;
}

const nodes = new Map<WebSocket, NodeState>();
const pendingRequests = new Map<string, PendingRequest>();
const sseClients = new Map<string, Set<http.ServerResponse>>();
let requestIdCounter = 0;

/**
 * TICLAW_GATEWAY_API_KEY — API key that controller clients (e.g. Supen) must provide.
 * When set, every inbound HTTP request must carry `Authorization: Bearer <key>`.
 * If unset, the gateway is in open mode (development only).
 */
const GATEWAY_API_KEY = process.env.TICLAW_GATEWAY_API_KEY || '';

function parseCsvSet(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

const ALLOWED_NODE_IDS = parseCsvSet(
  process.env.TICLAW_GATEWAY_ALLOWED_NODE_IDS,
);
const ALLOWED_NODE_FINGERPRINTS = parseCsvSet(
  process.env.TICLAW_GATEWAY_ALLOWED_NODE_FINGERPRINTS,
);

/**
 * TICLAW_GATEWAY_SECRET — pre-shared secret for node authentication.
 * When set, every enroll/auth message MUST include a valid HMAC token.
 * Token format: `${nodeId}.${timestampMs}.${hmacHex}` where hmacHex is
 * HMAC-SHA256(secret, `${nodeId}:${timestampMs}`).
 * Timestamps more than TOKEN_VALIDITY_MS old are rejected (replay protection).
 */
const GATEWAY_SECRET = process.env.TICLAW_GATEWAY_SECRET || '';
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
  return Array.from(nodes.values()).map(({ info, lastSeen }) => ({
    ...info,
    online: true,
    last_seen: new Date(lastSeen).toISOString(),
  }));
}

/** Get the WebSocket for a specific node by node_id. */
export function getNodeById(nodeId: string): WebSocket | null {
  for (const [ws, { info }] of nodes) {
    if (info.node_id === nodeId && info.trusted && ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

export function getActiveNode(): WebSocket | null {
  for (const [ws, { info }] of nodes) {
    if (info.trusted && ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

export function relayToNode(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 15000,
  targetNodeId?: string,
): Promise<RelayResult> {
  return new Promise((resolve) => {
    const node = targetNodeId ? getNodeById(targetNodeId) : getActiveNode();
    if (!node) {
      const msg = targetNodeId
        ? `Node '${targetNodeId}' is not connected to this gateway`
        : 'No node is currently connected to this gateway';
      resolve({ status: 503, headers: {}, body: { error: 'no_node_connected', message: msg } });
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
  log: GatewayOptions['logger'],
): void {
  // Update last_seen on every message
  const state = nodes.get(ws);
  if (state) state.lastSeen = Date.now();

  switch (msg.type) {
    case 'enroll': {
      const node_id = msg.node_id as string;
      const node_fingerprint = msg.node_fingerprint as string;
      const ip = nodes.get(ws)?.info.ip;
      // gateway_token = HMAC credential (separate from enrollment trust_token)
      const tokenCheck = verifyNodeToken(msg.gateway_token as string | undefined, node_id);
      if (!tokenCheck.ok) {
        log?.warn?.(
          `[gateway] Rejected node enrollment for id=${node_id}: ${tokenCheck.code}`,
        );
        ws.send(JSON.stringify({ type: 'enrollment_result', ok: false, code: tokenCheck.code }));
        ws.close();
        break;
      }
      if (!isNodeAllowed(node_id, node_fingerprint)) {
        log?.warn?.(
          `[gateway] Rejected node enrollment for id=${node_id} from ${ip || 'unknown-ip'} due to allowlist policy`,
        );
        ws.send(JSON.stringify({ type: 'enrollment_result', ok: false, code: 'node_not_allowed' }));
        ws.close();
        break;
      }
      nodes.set(ws, { info: { node_id, node_fingerprint, trusted: true, online: true, ip }, lastSeen: Date.now() });
      log?.info?.(`[gateway] Node enrolled: ${node_id}`);
      ws.send(JSON.stringify({ type: 'enrollment_result', ok: true, node_id, node_fingerprint }));
      break;
    }

    case 'auth': {
      const node_id = msg.node_id as string;
      const node_fingerprint = msg.node_fingerprint as string;
      const ip = nodes.get(ws)?.info.ip;
      const tokenCheck = verifyNodeToken(msg.token as string | undefined, node_id);
      if (!tokenCheck.ok) {
        log?.warn?.(`[gateway] Rejected node auth for id=${node_id}: ${tokenCheck.code}`);
        ws.send(JSON.stringify({ type: 'auth_result', ok: false, code: tokenCheck.code }));
        ws.close();
        break;
      }
      if (!isNodeAllowed(node_id, node_fingerprint)) {
        log?.warn?.(`[gateway] Rejected node auth for id=${node_id} from ${ip || 'unknown-ip'} due to allowlist policy`);
        ws.send(JSON.stringify({ type: 'auth_result', ok: false, code: 'node_not_allowed' }));
        ws.close();
        break;
      }
      nodes.set(ws, { info: { node_id, node_fingerprint, trusted: true, online: true, ip }, lastSeen: Date.now() });
      log?.info?.(`[gateway] Node authenticated: ${node_id}`);
      ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
      break;
    }

    case 'report': {
      const state = nodes.get(ws);
      if (state) {
        state.lastSeen = Date.now();
        if (msg.telemetry) {
          state.info.telemetry = msg.telemetry;
        }
        log?.debug?.(`[gateway] Report from ${state.info.node_id}: ${msg.status}`);
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

// ── Attach gateway WebSocket server to an HTTP server ──

/**
 * Attach the WebSocket gateway to an HTTP server.
 * Call this on any http.Server to enable node connections.
 */
export function attachGateway(
  httpServer: http.Server,
  opts: GatewayOptions = {},
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
    // Pre-populate state with IP so enroll/auth handlers can read it
    nodes.set(ws, {
      info: { node_id: '', node_fingerprint: '', trusted: false, online: true, ip: ipText },
      lastSeen: Date.now(),
    });
    log.info?.(`[gateway] New node connection from ${ipText}`);

    ws.on('message', (data) => {
      try {
        handleNodeMessage(ws, JSON.parse(data.toString()), log);
      } catch (err) {
        log.error?.('[gateway] Parse error:', err);
      }
    });

    ws.on('close', () => {
      const state = nodes.get(ws);
      if (state?.info.node_id) log.info?.(`[gateway] Node disconnected: ${state.info.node_id}`);
      nodes.delete(ws);
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
 * Handle an HTTP request — route gateway API or relay to node.
 * Returns true if the request was handled.
 */
export async function handleGatewayRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // ── OpenAPI spec (gateway-native paths + node paths fetched live) ──
  if (url.pathname === '/openapi.json' && req.method === 'GET') {
    const gatewayUrl = `http://${req.headers.host || 'localhost'}`;

    // Gateway-native paths (always present, no node needed)
    const gatewayPaths: Record<string, unknown> = {
      '/openapi.json': { get: { tags: ['Gateway'], summary: 'OpenAPI spec (this document)', security: [], responses: { '200': { description: 'OpenAPI 3.0 JSON' } } } },
      '/health': { get: { tags: ['Gateway'], summary: 'Gateway health (node count, uptime)', security: [], responses: { '200': { description: 'OK' } } } },
      '/api/gateway/nodes': { get: { tags: ['Gateway'], summary: 'List connected nodes', responses: { '200': { description: 'Nodes array' } } } },
    };

    // Try to fetch node spec and merge
    let nodePaths: Record<string, unknown> = {};
    let nodeInfo: Record<string, unknown> = {};
    try {
      const nodeSpec = await relayToNode('GET', '/api/v1/openapi.json', undefined, 5000);
      if (nodeSpec.status === 200 && nodeSpec.body && typeof nodeSpec.body === 'object') {
        const spec = nodeSpec.body as Record<string, unknown>;
        nodePaths = (spec.paths as Record<string, unknown>) || {};
        nodeInfo = (spec.info as Record<string, unknown>) || {};
      }
    } catch { /* node not connected — return gateway-only spec */ }

    const spec = {
      openapi: '3.0.3',
      info: {
        title: 'TiClaw Gateway API',
        version: (nodeInfo.version as string) || '1.0.0',
        description:
          'TiClaw Gateway API. Gateway-native routes (/health, /api/gateway/*) plus all node routes relayed transparently. ' +
          'Use X-Node-Id header to target a specific node.',
      },
      servers: [{ url: gatewayUrl, description: 'TiClaw Gateway' }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'Set via TICLAW_GATEWAY_API_KEY env var.' },
        },
      },
      paths: { ...gatewayPaths, ...nodePaths },
    };

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(spec, null, 2));
    return true;
  }

  // ── Gateway-native: health (own status, not relayed) ──
  if (url.pathname === '/health' && req.method === 'GET') {
    const connected = Array.from(nodes.values()).filter(
      ({ info }) => info.trusted && info.node_id,
    );
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      status: 'ok',
      gateway: true,
      nodes_connected: connected.length,
      uptime_s: Math.floor(process.uptime()),
    }));
    return true;
  }

  // ── Gateway-native: list nodes ──
  if (url.pathname === '/api/gateway/nodes' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ nodes: listNodes() }));
    return true;
  }

  // ── CORS preflight ──
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Node-Id',
  };
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // ── Controller auth ──
  if (GATEWAY_API_KEY) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== GATEWAY_API_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'unauthorized', message: 'Missing or invalid API key' }));
      return true;
    }
  }

  // ── Gateway-native: cloud node provisioning ──
  if (url.pathname === '/api/gateway/cloud-nodes' && req.method === 'GET') {
    try {
      const [nodes, meta] = await Promise.all([listCloudNodes(), getCloudNodeMeta()]);
      
      const connectedNodes = listNodes();
      for (const node of nodes) {
        const isOnline = connectedNodes.some((n) => n.node_id === node.nodeId && n.online);
        if (isOnline) {
          node.status = 'online';
        } else if (node.status === 'live') {
          node.status = 'offline';
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ nodes, meta }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err?.message || 'Failed to list cloud nodes' }));
    }
    return true;
  }

  if (url.pathname === '/api/gateway/cloud-nodes' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        if (!input.name || !input.tier || !input.region) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'name, tier, and region are required' }));
          return;
        }
        const result = await launchCloudNode(input);
        res.writeHead(201, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err?.message || 'Failed to launch cloud node' }));
      }
    });
    return true;
  }

  if (url.pathname.startsWith('/api/gateway/cloud-nodes/') && req.method === 'DELETE') {
    const serviceId = url.pathname.split('/').pop();
    if (!serviceId) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing service ID' }));
      return true;
    }
    try {
      await deleteCloudNode(serviceId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err?.message || 'Failed to delete cloud node' }));
    }
    return true;
  }

  // ── SSE stream relay — any path ending in /stream ──
  if (req.method === 'GET' && url.pathname.endsWith('/stream')) {
    handleSSERelay(req, res, url);
    return true;
  }

  // ── API relay to node (with optional X-Node-Id targeting) ──
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/runs')) {
    const targetNodeId = req.headers['x-node-id'] as string | undefined;
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      let parsedBody: unknown;
      try { parsedBody = body ? JSON.parse(body) : undefined; } catch { parsedBody = body; }
      const result = await relayToNode(req.method || 'GET', url.pathname + url.search, parsedBody, 15000, targetNodeId);

      if (result.encoding === 'base64' && typeof result.body === 'string') {
        const buffer = Buffer.from(result.body, 'base64');
        const headers = { ...result.headers };
        delete headers['content-length'];
        delete headers['Content-Length'];
        res.writeHead(result.status, { 'Access-Control-Allow-Origin': '*', ...headers, 'Content-Length': String(buffer.length) });
        res.end(buffer);
      } else {
        const headers = { ...result.headers };
        delete headers['content-length'];
        delete headers['Content-Length'];
        const responseBody = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
        res.writeHead(result.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers, 'Content-Length': String(Buffer.byteLength(responseBody)) });
        res.end(responseBody);
      }
    });
    return true;
  }

  return false;
}

// ── Convenience: create + start a standalone gateway server ──

export interface StartGatewayOptions extends GatewayOptions {
  port?: number;
  host?: string;
  /** Optional HTTP request handler for non-gateway routes (e.g., serving static files). */
  onRequest?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

/** @deprecated Use startGateway() */
export const StartHubOptions = undefined;

/**
 * Create and start a standalone gateway server.
 * Convenience for quick setup — or use attachHub() for more control.
 */
export function startGateway(opts: StartGatewayOptions = {}): Promise<http.Server> {
  const port = opts.port ?? parseInt(
    process.env.PORT ?? process.env.GATEWAY_PORT ?? process.env.HUB_PORT ?? '2755',
    10,
  );
  const host = opts.host ?? '0.0.0.0';
  const log = opts.logger ?? console;

  const httpServer = http.createServer(async (req, res) => {
    if (await handleGatewayRequest(req, res)) return;
    if (opts.onRequest) {
      opts.onRequest(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  attachGateway(httpServer, opts);

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      log.info?.(`[gateway] TiClaw Gateway listening on ws://${host}:${port}`);
      resolve(httpServer);
    });
  });
}
