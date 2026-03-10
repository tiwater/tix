import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  DEFAULT_RUNTIME_ID,
  STORE_DIR,
  TICLAW_HOME,
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
  RuntimeRecord,
  ScheduledTask,
  SessionRecord,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

function tableHasColumns(
  database: Database.Database,
  tableName: string,
  requiredColumns: string[],
): boolean {
  if (!tableExists(database, tableName)) return false;
  const rows = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  const columns = new Set(rows.map((row) => row.name));
  return requiredColumns.every((column) => columns.has(column));
}

function resetLegacyRoutingSchema(database: Database.Database): void {
  const needsReset =
    (tableExists(database, 'sessions') &&
      !tableHasColumns(database, 'sessions', [
        'runtime_id',
        'agent_id',
        'session_id',
        'chat_jid',
        'workspace_path',
        'memory_path',
        'logs_path',
      ])) ||
    (tableExists(database, 'scheduled_tasks') &&
      !tableHasColumns(database, 'scheduled_tasks', [
        'runtime_id',
        'agent_id',
        'session_id',
        'chat_jid',
      ])) ||
    (tableExists(database, 'task_run_logs') &&
      !tableHasColumns(database, 'task_run_logs', [
        'runtime_id',
        'agent_id',
        'session_id',
        'job_id',
      ])) ||
    (tableExists(database, 'registered_groups') &&
      !tableHasColumns(database, 'registered_groups', [
        'runtime_id',
        'agent_id',
      ]));

  if (!needsReset) return;

  logger.warn(
    'Resetting pre-release routing tables for runtime/agent/session support',
  );
  database.pragma('foreign_keys = OFF');
  database.exec(`
    DROP TABLE IF EXISTS task_run_logs;
    DROP TABLE IF EXISTS scheduled_tasks;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS agents;
    DROP TABLE IF EXISTS runtimes;
    DROP TABLE IF EXISTS registered_groups;
  `);
  database.pragma('foreign_keys = ON');
}

function safePathSegment(value: string): string {
  const raw = value.trim() || 'default';
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'default';
  if (safe === raw && safe.length <= 48) return safe;
  const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${safe.slice(0, 39)}-${digest}`;
}

function buildSessionPaths(
  runtimeId: string,
  agentId: string,
  sessionId: string,
): Pick<SessionRecord, 'workspace_path' | 'memory_path' | 'logs_path'> {
  const workspacePath = path.join(
    TICLAW_HOME,
    'factory',
    safePathSegment(runtimeId),
    safePathSegment(agentId),
    safePathSegment(sessionId),
  );
  return {
    workspace_path: workspacePath,
    memory_path: path.join(workspacePath, 'MEMORY.md'),
    logs_path: path.join(workspacePath, '.ticlaw', 'logs'),
  };
}

function createSchema(database: Database.Database): void {
  resetLegacyRoutingSchema(database);

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

    CREATE TABLE IF NOT EXISTS runtimes (
      runtime_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (runtime_id, agent_id),
      UNIQUE (runtime_id, folder),
      FOREIGN KEY (runtime_id) REFERENCES runtimes(runtime_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agents_runtime_folder
      ON agents(runtime_id, folder);

    CREATE TABLE IF NOT EXISTS sessions (
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL UNIQUE,
      channel TEXT,
      workspace_path TEXT NOT NULL,
      memory_path TEXT NOT NULL,
      logs_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (runtime_id, agent_id, session_id),
      FOREIGN KEY (runtime_id, agent_id)
        REFERENCES agents(runtime_id, agent_id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_chat_jid ON sessions(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_sessions_status
      ON sessions(runtime_id, agent_id, status);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (runtime_id, agent_id, session_id)
        REFERENCES sessions(runtime_id, agent_id, session_id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_next_run
      ON scheduled_tasks(next_run, runtime_id, agent_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_status
      ON scheduled_tasks(status, runtime_id, agent_id, session_id);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (runtime_id, agent_id, session_id)
        REFERENCES sessions(runtime_id, agent_id, session_id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs
      ON task_run_logs(task_id, run_at);
    CREATE INDEX IF NOT EXISTS idx_task_run_logs_scope
      ON task_run_logs(runtime_id, agent_id, session_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_registered_groups_scope
      ON registered_groups(runtime_id, agent_id);

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

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add is_main column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN is_main INTEGER DEFAULT 0`,
    );
    // Backfill: existing rows with folder = 'main' are the main group
    database.exec(
      `UPDATE registered_groups SET is_main = 1 WHERE folder = 'main'`,
    );
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
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

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
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
    // Update with name, preserving existing timestamp if newer
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
    // Update timestamp only, preserve existing name if any
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

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
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

