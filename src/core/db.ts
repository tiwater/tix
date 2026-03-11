import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  STORE_DIR,
} from './config.js';
import { isValidGroupFolder } from './utils.js';
import { logger } from './logger.js';
import {
  AgentRecord,
  InteractionEvent,
  MindLifecycle,
  MindPackage,
  MindState,
  NewMessage,
  RegisteredProject,
  ScheduleRecord,
  SessionRecord,
} from './types.js';

let db: Database.Database;

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

/**
 * Drop legacy tables from pre-simplification schema.
 * Called once during schema creation.
 */
function dropLegacyTables(database: Database.Database): void {
  const legacyTables = [
    'task_run_logs',
    'scheduled_tasks',
    'audit_logs',
    'jobs',
    'sessions',
    'agents',
    'runtimes',
    'registered_groups',
  ];

  const existing = legacyTables.filter((t) => tableExists(database, t));
  if (existing.length === 0) return;

  logger.warn(
    { tables: existing },
    'Dropping legacy tables for simplified schema',
  );
  database.pragma('foreign_keys = OFF');
  for (const table of existing) {
    database.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  database.pragma('foreign_keys = ON');
}

function createSchema(database: Database.Database): void {
  // Drop old tables if they exist (one-time migration)
  dropLegacyTables(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    -- === Simplified schema: 3 core tables ===

    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, channel);
    CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_ref);

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      next_run TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    -- === Supporting tables ===

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      requires_trigger INTEGER DEFAULT 1,
      is_main INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_registered_groups_agent
      ON registered_groups(agent_id);

    CREATE TABLE IF NOT EXISTS interaction_events (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      channel TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      sender TEXT,
      sender_name TEXT,
      intent TEXT,
      is_admin INTEGER DEFAULT 0,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interaction_events_chat_time
      ON interaction_events(chat_jid, timestamp DESC);

    CREATE TABLE IF NOT EXISTS mind_state (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      lifecycle TEXT NOT NULL,
      persona_json TEXT NOT NULL,
      memory_summary TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mind_packages (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      lifecycle TEXT NOT NULL,
      persona_json TEXT NOT NULL,
      memory_summary TEXT NOT NULL,
      changelog TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`,
    );
  } catch {
    /* columns already exist */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
}

// ═══════════════════════════════════════════════════════════════
// Chat metadata
// ═══════════════════════════════════════════════════════════════

export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, name, timestamp, ch, group);
  } else {
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group);
  }
}

export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

export function getLastGroupSync(): string | null {
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

// ═══════════════════════════════════════════════════════════════
// Mind interaction events
// ═══════════════════════════════════════════════════════════════

export function storeInteractionEvent(event: InteractionEvent): void {
  db.prepare(
    `INSERT OR REPLACE INTO interaction_events (id, chat_jid, channel, role, content, timestamp, sender, sender_name, intent, is_admin, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.chat_jid,
    event.channel || null,
    event.role,
    event.content,
    event.timestamp,
    event.sender || null,
    event.sender_name || null,
    event.intent || null,
    event.is_admin ? 1 : 0,
    event.metadata ? JSON.stringify(event.metadata) : null,
  );
}

export function getRecentInteractionEvents(
  chatJid: string,
  limit = 20,
): InteractionEvent[] {
  const rows = db
    .prepare(
      `SELECT id, chat_jid, channel, role, content, timestamp, sender, sender_name, intent, is_admin, metadata
       FROM interaction_events WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(chatJid, limit) as any[];

  return rows.reverse().map((row) => ({
    id: row.id,
    chat_jid: row.chat_jid,
    channel: row.channel || undefined,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    sender: row.sender || undefined,
    sender_name: row.sender_name || undefined,
    intent: row.intent || undefined,
    is_admin: row.is_admin === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

// ═══════════════════════════════════════════════════════════════
// Mind state & packages
// ═══════════════════════════════════════════════════════════════

function ensureDefaultMindState(): void {
  const existing = db
    .prepare('SELECT id FROM mind_state WHERE id = ?')
    .get('default') as { id: string } | undefined;
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mind_state (id, version, lifecycle, persona_json, memory_summary, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'default',
    1,
    'draft',
    JSON.stringify({ tone: 'friendly', verbosity: 'normal', emoji: false }),
    '',
    now,
  );
}

export function getMindState(): MindState {
  ensureDefaultMindState();
  const row = db
    .prepare(
      'SELECT id, version, lifecycle, persona_json, memory_summary, updated_at FROM mind_state WHERE id = ?',
    )
    .get('default') as any;
  return {
    id: row.id,
    version: row.version,
    lifecycle: row.lifecycle,
    persona: JSON.parse(row.persona_json || '{}'),
    memory_summary: row.memory_summary || '',
    updated_at: row.updated_at,
  };
}

export function updateMindState(partial: {
  version?: number;
  lifecycle?: MindLifecycle;
  persona?: Record<string, unknown>;
  memory_summary?: string;
}): MindState {
  const current = getMindState();
  const next = {
    ...current,
    version: partial.version ?? current.version,
    lifecycle: partial.lifecycle ?? current.lifecycle,
    persona: partial.persona ?? current.persona,
    memory_summary: partial.memory_summary ?? current.memory_summary,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE mind_state SET version = ?, lifecycle = ?, persona_json = ?, memory_summary = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.version,
    next.lifecycle,
    JSON.stringify(next.persona),
    next.memory_summary,
    next.updated_at,
    next.id,
  );

  return next;
}

export function createMindPackage(changelog: string): MindPackage {
  const state = getMindState();
  const now = new Date().toISOString();
  const pkg: MindPackage = {
    id: `mind-${state.version}`,
    version: state.version,
    lifecycle: state.lifecycle,
    persona: state.persona,
    memory_summary: state.memory_summary,
    changelog,
    created_at: now,
  };

  db.prepare(
    `INSERT OR REPLACE INTO mind_packages (id, version, lifecycle, persona_json, memory_summary, changelog, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pkg.id,
    pkg.version,
    pkg.lifecycle,
    JSON.stringify(pkg.persona),
    pkg.memory_summary,
    pkg.changelog,
    pkg.created_at,
  );

  return pkg;
}

export function listMindPackages(limit = 20): MindPackage[] {
  const rows = db
    .prepare(
      'SELECT id, version, lifecycle, persona_json, memory_summary, changelog, created_at FROM mind_packages ORDER BY version DESC LIMIT ?',
    )
    .all(limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    lifecycle: row.lifecycle,
    persona: JSON.parse(row.persona_json || '{}'),
    memory_summary: row.memory_summary || '',
    changelog: row.changelog || '',
    created_at: row.created_at,
  }));
}

export function syncUpsertMindPackage(pkg: MindPackage): void {
  db.prepare(
    `INSERT OR REPLACE INTO mind_packages (id, version, lifecycle, persona_json, memory_summary, changelog, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pkg.id,
    pkg.version,
    pkg.lifecycle,
    JSON.stringify(pkg.persona),
    pkg.memory_summary,
    pkg.changelog,
    pkg.created_at,
  );
}

export function rollbackMindPackage(version: number): MindState | null {
  const row = db
    .prepare(
      'SELECT id, version, lifecycle, persona_json, memory_summary FROM mind_packages WHERE version = ?',
    )
    .get(version) as any;
  if (!row) return null;
  return updateMindState({
    version: row.version,
    lifecycle: row.lifecycle,
    persona: JSON.parse(row.persona_json || '{}'),
    memory_summary: row.memory_summary || '',
  });
}

// ═══════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════

export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function getRecentMessages(
  chatJid: string,
  limit: number = 10,
): NewMessage[] {
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
    FROM messages
    WHERE chat_jid = ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(chatJid, limit) as NewMessage[];
  return rows.reverse();
}

// ═══════════════════════════════════════════════════════════════
// Agents
// ═══════════════════════════════════════════════════════════════

export function ensureAgent(input: {
  agent_id: string;
  name?: string;
}): AgentRecord {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO agents (agent_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `,
  ).run(input.agent_id, input.name || input.agent_id, now, now);

  return db
    .prepare('SELECT * FROM agents WHERE agent_id = ?')
    .get(input.agent_id) as AgentRecord;
}

export function getAgent(agentId: string): AgentRecord | undefined {
  return db
    .prepare('SELECT * FROM agents WHERE agent_id = ?')
    .get(agentId) as AgentRecord | undefined;
}

export function getAllAgents(): AgentRecord[] {
  return db
    .prepare('SELECT * FROM agents ORDER BY updated_at DESC')
    .all() as AgentRecord[];
}

// ═══════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════

function mapSessionRow(row: any): SessionRecord {
  return {
    session_id: row.session_id,
    agent_id: row.agent_id,
    channel: row.channel,
    source_ref: row.source_ref || undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function ensureSession(input: {
  agent_id: string;
  session_id: string;
  channel: string;
  source_ref?: string;
  agent_name?: string;
  status?: SessionRecord['status'];
}): SessionRecord {
  ensureAgent({
    agent_id: input.agent_id,
    name: input.agent_name,
  });
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT OR REPLACE INTO sessions (
      session_id,
      agent_id,
      channel,
      source_ref,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    input.session_id,
    input.agent_id,
    input.channel,
    input.source_ref || null,
    input.status || 'active',
    now,
    now,
  );

  return getSession(input.session_id)!;
}

export function getSession(sessionId: string): SessionRecord | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE session_id = ?')
    .get(sessionId);
  return row ? mapSessionRow(row) : undefined;
}

export function getSessionsForAgent(agentId: string): SessionRecord[] {
  const rows = db
    .prepare(
      'SELECT * FROM sessions WHERE agent_id = ? ORDER BY created_at DESC',
    )
    .all(agentId);
  return rows.map(mapSessionRow);
}

export function getAllSessions(): SessionRecord[] {
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY agent_id, session_id')
    .all();
  return rows.map(mapSessionRow);
}

export function updateSessionStatus(
  sessionId: string,
  status: SessionRecord['status'],
): void {
  db.prepare(
    `UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?`,
  ).run(status, new Date().toISOString(), sessionId);
}

function inferChannelFromChatJid(chatJid: string): string {
  if (chatJid.startsWith('acp:')) return 'acp';
  if (chatJid.startsWith('dc:')) return 'discord';
  if (chatJid.startsWith('tg:')) return 'telegram';
  if (chatJid.startsWith('web:')) return 'http';
  if (chatJid.startsWith('fs:')) return 'feishu';
  if (chatJid.includes('@')) return 'whatsapp';
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// Schedules
// ═══════════════════════════════════════════════════════════════

export function createSchedule(input: {
  agent_id: string;
  prompt: string;
  cron: string;
  next_run?: string;
}): ScheduleRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  ensureAgent({ agent_id: input.agent_id });

  db.prepare(
    `
    INSERT INTO schedules (id, agent_id, prompt, cron, status, next_run, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `,
  ).run(id, input.agent_id, input.prompt, input.cron, input.next_run || null, now);

  return getScheduleById(id)!;
}

export function getScheduleById(id: string): ScheduleRecord | undefined {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as
    | ScheduleRecord
    | undefined;
  return row || undefined;
}

export function getAllSchedules(): ScheduleRecord[] {
  return db
    .prepare('SELECT * FROM schedules ORDER BY created_at DESC')
    .all() as ScheduleRecord[];
}

export function getSchedulesForAgent(agentId: string): ScheduleRecord[] {
  return db
    .prepare('SELECT * FROM schedules WHERE agent_id = ? ORDER BY created_at DESC')
    .all(agentId) as ScheduleRecord[];
}

export function getDueSchedules(): ScheduleRecord[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT *
    FROM schedules
    WHERE status = 'active'
      AND next_run IS NOT NULL
      AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduleRecord[];
}

export function updateSchedule(
  id: string,
  updates: Partial<Pick<ScheduleRecord, 'prompt' | 'cron' | 'next_run' | 'status'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.cron !== undefined) {
    fields.push('cron = ?');
    values.push(updates.cron);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

export function updateScheduleAfterRun(
  id: string,
  nextRun: string | null,
): void {
  db.prepare(
    `
    UPDATE schedules
    SET next_run = ?, status = CASE WHEN ? IS NULL THEN 'paused' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, nextRun, id);
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

// ═══════════════════════════════════════════════════════════════
// Router state
// ═══════════════════════════════════════════════════════════════

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

/** @internal - for sync. Returns all router_state key-value pairs. */
export function getAllRouterState(): Record<string, string> {
  const rows = db
    .prepare('SELECT key, value FROM router_state')
    .all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Registered groups (projects)
// ═══════════════════════════════════════════════════════════════

export function getRegisteredProject(
  jid: string,
): (RegisteredProject & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        agent_id: string;
        trigger_pattern: string;
        added_at: string;
        requires_trigger: number | null;
        is_main: number | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    agent_id: row.agent_id || row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    isMain: row.is_main === 1 ? true : undefined,
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
  ensureAgent({
    agent_id: agentId,
    name: group.name,
  });
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (
      jid,
      name,
      folder,
      agent_id,
      trigger_pattern,
      added_at,
      requires_trigger,
      is_main
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    agentId,
    group.trigger,
    group.added_at,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.isMain ? 1 : 0,
  );
}

export function getAllRegisteredProjects(): Record<string, RegisteredProject> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    agent_id: string;
    trigger_pattern: string;
    added_at: string;
    requires_trigger: number | null;
    is_main: number | null;
  }>;
  const result: Record<string, RegisteredProject> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      agent_id: row.agent_id || row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      isMain: row.is_main === 1 ? true : undefined,
    };
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// JSON migration (legacy)
// ═══════════════════════════════════════════════════════════════

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // sessions.json carried only folder -> session_id and cannot represent the
  // new schema, so it is intentionally not migrated.
  if (migrateFile('sessions.json')) {
    logger.warn(
      'Ignored legacy sessions.json during schema simplification',
    );
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredProject
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredProject(jid, {
          ...group,
          agent_id: group.agent_id || group.folder,
        });
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}
