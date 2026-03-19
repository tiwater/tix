import os from 'os';
import path from 'path';
import fs from 'fs';

import { readEnvFile, readModelsConfig, type ModelEntry } from './env.js';
import { logger } from './logger.js';
export type { ModelEntry };

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TC_CODING_CLI',
  'SKILLS_DIRS',
  'SKILLS_ADMIN_ONLY',
  'SKILLS_ALLOW_LEVEL3',
  'SKILLS_AUTO_ENABLE',
  'MIND_ADMIN_USERS',
  'MIND_LOCK_MODE',
  'HTTP_PORT',
  'HTTP_ENABLED',
  'HTTP_API_KEY',
  'ANTHROPIC_API_KEY',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'CONTROL_PLANE_URL',
  'CONTROL_PLANE_ENROLLMENT_MODE',
  'ACP_ENABLED',
  'ACP_HUB_URL',
  'SECURITY_TRUSTED_REMOTE_HOSTS',
  'SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS',
  'WORKSPACE_ALLOWED_ROOTS',
  'CHILD_ENV_ALLOWLIST',
  'CONCURRENCY_LIMIT',
  'AGENT_CONCURRENCY_LIMIT',
  'SESSION_CONCURRENCY_LIMIT',
  'TASK_DEFAULT_TIMEOUT_MS',
  'TASK_DEFAULT_STEP_TIMEOUT_MS',
  'TASK_DEFAULT_RETRY_COUNT',
  'TASK_DEFAULT_RETRY_BACKOFF_MS',
  'TC_NODE_NAME',
  'TICLAW_AUTH_TOKEN',
  'SUPEN_NODE_ID',
  'WORKSPACE_ROOT',
  'ALLOWED_ORIGINS',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Shaw';
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
export const TICLAW_HOME = path.join(HOME_DIR, '.ticlaw');

