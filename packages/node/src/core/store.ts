/**
 * Filesystem-based data store for TiClaw.
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

import { AGENTS_DIR, TICLAW_HOME, TIMEZONE, getAgentModelConfig } from './config.js';
import { logger } from './logger.js';
import type {
  AgentRecord,
  Attachment,
  InteractionEvent,
  NewMessage,
  RegisteredProject,
  ScheduleRecord,
  SessionRecord,
} from './types.js';
import { isValidGroupFolder } from './utils.js';
import { assertSafePathSegment, resolveWithin } from './security.js';

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function readJson<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function appendJsonl(filePath: string, record: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line)) as T[];
  } catch {
    return [];
  }
}

/** Read last N lines from a JSONL file (efficient tail). */
function readJsonlTail<T>(filePath: string, limit: number): T[] {
  try {
    if (limit <= 0) return [];
    if (!fs.existsSync(filePath)) return [];

    const stat = fs.statSync(filePath);
    if (stat.size <= 0) return [];

    const fd = fs.openSync(filePath, 'r');
    try {
      const chunkSize = 64 * 1024;
      let pos = stat.size;
      let newlineCount = 0;
      const chunks: Buffer[] = [];

      while (pos > 0 && newlineCount <= limit) {
        const bytesToRead = Math.min(chunkSize, pos);
        pos -= bytesToRead;
        const chunk = Buffer.allocUnsafe(bytesToRead);
        const bytesRead = fs.readSync(fd, chunk, 0, bytesToRead, pos);
        if (bytesRead <= 0) break;
        const view = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
        for (let i = 0; i < view.length; i += 1) {
          if (view[i] === 0x0a) newlineCount += 1;
        }
        chunks.unshift(view);
      }

      if (chunks.length === 0) return [];
      const content = Buffer.concat(chunks).toString('utf-8').trim();
      if (!content) return [];
      const tail = content.split('\n').slice(-limit);
      const out: T[] = [];
      for (const line of tail) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as T);
        } catch {
          // Skip malformed lines to preserve best-effort retrieval.
        }
      }
      return out;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function listDirs(parentDir: string): string[] {
  try {
    if (!fs.existsSync(parentDir)) return [];
    return fs
      .readdirSync(parentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listJsonFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

function readYaml<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as T;
  } catch (err: any) {
    logger.error({ filePath, err: err.message }, 'Failed to read YAML');
    return undefined;
  }
}

function writeYaml<T>(filePath: string, data: T): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = yaml.dump(data, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err: any) {
    logger.error({ filePath, err: err.message }, 'Failed to write YAML');
  }
}

// ═══════════════════════════════════════════════════════════════
// Path helpers
// ═══════════════════════════════════════════════════════════════

function agentDir(agentId: string): string {
  const safeAgentId = assertSafePathSegment(agentId, 'agent_id');
  return resolveWithin(AGENTS_DIR, safeAgentId);
}

function agentJsonPath(agentId: string): string {
  return path.join(agentDir(agentId), 'agent.json');
}

function sessionDir(agentId: string, sessionId: string): string {
  const safeSessionId = assertSafePathSegment(sessionId, 'session_id');
  return resolveWithin(agentDir(agentId), 'sessions', safeSessionId);
}

function sessionJsonPath(agentId: string, sessionId: string): string {
  return path.join(sessionDir(agentId, sessionId), 'session.json');
}

function messagesPath(agentId: string, sessionId: string): string {
  return path.join(sessionDir(agentId, sessionId), 'messages.jsonl');
}

function schedulesDir(agentId: string): string {
  return path.join(agentDir(agentId), 'schedules');
}

function scheduleYamlPath(agentId: string, scheduleId: string): string {
  const safeScheduleId = assertSafePathSegment(scheduleId, 'schedule_id');
  return resolveWithin(schedulesDir(agentId), `${safeScheduleId}.yaml`);
}

const routerStatePath = path.join(TICLAW_HOME, 'router-state.json');
const registeredGroupsPath = path.join(TICLAW_HOME, 'registered-groups.json');

