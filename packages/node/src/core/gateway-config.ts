import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { TICLAW_HOME, NODE_HOSTNAME } from './config.js';
import { logger } from './logger.js';

export interface GatewayConfig {
  gateway_url?: string;
  trust_token?: string;
  reporting_interval?: number;
}

const CONFIG_PATH = path.join(TICLAW_HOME, 'config.yaml');

export function readGatewayConfig(): GatewayConfig {
  let config: GatewayConfig = {};

  // 1. Load from file if exists
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as any;
      config = {
        gateway_url: raw?.gateway_url,
        trust_token: raw?.trust_token,
        reporting_interval: raw?.reporting_interval,
      };
      logger.debug({ path: CONFIG_PATH }, 'Loaded gateway config from file');
    } catch (err) {
      logger.error({ err, path: CONFIG_PATH }, 'Failed to read gateway config file');
    }
  }

  // 2. Override with environment variables (canonical TICLAW_ names)
  if (process.env.TICLAW_GATEWAY_URL) config.gateway_url = process.env.TICLAW_GATEWAY_URL;
  if (process.env.TICLAW_GATEWAY_TRUST_TOKEN) config.trust_token = process.env.TICLAW_GATEWAY_TRUST_TOKEN;
  if (process.env.TICLAW_GATEWAY_REPORTING_INTERVAL) {
    config.reporting_interval = parseInt(process.env.TICLAW_GATEWAY_REPORTING_INTERVAL, 10);
  }

  // 3. Default gateway_url based on environment
  if (!config.gateway_url) {
    config.gateway_url =
      process.env.NODE_ENV === 'production'
        ? 'wss://ticlaw-gateway.onrender.com'
        : 'ws://127.0.0.1:2755';
  }

  return config;
}

export function writeGatewayConfig(config: GatewayConfig): void {
  try {
    const yamlStr = yaml.dump(config);
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    logger.info({ path: CONFIG_PATH }, 'Updated gateway config file');
  } catch (err) {
    logger.error({ err, path: CONFIG_PATH }, 'Failed to write gateway config file');
  }
}
