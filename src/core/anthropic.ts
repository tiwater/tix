/**
 * Shared Anthropic SDK client.
 *
 * Replaces src/core/llm.ts (Vercel AI SDK / OpenRouter).
 * Uses ANTHROPIC_API_KEY from env or config.yaml.
 * Supports HTTPS_PROXY via fetchOptions dispatcher (undici).
 */

import Anthropic from '@anthropic-ai/sdk';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const envConfig = readEnvFile(['ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY']);

export function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY || '';
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to ~/ticlaw/config.yaml or the environment.',
    );
  }
  return key;
}

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = getApiKey();
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    envConfig.HTTPS_PROXY ||
    envConfig.HTTP_PROXY;

  if (proxy) {
    logger.info({ proxy }, 'Anthropic: using proxy');
    // Dynamically import undici ProxyAgent to avoid top-level dep for users without proxy
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ProxyAgent } = require('undici');
      _client = new Anthropic({
        apiKey,
        fetchOptions: { dispatcher: new ProxyAgent(proxy) },
      });
    } catch {
      logger.warn('undici not available for proxy; falling back to direct connection');
      _client = new Anthropic({ apiKey });
    }
  } else {
    _client = new Anthropic({ apiKey });
  }

  return _client;
}

/** Fast model for structured outputs (intent parsing) */
export const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
/** Full model for agent execution tasks */
export const SONNET_MODEL = 'claude-sonnet-4-5';