/**
 * Get all known chats, ordered by most recent activity.
 */
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

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

// --- Mind interaction events ---

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

// --- Mind state & packages ---

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
      `SELECT id, version, lifecycle, persona_json, memory_summary, changelog, created_at
       FROM mind_packages ORDER BY version DESC LIMIT ?`,
    )
    .all(limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    lifecycle: row.lifecycle,
    persona: JSON.parse(row.persona_json || '{}'),
    memory_summary: row.memory_summary,
    changelog: row.changelog,
    created_at: row.created_at,
  }));
}

/** @internal - for sync. Upserts a mind package from cloud restore. */
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
      `SELECT version, lifecycle, persona_json, memory_summary FROM mind_packages WHERE version = ?`,
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

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
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

/**
 * Store a message directly.
 */
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
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
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
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
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
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(chatJid, limit) as NewMessage[];
  return rows.reverse();
}

function mapSessionRow(row: any): SessionRecord {
  return {
    runtime_id: row.runtime_id,
    agent_id: row.agent_id,
    session_id: row.session_id,
    chat_jid: row.chat_jid,
    channel: row.channel || undefined,
    workspace_path: row.workspace_path,
    memory_path: row.memory_path,
    logs_path: row.logs_path,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function ensureRuntime(runtimeId = DEFAULT_RUNTIME_ID): RuntimeRecord {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO runtimes (runtime_id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(runtime_id) DO UPDATE SET updated_at = excluded.updated_at
  `,
  ).run(runtimeId, now, now);

  return db
    .prepare('SELECT * FROM runtimes WHERE runtime_id = ?')
    .get(runtimeId) as RuntimeRecord;
}

export function ensureAgent(input: {
  runtime_id?: string;
  agent_id: string;
  name?: string;
  folder?: string;
}): AgentRecord {
  const runtimeId = input.runtime_id || DEFAULT_RUNTIME_ID;
  ensureRuntime(runtimeId);

  const folder = input.folder || safePathSegment(input.agent_id);
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid agent folder: ${JSON.stringify(folder)}`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO agents (runtime_id, agent_id, name, folder, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(runtime_id, agent_id) DO UPDATE SET
      name = excluded.name,
      folder = excluded.folder,
      updated_at = excluded.updated_at
  `,
  ).run(
    runtimeId,
    input.agent_id,
    input.name || input.agent_id,
    folder,
    now,
    now,
  );

  return db
    .prepare('SELECT * FROM agents WHERE runtime_id = ? AND agent_id = ?')
    .get(runtimeId, input.agent_id) as AgentRecord;
}

export function getAgent(
  runtimeId: string,
  agentId: string,
): AgentRecord | undefined {
  return db
    .prepare('SELECT * FROM agents WHERE runtime_id = ? AND agent_id = ?')
    .get(runtimeId, agentId) as AgentRecord | undefined;
}

export function ensureSession(input: {
  runtime_id?: string;
  agent_id: string;
  session_id: string;
  chat_jid: string;
  channel?: string;
  agent_name?: string;
  agent_folder?: string;
  status?: SessionRecord['status'];
}): SessionRecord {
  const runtimeId = input.runtime_id || DEFAULT_RUNTIME_ID;
  const agent = ensureAgent({
    runtime_id: runtimeId,
    agent_id: input.agent_id,
    name: input.agent_name,
    folder: input.agent_folder,
  });
  const paths = buildSessionPaths(runtimeId, input.agent_id, input.session_id);
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO sessions (
      runtime_id,
      agent_id,
      session_id,
      chat_jid,
      channel,
      workspace_path,
      memory_path,
      logs_path,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(runtime_id, agent_id, session_id) DO UPDATE SET
      chat_jid = excluded.chat_jid,
      channel = excluded.channel,
      workspace_path = excluded.workspace_path,
      memory_path = excluded.memory_path,
      logs_path = excluded.logs_path,
      status = excluded.status,
      updated_at = excluded.updated_at
  `,
  ).run(
    runtimeId,
    agent.agent_id,
    input.session_id,
    input.chat_jid,
    input.channel || null,
    paths.workspace_path,
    paths.memory_path,
    paths.logs_path,
    input.status || 'active',
    now,
    now,
  );

  return getSessionByScope(runtimeId, input.agent_id, input.session_id)!;
}

export function getSessionByScope(
  runtimeId: string,
  agentId: string,
  sessionId: string,
): SessionRecord | undefined {
  const row = db
    .prepare(
      `
      SELECT *
      FROM sessions
      WHERE runtime_id = ? AND agent_id = ? AND session_id = ?
    `,
    )
    .get(runtimeId, agentId, sessionId);
  return row ? mapSessionRow(row) : undefined;
}

export function getSessionByChatJid(chatJid: string): SessionRecord | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE chat_jid = ?')
    .get(chatJid);
  return row ? mapSessionRow(row) : undefined;
}

export function getAllSessions(): SessionRecord[] {
  const rows = db
    .prepare(
      'SELECT * FROM sessions ORDER BY runtime_id, agent_id, session_id',
    )
    .all();
  return rows.map(mapSessionRow);
}

export function updateSessionStatus(
  runtimeId: string,
  agentId: string,
  sessionId: string,
  status: SessionRecord['status'],
): void {
  db.prepare(
    `
    UPDATE sessions
    SET status = ?, updated_at = ?
    WHERE runtime_id = ? AND agent_id = ? AND session_id = ?
  `,
  ).run(status, new Date().toISOString(), runtimeId, agentId, sessionId);
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (
      id,
      runtime_id,
      agent_id,
      session_id,
      chat_jid,
      prompt,
      schedule_type,
      schedule_value,
      context_mode,
      next_run,
      status,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.runtime_id,
    task.agent_id,
    task.session_id,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForSession(
  runtimeId: string,
  agentId: string,
  sessionId: string,
): ScheduledTask[] {
  return db
    .prepare(
      `
      SELECT *
      FROM scheduled_tasks
      WHERE runtime_id = ? AND agent_id = ? AND session_id = ?
      ORDER BY created_at DESC
    `,
    )
    .all(runtimeId, agentId, sessionId) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
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
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT t.*
    FROM scheduled_tasks t
    INNER JOIN sessions s
      ON s.runtime_id = t.runtime_id
     AND s.agent_id = t.agent_id
     AND s.session_id = t.session_id
    WHERE t.status = 'active'
      AND t.next_run IS NOT NULL
      AND t.next_run <= ?
      AND s.status = 'active'
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (
      runtime_id,
      agent_id,
      session_id,
      job_id,
      task_id,
      run_at,
      duration_ms,
      status,
      result,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.runtime_id,
    log.agent_id,
    log.session_id,
    log.job_id,
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

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

// --- Registered group accessors ---

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
        runtime_id: string;
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
    runtime_id: row.runtime_id || DEFAULT_RUNTIME_ID,
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
  const runtimeId = group.runtime_id || DEFAULT_RUNTIME_ID;
  const agentId = group.agent_id || group.folder;
  ensureAgent({
    runtime_id: runtimeId,
    agent_id: agentId,
    name: group.name,
    folder: group.folder,
  });
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (
      jid,
      name,
      folder,
      runtime_id,
      agent_id,
      trigger_pattern,
      added_at,
      container_config,
      requires_trigger,
      is_main
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    runtimeId,
    agentId,
    group.trigger,
    group.added_at,
    null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.isMain ? 1 : 0,
  );
}

export function getAllRegisteredProjects(): Record<string, RegisteredProject> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    runtime_id: string;
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
      runtime_id: row.runtime_id || DEFAULT_RUNTIME_ID,
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

// --- JSON migration ---

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
  // new runtime/agent/session graph, so it is intentionally not migrated.
  if (migrateFile('sessions.json')) {
    logger.warn(
      'Ignored legacy sessions.json during pre-release routing schema reset',
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
          runtime_id: group.runtime_id || DEFAULT_RUNTIME_ID,
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
