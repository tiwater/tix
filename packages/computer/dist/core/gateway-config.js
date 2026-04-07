import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { TIX_HOME } from './config.js';
import { logger } from './logger.js';
const CONFIG_PATH = path.join(TIX_HOME, 'config.yaml');
/**
 * Default gateway URLs used by the Gateway class when no URL is configured.
 * Exported so callers can apply them explicitly rather than having readGatewayConfig
 * silently inject a value.
 */
export const DEFAULT_GATEWAY_URL_DEV = 'ws://127.0.0.1:2755';
export const DEFAULT_GATEWAY_URL_PROD = 'wss://tix-gateway.onrender.com';
export function readGatewayConfig() {
    let config = {};
    // 1. Load from file if exists
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const raw = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
            config = {
                gateway_url: raw?.gateway_url,
                trust_token: raw?.trust_token,
                reporting_interval: raw?.reporting_interval,
            };
            logger.debug({ path: CONFIG_PATH }, 'Loaded gateway config from file');
        }
        catch (err) {
            logger.error({ err, path: CONFIG_PATH }, 'Failed to read gateway config file');
        }
    }
    // 2. Override with environment variables (canonical TIX_ names)
    if (process.env.TIX_GATEWAY_URL)
        config.gateway_url = process.env.TIX_GATEWAY_URL;
    if (process.env.TIX_GATEWAY_TRUST_TOKEN)
        config.trust_token = process.env.TIX_GATEWAY_TRUST_TOKEN;
    if (process.env.TIX_GATEWAY_REPORTING_INTERVAL) {
        config.reporting_interval = parseInt(process.env.TIX_GATEWAY_REPORTING_INTERVAL, 10);
    }
    // Note: no automatic default for gateway_url — a missing value means
    // "gateway uplink disabled". Callers that want a default should use
    // DEFAULT_GATEWAY_URL_DEV / DEFAULT_GATEWAY_URL_PROD explicitly.
    return config;
}
export function writeGatewayConfig(config) {
    try {
        const yamlStr = yaml.dump(config);
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        logger.info({ path: CONFIG_PATH }, 'Updated gateway config file');
    }
    catch (err) {
        logger.error({ err, path: CONFIG_PATH }, 'Failed to write gateway config file');
    }
}
//# sourceMappingURL=gateway-config.js.map