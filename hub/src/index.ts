/**
 * TiClaw Hub — WebSocket server that accepts inbound node connections.
 *
 * Standalone package — no ticlaw core dependencies.
 * Ticos/Supen can `import { attachHub } from '@ticlaw/hub'` to embed.
 */

import http from 'node:http';
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
}

export interface HubOptions {
  /** Optional logger (defaults to console). */
  logger?: Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'>;
  /** Use noServer mode and manually handle upgrades. */
  handleUpgrade?: boolean;
}

// ── State ──

const nodes = new Map<WebSocket, NodeInfo>();
const pendingRequests = new Map<string, PendingRequest>();
const sseClients = new Map<string, Set<http.ServerResponse>>();
let requestIdCounter = 0;

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

    const reqId = `hub-req-${++requestIdCounter}`;
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
      nodes.set(ws, { node_id, node_fingerprint, trusted: true });
      log?.info?.(`[hub] Node enrolled: ${node_id}`);
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
      nodes.set(ws, { node_id, node_fingerprint, trusted: true });
      log?.info?.(`[hub] Node authenticated: ${node_id}`);
      ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
      break;
    }

    case 'report': {
      const info = nodes.get(ws);
      if (info) {
        log?.debug?.(`[hub] Report from ${info.node_id}: ${msg.status}`);
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
      log?.debug?.(`[hub] Unknown message type: ${msg.type}`);
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

  const reqId = `hub-sse-${++requestIdCounter}`;
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
    log.info?.(`[hub] New node connection from ${ip}`);

    ws.on('message', (data) => {
      try {
        handleNodeMessage(ws, JSON.parse(data.toString()), log);
      } catch (err) {
        log.error?.('[hub] Parse error:', err);
      }
    });

    ws.on('close', () => {
      const info = nodes.get(ws);
      if (info) log.info?.(`[hub] Node disconnected: ${info.node_id}`);
      nodes.delete(ws);
    });

    ws.on('error', (err) => {
      log.error?.('[hub] WebSocket error:', err);
    });
  });

  log.info?.('[hub] WebSocket hub attached');
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

  // Hub-native: list nodes
  if (url.pathname === '/api/hub/nodes' && req.method === 'GET') {
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
      res.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...result.headers,
      });
      res.end(
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      );
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
      log.info?.(`[hub] TiClaw Hub listening on http://${host}:${port}`);
      resolve(httpServer);
    });
  });
}