// ═══════════════════════════════════════════════════════════════
// Init (no-op — dirs created on demand)
// ═══════════════════════════════════════════════════════════════

export function initStore(): void {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  logger.info({ dir: AGENTS_DIR }, 'Store initialized (filesystem)');
}

// ═══════════════════════════════════════════════════════════════
// Agents
// ═══════════════════════════════════════════════════════════════

export function ensureAgent(input: {
  agent_id: string;
  name?: string;
}): AgentRecord {
  const jsonPath = agentJsonPath(input.agent_id);
  const existing = readJson<AgentRecord>(jsonPath);
  const now = new Date().toISOString();

  if (existing) {
    const updated: AgentRecord = {
      ...existing,
      name: input.name || existing.name,
      updated_at: now,
    };
    writeJson(jsonPath, updated);
    return updated;
  }

  const record: AgentRecord = {
    agent_id: input.agent_id,
    name: input.name || input.agent_id,
    created_at: now,
    updated_at: now,
  };
  writeJson(jsonPath, record);
  return record;
}

export function getAgent(agentId: string): AgentRecord | undefined {
  return readJson<AgentRecord>(agentJsonPath(agentId));
}

export function getAllAgents(): AgentRecord[] {
  const agents: AgentRecord[] = [];
  for (const id of listDirs(AGENTS_DIR)) {
    const agent = readJson<AgentRecord>(agentJsonPath(id));
    if (agent) agents.push(agent);
  }
  return agents.sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || ''),
  );
}

// ═══════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════

export function ensureSession(input: {
  agent_id: string;
  session_id: string;
  channel: string;
  source_ref?: string;
  agent_name?: string;
  status?: SessionRecord['status'];
}): SessionRecord {
  ensureAgent({ agent_id: input.agent_id, name: input.agent_name });

  const jsonPath = sessionJsonPath(input.agent_id, input.session_id);
  const existing = readJson<SessionRecord>(jsonPath);
  const now = new Date().toISOString();

  if (existing) {
    const updated: SessionRecord = {
      ...existing,
      channel: input.channel,
      source_ref: input.source_ref || existing.source_ref,
      status: input.status || existing.status,
      updated_at: now,
    };
    writeJson(jsonPath, updated);
    return updated;
  }

  const record: SessionRecord = {
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

export function getSession(sessionId: string): SessionRecord | undefined {
  // Sessions are nested under agents, so we need to scan
  for (const agentId of listDirs(AGENTS_DIR)) {
    const session = readJson<SessionRecord>(
      sessionJsonPath(agentId, sessionId),
    );
    if (session) return session;
  }
  return undefined;
}

export function getSessionForAgent(
  agentId: string,
  sessionId: string,
): SessionRecord | undefined {
  return readJson<SessionRecord>(sessionJsonPath(agentId, sessionId));
}

export function getSessionsForAgent(agentId: string): SessionRecord[] {
  const sessionsBase = path.join(agentDir(agentId), 'sessions');
  const sessions: SessionRecord[] = [];
  if (fs.existsSync(sessionsBase)) {
    for (const sid of listDirs(sessionsBase)) {
      const session = readJson<SessionRecord>(sessionJsonPath(agentId, sid));
      if (session) sessions.push(session);
    }
  }
  return sessions.sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || ''),
  );
}

export function getArchivedSessionsForAgent(agentId: string): SessionRecord[] {
  const sessionsBase = path.join(agentDir(agentId), 'archived_sessions');
  const sessions: SessionRecord[] = [];
  if (fs.existsSync(sessionsBase)) {
    for (const sid of listDirs(sessionsBase)) {
      const jsonPath = path.join(sessionsBase, sid, 'session.json');
      const session = readJson<SessionRecord>(jsonPath);
      if (session) {
        sessions.push({ ...session, status: 'archived' as any });
      }
    }
  }
  return sessions.sort((a, b) =>
    (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''),
  );
}

