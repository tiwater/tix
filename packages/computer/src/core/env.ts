import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';

export interface ModelEntry {
  /** Unique identifier for this model config. */
  id: string;
  api_key: string;
  base_url: string;
  model: string;
  /** If true, this model is used when no agent-level model is specified. First in list wins if none marked default. */
  default?: boolean;
  /** Optional pricing information per 1M tokens. */
  pricing?: {
    input_usd_per_1m: number;
    output_usd_per_1m: number;
  };
}

const TIX_CONFIG_PATH = path.join(
  process.env.HOME || os.homedir(),
  '.tix',
  'config.yaml',
);

/**
 * Config key mapping: YAML paths → env-style keys.
 * This flattens the YAML structure so readEnvFile() callers
 * don't need to change.
 */
const YAML_KEY_MAP: Record<string, string[]> = {
  TC_CODING_CLI: ['coding_cli'],
  ASSISTANT_NAME: ['assistant_name'],
  ASSISTANT_HAS_OWN_NUMBER: ['assistant_has_own_number'],
  HTTPS_PROXY: ['proxy'],
  HTTP_PROXY: ['proxy'],
  TC_DISCORD_TOKEN: ['channels', 'discord', 'token'],
  TC_DISCORD_ENABLED: ['channels', 'discord', 'enabled'],
  DISCORD_BOT_TOKEN: ['channels', 'discord', 'token'],
  TC_TELEGRAM_BOT_TOKEN: ['channels', 'telegram', 'token'],
  TC_SLACK_TOKEN: ['channels', 'slack', 'token'],
  TC_FEISHU_APP_ID: ['channels', 'feishu', 'app_id'],
  TC_FEISHU_APP_SECRET: ['channels', 'feishu', 'app_secret'],
  TC_FEISHU_ENABLED: ['channels', 'feishu', 'enabled'],
  HTTP_API_KEY: ['security', 'http_api_key'],
  GEMINI_API_KEY: ['api_keys', 'gemini'],
  ANTHROPIC_API_KEY: ['api_keys', 'anthropic'],
  CLAUDE_CODE_OAUTH_TOKEN: ['api_keys', 'claude_oauth'],
  TC_PREVIEW_URL_PATTERN: ['preview_url_pattern'],
  CONTAINER_IMAGE: ['container', 'image'],
  CONTAINER_TIMEOUT: ['container', 'timeout'],
  MAX_CONCURRENT_CONTAINERS: ['container', 'max_concurrent'],
  LLM_API_KEY: ['llm', 'api_key'],
  LLM_MODEL: ['llm', 'model'],
  LLM_BASE_URL: ['llm', 'base_url'],
  LLM_FALLBACK_API_KEY: ['llm', 'fallback', 'api_key'],
  LLM_FALLBACK_MODEL: ['llm', 'fallback', 'model'],
  LLM_FALLBACK_BASE_URL: ['llm', 'fallback', 'base_url'],
  SUPABASE_URL: ['supabase', 'url'],
  SUPABASE_SERVICE_KEY: ['supabase', 'service_key'],
  SUPABASE_SYNC_ENABLED: ['supabase', 'sync_enabled'],
  CONTROL_PLANE_URL: ['control_plane', 'url'],
  CONTROL_PLANE_ENROLLMENT_MODE: ['control_plane', 'enrollment_mode'],
  SKILLS_DIRS: ['skills', 'directories'],
  SKILLS_ADMIN_ONLY: ['skills', 'admin_only'],
  SKILLS_ALLOW_LEVEL3: ['skills', 'allow_level3'],
  SKILLS_AUTO_ENABLE: ['skills', 'auto_enable'],
  SKILLS_DEFAULT_ENABLED: ['skills', 'default_enabled'],
  SECURITY_TRUSTED_REMOTE_HOSTS: ['security', 'trusted_remote_hosts'],
  SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS: [
    'security',
    'allow_insecure_remote_endpoints',
  ],
  WORKSPACE_ALLOWED_ROOTS: ['security', 'workspace_allowed_roots'],
  CHILD_ENV_ALLOWLIST: ['security', 'child_env_allowlist'],
};

/**
 * Read config values from ~/.tix/config.yaml.
 * Returns a flat key-value map using env-style keys.
 * Creates a default config template on first run.
 */
