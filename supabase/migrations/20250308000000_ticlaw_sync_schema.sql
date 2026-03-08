-- TiClaw sync schema for Supabase (Phase 1: sync mode)
-- Mirrors critical SQLite tables for cloud backup and robot restore.

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

CREATE TABLE IF NOT EXISTS sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registered_groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  trigger_pattern TEXT NOT NULL,
  added_at TEXT NOT NULL,
  requires_trigger INTEGER DEFAULT 1,
  is_main INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Storage bucket 'ticlaw' for agent mind files (agents/{SOUL,MEMORY,...}.md, agents/{folder}/*.md)
-- Create via Supabase dashboard or: INSERT INTO storage.buckets (id, name, public) VALUES ('ticlaw', 'ticlaw', false);
