import os from 'os';
import path from 'path';
import fs from 'fs';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TC_CODING_CLI',
  'MIND_ADMIN_USERS',
  'MIND_LOCK_MODE',
  'HTTP_PORT',
  'HTTP_ENABLED',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
/** Workspace skill CLI: gemini, codex, claude, etc. Used only when agent needs to run code. */
export const TC_CODING_CLI =
  process.env.TC_CODING_CLI || envConfig.TC_CODING_CLI || 'gemini';

// Comma-separated sender IDs that can perform privileged mind operations.
// Example: MIND_ADMIN_USERS="ou_xxx,dc:user:12345"
export const MIND_ADMIN_USERS = (
  process.env.MIND_ADMIN_USERS ||
  envConfig.MIND_ADMIN_USERS ||
  ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// strict: locked mind rejects all natural persona edits
// admin_override: locked mind allows natural persona edits from admin users
export const MIND_LOCK_MODE =
  process.env.MIND_LOCK_MODE || envConfig.MIND_LOCK_MODE || 'admin_override';

export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths for TiClaw data management
const HOME_DIR = process.env.HOME || os.homedir();
export const TICLAW_HOME = path.join(HOME_DIR, 'ticlaw');

// Ensure base directory exists
if (!fs.existsSync(TICLAW_HOME)) {
  fs.mkdirSync(TICLAW_HOME, { recursive: true });
}

export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'ticlaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.join(TICLAW_HOME, 'store');
export const AGENTS_DIR = (() => {
  const agents = path.join(TICLAW_HOME, 'agents');
  const groups = path.join(TICLAW_HOME, 'groups');
  if (!fs.existsSync(agents) && fs.existsSync(groups)) {
    fs.renameSync(groups, agents);
  }
  if (!fs.existsSync(agents)) fs.mkdirSync(agents, { recursive: true });
  return agents;
})();
export const DATA_DIR = path.join(TICLAW_HOME, 'data');

/** @deprecated Use AGENTS_DIR. Kept for migration. */
export const GROUPS_DIR = AGENTS_DIR;

/** OpenClaw-compatible mind files (boot-md order). Evolved through conversation. */
export const AGENT_MIND_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const;

/** Legacy: single memory file (pre–OpenClaw split). Kept for migration. */
export const AGENT_MEMORY_FILENAME = 'MEMORY.md';

/** @deprecated Use AGENT_MIND_FILES. */
export const GROUP_MIND_FILES = AGENT_MIND_FILES;
/** @deprecated Use AGENT_MEMORY_FILENAME. */
export const GROUP_MEMORY_FILENAME = AGENT_MEMORY_FILENAME;

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'ticlaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// HTTP SSE channel
export const HTTP_PORT = parseInt(
  process.env.HTTP_PORT || envConfig.HTTP_PORT || '3280',
  10,
);
export const HTTP_ENABLED =
  (process.env.HTTP_ENABLED ?? envConfig.HTTP_ENABLED ?? 'true') !== 'false';