export function readConfigYaml(keys: string[]): Record<string, string> {
  // Bootstrap: create default config.yaml if missing
  if (!fs.existsSync(TIX_CONFIG_PATH)) {
    const dir = path.dirname(TIX_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TIX_CONFIG_PATH, DEFAULT_CONFIG_YAML, 'utf-8');
    logger.info(
      { path: TIX_CONFIG_PATH },
      'Created default config.yaml — edit it to set your API keys',
    );
  }

  let doc: any;
  try {
    const content = fs.readFileSync(TIX_CONFIG_PATH, 'utf-8');
    doc = yaml.parse(content);
  } catch {
    return {};
  }

  if (!doc || typeof doc !== 'object') return {};

  const result: Record<string, string> = {};
  for (const key of keys) {
    const yamlPath = YAML_KEY_MAP[key];
    if (!yamlPath) continue;

    let value: any = doc;
    for (const segment of yamlPath) {
      if (value == null || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = value[segment];
    }

    if (value != null && value !== '') {
      result[key] = Array.isArray(value) ? value.join(',') : String(value);
    }
  }

  return result;
}

const DEFAULT_CONFIG_YAML = `# Tix Computer Configuration
# Edit this file to configure your Computer.
# Docs: https://supen.ai/docs/computers

# ── LLM Provider ──
# BigModel (recommended): get a key at https://open.bigmodel.cn
llm:
  # api_key: "your-bigmodel-api-key"
  # base_url: "https://open.bigmodel.cn/api/anthropic"
  # model: "glm-4.7"  # Optional: override default model

# ── Agent Settings ──
# assistant_name: "Andy"
# coding_cli: "gemini"

# ── Channels ──
# channels:
#   http:
#     enabled: true
#   discord:
#     token: "your-discord-bot-token"
#     enabled: false
`;

/**
 * Read config values from ~/.tix/config.yaml.
 * Runtime priority is still enforced by callers as: process.env -> config.yaml.
 * This function does NOT mutate process.env.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  return readConfigYaml(keys);
}

/** Path to the YAML config file */
export { TIX_CONFIG_PATH };

/**
 * Read the models registry from config.yaml.
 *
 * Supports two formats:
 *  1. New: `models: [{ id, api_key, base_url, model, default? }, ...]`
 *  2. Legacy: `llm: { api_key, base_url, model }` — treated as a single entry with id "default"
 *
 * Returns entries in list order. Fallback order = list order.
 */
export function readModelsConfig(): ModelEntry[] {
  let doc: any;
  try {
    const content = fs.readFileSync(TIX_CONFIG_PATH, 'utf-8');
    doc = yaml.parse(content);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];

  // New format: models array
  if (Array.isArray(doc.models) && doc.models.length > 0) {
    const entries: ModelEntry[] = [];
    for (const m of doc.models) {
      if (!m || typeof m !== 'object') continue;
      entries.push({
        id: String(m.id || 'unnamed'),
        api_key: String(m.api_key || ''),
        base_url: String(m.base_url || ''),
        model: String(m.model || ''),
        default: !!m.default,
      });
    }
    // If none explicitly marked default, mark first entry
    if (entries.length > 0 && !entries.some((e) => e.default)) {
      entries[0].default = true;
    }
    return entries;
  }

  // Legacy format: llm.* single entry
  const llm = doc.llm;
  if (llm && typeof llm === 'object') {
    return [
      {
        id: 'default',
        api_key: String(llm.api_key || ''),
        base_url: String(llm.base_url || ''),
        model: String(llm.model || ''),
        default: true,
      },
    ];
  }

  return [];
}


/** Channels that can be enabled via config. */
const CONFIGURABLE_CHANNELS = [
  'discord',
  'feishu',
  'http',
  'telegram',
  'slack',
] as const;

/**
 * Returns channel names enabled in config.yaml.
 * Config-driven: only channels with a config block and enabled !== false are started.
 * Credentials can come from config or env; the channel factory returns null if missing.
 * If no channels are configured, returns [] and index falls back to all registered.
 */
export function getEnabledChannelsFromConfig(): string[] {
  let doc: any;
  try {
    const content = fs.readFileSync(TIX_CONFIG_PATH, 'utf-8');
    doc = yaml.parse(content);
  } catch {
    return [];
  }

  const channels = doc?.channels;
  if (!channels || typeof channels !== 'object') return [];

  const enabled: string[] = [];
  for (const name of CONFIGURABLE_CHANNELS) {
    if (name === 'http') {
      // HTTP SSE channel: enabled by default unless explicitly disabled in config
      const block = channels[name];
      if (block && (block.enabled === false || block.enabled === 'false'))
        continue;
      enabled.push(name);
      continue;
    }
    const block = channels[name];
    if (!block || typeof block !== 'object') continue;
    if (block.enabled === false || block.enabled === 'false') continue;
    enabled.push(name);
  }
  return enabled;
}
