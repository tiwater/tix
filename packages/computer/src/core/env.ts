import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';

/** A model definition within a provider entry in config.yaml. */
export interface ProviderModelDef {
  /** Model name sent to the LLM API (e.g. "claude-3-5-sonnet-latest"). */
  name: string;
  /** Human-friendly display name (optional). */
  display_name?: string;
  /** Per-model pricing overrides from config.yaml. */
  pricing?: {
    input_usd_per_1m: number;
    output_usd_per_1m: number;
  };
}

/**
 * Expanded model entry — one per (provider, model) pair.
 * Flattened from the config.yaml `providers` array at startup.
 */
export interface ModelEntry {
  /** Composite key: "provider_id:model_name" — uniquely identifies this configuration. */
  id: string;
  /** Provider identifier (e.g. "babelark", "anthropic"). */
  provider_id: string;
  /** Provider API key. */
  api_key: string;
  /** Provider base URL. */
  base_url: string;
  /** Model name sent to the API. */
  model: string;
  /** Human-friendly display name. */
  display_name?: string;
  /** If true, this is the default model. First in list wins if none marked default. */
  default?: boolean;
  /** Per-provider pricing for this model. */
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
  TIX_CODING_CLI: ['coding_cli'],
  ASSISTANT_NAME: ['assistant_name'],
  ASSISTANT_HAS_OWN_NUMBER: ['assistant_has_own_number'],
  HTTPS_PROXY: ['proxy'],
  HTTP_PROXY: ['proxy'],
  TIX_DISCORD_TOKEN: ['channels', 'discord', 'token'],
  TIX_DISCORD_ENABLED: ['channels', 'discord', 'enabled'],
  DISCORD_BOT_TOKEN: ['channels', 'discord', 'token'],
  TIX_TELEGRAM_BOT_TOKEN: ['channels', 'telegram', 'token'],
  TIX_SLACK_TOKEN: ['channels', 'slack', 'token'],
  TIX_FEISHU_APP_ID: ['channels', 'feishu', 'app_id'],
  TIX_FEISHU_APP_SECRET: ['channels', 'feishu', 'app_secret'],
  TIX_FEISHU_ENABLED: ['channels', 'feishu', 'enabled'],
  HTTP_API_KEY: ['security', 'http_api_key'],
  GEMINI_API_KEY: ['api_keys', 'gemini'],
  CLAUDE_CODE_OAUTH_TOKEN: ['api_keys', 'claude_oauth'],
  TIX_PREVIEW_URL_PATTERN: ['preview_url_pattern'],
  CONTAINER_IMAGE: ['container', 'image'],
  CONTAINER_TIMEOUT: ['container', 'timeout'],
  MAX_CONCURRENT_CONTAINERS: ['container', 'max_concurrent'],
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

# ── LLM Providers ──
# Each provider defines API credentials and available models.
# The first provider's first model is the default.
providers:
  - id: tix-cloud
    api_key: "tix-session-token"
    base_url: "http://localhost:2755/api/llm/v1"
    default: true
    models:
      - name: "qwen3.6-plus"
      - name: "claude-sonnet-4.6"
      - name: "gpt-5.4"

  # - id: anthropic
  #   api_key: "your-anthropic-api-key"
  #   models:
  #     - name: "claude-3-5-sonnet-latest"

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
 * Read the models registry from config.yaml `providers` array.
 *
 * Each provider entry contains API credentials and a list of models.
 * This function expands them into a flat list of `ModelEntry` objects,
 * each with a composite key `"provider_id:model_name"`.
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

  if (!Array.isArray(doc.providers) || doc.providers.length === 0) {
    return [];
  }

  const entries: ModelEntry[] = [];
  let hasDefault = false;

  for (const provider of doc.providers) {
    if (!provider || typeof provider !== 'object') continue;
    const providerId = String(provider.id || 'unnamed');
    const apiKey = String(provider.api_key || '');
    const baseUrl = String(provider.base_url || '');
    const isProviderDefault = !!provider.default;

    const models: any[] = Array.isArray(provider.models) ? provider.models : [];
    if (models.length === 0) continue;

    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      if (!m || typeof m !== 'object') continue;
      const modelName = String(m.name || '');
      if (!modelName) continue;

      const isDefault = isProviderDefault && i === 0 && !hasDefault;
      if (isDefault) hasDefault = true;

      const pricing = m.pricing && typeof m.pricing === 'object'
        ? {
            input_usd_per_1m: Number(m.pricing.input_usd_per_1m || 0),
            output_usd_per_1m: Number(m.pricing.output_usd_per_1m || 0),
          }
        : undefined;

      entries.push({
        id: `${providerId}:${modelName}`,
        provider_id: providerId,
        api_key: apiKey,
        base_url: baseUrl,
        model: modelName,
        display_name: m.display_name ? String(m.display_name) : undefined,
        default: isDefault,
        pricing: (pricing && (pricing.input_usd_per_1m > 0 || pricing.output_usd_per_1m > 0))
          ? pricing
          : undefined,
      });
    }
  }

  // If no entry was marked default, mark the first one
  if (entries.length > 0 && !hasDefault) {
    entries[0].default = true;
  }

  return entries;
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