export function getAllSessions(): SessionRecord[] {
  const sessions: SessionRecord[] = [];
  for (const agentId of listDirs(AGENTS_DIR)) {
    sessions.push(...getSessionsForAgent(agentId));
  }
  return sessions.sort((a, b) => {
    const cmp = a.agent_id.localeCompare(b.agent_id);
    return cmp !== 0 ? cmp : a.session_id.localeCompare(b.session_id);
  });
}

export function updateSessionStatus(
  agentId: string,
  sessionId: string,
  status: SessionRecord['status'],
): void {
  const jsonPath = sessionJsonPath(agentId, sessionId);
  const session = readJson<SessionRecord>(jsonPath);
  if (session) {
    session.status = status;
    session.updated_at = new Date().toISOString();
    writeJson(jsonPath, session);
  }
}

export function updateSessionUsage(
  agentId: string,
  sessionId: string,
  tokensIn: number,
  tokensOut: number,
): void {
  const now = new Date().toISOString();

  // 1. Update Session Usage
  const sessPath = sessionJsonPath(agentId, sessionId);
  const session = readJson<SessionRecord>(sessPath);
  if (session) {
    session.tokens_in = (session.tokens_in || 0) + tokensIn;
    session.tokens_out = (session.tokens_out || 0) + tokensOut;
    session.updated_at = now;
    writeJson(sessPath, session);
  }

  // 2. Update Agent Usage (Aggregate)
  const aPath = agentJsonPath(agentId);
  const agent = readJson<AgentRecord>(aPath);
  if (agent) {
    agent.tokens_in = (agent.tokens_in || 0) + tokensIn;
    agent.tokens_out = (agent.tokens_out || 0) + tokensOut;
    agent.updated_at = now;
    writeJson(aPath, agent);
  }
}

