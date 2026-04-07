import os from 'os';
import path from 'path';
import fs from 'fs';

import { readEnvFile, readModelsConfig, type ModelEntry } from './env.js';
import { logger } from './logger.js';
export type { ModelEntry };

// Read config values from ~/.tix/config.yaml.
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-computer.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TIX_CODING_CLI',
  'SKILLS_DIRS',
  'SKILLS_ADMIN_ONLY',
  'SKILLS_ALLOW_LEVEL3',
  'SKILLS_AUTO_ENABLE',
  'MIND_ADMIN_USERS',
  'MIND_LOCK_MODE',
  'HTTP_PORT',
  'HTTP_ENABLED',
  'HTTP_API_KEY',
  'CONTROL_PLANE_URL',
  'CONTROL_PLANE_ENROLLMENT_MODE',
  'ACP_ENABLED',
  'ACP_RELAY_URL',
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
  'TIX_COMPUTER_NAME',
  'TIX_PRODUCT_NAME',
  'TIX_AUTH_TOKEN',
  'WORKSPACE_ROOT',
  'ALLOWED_ORIGINS',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Shaw';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
/** Workspace skill CLI: gemini, codex, claude, etc. Used only when agent needs to run code. */
export const TIX_CODING_CLI =
  process.env.TIX_CODING_CLI || envConfig.TIX_CODING_CLI || 'gemini';

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

// Absolute paths for Tix data management
const HOME_DIR = process.env.HOME || os.homedir();
export let TIX_HOME = process.env.TIX_HOME || path.join(HOME_DIR, '.tix');

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

export let MOUNT_ALLOWLIST_PATH = path.join(
  TIX_HOME,
  'mount-allowlist.json',
);
export let STORE_DIR = path.join(TIX_HOME, 'store');
export let AGENTS_DIR = path.join(TIX_HOME, 'agents');

export let DATA_DIR = path.join(TIX_HOME, 'data');
export let SKILLS_HOME = path.join(TIX_HOME, 'skills');
export let SKILLS_STATE_PATH = path.join(SKILLS_HOME, 'registry.json');
export let SKILLS_AUDIT_LOG_PATH = path.join(SKILLS_HOME, 'audit.log');

export function configureTixComputer(options: { dataDir?: string }) {
  if (options.dataDir) {
    TIX_HOME = options.dataDir;
    MOUNT_ALLOWLIST_PATH = path.join(TIX_HOME, 'mount-allowlist.json');
    STORE_DIR = path.join(TIX_HOME, 'store');
    AGENTS_DIR = path.join(TIX_HOME, 'agents');
    DATA_DIR = path.join(TIX_HOME, 'data');
    SKILLS_HOME = path.join(TIX_HOME, 'skills');
    SKILLS_STATE_PATH = path.join(SKILLS_HOME, 'registry.json');
    SKILLS_AUDIT_LOG_PATH = path.join(SKILLS_HOME, 'audit.log');
  }
}

