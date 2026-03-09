import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

let openrouterInstance: ReturnType<typeof createOpenRouter> | null = null;

/** Create a fetch that routes requests through the given proxy URL. Required for regions (e.g. China) where OpenRouter must use a proxy. */
function createProxyFetch(proxyUrl: string): typeof fetch {
  const dispatcher = new ProxyAgent(proxyUrl);
  return (async (input: unknown, init?: unknown) =>
    undiciFetch(input as URL, {
      ...(init as object),
      dispatcher,
    })) as typeof fetch;
}

export function getOpenRouter(): ReturnType<typeof createOpenRouter> {
  if (openrouterInstance) return openrouterInstance;

  const env = readEnvFile([
    'OPENROUTER_API_KEY',
    'LLM_MODEL',
    'LLM_BASE_URL',
    'HTTPS_PROXY',
    'HTTP_PROXY',
  ]);
  const apiKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY not configured. Add it to ~/ticlaw/config.yaml under llm.api_key',
    );
  }

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    env.HTTPS_PROXY ||
    env.HTTP_PROXY;

  const providerOptions: Parameters<typeof createOpenRouter>[0] = { apiKey };
  if (proxyUrl) {
    providerOptions.fetch = createProxyFetch(proxyUrl);
    logger.info({ proxy: proxyUrl }, 'OpenRouter: using proxy for LLM calls');
  }

  openrouterInstance = createOpenRouter(providerOptions);
  return openrouterInstance;
}

export function getModelName(): string {
  const env = readEnvFile(['LLM_MODEL']);
  return process.env.LLM_MODEL || env.LLM_MODEL || 'google/gemini-2.5-flash';
}