export function getUsageStats(record: { tokens_in?: number; tokens_out?: number; agent_id?: string }) {
  const tokens_in = record.tokens_in || 0;
  const tokens_out = record.tokens_out || 0;
  let estimated_cost_usd = 0;

  if (record.agent_id) {
    const models = getAgentModelConfig(record.agent_id);
    const model = models.length > 0 ? models[0] : null;
    if (model?.pricing) {
      estimated_cost_usd =
        (tokens_in / 1_000_000) * model.pricing.input_usd_per_1m +
        (tokens_out / 1_000_000) * model.pricing.output_usd_per_1m;
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

/**
 * Reset sessions stuck as "running" — called at startup to recover from crashes.
 * A "running" session cannot survive a process restart, so these are stale.
 */
export function cleanupStaleSessions(): number {
  let cleaned = 0;
  for (const agentId of listDirs(AGENTS_DIR)) {
    for (const session of getSessionsForAgent(agentId)) {
      if (session.status === 'running') {
        updateSessionStatus(agentId, session.session_id, 'idle');
        cleaned++;
        logger.info(
          { agentId, sessionId: session.session_id },
          'Reset stale running session to idle',
        );
      }
    }
  }
  return cleaned;
}

export function updateSessionMetadata(
  agentId: string,
  sessionId: string,
  updates: Partial<SessionRecord>,
): boolean {
  const jsonPath = sessionJsonPath(agentId, sessionId);
  const session = readJson<SessionRecord>(jsonPath);
  if (!session) return false;
  if (updates.title !== undefined) session.title = updates.title;
  session.updated_at = new Date().toISOString();
  writeJson(jsonPath, session);
  return true;
}

export function archiveSessionForAgent(
  agentId: string,
  sessionId: string,
): boolean {
  const dir = sessionDir(agentId, sessionId);
  if (!fs.existsSync(dir)) return false;
  const archiveDir = path.join(agentDir(agentId), 'archived_sessions');
  fs.mkdirSync(archiveDir, { recursive: true });
  
  const targetDir = path.join(archiveDir, sessionId);
  if (fs.existsSync(targetDir)) return false; // already archived
  
  fs.renameSync(dir, targetDir);
  return true;
}

export function restoreSessionForAgent(
  agentId: string,
  sessionId: string,
): boolean {
  const archivePath = path.join(agentDir(agentId), 'archived_sessions', sessionId);
  if (!fs.existsSync(archivePath)) return false;
  
  const restoreDir = sessionDir(agentId, sessionId);
  fs.mkdirSync(path.dirname(restoreDir), { recursive: true });
  
  if (fs.existsSync(restoreDir)) return false;
  
  fs.renameSync(archivePath, restoreDir);
  return true;
}

export function deleteSession(sessionId: string): void {
  for (const agentId of listDirs(AGENTS_DIR)) {
    if (deleteSessionForAgent(agentId, sessionId)) return;
    if (deleteSessionForAgent(agentId, sessionId, true)) return;
  }
}

export function deleteSessionForAgent(
  agentId: string,
  sessionId: string,
  fromArchived: boolean = false
): boolean {
  const dir = fromArchived 
    ? path.join(agentDir(agentId), 'archived_sessions', sessionId)
    : sessionDir(agentId, sessionId);
    
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Messages (JSONL)
// ═══════════════════════════════════════════════════════════════

interface StoredMessage {
  id: string;
  ts: string;
  role: 'user' | 'bot';
  sender: string;
  sender_name: string;
  text: string;
  is_from_me?: boolean;
  attachments?: Attachment[];
}

/** Convert internal JSONL format → NewMessage for API compatibility */
function storedToNewMessage(m: StoredMessage, chatJid: string): NewMessage {
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
  };
}

/** Resolve agent+session from chat_jid (format: "web:agent_id:session_id" or similar). */
export function resolveFromChatJid(chatJid: string): {
  agentId: string;
  sessionId: string;
} | null {
  // web:agent_id:session_id
  const webMatch = chatJid.match(/^web:(.+?):(.+)$/);
  if (webMatch) return { agentId: webMatch[1], sessionId: webMatch[2] };

  // acp:agent_id:session_id
  const acpMatch = chatJid.match(/^acp:(.+?):(.+)$/);
  if (acpMatch) return { agentId: acpMatch[1], sessionId: acpMatch[2] };

  // For other channels, try to find the session across agents
  for (const agentId of listDirs(AGENTS_DIR)) {
    const sessionsBase = path.join(agentDir(agentId), 'sessions');
    for (const sid of listDirs(sessionsBase)) {
      const session = readJson<SessionRecord>(sessionJsonPath(agentId, sid));
      if (session?.source_ref === chatJid) {
        return { agentId, sessionId: sid };
      }
    }
  }
  return null;
}

export function storeMessage(msg: NewMessage): void {
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
    logger.warn(
      { chat_jid: msg.chat_jid },
      'Cannot store message: unable to resolve agent/session from chat_jid',
    );
    return;
  }

  // Ensure session directory exists
  const msgPath = messagesPath(agentId, sessionId);
  const stored: StoredMessage = {
    id: msg.id,
    ts: msg.timestamp,
    role: msg.is_bot_message ? 'bot' : 'user',
    sender: msg.sender,
    sender_name: msg.sender_name,
    text: msg.content,
    is_from_me: msg.is_from_me,
    attachments: msg.attachments,
  };
  appendJsonl(msgPath, stored);
}

/** Alias for storeMessage — both had identical implementations in db.ts */
export const storeMessageDirect = storeMessage;

export function getRecentMessages(
  chatJid: string,
  limit: number = 10,
): NewMessage[] {
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return [];

  const messages = readJsonlTail<StoredMessage>(
    messagesPath(resolved.agentId, resolved.sessionId),
    limit,
  );
  return messages.map((m) => storedToNewMessage(m, chatJid));
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  _botPrefix: string,
): NewMessage[] {
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return [];

  const all = readJsonl<StoredMessage>(
    messagesPath(resolved.agentId, resolved.sessionId),
  );
  return all
    .filter((m) => {
      const isNew = m.ts > sinceTimestamp;
      const isNotBot = m.role !== 'bot';
      const hasText = m.text && m.text.trim() !== '';
      const keep = isNew && isNotBot && hasText;
      logger.debug(
        { msgId: m.id, role: m.role, text: m.text, isNew, isNotBot, hasText, keep },
        'getMessagesSince: filtering message',
      );
      return keep;
    })
    .map((m) => storedToNewMessage(m, chatJid));
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  let newTimestamp = lastTimestamp;
  const messages: NewMessage[] = [];

  for (const jid of jids) {
    const msgs = getMessagesSince(jid, lastTimestamp, botPrefix);
    for (const m of msgs) {
      messages.push(m);
      if (m.timestamp > newTimestamp) newTimestamp = m.timestamp;
    }
  }

  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { messages, newTimestamp };
}

// ═══════════════════════════════════════════════════════════════
// Schedules
// ═══════════════════════════════════════════════════════════════

import { CronExpressionParser } from 'cron-parser';

export function createSchedule(input: {
  agent_id: string;
  cron: string;
  prompt: string;
  type?: 'cron' | 'one-shot';
  session?: 'main' | 'isolated';
  target_jid?: string;
  next_run?: string;
}): ScheduleRecord {
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
    } catch (e) {
      // invalid cron, let it be null
    }
  }

  const record: ScheduleRecord = {
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

export function getScheduleById(id: string): ScheduleRecord | undefined {
  for (const agentId of listDirs(AGENTS_DIR)) {
    const schedule = readYaml<ScheduleRecord>(scheduleYamlPath(agentId, id));
    if (schedule) return schedule;
  }
  return undefined;
}

export function getAllSchedules(): ScheduleRecord[] {
  const schedules: ScheduleRecord[] = [];
  for (const agentId of listDirs(AGENTS_DIR)) {
    schedules.push(...getSchedulesForAgent(agentId));
  }
  return schedules.sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || ''),
  );
}

