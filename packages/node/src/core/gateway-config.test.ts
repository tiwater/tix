import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

describe('gateway config', () => {
  it('reads TICLAW_GATEWAY_URL from env', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-gateway-config-'));
    const previousEnv = {
      TICLAW_HOME: process.env.TICLAW_HOME,
      TICLAW_GATEWAY_URL: process.env.TICLAW_GATEWAY_URL,
    };

    process.env.TICLAW_HOME = tempHome;
    process.env.TICLAW_GATEWAY_URL = 'wss://my-gateway.example.com';

    try {
      vi.resetModules();
      const { readGatewayConfig } = await import('./gateway-config.js');
      expect(readGatewayConfig().gateway_url).toBe('wss://my-gateway.example.com');
    } finally {
      vi.resetModules();
      if (previousEnv.TICLAW_HOME === undefined) delete process.env.TICLAW_HOME;
      else process.env.TICLAW_HOME = previousEnv.TICLAW_HOME;
      if (previousEnv.TICLAW_GATEWAY_URL === undefined) delete process.env.TICLAW_GATEWAY_URL;
      else process.env.TICLAW_GATEWAY_URL = previousEnv.TICLAW_GATEWAY_URL;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('returns undefined gateway_url when not configured', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-gateway-config-'));
    const previousEnv = {
      TICLAW_HOME: process.env.TICLAW_HOME,
      TICLAW_GATEWAY_URL: process.env.TICLAW_GATEWAY_URL,
    };

    process.env.TICLAW_HOME = tempHome;
    delete process.env.TICLAW_GATEWAY_URL;

    try {
      vi.resetModules();
      const { readGatewayConfig } = await import('./gateway-config.js');
      expect(readGatewayConfig().gateway_url).toBeUndefined();
    } finally {
      vi.resetModules();
      if (previousEnv.TICLAW_HOME === undefined) delete process.env.TICLAW_HOME;
      else process.env.TICLAW_HOME = previousEnv.TICLAW_HOME;
      if (previousEnv.TICLAW_GATEWAY_URL === undefined) delete process.env.TICLAW_GATEWAY_URL;
      else process.env.TICLAW_GATEWAY_URL = previousEnv.TICLAW_GATEWAY_URL;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
