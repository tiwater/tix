/**
 * Filesystem-based data store for Tix.
 *
 * Replaces SQLite (db.ts) with plain files:
 *   - agents/{id}/agent.json        → AgentRecord
 *   - agents/{id}/sessions/{sid}/   → session.json + messages.jsonl
 *   - agents/{id}/schedules/{id}.json → ScheduleRecord
 *   - router-state.json             → key-value pairs
 *   - registered groups             → agent.json `sources` field (future)
 *
 * Design philosophy: the filesystem IS the database.
 * See docs/data-management-design.md
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { AGENTS_DIR, TIX_HOME, TIMEZONE, getAgentModelConfig } from './config.js';
import { logger } from './logger.js';
const getGlobalUsagePath = () => path.join(TIX_HOME, 'global-usage.json');
import { isValidGroupFolder } from './utils.js';
import { assertSafePathSegment, resolveWithin } from './security.js';
// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function readJson(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return undefined;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
function appendJsonl(filePath, record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}
function readJsonl(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return [];
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content)
            return [];
        return content.split('\n').map((line) => JSON.parse(line));
    }
    catch {
        return [];
    }
}
/** Read last N lines from a JSONL file (efficient tail). */
function readJsonlTail(filePath, limit) {
    try {
        if (limit <= 0)
            return [];
        if (!fs.existsSync(filePath))
            return [];
        const stat = fs.statSync(filePath);
        if (stat.size <= 0)
            return [];
        const fd = fs.openSync(filePath, 'r');
        try {
            const chunkSize = 64 * 1024;
            let pos = stat.size;
            let newlineCount = 0;
            const chunks = [];
            while (pos > 0 && newlineCount <= limit) {
                const bytesToRead = Math.min(chunkSize, pos);
                pos -= bytesToRead;
                const chunk = Buffer.allocUnsafe(bytesToRead);
                const bytesRead = fs.readSync(fd, chunk, 0, bytesToRead, pos);
                if (bytesRead <= 0)
                    break;
                const view = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
                for (let i = 0; i < view.length; i += 1) {
                    if (view[i] === 0x0a)
                        newlineCount += 1;
                }
                chunks.unshift(view);
            }
            if (chunks.length === 0)
                return [];
            const content = Buffer.concat(chunks).toString('utf-8').trim();
            if (!content)
                return [];
            const tail = content.split('\n').slice(-limit);
            const out = [];
            for (const line of tail) {
                if (!line.trim())
                    continue;
                try {
                    out.push(JSON.parse(line));
                }
                catch {
                    // Skip malformed lines to preserve best-effort retrieval.
                }
            }
            return out;
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return [];
    }
}
function listDirs(parentDir) {
    try {
        if (!fs.existsSync(parentDir))
            return [];
        return fs
            .readdirSync(parentDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
    catch {
        return [];
    }
}
function listJsonFiles(dir) {
    try {
        if (!fs.existsSync(dir))
            return [];
        return fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace('.json', ''));
    }
    catch {
        return [];
    }
}
function readYaml(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return undefined;
        const content = fs.readFileSync(filePath, 'utf-8');
        return yaml.load(content);
    }
    catch (err) {
        logger.error({ filePath, err: err.message }, 'Failed to read YAML');
        return undefined;
    }
}
function writeYaml(filePath, data) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const content = yaml.dump(data, { lineWidth: -1, noRefs: true });
        fs.writeFileSync(filePath, content, 'utf-8');
    }
    catch (err) {
        logger.error({ filePath, err: err.message }, 'Failed to write YAML');
    }
}
// ═══════════════════════════════════════════════════════════════
// Path helpers
// ═══════════════════════════════════════════════════════════════
function agentDir(agentId) {
    const safeAgentId = assertSafePathSegment(agentId, 'agent_id');
    return resolveWithin(AGENTS_DIR, safeAgentId);
}
function agentJsonPath(agentId) {
    return path.join(agentDir(agentId), 'agent.json');
}
function sessionDir(agentId, sessionId) {
    const safeSessionId = assertSafePathSegment(sessionId, 'session_id');
    return resolveWithin(agentDir(agentId), 'sessions', safeSessionId);
}
function resolveSessionDir(agentId, sessionId) {
    const safeSessionId = assertSafePathSegment(sessionId, 'session_id');
    const archivedPath = resolveWithin(agentDir(agentId), 'archived_sessions', safeSessionId);
    if (fs.existsSync(archivedPath)) {
        return archivedPath;
    }
    return sessionDir(agentId, sessionId);
}
function sessionJsonPath(agentId, sessionId) {
    return path.join(resolveSessionDir(agentId, sessionId), 'session.json');
}
function messagesPath(agentId, sessionId) {
    return path.join(resolveSessionDir(agentId, sessionId), 'messages.jsonl');
}
function schedulesDir(agentId) {
    return path.join(agentDir(agentId), 'schedules');
}
function scheduleYamlPath(agentId, scheduleId) {
    const safeScheduleId = assertSafePathSegment(scheduleId, 'schedule_id');
    return resolveWithin(schedulesDir(agentId), `${safeScheduleId}.yaml`);
}
const getRouterStatePath = () => path.join(TIX_HOME, 'router-state.json');
const getRegisteredGroupsPath = () => path.join(TIX_HOME, 'registered-groups.json');
// ═══════════════════════════════════════════════════════════════
// Init (no-op — dirs created on demand)
// ═══════════════════════════════════════════════════════════════
export function initStore() {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    logger.info({ dir: AGENTS_DIR }, 'Store initialized (filesystem)');
}
// ═══════════════════════════════════════════════════════════════
// Agents
// ═══════════════════════════════════════════════════════════════
export function ensureAgent(input) {
    const jsonPath = agentJsonPath(input.agent_id);
    const existing = readJson(jsonPath);
    const now = new Date().toISOString();
    if (existing) {
        const updated = {
            ...existing,
            name: input.name || existing.name,
            tags: input.tags || existing.tags,
            updated_at: now,
        };
        writeJson(jsonPath, updated);
        return updated;
    }
    const record = {
        agent_id: input.agent_id,
        name: input.name || input.agent_id,
        tags: input.tags,
        created_at: now,
        updated_at: now,
    };
    writeJson(jsonPath, record);
    return record;
}
export function getAgent(agentId) {
    return readJson(agentJsonPath(agentId));
}
export function getAllAgents() {
    const agents = [];
    for (const id of listDirs(AGENTS_DIR)) {
        const agent = readJson(agentJsonPath(id));
        if (agent)
            agents.push(agent);
    }
    return agents.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}
