-- TiClaw sync schema v2 — fixes schema mismatch (issue #37)
-- Aligns sessions table and registered_agents with the actual push/pull schema.
--
-- BREAKING vs v1 migration: Drop and recreate sessions table.
-- If you have data in the old sessions table, export it first.

-- Sessions: matches supabase-sync.ts push schema
-- { agent_id, session_id, channel, status, created_at, updated_at }
-- Composite primary key (agent_id, session_id)
DROP TABLE IF EXISTS sessions;
CREATE TABLE IF NOT EXISTS sessions (
  agent_id   TEXT NOT NULL,
  session_id TEXT NOT NULL,
  channel    TEXT,
  status     TEXT,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (agent_id, session_id)
);

-- registered_agents: add agent_id column missing from v1
-- Safe to run on existing tables (IF NOT EXISTS guards)
CREATE TABLE IF NOT EXISTS registered_agents (
  jid             TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  folder          TEXT NOT NULL UNIQUE,
  agent_id        TEXT,
  trigger_pattern TEXT NOT NULL,
  added_at        TEXT NOT NULL,
  requires_trigger INTEGER DEFAULT 1,
  is_main          INTEGER DEFAULT 0
);

-- Add agent_id column to existing tables that might not have it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='registered_agents' AND column_name='agent_id'
  ) THEN
    ALTER TABLE registered_agents ADD COLUMN agent_id TEXT;
  END IF;
END $$;

-- router_state stays the same
CREATE TABLE IF NOT EXISTS router_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- mind_state and mind_packages: unchanged from v1 but included for completeness
CREATE TABLE IF NOT EXISTS mind_state (
  id               TEXT PRIMARY KEY,
  version          INTEGER NOT NULL,
  lifecycle        TEXT NOT NULL,
  persona_json     TEXT NOT NULL,
  memory_summary   TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mind_packages (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL UNIQUE,
  lifecycle      TEXT NOT NULL,
  persona_json   TEXT NOT NULL,
  memory_summary TEXT NOT NULL,
  changelog      TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Storage bucket 'ticlaw' for agent mind files
-- Create via Supabase dashboard or:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('ticlaw', 'ticlaw', false);