export function getSchedulesForAgent(agentId: string): ScheduleRecord[] {
  const dir = schedulesDir(agentId);
  const schedules: ScheduleRecord[] = [];
  if (!fs.existsSync(dir)) return schedules;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.yaml')) continue;

    // Fallback: migrate .json if they still exist
    if (file.endsWith('.json')) continue;

    const id = file.replace('.yaml', '');
    const schedule = readYaml<ScheduleRecord>(scheduleYamlPath(agentId, id));
    if (schedule) schedules.push(schedule);
  }
  return schedules.sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || ''),
  );
}

export function getDueSchedules(forceAll: boolean = false): ScheduleRecord[] {
  const now = new Date().toISOString();
  return getAllSchedules().filter(
    (s) => s.status === 'active' && (forceAll || (s.next_run && s.next_run <= now)),
  );
}

export function updateSchedule(
  id: string,
  updates: Partial<
    Pick<
      ScheduleRecord,
      | 'prompt'
      | 'cron'
      | 'next_run'
      | 'status'
      | 'type'
      | 'session'
      | 'delete_after_run'
      | 'last_run'
    >
  >,
): void {
  for (const agentId of listDirs(AGENTS_DIR)) {
    const yamlPath = scheduleYamlPath(agentId, id);
    const schedule = readYaml<ScheduleRecord>(yamlPath);
    if (schedule) {
      const updated = { ...schedule, ...updates };
      writeYaml(yamlPath, updated);
      return;
    }
  }
}

export function updateScheduleAfterRun(
  id: string,
  nextRun: string | null,
): void {
  for (const agentId of listDirs(AGENTS_DIR)) {
    const yamlPath = scheduleYamlPath(agentId, id);
    const schedule = readYaml<ScheduleRecord>(yamlPath);
    if (schedule) {
      schedule.last_run = new Date().toISOString();
      schedule.next_run = nextRun;
      if (!nextRun) schedule.status = 'paused';
      writeYaml(yamlPath, schedule);
      return;
    }
  }
}

