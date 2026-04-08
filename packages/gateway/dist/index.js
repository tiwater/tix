/**
 * Tix Gateway — WebSocket relay that accepts inbound computer connections.
 *
 * Standalone package — no tix core dependencies.
 * Ticos/Supen can `import { attachGateway } from '@tix/gateway'` to embed.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Readable } from 'node:stream';
import { listCloudComputers, launchCloudComputer, deleteCloudComputer, getCloudComputerMeta } from './cloud-computers.js';
const computers = new Map();
const pendingRequests = new Map();
const sseClients = new Map();
let requestIdCounter = 0;
/**
 * TIX_GATEWAY_API_KEY — API key that controller clients (e.g. Supen) must provide.
 * When set, every inbound HTTP request must carry `Authorization: Bearer <key>`.
 * If unset, the gateway is in open mode (development only).
 */
const GATEWAY_API_KEY = process.env.TIX_GATEWAY_API_KEY || '';
function parseCsvSet(value) {
    if (!value)
        return new Set();
    return new Set(value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean));
}
const ALLOWED_COMPUTER_IDS = parseCsvSet(process.env.TIX_GATEWAY_ALLOWED_COMPUTER_IDS);
const ALLOWED_COMPUTER_FINGERPRINTS = parseCsvSet(process.env.TIX_GATEWAY_ALLOWED_COMPUTER_FINGERPRINTS);
/**
 * TIX_GATEWAY_SECRET — pre-shared secret for computer authentication.
 * When set, every enroll/auth message MUST include a valid HMAC token.
 * Token format: `${computerId}.${timestampMs}.${hmacHex}` where hmacHex is
 * HMAC-SHA256(secret, `${computerId}:${timestampMs}`).
 * Timestamps more than TOKEN_VALIDITY_MS old are rejected (replay protection).
 */
