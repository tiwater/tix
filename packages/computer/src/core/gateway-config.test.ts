import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

describe('gateway config', () => {
  it('reads TIX_GATEWAY_URL from env', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tix-gateway-config-'));
    const previousEnv = {
      TIX_HOME: process.env.TIX_HOME,
      TIX_GATEWAY_URL: process.env.TIX_GATEWAY_URL,
    };

    process.env.TIX_HOME = tempHome;
    process.env.TIX_GATEWAY_URL = 'wss://my-gateway.example.com';

    try {
      vi.resetModules();
      const { readGatewayConfig } = await import('./gateway-config.js');
      expect(readGatewayConfig().gateway_url).toBe('wss://my-gateway.example.com');
    } finally {
      vi.resetModules();
      if (previousEnv.TIX_HOME === undefined) delete process.env.TIX_HOME;
      else process.env.TIX_HOME = previousEnv.TIX_HOME;
      if (previousEnv.TIX_GATEWAY_URL === undefined) delete process.env.TIX_GATEWAY_URL;
      else process.env.TIX_GATEWAY_URL = previousEnv.TIX_GATEWAY_URL;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('returns undefined gateway_url when not configured', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tix-gateway-config-'));
    const previousEnv = {
      TIX_HOME: process.env.TIX_HOME,
      TIX_GATEWAY_URL: process.env.TIX_GATEWAY_URL,
    };

    process.env.TIX_HOME = tempHome;
    delete process.env.TIX_GATEWAY_URL;

    try {
      vi.resetModules();
      const { readGatewayConfig } = await import('./gateway-config.js');
      expect(readGatewayConfig().gateway_url).toBeUndefined();
    } finally {
      vi.resetModules();
      if (previousEnv.TIX_HOME === undefined) delete process.env.TIX_HOME;
      else process.env.TIX_HOME = previousEnv.TIX_HOME;
      if (previousEnv.TIX_GATEWAY_URL === undefined) delete process.env.TIX_GATEWAY_URL;
      else process.env.TIX_GATEWAY_URL = previousEnv.TIX_GATEWAY_URL;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
