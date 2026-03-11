import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';

const TICLAW_CONFIG_PATH = path.join(
  process.env.HOME || os.homedir(),
  'ticlaw',
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
  GEMINI_API_KEY: ['api_keys', 'gemini'],
  ANTHROPIC_API_KEY: ['api_keys', 'anthropic'],
  CLAUDE_CODE_OAUTH_TOKEN: ['api_keys', 'claude_oauth'],
  TC_PREVIEW_URL_PATTERN: ['preview_url_pattern'],
  CONTAINER_IMAGE: ['container', 'image'],
  CONTAINER_TIMEOUT: ['container', 'timeout'],
  MAX_CONCURRENT_CONTAINERS: ['container', 'max_concurrent'],
  OPENROUTER_API_KEY: ['llm', 'api_key'],
  LLM_MODEL: ['llm', 'model'],
  LLM_BASE_URL: ['llm', 'base_url'],
  SUPABASE_URL: ['supabase', 'url'],
  SUPABASE_SERVICE_KEY: ['supabase', 'service_key'],
  SUPABASE_SYNC_ENABLED: ['supabase', 'sync_enabled'],
  CONTROL_PLANE_URL: ['control_plane', 'url'],
  CONTROL_PLANE_ENROLLMENT_MODE: ['control_plane', 'enrollment_mode'],
  CONTROL_PLANE_RUNTIME_ID: ['control_plane', 'runtime_id'],
  SKILLS_DIRS: ['skills', 'directories'],
  SKILLS_ADMIN_ONLY: ['skills', 'admin_only'],
  SKILLS_ALLOW_LEVEL3: ['skills', 'allow_level3'],
  SKILLS_AUTO_ENABLE: ['skills', 'auto_enable'],
};

/**
 * Read config values from ~/ticlaw/config.yaml.
 * Returns a flat key-value map using env-style keys.
 */
export function readConfigYaml(keys: string[]): Record<string, string> {
  let doc: any;
  try {
    const content = fs.readFileSync(TICLAW_CONFIG_PATH, 'utf-8');
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

/**
 * Read config values. Priority: process.env → config.yaml → .env (dev fallback).
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  // 1. Read from ~/ticlaw/config.yaml (production)
  const yamlConfig = readConfigYaml(keys);

  // 2. Read from .env (dev fallback)
  const envFile = path.join(process.cwd(), '.env');
  let dotenvConfig: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envFile, 'utf-8');
    const wanted = new Set(keys);

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!wanted.has(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) dotenvConfig[key] = value;
    }
  } catch {
    logger.debug('.env file not found, using config.yaml or defaults');
  }

  // YAML takes priority over .env
  return { ...dotenvConfig, ...yamlConfig };
}

/** Path to the YAML config file */
export { TICLAW_CONFIG_PATH };

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
    const content = fs.readFileSync(TICLAW_CONFIG_PATH, 'utf-8');
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
