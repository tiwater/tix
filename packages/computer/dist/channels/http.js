/**
 * HTTP SSE channel for Tix — REST API v1
 *
 * Computer:
 *   GET  /api/v1/computer                                  — computer status
 *   POST /api/v1/computer/trust                            — trust computer
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
 *   POST   /api/v1/agents/:agent_id/sessions/:session_id/stop — stop active run
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/messages — chat history
 *   POST   /api/v1/agents/:agent_id/sessions/:session_id/messages — send message
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/stream   — SSE stream
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/context  — context window usage
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
import { WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { ACP_ENABLED, AGENTS_DIR, HTTP_API_KEY, COMPUTER_HOSTNAME, HTTP_ENABLED, HTTP_PORT, SKILLS_CONFIG, agentPaths, TIX_HOME, MODELS_REGISTRY, getAgentModelConfig, ALLOWED_ORIGINS, } from '../core/config.js';
import { readConfigYaml } from '../core/env.js';
function inferMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
    };
    return mimes[ext] || 'application/octet-stream';
}
import { ensureAgent, ensureSession, getAllAgents, getAllSchedules, getAllSessions, getGlobalUsage, getDailyUsage, getUsageStats, getRecentMessages, getSession, getSessionForAgent, getSessionsForAgent, getArchivedSessionsForAgent, getSchedulesForAgent, createSchedule, updateSchedule, deleteSchedule, deleteSession, deleteSessionForAgent, archiveSessionForAgent, restoreSessionForAgent, updateSessionMetadata, resolveFromChatJid, } from '../core/store.js';
import { SkillsRegistry } from '../skills/registry.js';
import { createEnrollmentToken, readEnrollmentState, setTrustState, verifyEnrollmentToken, } from '../core/enrollment.js';
import { approvePairing, listBindings, listPendingPairings, removeBinding, upsertBinding, } from '../core/pairing.js';
import { logger } from '../core/logger.js';
import { isPathWithin } from '../core/security.js';
import { getExecutorStats, listActiveTasks } from '../task-executor.js';
import { getWarmSession } from '../core/computer.js';
import { registerChannel } from './registry.js';
import { maybeHandleAcpRequest } from './acp.js';
import { app } from '../core/app.js';
import { forceSchedulerCheck } from '../task-scheduler.js';
const WEB_JID_PREFIX = 'web:';
const sseClients = new Map();
// Hook into global app and dispatcher
app.on('broadcast', (data) => {
    if (data.chatJid.startsWith(WEB_JID_PREFIX)) {
        broadcastToChat(data.chatJid, data.event);
    }
});
app.on('send', async (data) => {
    if (data.jid.startsWith(WEB_JID_PREFIX)) {
        broadcastToChat(data.jid, {
            type: 'message',
            chat_jid: data.jid,
            text: data.text,
        });
    }
});
function buildHttpSessionId(agentId, sessionId) {
    return `${WEB_JID_PREFIX}${agentId}:${sessionId}`;
}
function parseHttpSessionId(chatJid) {
    // Format: web:agentId:sessionId
    const parts = chatJid.replace(WEB_JID_PREFIX, '').split(':');
    return [parts[0] || '', parts.slice(1).join(':') || ''];
}
function resolveSessionContext(chatJid) {
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return undefined;
    return getSessionForAgent(resolved.agentId, resolved.sessionId);
}
function addClient(chatJid, res) {
    if (!sseClients.has(chatJid))
        sseClients.set(chatJid, new Set());
    sseClients.get(chatJid).add(res);
}
// Global artifact watcher
function startArtifactWatcher() {
    try {
        fs.watch(AGENTS_DIR, { recursive: true }, (eventType, filename) => {
            if (!filename)
                return;
            const parts = filename.split(path.sep);
            const agentId = parts[0];
            const relPath = parts.slice(1).join('/');
            if (!agentId || !relPath)
                return;
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
    }
    catch (err) {
        if (typeof logger !== 'undefined')
            logger.warn({ err }, 'Failed to start recursive artifact watcher (possibly OS limitation)');
    }
}
if (fs.existsSync(AGENTS_DIR)) {
    startArtifactWatcher();
}
function removeClient(chatJid, res) {
    sseClients.get(chatJid)?.delete(res);
}
export function broadcastToChat(chatJid, event) {
    const clients = sseClients.get(chatJid);
    if (!clients || clients.size === 0)
        return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const wsPayload = JSON.stringify(event);
    for (const client of clients) {
        try {
            if (client instanceof http.ServerResponse) {
                client.write(payload);
            }
            else {
                client.send(wsPayload);
            }
        }
        catch {
            clients.delete(client);
        }
    }
}
export function isOriginAllowed(origin) {
    if (!origin)
        return false;
    if (!ALLOWED_ORIGINS.trim())
        return false;
    try {
        const regex = new RegExp(ALLOWED_ORIGINS);
        return regex.test(origin);
    }
    catch {
        return false;
    }
}
function setCorsHeaders(req, res) {
    const origin = readSingleHeaderValue(req.headers.origin);
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Last-Modified');
}
function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
    });
    res.end(JSON.stringify(payload));
}
function readSingleHeaderValue(value) {
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
function extractApiKey(req) {
    const direct = readSingleHeaderValue(req.headers['x-api-key']);
    if (direct)
        return direct;
    const auth = readSingleHeaderValue(req.headers.authorization);
    if (!auth)
        return null;
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match)
        return null;
    const token = match[1]?.trim();
    return token || null;
}
function safeEquals(input, expected) {
    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
function isLoopbackAddress(remote) {
    const value = remote || '';
    return (value === '127.0.0.1' ||
        value === '::1' ||
        value === '::ffff:127.0.0.1');
}
export function requiresAdminApiAccess(pathname, method) {
    // Legacy run endpoint
    if (pathname === '/runs' && method === 'POST')
        return true;
    // All new v1 api endpoints require admin access
    if (pathname.startsWith('/api/v1/')) {
        if (method === 'OPTIONS')
            return false;
        return true;
    }
    // Legacy /api/ paths still require admin access
    if (pathname.startsWith('/api/')) {
        if (method === 'OPTIONS')
            return false;
        return true;
    }
    return false;
}
export function resolveHttpAdminContextFromInput(providedApiKey, isLoopback, configuredApiKeyOverride) {
    const configuredApiKey = (configuredApiKeyOverride ?? HTTP_API_KEY).trim();
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
function resolveHttpAdminContext(req) {
    return resolveHttpAdminContextFromInput(extractApiKey(req), isLoopbackAddress(req.socket.remoteAddress));
}
export function deriveHttpSenderIdentity(context) {
    return context.actor === 'http-loopback'
        ? { sender: 'http-loopback', sender_name: 'Local HTTP Admin' }
        : { sender: 'http-api-key', sender_name: 'HTTP API Client' };
}
export function getHttpSecurityPosture(config) {
    if (!config.httpEnabled) {
        return { mode: 'disabled', warnings: [], bindHost: undefined };
    }
    const warnings = [];
    const hasApiKey = Boolean(config.httpApiKey.trim());
    const hasAllowedOrigins = Boolean(config.allowedOrigins.trim());
    if (!hasApiKey) {
        warnings.push('HTTP_API_KEY is not configured; admin/API access falls back to loopback-only local development mode.');
        warnings.push('HTTP listener is restricted to 127.0.0.1 until HTTP_API_KEY is configured.');
        warnings.push('Do not expose this computer beyond localhost without setting HTTP_API_KEY.');
    }
    if (!hasAllowedOrigins) {
        warnings.push('ALLOWED_ORIGINS is not configured; browser origins are denied by default.');
    }
    return {
        mode: hasApiKey ? 'protected' : 'dev_loopback_only',
        warnings,
        bindHost: hasApiKey ? undefined : '127.0.0.1',
    };
}
function logHttpSecurityPosture(posture) {
    const resolved = posture ?? getHttpSecurityPosture({
        httpEnabled: HTTP_ENABLED,
        httpApiKey: HTTP_API_KEY,
        allowedOrigins: ALLOWED_ORIGINS,
    });
    if (resolved.mode === 'disabled')
        return;
    logger.info({
        port: HTTP_PORT,
        mode: resolved.mode,
        bind_host: resolved.bindHost ?? '0.0.0.0',
        has_api_key: Boolean(HTTP_API_KEY.trim()),
        has_allowed_origins: Boolean(ALLOWED_ORIGINS.trim()),
    }, 'HTTP security posture');
    for (const warning of resolved.warnings) {
        logger.warn({ port: HTTP_PORT, mode: resolved.mode, bind_host: resolved.bindHost ?? '0.0.0.0' }, warning);
    }
}
function requireHttpAdminContext(req, res) {
    const context = resolveHttpAdminContext(req);
    if (context)
        return context;
    if (HTTP_API_KEY.trim()) {
        writeProtocolError(res, 401, 'auth_error', 'invalid_api_key', 'Valid API key required. Send X-API-Key or Authorization: Bearer <key>.');
        return null;
    }
    writeProtocolError(res, 403, 'auth_error', 'admin_loopback_only', 'Endpoint is restricted to loopback requests when HTTP_API_KEY is not configured.');
    return null;
}
function writeProtocolError(res, statusCode, classification, code, message, details) {
    writeJson(res, statusCode, {
        error: {
            classification,
            code,
            message,
            ...(details ? { details } : {}),
        },
    });
}
async function readJsonBody(req) {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
    }
    if (!body)
        return {};
    try {
        return JSON.parse(body);
    }
    catch {
        throw new Error('Invalid JSON body');
    }
}
function protocolErrorFromUnknown(err) {
    if (err && typeof err === 'object') {
        const e = err;
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
function generateSessionTitleBackground(agentId, sessionId, message) {
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
                if (title.length > 60)
                    title = title.slice(0, 60) + '…';
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
        }
        catch (err) {
            logger.warn({ err: err.message, agentId, sessionId }, 'Failed to generate LLM session title');
        }
    })();
}
export class HttpChannel {
    name = 'http';
    server = null;
    wss = null;
    opts;
    _connected = false;
    constructor(opts) {
        this.opts = opts;
    }
    async connect() {
        const posture = getHttpSecurityPosture({
            httpEnabled: HTTP_ENABLED,
            httpApiKey: HTTP_API_KEY,
            allowedOrigins: ALLOWED_ORIGINS,
        });
        this.server = http.createServer((req, res) => {
            void this.handleRequest(req, res);
        });
        this.wss = new WebSocketServer({ server: this.server });
        this.wss.on('connection', (ws, req) => {
            this.handleWebSocket(ws, req);
        });
        await new Promise((resolve, reject) => {
            this.server.listen(HTTP_PORT, posture.bindHost, () => resolve());
            this.server.on('error', reject);
        });
        this._connected = true;
        logger.info({ port: HTTP_PORT, bind_host: posture.bindHost ?? '0.0.0.0' }, 'HTTP/WS channel listening');
        logHttpSecurityPosture(posture);
        console.log(`\n  HTTP SSE: http://localhost:${HTTP_PORT}/runs/{id}/stream\n  WebSocket: ws://localhost:${HTTP_PORT}/\n`);
    }
    handleWebSocket(ws, req) {
        let chatJid = null;
        let wsAdminContext = null;
        const remoteAddress = req.socket.remoteAddress;
        ws.on('message', async (data) => {
            try {
                const payload = JSON.parse(data.toString());
                const { type, agent_id, session_id, content } = payload;
                if (type === 'auth') {
                    const wsApiKey = typeof payload.api_key === 'string' && payload.api_key.trim()
                        ? payload.api_key.trim()
                        : null;
                    const wsContext = resolveHttpAdminContextFromInput(wsApiKey, isLoopbackAddress(remoteAddress));
                    if (!wsContext) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: HTTP_API_KEY.trim()
                                ? 'invalid_api_key'
                                : 'admin_loopback_only',
                        }));
                        ws.close();
                        return;
                    }
                    wsAdminContext = wsContext;
                    if (!agent_id || !session_id) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'agent_id and session_id required',
                        }));
                        return;
                    }
                    chatJid = buildHttpSessionId(agent_id, session_id);
                    // Check trust status
                    const enrollState = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
                    if (enrollState.trust_state !== 'trusted') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'computer_not_trusted',
                            trust_state: enrollState.trust_state,
                        }));
                        return;
                    }
                    addClient(chatJid, ws);
                    ws.send(JSON.stringify({ type: 'authenticated', chat_jid: chatJid }));
                    return;
                }
                if (type === 'message') {
                    if (!chatJid) {
                        ws.send(JSON.stringify({ type: 'error', message: 'not authenticated' }));
                        return;
                    }
                    if (!content)
                        return;
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
                    const senderIdentity = deriveHttpSenderIdentity(wsAdminContext ?? { actor: 'http-api-key', isAdmin: true, approveLevel3: true });
                    const msg = {
                        id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        chat_jid: chatJid,
                        sender: senderIdentity.sender,
                        sender_name: senderIdentity.sender_name,
                        content,
                        timestamp,
                        is_from_me: false,
                        agent_id: authedAgentId,
                        session_id: authedSessionId,
                        task_id: taskId,
                    };
                    this.opts.onMessage(chatJid, msg);
                    ws.send(JSON.stringify({ type: 'accepted', id: msg.id, task_id: taskId }));
                }
            }
            catch (err) {
                logger.error({ err }, 'WS message handling failed');
            }
        });
        ws.on('close', () => {
            if (chatJid)
                removeClient(chatJid, ws);
        });
    }
    async handleRequest(req, res) {
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
            if (workspaceMatch && (req.method === 'GET' || req.method === 'HEAD')) {
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
                const basename = path.basename(filePath);
                const asciiName = basename.replace(/[^\x20-\x7E]/g, '_');
                const encodedName = encodeURIComponent(basename).replace(/'/g, '%27');
                const disposition = mime === 'application/octet-stream'
                    ? `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
                    : 'inline';
                res.writeHead(200, {
                    'Content-Type': mime,
                    'Content-Length': stat.size,
                    'Last-Modified': stat.mtime.toUTCString(),
                    'Cache-Control': 'public, max-age=60',
                    'Content-Disposition': disposition,
                });
                if (req.method === 'HEAD') {
                    res.end();
                    return;
                }
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
                const reqBody = req._body || await new Promise((resolve) => {
                    let raw = '';
                    req.on('data', (chunk) => { raw += chunk; });
                    req.on('end', () => {
                        try {
                            resolve(JSON.parse(raw));
                        }
                        catch {
                            resolve(null);
                        }
                    });
                });
                if (!reqBody?.files || !Array.isArray(reqBody.files)) {
                    writeJson(res, 400, { error: 'Request body must contain files array with { name, data } objects' });
                    return;
                }
                const workspace = agentPaths(agentId).workspace;
                const uploadDir = path.join(workspace, '.uploads');
                fs.mkdirSync(uploadDir, { recursive: true });
                const uploadedFiles = [];
                for (const file of reqBody.files) {
                    if (!file.name || !file.data)
                        continue;
                    const originalName = path.basename(file.name); // sanitize
                    const content = Buffer.from(file.data, 'base64');
                    // 50MB per-file limit
                    if (content.length > 50 * 1024 * 1024)
                        continue;
                    const uuid = randomUUID().slice(0, 8);
                    const destName = `${uuid}-${originalName}`;
                    const destPath = path.join(uploadDir, destName);
                    fs.writeFileSync(destPath, content);
                    const relPath = `.uploads/${destName}`;
                    uploadedFiles.push({
                        name: originalName,
                        path: relPath,
                        tixUrl: `tix://workspace/${agentId}/${relPath}`,
                        size: content.length,
                    });
                    logger.info({ agentId, destName, size: content.length }, 'File uploaded to workspace');
                }
                writeJson(res, 200, { files: uploadedFiles });
                return;
            }
            // ── Workspace: delete file/folder ──
            const deleteWsMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/(.+)$/);
            if (deleteWsMatch && req.method === 'DELETE') {
                const agentId = decodeURIComponent(deleteWsMatch[1]);
                const relPath = decodeURIComponent(deleteWsMatch[2]);
                const normalized = path.normalize(relPath);
                if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
                    writeJson(res, 400, { error: 'Invalid path' });
                    return;
                }
                const workspace = agentPaths(agentId).workspace;
                const target = path.join(workspace, normalized);
                if (!target.startsWith(workspace + path.sep) && target !== workspace) {
                    writeJson(res, 403, { error: 'Path outside workspace' });
                    return;
                }
                if (!fs.existsSync(target)) {
                    writeJson(res, 404, { error: 'Not found' });
                    return;
                }
                fs.rmSync(target, { recursive: true, force: true });
                logger.info({ agentId, path: relPath }, 'Workspace file deleted');
                writeJson(res, 200, { ok: true });
                return;
            }
            // ── Workspace: rename ──
            const renameWsMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/rename$/);
            if (renameWsMatch && req.method === 'POST') {
                const agentId = decodeURIComponent(renameWsMatch[1]);
                const body = req._body || await new Promise((resolve) => {
                    let raw = '';
                    req.on('data', (chunk) => { raw += chunk; });
                    req.on('end', () => { try {
                        resolve(JSON.parse(raw));
                    }
                    catch {
                        resolve(null);
                    } });
                });
                if (!body?.from || !body?.to) {
                    writeJson(res, 400, { error: 'from and to required' });
                    return;
                }
                const fromNorm = path.normalize(body.from);
                const toNorm = path.normalize(body.to);
                if (fromNorm.startsWith('..') || toNorm.startsWith('..') || path.isAbsolute(fromNorm) || path.isAbsolute(toNorm)) {
                    writeJson(res, 400, { error: 'Invalid path' });
                    return;
                }
                const workspace = agentPaths(agentId).workspace;
                const fromPath = path.join(workspace, fromNorm);
                const toPath = path.join(workspace, toNorm);
                if (!fromPath.startsWith(workspace + path.sep) || !toPath.startsWith(workspace + path.sep)) {
                    writeJson(res, 403, { error: 'Path outside workspace' });
                    return;
                }
                if (!fs.existsSync(fromPath)) {
                    writeJson(res, 404, { error: 'Source not found' });
                    return;
                }
                fs.mkdirSync(path.dirname(toPath), { recursive: true });
                fs.renameSync(fromPath, toPath);
                logger.info({ agentId, from: body.from, to: body.to }, 'Workspace file renamed');
                writeJson(res, 200, { ok: true });
                return;
            }
            // ── Workspace: create folder ──
            const mkdirWsMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/workspace\/mkdir$/);
            if (mkdirWsMatch && req.method === 'POST') {
                const agentId = decodeURIComponent(mkdirWsMatch[1]);
                const body = req._body || await new Promise((resolve) => {
                    let raw = '';
                    req.on('data', (chunk) => { raw += chunk; });
                    req.on('end', () => { try {
                        resolve(JSON.parse(raw));
                    }
                    catch {
                        resolve(null);
                    } });
                });
                if (!body?.path) {
                    writeJson(res, 400, { error: 'path required' });
                    return;
                }
                const normalized = path.normalize(body.path);
                if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
                    writeJson(res, 400, { error: 'Invalid path' });
                    return;
                }
                const workspace = agentPaths(agentId).workspace;
                const target = path.join(workspace, normalized);
                if (!target.startsWith(workspace + path.sep)) {
                    writeJson(res, 403, { error: 'Path outside workspace' });
                    return;
                }
                fs.mkdirSync(target, { recursive: true });
                logger.info({ agentId, path: body.path }, 'Workspace folder created');
                writeJson(res, 200, { ok: true });
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
                const files = {};
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
                    }
                    catch {
                        /* skip unreadable files */
                    }
                }
                writeJson(res, 200, { files });
                return;
            }
            // ── Edit Mind File (SOUL, MEMORY, etc.) ──
            const putMindFileMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/mind\/([^/]+)$/);
            if (putMindFileMatch && req.method === 'PUT') {
                const agentId = decodeURIComponent(putMindFileMatch[1]);
                const filename = decodeURIComponent(putMindFileMatch[2]);
                const baseDir = agentPaths(agentId).base;
                const MIND_FILES = ['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'USER.md'];
                if (!MIND_FILES.includes(filename)) {
                    writeJson(res, 400, { error: 'Invalid mind file name. Must be one of: ' + MIND_FILES.join(', ') });
                    return;
                }
                const body = req._body || await new Promise((resolve) => {
                    let raw = '';
                    req.on('data', (chunk) => { raw += chunk; });
                    req.on('end', () => { try {
                        resolve(JSON.parse(raw));
                    }
                    catch {
                        resolve(null);
                    } });
                });
                if (!body || typeof body.content !== 'string') {
                    writeJson(res, 400, { error: 'Missing or invalid content string' });
                    return;
                }
                const filePath = path.join(baseDir, filename);
                try {
                    fs.mkdirSync(baseDir, { recursive: true });
                    fs.writeFileSync(filePath, body.content, 'utf-8');
                    logger.info({ agentId, filename }, 'Mind file updated by client');
                    writeJson(res, 200, { ok: true });
                }
                catch (err) {
                    logger.error({ err, agentId, filename }, 'Failed to write mind file');
                    writeJson(res, 500, { error: 'Failed to write file' });
                }
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
                        const mimeTypes = {
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
                const artifacts = {};
                const walkSync = (dir, filelist = []) => {
                    if (!fs.existsSync(dir))
                        return filelist;
                    const items = fs.readdirSync(dir);
                    for (const item of items) {
                        const filepath = path.join(dir, item);
                        try {
                            if (fs.statSync(filepath).isDirectory()) {
                                // exclude huge directories or internal stores
                                if (item !== '.git' && item !== 'node_modules') {
                                    walkSync(filepath, filelist);
                                }
                            }
                            else {
                                filelist.push(filepath);
                            }
                        }
                        catch { /* ignore stat failures */ }
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
                    }
                    catch {
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
                    }
                    catch { /* skip */ }
                }
                const roll = [];
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
                    }
                    catch { /* skip */ }
                }
                writeJson(res, 200, { core_memory: coreMemory, roll });
                return;
            }
            const memoryEditMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/memory\/([^/]+)$/) ?? pathname.match(/^\/api\/agents\/([^/]+)\/memory\/([^/]+)$/);
            if (memoryEditMatch) {
                const agentId = decodeURIComponent(memoryEditMatch[1]);
                const dateId = decodeURIComponent(memoryEditMatch[2]);
                const baseDir = agentPaths(agentId).base;
                if (req.method === 'PUT') {
                    try {
                        const body = await readJsonBody(req);
                        if (typeof body.content !== 'string') {
                            writeProtocolError(res, 400, 'invalid_request', 'bad_request', 'content must be a string');
                            return;
                        }
                        let targetPath = '';
                        if (dateId === 'core') {
                            targetPath = path.join(baseDir, 'MEMORY.md');
                        }
                        else if (/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
                            const memoryDir = path.join(baseDir, 'memory');
                            if (!fs.existsSync(memoryDir))
                                fs.mkdirSync(memoryDir, { recursive: true });
                            targetPath = path.join(memoryDir, `${dateId}.md`);
                        }
                        else {
                            writeProtocolError(res, 400, 'invalid_request', 'bad_request', 'invalid date identifier');
                            return;
                        }
                        fs.writeFileSync(targetPath, body.content, 'utf-8');
                        writeJson(res, 200, { success: true });
                    }
                    catch (err) {
                        writeProtocolError(res, 500, 'server_error', 'internal_error', err.message);
                    }
                    return;
                }
                if (req.method === 'DELETE') {
                    try {
                        let targetPath = '';
                        if (dateId === 'core') {
                            targetPath = path.join(baseDir, 'MEMORY.md');
                        }
                        else if (/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
                            targetPath = path.join(baseDir, 'memory', `${dateId}.md`);
                        }
                        else {
                            writeProtocolError(res, 400, 'invalid_request', 'bad_request', 'invalid date identifier');
                            return;
                        }
                        if (fs.existsSync(targetPath)) {
                            fs.unlinkSync(targetPath);
                        }
                        writeJson(res, 200, { success: true });
                    }
                    catch (err) {
                        writeProtocolError(res, 500, 'server_error', 'internal_error', err.message);
                    }
                    return;
                }
            }
            if (pathname === '/agents' && req.method === 'GET') {
                writeJson(res, 200, {
                    name: 'Tix',
                    description: 'Tix AI Agent',
                    version: '1.0.0',
                });
                return;
            }
            // ── Enrollment endpoints ──
            if (pathname === '/api/enroll/status' && req.method === 'GET') {
                const state = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
                writeJson(res, 200, {
                    computer_id: state.computer_id,
                    fingerprint: state.computer_fingerprint,
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
                    computerId: COMPUTER_HOSTNAME || undefined,
                });
                writeJson(res, 201, result);
                return;
            }
            if (pathname === '/api/enroll/verify' && req.method === 'POST') {
                const parsed = await readJsonBody(req);
                const token = parsed.token;
                const computerFingerprint = parsed.computer_fingerprint;
                if (!token || !computerFingerprint) {
                    writeProtocolError(res, 400, 'input_error', 'bad_request', 'token and computer_fingerprint are required');
                    return;
                }
                const result = verifyEnrollmentToken({
                    token,
                    computerFingerprint,
                    computerId: COMPUTER_HOSTNAME || undefined,
                });
                if (!result.ok) {
                    const statusCode = result.code === 'frozen'
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
                    computerId: COMPUTER_HOSTNAME || undefined,
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
                    computerId: COMPUTER_HOSTNAME || undefined,
                });
                writeJson(res, 200, { ok: true, trust_state: state.trust_state });
                return;
            }
            if (pathname === '/api/enroll/reenroll' && req.method === 'POST') {
                const state = setTrustState('discovered_untrusted', {
                    computerId: COMPUTER_HOSTNAME || undefined,
                });
                writeJson(res, 200, { ok: true, trust_state: state.trust_state });
                return;
            }
            // ── Pairing endpoints ──
            if (pathname === '/api/v1/pairings' && req.method === 'GET') {
                const ctx = resolveHttpAdminContext(req);
                if (!ctx?.isAdmin) {
                    writeProtocolError(res, 403, 'auth_error', 'admin_required', 'Admin access required for pairing management.');
                    return;
                }
                writeJson(res, 200, {
                    ok: true,
                    bindings: listBindings(),
                    pending: listPendingPairings(),
                });
                return;
            }
            if (pathname === '/api/v1/pairings/approve' && req.method === 'POST') {
                const ctx = resolveHttpAdminContext(req);
                if (!ctx?.isAdmin) {
                    writeProtocolError(res, 403, 'auth_error', 'admin_required', 'Admin access required for pairing approval.');
                    return;
                }
                const parsed = await readJsonBody(req);
                const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
                const agentId = typeof parsed.agent_id === 'string' ? parsed.agent_id.trim() : undefined;
                if (!code) {
                    writeProtocolError(res, 400, 'input_error', 'code_required', 'Pair code is required.');
                    return;
                }
                const approved = approvePairing(code, ctx.actor || 'http-admin', agentId);
                if (!approved) {
                    writeProtocolError(res, 404, 'input_error', 'pair_code_not_found', `Pair code not found: ${code.toUpperCase()}`);
                    return;
                }
                if (approved.status === 'expired') {
                    writeProtocolError(res, 410, 'input_error', 'pair_code_expired', `Pair code has expired: ${approved.pair_code}`, {
                        pair_code: approved.pair_code,
                        expires_at: approved.expires_at,
                    });
                    return;
                }
                const boundAgentId = approved.bound_agent_id || approved.requested_agent_id;
                const binding = upsertBinding({
                    chatJid: approved.chat_jid,
                    agentId: boundAgentId,
                    approvedBy: ctx.actor || 'http-admin',
                    pairCode: approved.pair_code,
                });
                writeJson(res, 200, { ok: true, pairing: approved, binding });
                return;
            }
            if (pathname === '/api/v1/pairings' && req.method === 'DELETE') {
                const ctx = resolveHttpAdminContext(req);
                if (!ctx?.isAdmin) {
                    writeProtocolError(res, 403, 'auth_error', 'admin_required', 'Admin access required for binding removal.');
                    return;
                }
                const parsed = await readJsonBody(req);
                const chatJid = typeof parsed.chat_jid === 'string' ? parsed.chat_jid.trim() : '';
                if (!chatJid) {
                    writeProtocolError(res, 400, 'input_error', 'chat_jid_required', 'chat_jid is required.');
                    return;
                }
                const removed = removeBinding(chatJid);
                writeJson(res, 200, { ok: true, removed, chat_jid: chatJid });
                return;
            }
            // ── SSE Stream ── (v1: /api/v1/agents/:agent_id/sessions/:session_id/stream)
            const sseV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/stream$/);
            if ((sseV1Match ||
                (pathname.startsWith('/runs/') && pathname.endsWith('/stream'))) &&
                req.method === 'GET') {
                const agentId = sseV1Match ? decodeURIComponent(sseV1Match[1]) : url.searchParams.get('agent_id');
                const sessionId = sseV1Match ? decodeURIComponent(sseV1Match[2]) : url.searchParams.get('session_id');
                if (!agentId || !sessionId) {
                    writeProtocolError(res, 400, 'input_error', 'missing_scope', 'agent_id and session_id are required');
                    return;
                }
                const chatJid = buildHttpSessionId(agentId, sessionId);
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                });
                res.write(`data: ${JSON.stringify({
                    type: 'connected',
                    chat_jid: chatJid,
                    agent_id: agentId,
                    session_id: sessionId,
                })}\n\n`);
                addClient(chatJid, res);
                const heartbeat = setInterval(() => {
                    try {
                        res.write(': ping\n\n');
                    }
                    catch {
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
                // v1: override agent_id and session_id from path params
                if (postMsgV1Match) {
                    parsed.agent_id = decodeURIComponent(postMsgV1Match[1]);
                    parsed.session_id = decodeURIComponent(postMsgV1Match[2]);
                }
                const { agent_id: rawAgentId, session_id: rawSessionId, task_id: rawTaskId, content, } = parsed;
                if (!content || typeof content !== 'string') {
                    writeProtocolError(res, 400, 'input_error', 'content_required', 'content is required');
                    return;
                }
                const agentId = typeof rawAgentId === 'string' && rawAgentId.trim()
                    ? rawAgentId.trim()
                    : null;
                const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim()
                    ? rawSessionId.trim()
                    : null;
                const taskId = typeof rawTaskId === 'string' && rawTaskId.trim()
                    ? rawTaskId.trim()
                    : randomUUID();
                if (!agentId || !sessionId) {
                    writeProtocolError(res, 400, 'input_error', 'missing_scope', 'agent_id and session_id are required');
                    return;
                }
                const chatJid = buildHttpSessionId(agentId, sessionId);
                const senderIdentity = adminContext
                    ? deriveHttpSenderIdentity(adminContext)
                    : { sender: 'web-user', sender_name: 'Web User' };
                const timestamp = new Date().toISOString();
                const enrollState = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
                if (enrollState.trust_state !== 'trusted') {
                    writeJson(res, 403, {
                        error: 'computer_not_trusted',
                        trust_state: enrollState.trust_state,
                    });
                    return;
                }
                const projects = this.opts.registeredProjects();
                if (!projects[chatJid] && this.opts.onGroupRegistered) {
                    const project = {
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
                const msg = {
                    id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    chat_jid: chatJid,
                    sender: senderIdentity.sender,
                    sender_name: senderIdentity.sender_name,
                    content,
                    timestamp,
                    is_from_me: false,
                    agent_id: agentId,
                    session_id: sessionId,
                    task_id: taskId,
                    model: typeof parsed.model === 'string' ? parsed.model : undefined,
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
            if ((pathname === '/api/v1/skills/install' || pathname === '/api/skills/install') && method === 'POST') {
                let bodyObj;
                try {
                    bodyObj = await readJsonBody(req);
                }
                catch (e) {
                    writeProtocolError(res, 400, 'input_error', 'invalid_json', 'invalid json body');
                    return;
                }
                if (!bodyObj?.url) {
                    writeProtocolError(res, 400, 'input_error', 'missing_url', 'url is required');
                    return;
                }
                const registry = new SkillsRegistry(SKILLS_CONFIG);
                const ctx = adminContext || { actor: 'web-ui', isAdmin: true, approveLevel3: true };
                try {
                    // Proxy priority: API body (from Supen UI) > config.yaml proxy field.
                    // Shell env vars (http_proxy etc.) are intentionally ignored.
                    const proxy = bodyObj.proxy || readConfigYaml(['HTTPS_PROXY'])['HTTPS_PROXY'] || undefined;
                    const result = registry.installManagedSkill(bodyObj.url, ctx, { trustSource: true, proxy });
                    registry.enableSkill(result.name, ctx);
                    writeJson(res, 200, { ok: true, skill: result });
                }
                catch (err) {
                    writeProtocolError(res, 400, 'input_error', 'skill_install_failed', err.message);
                }
                return;
            }
            if ((pathname.startsWith('/api/v1/skills/') || pathname.startsWith('/api/skills/')) &&
                (pathname.endsWith('/enable') || pathname.endsWith('/disable')) &&
                method === 'POST') {
                const parts = pathname.split('/');
                // v1 path: /api/v1/skills/:name/enable → parts[4]=name, parts[5]=action
                // old path: /api/skills/:name/enable   → parts[3]=name, parts[4]=action
                const isV1 = pathname.startsWith('/api/v1/');
                const skillName = isV1 ? parts[4] : parts[3];
                const action = (isV1 ? parts[5] : parts[4]);
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
                    }
                    else {
                        result = registry.disableSkill(skillName, ctx);
                    }
                    writeJson(res, 200, { ok: true, skill: result });
                }
                catch (err) {
                    writeProtocolError(res, 400, 'input_error', 'skill_action_failed', err.message);
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
                    writeProtocolError(res, 400, 'input_error', 'missing_params', 'agent_id and session_id required');
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
            if ((pathname === '/api/v1/usage/daily' || pathname === '/api/usage/daily') && req.method === 'GET') {
                const daily = getDailyUsage();
                const allAgents = getAllAgents();
                const agentMap = Object.fromEntries(allAgents.map(a => [a.agent_id, a.name]));
                // Optionally enrich sessions with agent names
                const enriched = {};
                for (const [date, dayData] of Object.entries(daily)) {
                    const day = dayData;
                    enriched[date] = {
                        total: { ...day.total, tokens_total: (day.total.tokens_in || 0) + (day.total.tokens_out || 0) },
                        models: {}
                    };
                    for (const [modelId, modelData] of Object.entries(day.models)) {
                        const mod = modelData;
                        enriched[date].models[modelId] = {
                            total: { ...mod.total, tokens_total: (mod.total.tokens_in || 0) + (mod.total.tokens_out || 0) },
                            sessions: {}
                        };
                        for (const [sessionId, sess] of Object.entries(mod.sessions)) {
                            const s = sess;
                            enriched[date].models[modelId].sessions[sessionId] = {
                                ...s,
                                agent_name: agentMap[s.agent_id] || s.agent_id
                            };
                        }
                    }
                }
                writeJson(res, 200, { daily: enriched });
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
                    const agentSessions = allSessions.filter((s) => s.agent_id === a.agent_id);
                    let model;
                    try {
                        const configPath = agentPaths(a.agent_id).config;
                        if (fs.existsSync(configPath)) {
                            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                            model = config.model;
                        }
                    }
                    catch {
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
                    writeProtocolError(res, 400, 'validation_error', 'name_required', 'Agent name is required');
                    return;
                }
                const agentId = name
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, '-')
                    .replace(/-+/g, '-');
                const agent = ensureAgent({ agent_id: agentId, name, tags: body.tags });
                // Write initial LLM config if provided during generation
                if (typeof body.model === 'string' && body.model.trim()) {
                    const configPath = agentPaths(agentId).config;
                    let config = {};
                    if (fs.existsSync(configPath)) {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    }
                    config.model = body.model.trim();
                    fs.mkdirSync(path.dirname(configPath), { recursive: true });
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                }
                writeJson(res, 201, { agent });
                return;
            }
            // GET /api/v1/agents/:id — get agent config + session count
            const agentGetMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
            if (agentGetMatch && req.method === 'GET') {
                const agentId = decodeURIComponent(agentGetMatch[1]);
                const allSessions = getAllSessions();
                const agentSessions = allSessions.filter((s) => s.agent_id === agentId);
                let config = {};
                try {
                    const configPath = agentPaths(agentId).config;
                    if (fs.existsSync(configPath)) {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    }
                }
                catch { /* ignore */ }
                writeJson(res, 200, {
                    agent_id: agentId,
                    session_count: agentSessions.length,
                    config,
                });
                return;
            }
            // GET /api/v1/agents/:id/skills — list global skills with per-agent overrides
            const agentSkillsMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/skills$/);
            if (agentSkillsMatch && req.method === 'GET') {
                const agentId = decodeURIComponent(agentSkillsMatch[1]);
                try {
                    const paths = agentPaths(agentId);
                    const registry = new SkillsRegistry(SKILLS_CONFIG);
                    const available = registry.listAvailable();
                    const agentSkillsPath = path.join(paths.base, 'skills.json');
                    let agentAllowed = null;
                    if (fs.existsSync(agentSkillsPath)) {
                        try {
                            agentAllowed = JSON.parse(fs.readFileSync(agentSkillsPath, 'utf8'));
                        }
                        catch { /* fallback to null = use global */ }
                    }
                    writeJson(res, 200, {
                        mode: agentAllowed ? 'custom' : 'global',
                        allowed: agentAllowed,
                        skills: available.map((s) => {
                            const globalEnabled = s.installed?.enabled ?? false;
                            const agentEnabled = agentAllowed
                                ? agentAllowed.includes(s.skill.name) && globalEnabled
                                : globalEnabled;
                            return {
                                name: s.skill.name,
                                description: s.skill.description,
                                version: s.skill.version,
                                source: s.skill.source,
                                permissionLevel: s.skill.permission.level,
                                globalEnabled,
                                agentEnabled,
                                installed: !!s.installed,
                                diagnostics: s.skill.diagnostics,
                            };
                        }),
                    });
                }
                catch (err) {
                    writeProtocolError(res, 500, 'internal_error', 'agent_skills_read_failed', err.message);
                }
                return;
            }
            // PUT /api/v1/agents/:id/skills — set per-agent skills config
            if (agentSkillsMatch && req.method === 'PUT') {
                const agentId = decodeURIComponent(agentSkillsMatch[1]);
                const body = await readJsonBody(req);
                try {
                    const paths = agentPaths(agentId);
                    const agentSkillsPath = path.join(paths.base, 'skills.json');
                    fs.mkdirSync(paths.base, { recursive: true });
                    if (body.mode === 'global') {
                        // Remove the per-agent override — agent falls back to global config
                        if (fs.existsSync(agentSkillsPath)) {
                            fs.unlinkSync(agentSkillsPath);
                        }
                    }
                    else if (Array.isArray(body.allowed)) {
                        // Write a whitelist of skill names
                        fs.writeFileSync(agentSkillsPath, JSON.stringify(body.allowed, null, 2));
                    }
                    else {
                        writeProtocolError(res, 400, 'input_error', 'invalid_body', 'Provide { mode: "global" } or { mode: "custom", allowed: [...] }');
                        return;
                    }
                    writeJson(res, 200, { ok: true });
                }
                catch (err) {
                    writeProtocolError(res, 500, 'internal_error', 'agent_skills_write_failed', err.message);
                }
                return;
            }
            // PATCH /api/v1/agents/:id — update agent configuration
            const agentPatchMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
            if (agentPatchMatch && req.method === 'PATCH') {
                const agentId = decodeURIComponent(agentPatchMatch[1]);
                const body = await readJsonBody(req);
                try {
                    const configPath = agentPaths(agentId).config;
                    let config = {};
                    if (fs.existsSync(configPath)) {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    }
                    // Merge in allowed top-level config fields
                    const allowed = ['model', 'name', 'system_prompt', 'tags', 'effort', 'max_turns', 'max_budget_usd', 'max_task_tokens'];
                    for (const key of allowed) {
                        if (body[key] !== undefined)
                            config[key] = body[key];
                    }
                    fs.mkdirSync(path.dirname(configPath), { recursive: true });
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                    // Also update AgentRecord (agent.json) for name and tags
                    if (body.name !== undefined || body.tags !== undefined) {
                        ensureAgent({
                            agent_id: agentId,
                            name: body.name,
                            tags: body.tags
                        });
                    }
                    writeJson(res, 200, { ok: true, config });
                }
                catch (err) {
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
                }
                catch (err) {
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
                    let config = {};
                    if (fs.existsSync(configPath)) {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    }
                    if (modelId) {
                        config.model = modelId;
                    }
                    else {
                        delete config.model;
                    }
                    // Ensure directory exists
                    fs.mkdirSync(path.dirname(configPath), { recursive: true });
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                    writeJson(res, 200, { ok: true, model: modelId });
                }
                catch (err) {
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
                    writeProtocolError(res, 400, 'validation_error', 'agent_id_required', 'agent_id is required');
                    return;
                }
                const sessionId = typeof body.session_id === 'string' && body.session_id.trim()
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
            const sessionStopV1Match = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/stop$/);
            const sessionDeleteMatch = sessionV1Match ?? pathname.match(/^\/api\/sessions\/([^/]+)$/);
            if (sessionStopV1Match && req.method === 'POST') {
                const agentId = decodeURIComponent(sessionStopV1Match[1]);
                const sessionId = decodeURIComponent(sessionStopV1Match[2]);
                const session = getSessionForAgent(agentId, sessionId);
                if (!session) {
                    writeProtocolError(res, 404, 'input_error', 'session_not_found', `Session "${sessionId}" not found for agent "${agentId}"`);
                    return;
                }
                const result = this.opts.onSessionStop?.(agentId, sessionId, adminContext?.actor);
                if (!result) {
                    writeProtocolError(res, 501, 'internal_error', 'session_stop_unavailable', 'Session stop is not available in this runtime.');
                    return;
                }
                if (!result.ok) {
                    writeProtocolError(res, 409, 'input_error', result.code, result.message);
                    return;
                }
                writeJson(res, 200, {
                    ok: true,
                    code: result.code,
                    message: result.message,
                    agent_id: agentId,
                    session_id: sessionId,
                });
                return;
            }
            if (sessionDeleteMatch && req.method === 'DELETE') {
                const id = sessionV1Match ? decodeURIComponent(sessionV1Match[2]) : decodeURIComponent(sessionDeleteMatch[1]);
                const agentIdRaw = sessionV1Match ? decodeURIComponent(sessionV1Match[1]) : url.searchParams.get('agent_id');
                const agentId = typeof agentIdRaw === 'string' && agentIdRaw.trim()
                    ? agentIdRaw.trim()
                    : '';
                try {
                    if (agentId) {
                        let deleted = deleteSessionForAgent(agentId, id);
                        if (!deleted) {
                            deleted = deleteSessionForAgent(agentId, id, true);
                        }
                        if (!deleted) {
                            writeProtocolError(res, 404, 'input_error', 'session_not_found', `Session "${id}" not found for agent "${agentId}"`);
                            return;
                        }
                    }
                    else {
                        // Backward-compatible fallback for older clients.
                        deleteSession(id);
                    }
                }
                catch (e) {
                    logger.warn({ id, agentId: agentId || undefined, error: e }, 'Failed to delete session directory');
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
                const updates = {};
                if (title !== undefined)
                    updates.title = title;
                if (archived !== undefined)
                    updates.archived = archived;
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
                }
                else {
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
                const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
                const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
                const cron = typeof body.cron === 'string' ? body.cron.trim() : '';
                const targetJid = typeof body.target_jid === 'string' ? body.target_jid.trim() : undefined;
                if (!agentId || !prompt || !cron) {
                    writeProtocolError(res, 400, 'validation_error', 'missing_fields', 'agent_id, prompt, and cron are required');
                    return;
                }
                // Validate cron expression before creating schedule
                try {
                    const { CronExpressionParser } = await import('cron-parser');
                    CronExpressionParser.parse(cron, { tz: 'Asia/Shanghai' });
                }
                catch (e) {
                    writeProtocolError(res, 400, 'validation_error', 'invalid_cron', `Invalid cron expression: ${cron}`);
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
                const newStatus = typeof body.status === 'string' ? body.status : undefined;
                if (newStatus !== 'active' && newStatus !== 'paused') {
                    writeProtocolError(res, 400, 'validation_error', 'invalid_status', 'status must be active or paused');
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
                }
                catch (err) {
                    logger.error({ err: err.message }, 'Failed to list active tasks');
                    writeJson(res, 500, { error: 'Failed to list tasks', tasks: [] });
                }
                return;
            }
            // ── OpenAPI spec (auto-generated from route registry) ──
            if (pathname === '/api/v1/openapi.json' && req.method === 'GET') {
                const { buildComputerOpenApiSpec } = await import('./http-routes.js');
                const spec = buildComputerOpenApiSpec({
                    serverUrl: `http://${req.headers.host || `localhost:${HTTP_PORT}`}`,
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(spec, null, 2));
                return;
            }
            // ── Web UI API: Computer ──
            if ((pathname === '/api/v1/computer' || pathname === '/api/computer') && req.method === 'GET') {
                const enrollment = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
                const stats = getExecutorStats();
                // System Telemetry
                const cpus = os.cpus();
                const memTotal = os.totalmem();
                const memFree = os.freemem();
                const loadAvg = os.loadavg();
                const uptime = os.uptime();
                // Disk Telemetry (Tix Home)
                let disk_total;
                let disk_free;
                let disk_used;
                try {
                    const diskStats = fs.statfsSync(TIX_HOME);
                    disk_total = diskStats.bsize * diskStats.blocks;
                    disk_free = diskStats.bsize * diskStats.bavail;
                    disk_used = disk_total - disk_free;
                }
                catch {
                    /* ignore */
                }
                writeJson(res, 200, {
                    hostname: COMPUTER_HOSTNAME,
                    enrollment: {
                        trust_state: enrollment.trust_state,
                        fingerprint: enrollment.computer_fingerprint,
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
                        disk_total,
                        disk_free,
                        disk_used,
                    }
                });
                return;
            }
            // ── Web UI API: Trust Tix ──
            if ((pathname === '/api/v1/computer/trust' || pathname === '/api/computer/trust') && req.method === 'POST') {
                writeProtocolError(res, 410, 'auth_error', 'trust_endpoint_removed', 'Direct trust elevation is disabled. Use the enrollment flow (/api/enroll/token + /api/enroll/verify) to transition a computer to trusted state.');
                return;
            }
            // ── Feature 4: Context window usage for an active session ──
            //   GET /api/v1/agents/:agentId/sessions/:sessionId/context
            const contextUsageMatch = req.method === 'GET' &&
                pathname.match(/^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/context$/);
            if (contextUsageMatch) {
                const agentId = decodeURIComponent(contextUsageMatch[1]);
                const sessionId = decodeURIComponent(contextUsageMatch[2]);
                const warm = getWarmSession(agentId, sessionId);
                if (!warm || !warm.alive) {
                    writeProtocolError(res, 404, 'not_found', 'no_active_session', 'No active warm session found for this agent/session. The session may be idle or not yet started.');
                    return;
                }
                try {
                    const usage = await warm.query.getContextUsage();
                    writeJson(res, 200, usage);
                }
                catch (err) {
                    writeProtocolError(res, 500, 'internal_error', 'context_usage_failed', err.message);
                }
                return;
            }
            writeProtocolError(res, 404, 'input_error', 'not_found', 'Not found');
        }
        catch (err) {
            const protocolError = protocolErrorFromUnknown(err);
            logger.error({ err, pathname }, 'HTTP request failed');
            if (!res.headersSent) {
                writeProtocolError(res, protocolError.statusCode, protocolError.classification, protocolError.code, protocolError.message);
            }
            else {
                res.end();
            }
        }
    }
    async sendMessage(jid, text, options) {
        if (!text.trim())
            return;
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
        logger.debug({
            agent_id: session?.agent_id,
            session_id: session?.session_id,
            chat_jid: jid,
            length: text.length,
        }, 'HTTP SSE message broadcast');
    }
    async sendFile(jid, filePath, caption) {
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
        let tixUrl;
        if (filePath.startsWith(workspace)) {
            const relPath = path.relative(workspace, filePath);
            tixUrl = `tix://workspace/${agentId}/${relPath}`;
        }
        else {
            // File outside workspace — copy to workspace first
            const destName = `${randomUUID()}${path.extname(filePath)}`;
            const destPath = path.join(workspace, '.files', destName);
            fs.mkdirSync(path.join(workspace, '.files'), { recursive: true });
            fs.copyFileSync(filePath, destPath);
            tixUrl = `tix://workspace/${agentId}/.files/${destName}`;
        }
        const text = mime.startsWith('image/')
            ? `![${label}](${tixUrl})`
            : `[${label}](${tixUrl})`;
        broadcastToChat(jid, {
            type: 'message',
            chat_jid: jid,
            agent_id: agentId,
            session_id: session?.session_id,
            text,
            is_file: true,
        });
        logger.info({ jid, tixUrl, mime }, 'File sent to web client');
    }
    isConnected() {
        return this._connected && this.server !== null;
    }
    ownsJid(jid) {
        return jid.startsWith(WEB_JID_PREFIX);
    }
    async disconnect() {
        this._connected = false;
        if (this.server) {
            await new Promise((resolve) => this.server.close(() => resolve()));
            this.server = null;
        }
        for (const clients of sseClients.values()) {
            for (const res of clients) {
                try {
                    if (res instanceof http.ServerResponse) {
                        res.end();
                    }
                    else {
                        res.close();
                    }
                }
                catch {
                    /* ignore */
                }
            }
        }
        sseClients.clear();
        logger.info('HTTP SSE channel disconnected');
    }
}
function createHttpChannel(opts) {
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
//# sourceMappingURL=http.js.map