export function deleteSchedule(id: string): void {
  for (const agentId of listDirs(AGENTS_DIR)) {
    const yamlPath = scheduleYamlPath(agentId, id);
    if (fs.existsSync(yamlPath)) {
      fs.unlinkSync(yamlPath);
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Router state (simple JSON key-value file)
// ═══════════════════════════════════════════════════════════════

function loadRouterState(): Record<string, string> {
  return readJson<Record<string, string>>(routerStatePath) || {};
}

function saveRouterState(state: Record<string, string>): void {
  writeJson(routerStatePath, state);
}

export function getRouterState(key: string): string | undefined {
  return loadRouterState()[key];
}

export function setRouterState(key: string, value: string): void {
  const state = loadRouterState();
  state[key] = value;
  saveRouterState(state);
}

export function getAllRouterState(): Record<string, string> {
  return loadRouterState();
}

// ═══════════════════════════════════════════════════════════════
// Registered groups/projects (JSON file)
// ═══════════════════════════════════════════════════════════════

function loadRegisteredGroups(): Record<
  string,
  RegisteredProject & { jid?: string }
> {
  return (
    readJson<Record<string, RegisteredProject & { jid?: string }>>(
      registeredGroupsPath,
    ) || {}
  );
}

function saveRegisteredGroups(groups: Record<string, RegisteredProject>): void {
  writeJson(registeredGroupsPath, groups);
}

export function getRegisteredProject(
  jid: string,
): (RegisteredProject & { jid: string }) | undefined {
  const groups = loadRegisteredGroups();
  const group = groups[jid];
  if (!group) return undefined;
  if (!isValidGroupFolder(group.folder)) {
    logger.warn(
      { jid, folder: group.folder },
      'Skipping registered group with invalid folder',
    );
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

export function setRegisteredProject(
  jid: string,
  group: RegisteredProject,
): void {
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

export function getAllRegisteredProjects(): Record<string, RegisteredProject> {
  const groups = loadRegisteredGroups();
  const result: Record<string, RegisteredProject> = {};
  for (const [jid, group] of Object.entries(groups)) {
    if (!isValidGroupFolder(group.folder)) {
      logger.warn(
        { jid, folder: group.folder },
        'Skipping registered group with invalid folder',
      );
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

export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  _isGroup?: boolean,
): void {
  // For the filesystem approach, chat metadata is implicitly part of
  // the session. We ensure the session exists.
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return;

  ensureSession({
    agent_id: resolved.agentId,
    session_id: resolved.sessionId,
    channel: channel || 'unknown',
    source_ref: chatJid,
    agent_name: name,
  });
}

export function updateChatName(chatJid: string, name: string): void {
  // Chat metadata is stored in session.json — update the agent name
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return;

  const jsonPath = sessionJsonPath(resolved.agentId, resolved.sessionId);
  const session = readJson<SessionRecord & { name?: string }>(jsonPath);
  if (session) {
    (session as any).name = name;
    session.updated_at = new Date().toISOString();
    writeJson(jsonPath, session);
  }
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export function getAllChats(): ChatInfo[] {
  // Reconstruct from sessions
  const chats: ChatInfo[] = [];
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
  return chats.sort((a, b) =>
    b.last_message_time.localeCompare(a.last_message_time),
  );
}

export function getLastGroupSync(): string | null {
  return getRouterState('__group_sync__') || null;
}

export function setLastGroupSync(): void {
  setRouterState('__group_sync__', new Date().toISOString());
}

// ═══════════════════════════════════════════════════════════════
// Interaction events (JSONL per session)
// ═══════════════════════════════════════════════════════════════

export function storeInteractionEvent(event: InteractionEvent): void {
  const resolved = resolveFromChatJid(event.chat_jid);
  if (!resolved) return;

  const eventsPath = path.join(
    sessionDir(resolved.agentId, resolved.sessionId),
    'events.jsonl',
  );
  appendJsonl(eventsPath, event);
}

export function getRecentInteractionEvents(
  chatJid: string,
  limit = 20,
): InteractionEvent[] {
  const resolved = resolveFromChatJid(chatJid);
  if (!resolved) return [];

  const eventsPath = path.join(
    sessionDir(resolved.agentId, resolved.sessionId),
    'events.jsonl',
  );
  return readJsonlTail<InteractionEvent>(eventsPath, limit);
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
