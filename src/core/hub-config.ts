import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { TICLAW_HOME, CLAW_HOSTNAME } from './config.js';
import { logger } from './logger.js';

export interface HubConfig {
  hub_url?: string;
  trust_token?: string;
  reporting_interval?: number;
}

const CONFIG_PATH = path.join(TICLAW_HOME, 'config.yaml');

export function readHubConfig(): HubConfig {
  let config: HubConfig = {};

  // 1. Load from file if exists
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = yaml.load(fileContent) as HubConfig;
      logger.debug({ path: CONFIG_PATH }, 'Loaded hub config from file');
    } catch (err) {
      logger.error(
        { err, path: CONFIG_PATH },
        'Failed to read hub config file',
      );
    }
  }

  // 2. Override with Environment Variables
  if (process.env.HUB_URL) config.hub_url = process.env.HUB_URL;
  if (process.env.HUB_TRUST_TOKEN)
    config.trust_token = process.env.HUB_TRUST_TOKEN;
  if (process.env.HUB_REPORTING_INTERVAL) {
    config.reporting_interval = parseInt(
      process.env.HUB_REPORTING_INTERVAL,
      10,
    );
  }

  // Use defaults for missing fields if necessary, or keep as undefined
  return config;
}

export function writeHubConfig(config: HubConfig): void {
  try {
    const yamlStr = yaml.dump(config);
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    logger.info({ path: CONFIG_PATH }, 'Updated hub config file');
  } catch (err) {
    logger.error({ err, path: CONFIG_PATH }, 'Failed to write hub config file');
  }
}