// ═══════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════
export function ensureSession(input) {
    ensureAgent({ agent_id: input.agent_id, name: input.agent_name });
    const jsonPath = sessionJsonPath(input.agent_id, input.session_id);
    const existing = readJson(jsonPath);
    const now = new Date().toISOString();
    if (existing) {
        const updated = {
            ...existing,
            channel: input.channel,
            source_ref: input.source_ref || existing.source_ref,
            status: input.status || existing.status,
            updated_at: now,
        };
        writeJson(jsonPath, updated);
        return updated;
    }
    const record = {
        session_id: input.session_id,
        agent_id: input.agent_id,
        channel: input.channel,
        source_ref: input.source_ref,
        status: input.status || 'idle',
        created_at: now,
        updated_at: now,
    };
    writeJson(jsonPath, record);
    return record;
}
export function getSession(sessionId) {
    // Sessions are nested under agents, so we need to scan
    for (const agentId of listDirs(AGENTS_DIR)) {
        const session = readJson(sessionJsonPath(agentId, sessionId));
        if (session)
            return session;
    }
    return undefined;
}
export function getSessionForAgent(agentId, sessionId) {
    return readJson(sessionJsonPath(agentId, sessionId));
}
export function getSessionsForAgent(agentId) {
    const sessionsBase = path.join(agentDir(agentId), 'sessions');
    const sessions = [];
    if (fs.existsSync(sessionsBase)) {
        for (const sid of listDirs(sessionsBase)) {
            const session = readJson(sessionJsonPath(agentId, sid));
            if (session)
                sessions.push(session);
        }
    }
    return sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export function getArchivedSessionsForAgent(agentId) {
    const sessionsBase = path.join(agentDir(agentId), 'archived_sessions');
    const sessions = [];
    if (fs.existsSync(sessionsBase)) {
        for (const sid of listDirs(sessionsBase)) {
            const jsonPath = path.join(sessionsBase, sid, 'session.json');
            const session = readJson(jsonPath);
            if (session) {
                sessions.push({ ...session, status: 'archived' });
            }
        }
    }
    return sessions.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
}
export function getAllSessions() {
    const sessions = [];
    for (const agentId of listDirs(AGENTS_DIR)) {
        sessions.push(...getSessionsForAgent(agentId));
    }
    return sessions.sort((a, b) => {
        const cmp = a.agent_id.localeCompare(b.agent_id);
        return cmp !== 0 ? cmp : a.session_id.localeCompare(b.session_id);
    });
}
export function updateSessionStatus(agentId, sessionId, status) {
    const jsonPath = sessionJsonPath(agentId, sessionId);
    const session = readJson(jsonPath);
    if (session) {
        session.status = status;
        session.updated_at = new Date().toISOString();
        writeJson(jsonPath, session);
    }
}
export function updateSessionUsage(agentId, sessionId, tokensIn, tokensOut) {
    const now = new Date().toISOString();
    // 1. Update Session Usage
    const sessPath = sessionJsonPath(agentId, sessionId);
    const session = readJson(sessPath);
    if (session) {
        session.tokens_in = (session.tokens_in || 0) + tokensIn;
        session.tokens_out = (session.tokens_out || 0) + tokensOut;
        session.updated_at = now;
        writeJson(sessPath, session);
    }
    // 2. Update Agent Usage (Aggregate)
    const aPath = agentJsonPath(agentId);
    const agent = readJson(aPath);
    if (agent) {
        agent.tokens_in = (agent.tokens_in || 0) + tokensIn;
        agent.tokens_out = (agent.tokens_out || 0) + tokensOut;
        agent.updated_at = now;
        writeJson(aPath, agent);
    }
    // 3. Update Global Usage (Persistent Log)
    // This ensures deletion of agents/sessions does not impact the historical total.
    try {
        const today = now.split('T')[0];
        const models = getAgentModelConfig(agentId, true);
        const modelId = models.length > 0 ? models[0].id : 'unknown';
        const rawLedger = readJson(getGlobalUsagePath());
        let ledger;
        if (!rawLedger || typeof rawLedger.total !== 'object') {
            ledger = {
                total: {
                    tokens_in: rawLedger?.tokens_in || 0,
                    tokens_out: rawLedger?.tokens_out || 0,
                    estimated_cost_usd: rawLedger?.estimated_cost_usd || 0,
                    updated_at: rawLedger?.updated_at || now
                },
                daily: {},
            };
        }
        else {
            ledger = rawLedger;
        }
        // Calculate incremental cost for this specific turn
        const increment = getUsageStats({
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            agent_id: agentId,
        });
        // Initialize daily/model/session nested structures if missing
        if (!ledger.daily)
            ledger.daily = {};
        if (!ledger.daily[today]) {
            ledger.daily[today] = {
                total: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0 },
                models: {},
            };
        }
        const day = ledger.daily[today];
        if (!day.models[modelId]) {
            day.models[modelId] = {
                total: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0 },
                sessions: {},
            };
        }
        const model = day.models[modelId];
        if (!model.sessions[sessionId]) {
            model.sessions[sessionId] = {
                agent_id: agentId,
                tokens_in: 0,
                tokens_out: 0,
                estimated_cost_usd: 0,
            };
        }
        const sessionEntry = model.sessions[sessionId];
        // Apply increments
        const applyIncrement = (target) => {
            target.tokens_in += tokensIn;
            target.tokens_out += tokensOut;
            target.tokens_total = (target.tokens_in || 0) + (target.tokens_out || 0);
            target.estimated_cost_usd = Number((target.estimated_cost_usd + increment.estimated_cost_usd).toFixed(6));
        };
        applyIncrement(ledger.total);
        ledger.total.updated_at = now;
        applyIncrement(day.total);
        applyIncrement(model.total);
        applyIncrement(sessionEntry);
        writeJson(getGlobalUsagePath(), ledger);
    }
    catch (e) {
        logger.warn({ error: e }, 'Failed to update global usage file');
    }
}
export function getUsageStats(record) {
    const tokens_in = record.tokens_in || 0;
    const tokens_out = record.tokens_out || 0;
    let estimated_cost_usd = 0;
    if (record.agent_id) {
        const models = getAgentModelConfig(record.agent_id, true);
        const model = models.length > 0 ? models[0] : null;
        if (model?.pricing) {
            estimated_cost_usd =
                (tokens_in / 1_000_000) * (model.pricing.input_usd_per_1m || 0) +
                    (tokens_out / 1_000_000) * (model.pricing.output_usd_per_1m || 0);
        }
    }
    return {
        tokens_in,
        tokens_out,
        tokens_total: tokens_in + tokens_out,
        estimated_cost_usd: Number(estimated_cost_usd.toFixed(6)),
    };
}
/** Get global usage across all agents and sessions. */
export function getGlobalUsage() {
    const ledger = readJson(getGlobalUsagePath());
    if (ledger && ledger.total) {
        return {
            tokens_in: ledger.total.tokens_in,
            tokens_out: ledger.total.tokens_out,
            tokens_total: ledger.total.tokens_in + ledger.total.tokens_out,
            estimated_cost_usd: ledger.total.estimated_cost_usd,
        };
    }
    // Fallback: calculate from current agents (migration path)
    let tokens_in = 0;
    let tokens_out = 0;
    let total_cost = 0;
    for (const agent of getAllAgents()) {
        const stats = getUsageStats(agent);
        tokens_in += stats.tokens_in;
        tokens_out += stats.tokens_out;
        total_cost += stats.estimated_cost_usd;
    }
    return {
        tokens_in,
        tokens_out,
        tokens_total: tokens_in + tokens_out,
        estimated_cost_usd: Number(total_cost.toFixed(6)),
    };
}
/** Get the full detailed daily usage ledger. */
export function getDailyUsage() {
    const ledger = readJson(getGlobalUsagePath());
    return ledger?.daily || {};
}
/**
 * Reset sessions stuck as "running" — called at startup to recover from crashes.
 * A "running" session cannot survive a process restart, so these are stale.
 */
