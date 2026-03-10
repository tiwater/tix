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
  'TICLAW_RUNTIME_ID',
  'TICLAW_RUNTIME_CONCURRENCY',
  'TICLAW_AGENT_CONCURRENCY',
  'TICLAW_SESSION_CONCURRENCY',
  'MIND_ADMIN_USERS',
  'MIND_LOCK_MODE',
  'HTTP_PORT',
  'HTTP_ENABLED',
  'ACP_ENABLED',
  'ACP_HUB_URL',
  'ANTHROPIC_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'CONTROL_PLANE_URL',
  'CONTROL_PLANE_ENROLLMENT_MODE',
  'CONTROL_PLANE_RUNTIME_ID',
  'RUNTIME_API_KEY',
  'RUNTIME_CAPABILITY_WHITELIST',
  'JOB_DEFAULT_TIMEOUT_MS',
  'JOB_DEFAULT_STEP_TIMEOUT_MS',
  'JOB_DEFAULT_RETRY_COUNT',
  'JOB_DEFAULT_RETRY_BACKOFF_MS',
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

export const ACP_ENABLED =
  (process.env.ACP_ENABLED ?? envConfig.ACP_ENABLED ?? 'false') === 'true';

export const ACP_HUB_URL =
  process.env.ACP_HUB_URL || envConfig.ACP_HUB_URL || '';

// LLM API keys — prefer MiniMax if configured, fall back to Anthropic
export const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY || '';
export const MINIMAX_API_KEY =
  process.env.MINIMAX_API_KEY || envConfig.MINIMAX_API_KEY || '';
export const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL ||
  envConfig.MINIMAX_BASE_URL ||
  'https://api.minimax.io/anthropic';

/** Default model name. Uses MiniMax-M2.5 when MINIMAX_API_KEY is set, else undefined (claude-code default). */
export const DEFAULT_LLM_MODEL = MINIMAX_API_KEY ? 'MiniMax-M2.5' : undefined;

// Generic control-plane enrollment config (control-plane agnostic)
export const CONTROL_PLANE_URL =
  process.env.CONTROL_PLANE_URL || envConfig.CONTROL_PLANE_URL || '';
export const CONTROL_PLANE_ENROLLMENT_MODE =
  process.env.CONTROL_PLANE_ENROLLMENT_MODE ||
  envConfig.CONTROL_PLANE_ENROLLMENT_MODE ||
  'tofu_oob';
export const CONTROL_PLANE_RUNTIME_ID =
  process.env.CONTROL_PLANE_RUNTIME_ID ||
  envConfig.CONTROL_PLANE_RUNTIME_ID ||
  '';

export const RUNTIME_API_KEY =
  process.env.RUNTIME_API_KEY || envConfig.RUNTIME_API_KEY || '';

export const RUNTIME_CAPABILITY_WHITELIST = (
  process.env.RUNTIME_CAPABILITY_WHITELIST ||
  envConfig.RUNTIME_CAPABILITY_WHITELIST ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const DEFAULT_RUNTIME_ID =
  process.env.TICLAW_RUNTIME_ID ||
  envConfig.TICLAW_RUNTIME_ID ||
  CONTROL_PLANE_RUNTIME_ID ||
  'ticlaw-runtime';

function parseConcurrencyLimit(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RUNTIME_CONCURRENCY_LIMIT = parseConcurrencyLimit(
  process.env.TICLAW_RUNTIME_CONCURRENCY ||
    envConfig.TICLAW_RUNTIME_CONCURRENCY,
  10,
);

export const AGENT_CONCURRENCY_LIMIT = parseConcurrencyLimit(
  process.env.TICLAW_AGENT_CONCURRENCY || envConfig.TICLAW_AGENT_CONCURRENCY,
  5,
);

export const SESSION_CONCURRENCY_LIMIT = parseConcurrencyLimit(
  process.env.TICLAW_SESSION_CONCURRENCY ||
    envConfig.TICLAW_SESSION_CONCURRENCY,
  2,
);

export const JOB_DEFAULT_TIMEOUT_MS = parseConcurrencyLimit(
  process.env.JOB_DEFAULT_TIMEOUT_MS || envConfig.JOB_DEFAULT_TIMEOUT_MS,
  30 * 60 * 1000,
);

export const JOB_DEFAULT_STEP_TIMEOUT_MS = parseConcurrencyLimit(
  process.env.JOB_DEFAULT_STEP_TIMEOUT_MS ||
    envConfig.JOB_DEFAULT_STEP_TIMEOUT_MS,
  5 * 60 * 1000,
);

export const JOB_DEFAULT_RETRY_COUNT = Math.max(
  0,
  parseInt(
    process.env.JOB_DEFAULT_RETRY_COUNT ||
      envConfig.JOB_DEFAULT_RETRY_COUNT ||
      '1',
    10,
  ) || 0,
);

export const JOB_DEFAULT_RETRY_BACKOFF_MS = parseConcurrencyLimit(
  process.env.JOB_DEFAULT_RETRY_BACKOFF_MS ||
    envConfig.JOB_DEFAULT_RETRY_BACKOFF_MS,
  5_000,
);