export function initializeDataDirs() {
  if (!fs.existsSync(TIX_HOME)) fs.mkdirSync(TIX_HOME, { recursive: true });
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

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

/** OpenTix-compatible mind files (boot-md order). Evolved through conversation. */
export const AGENT_MIND_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const;

/** Legacy: single memory file (pre–OpenTix split). Kept for migration. */
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
  '~/.tix/skills',
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
  process.env.CONTAINER_IMAGE || 'tix-agent:latest';
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

export const TIX_AUTH_TOKEN =
  process.env.TIX_AUTH_TOKEN || envConfig.TIX_AUTH_TOKEN || '';

export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT || envConfig.WORKSPACE_ROOT || '';
export const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS || envConfig.ALLOWED_ORIGINS || '';

// LLM configuration is now fully provider-driven via config.yaml `providers` array.
// No more raw env-var exports for api keys / base urls / model names.

/**
 * Model registry — loaded once at startup from config.yaml `providers` list.
 * Each entry is a (provider, model) pair with a composite ID "provider_id:model_name".
 */

/** Provider-keyed fallback pricing per 1M tokens in USD. */
const MODEL_PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  _global: {
    'glm-4': { input: 0.1, output: 0.1 },
    'glm-4v': { input: 0.1, output: 0.1 },
    'glm-4-air': { input: 0.01, output: 0.01 },
    'glm-4-flash': { input: 0.0, output: 0.0 },
    'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku': { input: 0.25, output: 1.25 },
    'claude-3-opus': { input: 15.0, output: 75.0 },
    'claude-sonnet-4': { input: 3.0, output: 15.0 },
    'claude-opus-4': { input: 15.0, output: 75.0 },
    'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  },
  babelark: {
    'qwen3.6': { input: 0.29, output: 1.74 },
    'qwen3.5': { input: 0.12, output: 0.7 },
    'gpt-5.4': { input: 2.5, output: 15.0 },
    'claude-sonnet-4.6': { input: 3.0, output: 15.0 },
  },
};

/**
 * Get pricing for a model entry.
 * Priority: 1) explicit config.yaml pricing, 2) provider-specific built-in, 3) global fallback.
 */
export function getModelPricing(entry: ModelEntry) {
  // 1. Explicit pricing from config.yaml
  if (entry.pricing && (entry.pricing.input_usd_per_1m > 0 || entry.pricing.output_usd_per_1m > 0)) {
    return { input: entry.pricing.input_usd_per_1m, output: entry.pricing.output_usd_per_1m };
  }

  // 2. Provider-specific built-in pricing (fuzzy match)
  const providerMap = MODEL_PRICING[entry.provider_id];
  if (providerMap) {
    for (const [key, pricing] of Object.entries(providerMap)) {
      if (entry.model.toLowerCase().startsWith(key)) {
        return pricing;
      }
    }
  }

  // 3. Global fallback (fuzzy match)
  const globalMap = MODEL_PRICING._global;
  for (const [key, pricing] of Object.entries(globalMap)) {
    if (entry.model.toLowerCase().startsWith(key)) {
      return pricing;
    }
  }

  return { input: 0, output: 0 };
}

export const MODELS_REGISTRY: ModelEntry[] = (() => {
  const entries = readModelsConfig();

  // Enrich with pricing
  for (const entry of entries) {
    if (!entry.pricing) {
      const p = getModelPricing(entry);
      if (p.input > 0 || p.output > 0) {
        entry.pricing = { input_usd_per_1m: p.input, output_usd_per_1m: p.output };
      }
    }
  }
  return entries;
})();

/** The default model entry (marked default:true, or first in list). */
export const DEFAULT_MODEL: ModelEntry | undefined =
  MODELS_REGISTRY.find((m) => m.default) ?? MODELS_REGISTRY[0];

// Computer identity — derived from hostname or manual override via TIX_COMPUTER_NAME
const rawHostname = os.hostname() || 'tix-local';
export const COMPUTER_HOSTNAME =
  process.env.TIX_COMPUTER_NAME || envConfig.TIX_COMPUTER_NAME || rawHostname;

/** Product branding name (e.g. "Supen", "Ticos"). Defaults to "Supen". */
export const TIX_PRODUCT_NAME = 
  process.env.TIX_PRODUCT_NAME || envConfig.TIX_PRODUCT_NAME || 'Supen';

// ACP (Agent Communication Protocol) configuration
export const ACP_ENABLED =
  (process.env.ACP_ENABLED ?? envConfig.ACP_ENABLED ?? 'false') === 'true';
export const ACP_RELAY_URL =
  process.env.ACP_RELAY_URL || envConfig.ACP_RELAY_URL || '';

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
 * 1. Checks `agent-config.json` for `model`: "provider_id:model_name" (composite key)
 * 2. If present, puts that model first, followed by the rest of the registry for fallback.
 * 3. If absent or invalid, returns the full registry (which puts the default model first).
 */
export function getAgentModelConfig(agentId: string, silent = false): ModelEntry[] {
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
    if (!silent) {
      logger.warn({ err: e.message, agentId }, 'Failed to parse agent-config.json for model selection');
    }
  }

  // If no model explicitly selected or registry empty, return registry as-is
  if (!selectedModelId || MODELS_REGISTRY.length === 0) {
    return MODELS_REGISTRY;
  }

  // Find by composite key (e.g. "babelark:qwen3.6-plus")
  let selectedIdx = MODELS_REGISTRY.findIndex(m => m.id === selectedModelId);

  // If the agent requested a model that isn't in the registry, fall back to default
  if (selectedIdx === -1) {
    if (!silent) {
      logger.warn(
        { agentId, requestedModel: selectedModelId },
        'Agent requested model ID not found in config.yaml providers block. Falling back to default.'
      );
    }
    return MODELS_REGISTRY;
  }
  // Build the list: Selected model FIRST, then the rest in their original order for fallback
  const list = [...MODELS_REGISTRY];
  const [selected] = list.splice(selectedIdx, 1);
  return [selected, ...list];
}