const GATEWAY_SECRET = process.env.TIX_GATEWAY_SECRET || '';
const TOKEN_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes
function verifyComputerToken(token, computerId) {
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
    const [tokenComputerId, tsStr, givenHmac] = parts;
    if (tokenComputerId !== computerId) {
        return { ok: false, code: 'token_computer_mismatch' };
    }
    const ts = parseInt(tsStr, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOKEN_VALIDITY_MS) {
        return { ok: false, code: 'token_expired' };
    }
    const expected = crypto
        .createHmac('sha256', GATEWAY_SECRET)
        .update(`${computerId}:${tsStr}`)
        .digest('hex');
    try {
        const givenBuf = Buffer.from(givenHmac, 'hex');
        const expectedBuf = Buffer.from(expected, 'hex');
        if (givenBuf.length !== expectedBuf.length ||
            !crypto.timingSafeEqual(givenBuf, expectedBuf)) {
            return { ok: false, code: 'token_invalid' };
        }
    }
    catch {
        return { ok: false, code: 'token_invalid' };
    }
    return { ok: true };
}
function isComputerAllowed(computerId, computerFingerprint) {
    if (ALLOWED_COMPUTER_IDS.size > 0 && !ALLOWED_COMPUTER_IDS.has(computerId)) {
        return false;
    }
    if (ALLOWED_COMPUTER_FINGERPRINTS.size > 0 &&
        !ALLOWED_COMPUTER_FINGERPRINTS.has(computerFingerprint)) {
        return false;
    }
    return true;
}
// ── Public API ──
export function listComputers() {
    return Array.from(computers.values()).map(({ info, lastSeen }) => ({
        ...info,
        online: true,
        last_seen: new Date(lastSeen).toISOString(),
    }));
}
/** Get the WebSocket for a specific computer by computer_id. */
export function getComputerById(computerId) {
    for (const [ws, { info }] of computers) {
        if (info.computer_id === computerId && info.trusted && ws.readyState === WebSocket.OPEN)
            return ws;
    }
    return null;
}
export function getActiveComputer() {
    for (const [ws, { info }] of computers) {
        if (info.trusted && ws.readyState === WebSocket.OPEN)
            return ws;
    }
    return null;
}
export function relayToComputer(method, path, body, timeoutMs = 15000, targetComputerId) {
    return new Promise((resolve) => {
        const computer = targetComputerId ? getComputerById(targetComputerId) : getActiveComputer();
        if (!computer) {
            const msg = targetComputerId
                ? `Computer '${targetComputerId}' is not connected to this gateway`
                : 'No computer is currently connected to this gateway';
            resolve({ status: 503, headers: {}, body: { error: 'no_computer_connected', message: msg } });
            return;
        }
        const reqId = `gateway-req-${++requestIdCounter}`;
        const timer = setTimeout(() => {
            pendingRequests.delete(reqId);
            resolve({
                status: 504,
                headers: {},
                body: { error: 'timeout', message: 'Computer did not respond in time' },
            });
        }, timeoutMs);
        pendingRequests.set(reqId, { resolve, timer });
        computer.send(JSON.stringify({ type: 'api_request', request_id: reqId, method, path, body }));
    });
}
// ── Computer message handler ──
function handleComputerMessage(ws, msg, log) {
    // Update last_seen on every message
    const state = computers.get(ws);
    if (state)
        state.lastSeen = Date.now();
    switch (msg.type) {
        case 'enroll': {
            const computer_id = msg.computer_id;
            const computer_fingerprint = msg.computer_fingerprint;
            const ip = computers.get(ws)?.info.ip;
            // gateway_token = HMAC credential (separate from enrollment trust_token)
            const tokenCheck = verifyComputerToken(msg.gateway_token, computer_id);
            if (!tokenCheck.ok) {
                log?.warn?.(`[gateway] Rejected computer enrollment for id=${computer_id}: ${tokenCheck.code}`);
                ws.send(JSON.stringify({ type: 'enrollment_result', ok: false, code: tokenCheck.code }));
                ws.close();
                break;
            }
            if (!isComputerAllowed(computer_id, computer_fingerprint)) {
                log?.warn?.(`[gateway] Rejected computer enrollment for id=${computer_id} from ${ip || 'unknown-ip'} due to allowlist policy`);
                ws.send(JSON.stringify({ type: 'enrollment_result', ok: false, code: 'computer_not_allowed' }));
                ws.close();
                break;
            }
            computers.set(ws, { info: { computer_id, computer_fingerprint, trusted: true, online: true, ip }, lastSeen: Date.now() });
            log?.info?.(`[gateway] Computer enrolled: ${computer_id}`);
            ws.send(JSON.stringify({ type: 'enrollment_result', ok: true, computer_id, computer_fingerprint }));
            break;
        }
        case 'auth': {
            const computer_id = msg.computer_id;
            const computer_fingerprint = msg.computer_fingerprint;
            const ip = computers.get(ws)?.info.ip;
            const tokenCheck = verifyComputerToken(msg.token, computer_id);
            if (!tokenCheck.ok) {
                log?.warn?.(`[gateway] Rejected computer auth for id=${computer_id}: ${tokenCheck.code}`);
                ws.send(JSON.stringify({ type: 'auth_result', ok: false, code: tokenCheck.code }));
                ws.close();
                break;
            }
            if (!isComputerAllowed(computer_id, computer_fingerprint)) {
                log?.warn?.(`[gateway] Rejected computer auth for id=${computer_id} from ${ip || 'unknown-ip'} due to allowlist policy`);
                ws.send(JSON.stringify({ type: 'auth_result', ok: false, code: 'computer_not_allowed' }));
                ws.close();
                break;
            }
            computers.set(ws, { info: { computer_id, computer_fingerprint, trusted: true, online: true, ip }, lastSeen: Date.now() });
            log?.info?.(`[gateway] Computer authenticated: ${computer_id}`);
            ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
            break;
        }
        case 'report': {
            const state = computers.get(ws);
            if (state) {
                state.lastSeen = Date.now();
                if (msg.telemetry) {
                    state.info.telemetry = msg.telemetry;
                }
                log?.debug?.(`[gateway] Report from ${state.info.computer_id}: ${msg.status}`);
            }
            break;
        }
        case 'api_response': {
            const reqId = msg.request_id;
            const pending = pendingRequests.get(reqId);
            if (pending) {
                clearTimeout(pending.timer);
                pendingRequests.delete(reqId);
                pending.resolve({
                    status: msg.status || 200,
                    headers: msg.headers || {},
                    body: msg.body,
                    encoding: msg.encoding === 'base64' ? 'base64' : undefined,
                });
            }
            break;
        }
        case 'sse_event': {
            const streamKey = msg.stream_key;
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
function handleSSERelay(req, res, url) {
    const computer = getActiveComputer();
    if (!computer) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_computer_connected' }));
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
    if (!sseClients.has(streamKey))
        sseClients.set(streamKey, new Set());
    sseClients.get(streamKey).add(res);
    const reqId = `gateway-sse-${++requestIdCounter}`;
    computer.send(JSON.stringify({ type: 'sse_subscribe', request_id: reqId, path: streamKey }));
    req.on('close', () => {
        sseClients.get(streamKey)?.delete(res);
        if (sseClients.get(streamKey)?.size === 0)
            sseClients.delete(streamKey);
    });
}
// ── Attach gateway WebSocket server to an HTTP server ──
/**
 * Attach the WebSocket gateway to an HTTP server.
 * Call this on any http.Server to enable computer connections.
 */
export function attachGateway(httpServer, opts = {}) {
    const log = opts.logger ?? console;
    const wss = opts.handleUpgrade
        ? new WebSocketServer({ noServer: true })
        : new WebSocketServer({ server: httpServer });
    if (opts.handleUpgrade) {
        httpServer.on('upgrade', (req, socket, head) => {
            const url = req.url || '/';
            if (url === '/' || url.startsWith('/?'))
                return;
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        });
    }
    wss.on('connection', (ws, req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const ipText = Array.isArray(ip) ? ip[0] : String(ip || '');
        // Pre-populate state with IP so enroll/auth handlers can read it
        computers.set(ws, {
            info: { computer_id: '', computer_fingerprint: '', trusted: false, online: true, ip: ipText },
            lastSeen: Date.now(),
        });
        log.info?.(`[gateway] New computer connection from ${ipText}`);
        ws.on('message', (data) => {
            try {
                handleComputerMessage(ws, JSON.parse(data.toString()), log);
            }
            catch (err) {
                log.error?.('[gateway] Parse error:', err);
            }
        });
        ws.on('close', () => {
            const state = computers.get(ws);
            if (state?.info.computer_id)
                log.info?.(`[gateway] Computer disconnected: ${state.info.computer_id}`);
            computers.delete(ws);
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
 * Handle an HTTP request — route gateway API or relay to computer.
 * Returns true if the request was handled.
 */
export async function handleGatewayRequest(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    // ── OpenAPI spec (gateway-native paths + node paths fetched live) ──
    if (url.pathname === '/openapi.json' && req.method === 'GET') {
        const gatewayUrl = `http://${req.headers.host || 'localhost'}`;
        // Gateway-native paths (always present, no computer needed)
        const gatewayPaths = {
            '/openapi.json': { get: { tags: ['Gateway'], summary: 'OpenAPI spec (this document)', security: [], responses: { '200': { description: 'OpenAPI 3.0 JSON' } } } },
            '/health': { get: { tags: ['Gateway'], summary: 'Gateway health (computer count, uptime)', security: [], responses: { '200': { description: 'OK' } } } },
            '/api/gateway/computers': { get: { tags: ['Gateway'], summary: 'List connected computers', responses: { '200': { description: 'Computers array' } } } },
        };
        // Try to fetch computer spec and merge
        let computerPaths = {};
        let computerInfo = {};
        try {
            const computerSpec = await relayToComputer('GET', '/api/v1/openapi.json', undefined, 5000);
            if (computerSpec.status === 200 && computerSpec.body && typeof computerSpec.body === 'object') {
                const spec = computerSpec.body;
                computerPaths = spec.paths || {};
                computerInfo = spec.info || {};
            }
        }
        catch { /* computer not connected — return gateway-only spec */ }
        const spec = {
            openapi: '3.0.3',
            info: {
                title: 'Tix Gateway API',
                version: computerInfo.version || '1.0.0',
                description: 'Tix Gateway API. Gateway-native routes (/health, /api/gateway/*) plus all computer routes relayed transparently. ' +
                    'Use X-Computer-Id header to target a specific computer.',
            },
            servers: [{ url: gatewayUrl, description: 'Tix Gateway' }],
            security: [{ bearerAuth: [] }],
            components: {
                securitySchemes: {
                    bearerAuth: { type: 'http', scheme: 'bearer', description: 'Set via TIX_GATEWAY_API_KEY env var.' },
                },
            },
            paths: { ...gatewayPaths, ...computerPaths },
        };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(spec, null, 2));
        return true;
    }
    // ── Gateway-native: health (own status, not relayed) ──
    if (url.pathname === '/health' && req.method === 'GET') {
        const connected = Array.from(computers.values()).filter(({ info }) => info.trusted && info.computer_id);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
            status: 'ok',
            gateway: true,
            computers_connected: connected.length,
            uptime_s: Math.floor(process.uptime()),
        }));
        return true;
    }
    // ── Gateway-native: list computers ──
    if (url.pathname === '/api/gateway/computers' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ computers: listComputers() }));
        return true;
    }
    // ── CORS preflight ──
    const CORS_HEADERS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Computer-Id',
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
    // ── Gateway-native: cloud computer provisioning ──
    if (url.pathname === '/api/gateway/cloud-computers' && req.method === 'GET') {
        try {
            const [computersList, meta] = await Promise.all([listCloudComputers(), getCloudComputerMeta()]);
            const connectedComputers = listComputers();
            for (const computer of computersList) {
                const isOnline = connectedComputers.some((r) => r.computer_id === computer.computerId && r.online);
                if (isOnline) {
                    computer.status = 'online';
                }
                else if (computer.status === 'live') {
                    computer.status = 'offline';
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ computers: computersList, meta }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err?.message || 'Failed to list cloud computers' }));
        }
        return true;
    }
    if (url.pathname === '/api/gateway/cloud-computers' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            try {
                const input = JSON.parse(body);
                if (!input.name || !input.tier || !input.region) {
                    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: 'name, tier, and region are required' }));
                    return;
                }
                const result = await launchCloudComputer(input);
                res.writeHead(201, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(result));
            }
            catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: err?.message || 'Failed to launch cloud computer' }));
            }
        });
        return true;
    }
    if (url.pathname.startsWith('/api/gateway/cloud-computers/') && req.method === 'DELETE') {
        const serviceId = url.pathname.split('/').pop();
        if (!serviceId) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Missing service ID' }));
            return true;
        }
        try {
            await deleteCloudComputer(serviceId);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true }));
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err?.message || 'Failed to delete cloud computer' }));
        }
        return true;
    }
    // ── SSE stream relay — any path ending in /stream ──
    if (req.method === 'GET' && url.pathname.endsWith('/stream')) {
        handleSSERelay(req, res, url);
        return true;
    }
    // ── Gateway-native: LLM Proxy ──
    if (url.pathname.startsWith('/api/llm/')) {
        // Expected format: /api/llm/<provider>/...
        // Examples: /api/llm/babelark/v1/chat/completions
        const segments = url.pathname.split('/');
        let provider = segments[3];
        let pathRest = segments.slice(4).join('/');
        // If path is /api/llm/v1/... assume default proxying (tix -> babelark)
        if (provider === 'v1') {
            provider = 'tix';
            pathRest = 'v1/' + pathRest;
        }
        let targetUrlBase = '';
        let apiKey = '';
        if (provider === 'babelark' || provider === 'tix') {
            targetUrlBase = process.env.BABELARK_BASE_URL || 'https://api.babelark.com';
            apiKey = process.env.BABELARK_API_KEY || '';
        }
        else if (provider === 'openai') {
            targetUrlBase = 'https://api.openai.com';
            apiKey = process.env.OPENAI_API_KEY || '';
        }
        else if (provider === 'deepseek') {
            targetUrlBase = 'https://api.deepseek.com';
            apiKey = process.env.DEEPSEEK_API_KEY || '';
        }
        else if (provider === 'openrouter') {
            targetUrlBase = 'https://openrouter.ai/api';
            apiKey = process.env.OPENROUTER_API_KEY || '';
        }
        else if (provider === 'anthropic') {
            targetUrlBase = 'https://api.anthropic.com';
            apiKey = process.env.ANTHROPIC_API_KEY || '';
        }
        if (!targetUrlBase) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'unsupported_llm_provider', provider }));
            return true;
        }
        // Ensure no double slashes or double /v1/v1
        let finalPath = pathRest.replace(/^\/+/, '');
        const cleanBase = targetUrlBase.replace(/\/+$/, '');
        if (cleanBase.endsWith('/v1') && finalPath.startsWith('v1/')) {
            finalPath = finalPath.slice(3);
        }
        const targetUrl = `${cleanBase}/${finalPath}${url.search}`;
        const proxyHeaders = new Headers();
        proxyHeaders.set('Content-Type', req.headers['content-type'] || 'application/json');
        if (apiKey)
            proxyHeaders.set('Authorization', `Bearer ${apiKey}`);
        // Pass Anthropic specific headers if needed
        if (provider === 'anthropic' || provider === 'tix' || provider === 'babelark') {
            if (apiKey)
                proxyHeaders.set('x-api-key', apiKey);
            proxyHeaders.set('anthropic-version', '2023-06-01');
            if (req.headers['anthropic-beta'])
                proxyHeaders.set('anthropic-beta', req.headers['anthropic-beta']);
        }
        // OpenRouter specific headers
        if (provider === 'openrouter') {
            proxyHeaders.set('HTTP-Referer', 'https://tix.computer');
            proxyHeaders.set('X-Title', 'Tix Gateway');
        }
        let reqBody = '';
        req.on('data', chunk => { reqBody += chunk; });
        req.on('end', async () => {
            try {
                console.log(`[gateway] Proxying LLM request to: ${targetUrl}`);
                console.log(`[gateway] Using API Key prefix: ${apiKey.substring(0, 7)}...`);
                const upstreamRes = await fetch(targetUrl, {
                    method: req.method,
                    headers: proxyHeaders,
                    body: (req.method !== 'GET' && req.method !== 'HEAD') ? (reqBody || undefined) : undefined
                });
                console.log(`[gateway] Upstream Res Status: ${upstreamRes.status} ${upstreamRes.statusText}`);
                const resHeaders = {
                    'Access-Control-Allow-Origin': '*'
                };
                upstreamRes.headers.forEach((val, key) => {
                    if (key.toLowerCase() !== 'content-encoding' &&
                        key.toLowerCase() !== 'content-length' &&
                        key.toLowerCase() !== 'transfer-encoding') {
                        resHeaders[key] = val;
                    }
                });
                res.writeHead(upstreamRes.status, resHeaders);
                if (upstreamRes.body) {
                    Readable.fromWeb(upstreamRes.body).pipe(res);
                }
                else {
                    res.end();
                }
            }
            catch (err) {
                console.error('[gateway] LLM Proxy error:', err);
                res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'bad_gateway', message: err.message }));
            }
        });
        return true;
    }
    // ── API relay to computer (with optional X-Computer-Id targeting) ──
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/runs')) {
        const targetComputerId = req.headers['x-computer-id'];
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            let parsedBody;
            try {
                parsedBody = body ? JSON.parse(body) : undefined;
            }
            catch {
                parsedBody = body;
            }
            const result = await relayToComputer(req.method || 'GET', url.pathname + url.search, parsedBody, 15000, targetComputerId);
            if (result.encoding === 'base64' && typeof result.body === 'string') {
                const buffer = Buffer.from(result.body, 'base64');
                const headers = { ...result.headers };
                delete headers['content-length'];
                delete headers['Content-Length'];
                res.writeHead(result.status, { 'Access-Control-Allow-Origin': '*', ...headers, 'Content-Length': String(buffer.length) });
                res.end(buffer);
            }
            else {
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
/**
 * Create and start a standalone gateway server.
 * Convenience for quick setup — or use attachGateway() for more control.
 */
export function startGateway(opts = {}) {
    const port = opts.port ?? parseInt(process.env.PORT ?? process.env.GATEWAY_PORT ?? process.env.HUB_PORT ?? '2755', 10);
    const host = opts.host ?? '0.0.0.0';
    const log = opts.logger ?? console;
    const httpServer = http.createServer(async (req, res) => {
        if (await handleGatewayRequest(req, res))
            return;
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
            log.info?.(`[gateway] Tix Gateway listening on ws://${host}:${port}`);
            resolve(httpServer);
        });
    });
}
//# sourceMappingURL=index.js.map