// Ensure base directory exists
if (!fs.existsSync(TICLAW_HOME)) {
  fs.mkdirSync(TICLAW_HOME, { recursive: true });
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function findMonorepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

// Resolve current file's directory dynamically (compatible with ESM or CJS compiled output)
const currentFileDir = typeof __dirname !== 'undefined' 
  ? __dirname 
  : new URL('.', import.meta.url).pathname;

const monorepoRoot = findMonorepoRoot(currentFileDir);

export function expandHomePath(inputPath: string): string {
  if (inputPath === '~') return HOME_DIR;
  if (inputPath.startsWith('~/')) {
    return path.join(HOME_DIR, inputPath.slice(2));
  }
  if (inputPath.startsWith('@/') && monorepoRoot) {
    return path.join(monorepoRoot, inputPath.slice(2));
  }
  return path.resolve(inputPath);
}

function parsePathList(
  value: string | undefined,
  fallback: string[],
): string[] {
  const rawItems = value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;
  return Array.from(new Set(rawItems.map((item) => expandHomePath(item))));
}

function parseStringList(value: string | undefined, fallback: string[]): string[] {
  const rawItems = value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;
  return Array.from(new Set(rawItems));
}

export const MOUNT_ALLOWLIST_PATH = path.join(
  TICLAW_HOME,
  'mount-allowlist.json',
);
export const STORE_DIR = path.join(TICLAW_HOME, 'store');
export const AGENTS_DIR = path.join(TICLAW_HOME, 'agents');

if (!fs.existsSync(AGENTS_DIR)) {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

export const DATA_DIR = path.join(TICLAW_HOME, 'data');
export const SKILLS_HOME = path.join(TICLAW_HOME, 'skills');
export const SKILLS_STATE_PATH = path.join(SKILLS_HOME, 'registry.json');
export const SKILLS_AUDIT_LOG_PATH = path.join(SKILLS_HOME, 'audit.log');

export const SECURITY_TRUSTED_REMOTE_HOSTS = parseStringList(
  process.env.SECURITY_TRUSTED_REMOTE_HOSTS ||
    envConfig.SECURITY_TRUSTED_REMOTE_HOSTS,
  [],
);

export const SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS = parseBoolean(
  process.env.SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS ||
    envConfig.SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS,
  false,
);

export const WORKSPACE_ALLOWED_ROOTS = parsePathList(
  process.env.WORKSPACE_ALLOWED_ROOTS || envConfig.WORKSPACE_ALLOWED_ROOTS,
  [HOME_DIR],
);

export const CHILD_ENV_ALLOWLIST = parseStringList(
  process.env.CHILD_ENV_ALLOWLIST || envConfig.CHILD_ENV_ALLOWLIST,
  [],
);

/** OpenClaw-compatible mind files (boot-md order). Evolved through conversation. */
export const AGENT_MIND_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const;

/** Legacy: single memory file (pre–OpenClaw split). Kept for migration. */
export const AGENT_MEMORY_FILENAME = 'MEMORY.md';

export interface SkillsRuntimeConfig {
  directories: string[];
  adminOnly: boolean;
  allowLevel3: boolean;
  autoEnableOnInstall: boolean;
  defaultEnabled: string[];
  statePath: string;
  auditLogPath: string;
}

const defaultSkillDirectories = [
  '~/.ticlaw/skills',
  '@/skills',
  './skills'
];

export const SKILLS_CONFIG: SkillsRuntimeConfig = {
  directories: parsePathList(
    process.env.SKILLS_DIRS || envConfig.SKILLS_DIRS,
    defaultSkillDirectories,
  ),
  adminOnly: parseBoolean(
    process.env.SKILLS_ADMIN_ONLY || envConfig.SKILLS_ADMIN_ONLY,
    true,
  ),
  allowLevel3: parseBoolean(
    process.env.SKILLS_ALLOW_LEVEL3 || envConfig.SKILLS_ALLOW_LEVEL3,
    true,
  ),
  autoEnableOnInstall: parseBoolean(
    process.env.SKILLS_AUTO_ENABLE || envConfig.SKILLS_AUTO_ENABLE,
    false,
  ),
  defaultEnabled:
    process.env.SKILLS_DEFAULT_ENABLED || envConfig.SKILLS_DEFAULT_ENABLED
      ? (process.env.SKILLS_DEFAULT_ENABLED ||
          envConfig.SKILLS_DEFAULT_ENABLED)!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['web-content', 'web-search', 'browser'],
  statePath: SKILLS_STATE_PATH,
  auditLogPath: SKILLS_AUDIT_LOG_PATH,
};

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
  process.env.PORT || process.env.HTTP_PORT || envConfig.HTTP_PORT || '2756',
  10,
);
export const HTTP_ENABLED =
  (process.env.HTTP_ENABLED ?? envConfig.HTTP_ENABLED ?? 'true') !== 'false';
export const HTTP_API_KEY =
  process.env.HTTP_API_KEY || envConfig.HTTP_API_KEY || '';

export const TICLAW_AUTH_TOKEN =
  process.env.TICLAW_AUTH_TOKEN || envConfig.TICLAW_AUTH_TOKEN || '';
export const SUPEN_NODE_ID =
  process.env.SUPEN_NODE_ID || envConfig.SUPEN_NODE_ID || '';
export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT || envConfig.WORKSPACE_ROOT || '';
export const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS || envConfig.ALLOWED_ORIGINS || '';

// LLM API keys — prefer MiniMax if configured, fall back to Anthropic
export const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY || '';
export const LLM_API_KEY =
  process.env.LLM_API_KEY || envConfig.LLM_API_KEY || '';
export const MINIMAX_API_KEY =
  process.env.MINIMAX_API_KEY || envConfig.MINIMAX_API_KEY || '';
export const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL ||
  envConfig.MINIMAX_BASE_URL ||
  'https://api.minimax.io/anthropic';

/** Default model name. Priority: config.yaml llm.model > MiniMax > undefined (let CLI decide). */
export const DEFAULT_LLM_MODEL =
  process.env.LLM_MODEL ||
  envConfig.LLM_MODEL ||
  (MINIMAX_API_KEY ? 'MiniMax-M2.5' : undefined);

/** LLM base URL from config.yaml llm.base_url (Anthropic-compatible endpoint). */
export const LLM_BASE_URL =
  process.env.LLM_BASE_URL || envConfig.LLM_BASE_URL || '';

/**
 * Model registry — loaded once at startup from config.yaml `models` list.
 * Fallback order = list order. First entry (or first with default:true) is the default.
 *
 * Env-var-only setups (no config.yaml models array) will get a synthetic single-entry
 * list built from LLM_API_KEY / LLM_BASE_URL / DEFAULT_LLM_MODEL.
 */
export const MODELS_REGISTRY: ModelEntry[] = (() => {
  const fromYaml = readModelsConfig();
  if (fromYaml.length > 0) return fromYaml;

  // Env-var fallback: build a single synthetic entry
  const apiKey = ANTHROPIC_API_KEY || LLM_API_KEY;
  const baseUrl = LLM_BASE_URL;
  const model = process.env.LLM_MODEL || envConfig.LLM_MODEL || '';
  if (!apiKey) return [];
  return [{ id: 'default', api_key: apiKey, base_url: baseUrl, model, default: true }];
})();

/** The default model entry (marked default:true, or first in list). */
export const DEFAULT_MODEL: ModelEntry | undefined =
  MODELS_REGISTRY.find((m) => m.default) ?? MODELS_REGISTRY[0];

// Node identity — derived from hostname or manual override via TC_NODE_NAME
const rawHostname = os.hostname() || 'ticlaw-local';
export const NODE_HOSTNAME =
  process.env.TC_NODE_NAME || envConfig.TC_NODE_NAME || rawHostname;

// ACP (Agent Communication Protocol) configuration
export const ACP_ENABLED =
  (process.env.ACP_ENABLED ?? envConfig.ACP_ENABLED ?? 'false') === 'true';
export const ACP_HUB_URL =
  process.env.ACP_HUB_URL || envConfig.ACP_HUB_URL || '';

// Concurrency limits
export const CONCURRENCY_LIMIT = Math.max(
  1,
  parseInt(
    process.env.CONCURRENCY_LIMIT || envConfig.CONCURRENCY_LIMIT || '5',
    10,
  ) || 5,
);
export const AGENT_CONCURRENCY_LIMIT = Math.max(
  1,
  parseInt(
    process.env.AGENT_CONCURRENCY_LIMIT ||
      envConfig.AGENT_CONCURRENCY_LIMIT ||
      '3',
    10,
  ) || 3,
);
export const SESSION_CONCURRENCY_LIMIT = Math.max(
  1,
  parseInt(
    process.env.SESSION_CONCURRENCY_LIMIT ||
      envConfig.SESSION_CONCURRENCY_LIMIT ||
      '1',
    10,
  ) || 1,
);

// Task executor defaults
export const TASK_DEFAULT_TIMEOUT_MS = parseInt(
  process.env.TASK_DEFAULT_TIMEOUT_MS ||
    envConfig.TASK_DEFAULT_TIMEOUT_MS ||
    '0',
  10,
);
export const TASK_DEFAULT_STEP_TIMEOUT_MS = parseInt(
  process.env.TASK_DEFAULT_STEP_TIMEOUT_MS ||
    envConfig.TASK_DEFAULT_STEP_TIMEOUT_MS ||
    '0',
  10,
);
export const TASK_DEFAULT_RETRY_COUNT = parseInt(
  process.env.TASK_DEFAULT_RETRY_COUNT ||
    envConfig.TASK_DEFAULT_RETRY_COUNT ||
    '0',
  10,
);
export const TASK_DEFAULT_RETRY_BACKOFF_MS = parseInt(
  process.env.TASK_DEFAULT_RETRY_BACKOFF_MS ||
    envConfig.TASK_DEFAULT_RETRY_BACKOFF_MS ||
    '5000',
  10,
);

// --- Convention-based agent paths ---
export function agentPaths(agentId: string) {
  const normalizedAgentId = (agentId || '').trim();
  if (
    !normalizedAgentId ||
    normalizedAgentId === '.' ||
    normalizedAgentId === '..' ||
    normalizedAgentId.includes('/') ||
    normalizedAgentId.includes('\\') ||
    normalizedAgentId.includes('\0')
  ) {
    throw new Error(`Invalid agent_id: ${JSON.stringify(agentId)}`);
  }

  const base = path.resolve(AGENTS_DIR, normalizedAgentId);
  if (base !== AGENTS_DIR && !base.startsWith(`${AGENTS_DIR}${path.sep}`)) {
    throw new Error(`Invalid agent_id path escape attempt: ${normalizedAgentId}`);
  }
  const configPath = path.join(base, 'agent-config.json');

  let workspace = path.join(HOME_DIR, `workspace-${normalizedAgentId}`);
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.workspace) {
        const requested = expandHomePath(config.workspace);
        const inAllowedRoot = WORKSPACE_ALLOWED_ROOTS.some((root) => {
          const resolvedRoot = path.resolve(root);
          const resolvedPath = path.resolve(requested);
          return (
            resolvedPath === resolvedRoot ||
            resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
          );
        });
        if (inAllowedRoot) {
          workspace = requested;
        } else {
          console.warn(
            `[security] Workspace "${requested}" is outside WORKSPACE_ALLOWED_ROOTS; falling back to default for agent "${normalizedAgentId}".`,
          );
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    base,
    config: configPath,
    workspace,
    logs: path.join(base, 'logs'),
    brain: base,
  };
}

/**
 * Get the ordered list of models for a specific agent.
 *
 * 1. Checks `agent-config.json` for `model`: "model_id"
 * 2. If present, puts that model first, followed by the rest of the registry for fallback.
 * 3. If absent or invalid, returns the full registry (which puts the default model first).
 */
export function getAgentModelConfig(agentId: string): ModelEntry[] {
  let selectedModelId: string | undefined;

  try {
    const configPath = path.join(AGENTS_DIR, agentId, 'agent-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (typeof config.model === 'string' && config.model) {
        selectedModelId = config.model;
      }
    }
  } catch (e: any) {
    logger.warn({ err: e.message, agentId }, 'Failed to parse agent-config.json for model selection');
  }

  // If no model explicitly selected or registry empty, return registry as-is
  if (!selectedModelId || MODELS_REGISTRY.length === 0) {
    // If we have no registry, build one from env fallback (handled by MODELS_REGISTRY init)
    return MODELS_REGISTRY;
  }

  // Find the selected model
  const selectedIdx = MODELS_REGISTRY.findIndex(m => m.id === selectedModelId);
  
  // If the agent requested a model that isn't in config.yaml, fall back to default registry
  if (selectedIdx === -1) {
    logger.warn(
      { agentId, requestedModel: selectedModelId },
      'Agent requested model ID not found in config.yaml models block. Falling back to default.'
    );
    return MODELS_REGISTRY;
  }

  // Build the list: Selected model FIRST, then the rest in their original order for fallback
  const list = [...MODELS_REGISTRY];
  const [selected] = list.splice(selectedIdx, 1);
  return [selected, ...list];
}