export function cleanupStaleSessions() {
    let cleaned = 0;
    for (const agentId of listDirs(AGENTS_DIR)) {
        for (const session of getSessionsForAgent(agentId)) {
            if (session.status === 'running') {
                updateSessionStatus(agentId, session.session_id, 'idle');
                cleaned++;
                logger.info({ agentId, sessionId: session.session_id }, 'Reset stale running session to idle');
            }
        }
    }
    return cleaned;
}
export function updateSessionMetadata(agentId, sessionId, updates) {
    const jsonPath = sessionJsonPath(agentId, sessionId);
    const session = readJson(jsonPath);
    if (!session)
        return false;
    if (updates.title !== undefined)
        session.title = updates.title;
    session.updated_at = new Date().toISOString();
    writeJson(jsonPath, session);
    return true;
}
export function archiveSessionForAgent(agentId, sessionId) {
    const dir = sessionDir(agentId, sessionId);
    if (!fs.existsSync(dir))
        return false;
    const archiveDir = path.join(agentDir(agentId), 'archived_sessions');
    fs.mkdirSync(archiveDir, { recursive: true });
    const targetDir = path.join(archiveDir, sessionId);
    if (fs.existsSync(targetDir))
        return false; // already archived
    fs.renameSync(dir, targetDir);
    deleteSchedulesForSession(agentId, sessionId);
    return true;
}
function deleteSchedulesForSession(agentId, sessionId) {
    if (sessionId.startsWith('sched-')) {
        deleteSchedule(sessionId.slice(6));
    }
    else {
        const schedules = getSchedulesForAgent(agentId);
        for (const s of schedules) {
            if (s.target_jid && s.target_jid.endsWith(':' + sessionId)) {
                deleteSchedule(s.id);
            }
        }
    }
}
export function restoreSessionForAgent(agentId, sessionId) {
    const archivePath = path.join(agentDir(agentId), 'archived_sessions', sessionId);
    if (!fs.existsSync(archivePath))
        return false;
    const restoreDir = sessionDir(agentId, sessionId);
    fs.mkdirSync(path.dirname(restoreDir), { recursive: true });
    if (fs.existsSync(restoreDir))
        return false;
    fs.renameSync(archivePath, restoreDir);
    return true;
}
export function deleteSession(sessionId) {
    for (const agentId of listDirs(AGENTS_DIR)) {
        if (deleteSessionForAgent(agentId, sessionId))
            return;
        if (deleteSessionForAgent(agentId, sessionId, true))
            return;
    }
}
export function deleteSessionForAgent(agentId, sessionId, fromArchived = false) {
    const dir = fromArchived
        ? path.join(agentDir(agentId), 'archived_sessions', sessionId)
        : sessionDir(agentId, sessionId);
    if (!fs.existsSync(dir))
        return false;
    fs.rmSync(dir, { recursive: true, force: true });
    deleteSchedulesForSession(agentId, sessionId);
    return true;
}
/** Convert internal JSONL format → NewMessage for API compatibility */
function storedToNewMessage(m, chatJid) {
    return {
        id: m.id,
        chat_jid: chatJid,
        sender: m.sender,
        sender_name: m.sender_name,
        content: m.text,
        timestamp: m.ts,
        is_from_me: m.is_from_me ?? m.role === 'bot',
        is_bot_message: m.role === 'bot',
        attachments: m.attachments,
        model: m.model,
    };
}
/** Resolve agent+session from chat_jid (format: "web:agent_id:session_id" or similar). */
export function resolveFromChatJid(chatJid) {
    // web:agent_id:session_id
    const webMatch = chatJid.match(/^web:(.+?):(.+)$/);
    if (webMatch)
        return { agentId: webMatch[1], sessionId: webMatch[2] };
    // acp:agent_id:session_id
    const acpMatch = chatJid.match(/^acp:(.+?):(.+)$/);
    if (acpMatch)
        return { agentId: acpMatch[1], sessionId: acpMatch[2] };
    // feishu:app_id:chat_id
    const feishuMatch = chatJid.match(/^feishu:(.+?):(.+)$/);
    if (feishuMatch)
        return { agentId: feishuMatch[1], sessionId: feishuMatch[2] };
    // fs:app_id:chat_id (legacy/short prefix)
    const fsMatch = chatJid.match(/^fs:(.+?):(.+)$/);
    if (fsMatch)
        return { agentId: fsMatch[1], sessionId: fsMatch[2] };
    // For other channels, try to find the session across agents
    for (const agentId of listDirs(AGENTS_DIR)) {
        const sessionsBase = path.join(agentDir(agentId), 'sessions');
        for (const sid of listDirs(sessionsBase)) {
            const session = readJson(sessionJsonPath(agentId, sid));
            if (session?.source_ref === chatJid) {
                return { agentId, sessionId: sid };
            }
        }
    }
    return null;
}
export function storeMessage(msg) {
    // Determine agent_id and session_id
    let agentId = msg.agent_id;
    let sessionId = msg.session_id;
    if (!agentId || !sessionId) {
        const resolved = resolveFromChatJid(msg.chat_jid);
        if (resolved) {
            agentId = agentId || resolved.agentId;
            sessionId = sessionId || resolved.sessionId;
        }
    }
    if (!agentId || !sessionId) {
        logger.warn({ chat_jid: msg.chat_jid }, 'Cannot store message: unable to resolve agent/session from chat_jid');
        return;
    }
    // Ensure session directory exists
    const msgPath = messagesPath(agentId, sessionId);
    const stored = {
        id: msg.id,
        ts: msg.timestamp,
        role: msg.is_bot_message ? 'bot' : 'user',
        sender: msg.sender,
        sender_name: msg.sender_name,
        text: msg.content,
        is_from_me: msg.is_from_me,
        attachments: msg.attachments,
        model: msg.model,
    };
    appendJsonl(msgPath, stored);
}
/** Alias for storeMessage — both had identical implementations in db.ts */
export const storeMessageDirect = storeMessage;
export function getRecentMessages(chatJid, limit = 10) {
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return [];
    const messages = readJsonlTail(messagesPath(resolved.agentId, resolved.sessionId), limit);
    return messages.map((m) => storedToNewMessage(m, chatJid));
}
export function getMessagesSince(chatJid, sinceTimestamp, _botPrefix) {
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return [];
    const all = readJsonl(messagesPath(resolved.agentId, resolved.sessionId));
    return all
        .filter((m) => {
        const isNew = m.ts > sinceTimestamp;
        const isNotBot = m.role !== 'bot';
        const hasText = m.text && m.text.trim() !== '';
        const keep = isNew && isNotBot && hasText;
        logger.debug({ msgId: m.id, role: m.role, text: m.text, isNew, isNotBot, hasText, keep }, 'getMessagesSince: filtering message');
        return keep;
    })
        .map((m) => storedToNewMessage(m, chatJid));
}
export function getNewMessages(jids, lastTimestamp, botPrefix) {
    if (jids.length === 0)
        return { messages: [], newTimestamp: lastTimestamp };
    let newTimestamp = lastTimestamp;
    const messages = [];
    for (const jid of jids) {
        const msgs = getMessagesSince(jid, lastTimestamp, botPrefix);
        for (const m of msgs) {
            messages.push(m);
            if (m.timestamp > newTimestamp)
                newTimestamp = m.timestamp;
        }
    }
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { messages, newTimestamp };
}
// ═══════════════════════════════════════════════════════════════
// Schedules
// ═══════════════════════════════════════════════════════════════
import { CronExpressionParser } from 'cron-parser';
export function createSchedule(input) {
    if (!input.agent_id) {
        throw new Error('agent_id is required to create a schedule');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    ensureAgent({ agent_id: input.agent_id });
    let nextRun = input.next_run || null;
    if (!nextRun && input.cron) {
        try {
            const interval = CronExpressionParser.parse(input.cron, { tz: TIMEZONE });
            nextRun = interval.next().toISOString();
        }
        catch (e) {
            // invalid cron, let it be null
        }
    }
    const record = {
        id,
        agent_id: input.agent_id,
        cron: input.cron,
        prompt: input.prompt,
        type: input.type || 'cron',
        session: input.session || 'isolated',
        status: 'active',
        target_jid: input.target_jid,
        delete_after_run: false,
        next_run: nextRun,
        created_at: now,
    };
    writeYaml(scheduleYamlPath(input.agent_id, id), record);
    return record;
}
export function getScheduleById(id) {
    for (const agentId of listDirs(AGENTS_DIR)) {
        const schedule = readYaml(scheduleYamlPath(agentId, id));
        if (schedule)
            return schedule;
    }
    return undefined;
}
export function getAllSchedules() {
    const schedules = [];
    for (const agentId of listDirs(AGENTS_DIR)) {
        schedules.push(...getSchedulesForAgent(agentId));
    }
    return schedules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export function getSchedulesForAgent(agentId) {
    const dir = schedulesDir(agentId);
    const schedules = [];
    if (!fs.existsSync(dir))
        return schedules;
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.yaml'))
            continue;
        // Fallback: migrate .json if they still exist
        if (file.endsWith('.json'))
            continue;
        const id = file.replace('.yaml', '');
        const schedule = readYaml(scheduleYamlPath(agentId, id));
        if (schedule)
            schedules.push(schedule);
    }
    return schedules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export function getDueSchedules(forceAll = false) {
    const now = new Date().toISOString();
    return getAllSchedules().filter((s) => s.status === 'active' && (forceAll || (s.next_run && s.next_run <= now)));
}
export function updateSchedule(id, updates) {
    for (const agentId of listDirs(AGENTS_DIR)) {
        const yamlPath = scheduleYamlPath(agentId, id);
        const schedule = readYaml(yamlPath);
        if (schedule) {
            const updated = { ...schedule, ...updates };
            writeYaml(yamlPath, updated);
            return;
        }
    }
}
export function updateScheduleAfterRun(id, nextRun) {
    for (const agentId of listDirs(AGENTS_DIR)) {
        const yamlPath = scheduleYamlPath(agentId, id);
        const schedule = readYaml(yamlPath);
        if (schedule) {
            schedule.last_run = new Date().toISOString();
            schedule.next_run = nextRun;
            if (!nextRun)
                schedule.status = 'paused';
            writeYaml(yamlPath, schedule);
            return;
        }
    }
}
export function deleteSchedule(id) {
    for (const agentId of listDirs(AGENTS_DIR)) {
        const yamlPath = scheduleYamlPath(agentId, id);
        if (fs.existsSync(yamlPath)) {
            fs.unlinkSync(yamlPath);
            const sessionId = 'sched-' + id;
            const sDir = sessionDir(agentId, sessionId);
            if (fs.existsSync(sDir)) {
                fs.rmSync(sDir, { recursive: true, force: true });
            }
            else {
                const archivedDir = path.join(agentDir(agentId), 'archived_sessions', sessionId);
                if (fs.existsSync(archivedDir)) {
                    fs.rmSync(archivedDir, { recursive: true, force: true });
                }
            }
            return;
        }
    }
}
// ═══════════════════════════════════════════════════════════════
// Router state (simple JSON key-value file)
// ═══════════════════════════════════════════════════════════════
function loadRouterState() {
    return readJson(getRouterStatePath()) || {};
}
function saveRouterState(state) {
    writeJson(getRouterStatePath(), state);
}
export function getRouterState(key) {
    return loadRouterState()[key];
}
export function setRouterState(key, value) {
    const state = loadRouterState();
    state[key] = value;
    saveRouterState(state);
}
export function getAllRouterState() {
    return loadRouterState();
}
// ═══════════════════════════════════════════════════════════════
// Registered groups/projects (JSON file)
// ═══════════════════════════════════════════════════════════════
function loadRegisteredGroups() {
    return (readJson(getRegisteredGroupsPath()) || {});
}
function saveRegisteredGroups(groups) {
    writeJson(getRegisteredGroupsPath(), groups);
}
export function getRegisteredProject(jid) {
    const groups = loadRegisteredGroups();
    const group = groups[jid];
    if (!group)
        return undefined;
    if (!isValidGroupFolder(group.folder)) {
        logger.warn({ jid, folder: group.folder }, 'Skipping registered group with invalid folder');
        return undefined;
    }
    return {
        jid,
        name: group.name,
        folder: group.folder,
        agent_id: group.agent_id || group.folder,
        trigger: group.trigger,
        added_at: group.added_at,
        requiresTrigger: group.requiresTrigger,
        isMain: group.isMain,
    };
}
export function setRegisteredProject(jid, group) {
    if (!isValidGroupFolder(group.folder)) {
        throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
    }
    const agentId = group.agent_id || group.folder;
    ensureAgent({ agent_id: agentId, name: group.name });
    const groups = loadRegisteredGroups();
    groups[jid] = {
        ...group,
        agent_id: agentId,
    };
    saveRegisteredGroups(groups);
}
export function getAllRegisteredProjects() {
    const groups = loadRegisteredGroups();
    const result = {};
    for (const [jid, group] of Object.entries(groups)) {
        if (!isValidGroupFolder(group.folder)) {
            logger.warn({ jid, folder: group.folder }, 'Skipping registered group with invalid folder');
            continue;
        }
        result[jid] = {
            name: group.name,
            folder: group.folder,
            agent_id: group.agent_id || group.folder,
            trigger: group.trigger,
            added_at: group.added_at,
            requiresTrigger: group.requiresTrigger,
            isMain: group.isMain,
        };
    }
    return result;
}
// ═══════════════════════════════════════════════════════════════
// Chat metadata (lightweight — stored in session.json)
// ═══════════════════════════════════════════════════════════════
export function storeChatMetadata(chatJid, timestamp, name, channel, _isGroup) {
    // For the filesystem approach, chat metadata is implicitly part of
    // the session. We ensure the session exists.
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return;
    ensureSession({
        agent_id: resolved.agentId,
        session_id: resolved.sessionId,
        channel: channel || 'unknown',
        source_ref: chatJid,
        agent_name: name,
    });
}
export function updateChatName(chatJid, name) {
    // Chat metadata is stored in session.json — update the agent name
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return;
    const jsonPath = sessionJsonPath(resolved.agentId, resolved.sessionId);
    const session = readJson(jsonPath);
    if (session) {
        session.name = name;
        session.updated_at = new Date().toISOString();
        writeJson(jsonPath, session);
    }
}
export function getAllChats() {
    // Reconstruct from sessions
    const chats = [];
    for (const agentId of listDirs(AGENTS_DIR)) {
        const sessions = getSessionsForAgent(agentId);
        for (const session of sessions) {
            chats.push({
                jid: session.source_ref || `web:${agentId}:${session.session_id}`,
                name: agentId,
                last_message_time: session.updated_at,
                channel: session.channel,
                is_group: 0,
            });
        }
    }
    return chats.sort((a, b) => b.last_message_time.localeCompare(a.last_message_time));
}
export function getLastGroupSync() {
    return getRouterState('__group_sync__') || null;
}
export function setLastGroupSync() {
    setRouterState('__group_sync__', new Date().toISOString());
}
// ═══════════════════════════════════════════════════════════════
// Interaction events (JSONL per session)
// ═══════════════════════════════════════════════════════════════
export function storeInteractionEvent(event) {
    const resolved = resolveFromChatJid(event.chat_jid);
    if (!resolved)
        return;
    const eventsPath = path.join(sessionDir(resolved.agentId, resolved.sessionId), 'events.jsonl');
    appendJsonl(eventsPath, event);
}
export function getRecentInteractionEvents(chatJid, limit = 20) {
    const resolved = resolveFromChatJid(chatJid);
    if (!resolved)
        return [];
    const eventsPath = path.join(sessionDir(resolved.agentId, resolved.sessionId), 'events.jsonl');
    return readJsonlTail(eventsPath, limit);
}
// Test-only exports for deterministic helper validation.
export const __testOnly = {
    readJsonlTail,
};
// ═══════════════════════════════════════════════════════════════
// Mind state — REMOVED
// These functions are kept as no-ops / stubs for compilation.
// The mind state is now defined by Markdown files (SOUL.md, MEMORY.md).
// ═══════════════════════════════════════════════════════════════
// Intentionally not exported. Mind code should be refactored
// to read/write Markdown files directly.
//# sourceMappingURL=store.js.map