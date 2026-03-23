import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

describe('gateway config defaults', () => {
  it('uses the Render gateway domain as the production fallback', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-gateway-config-'));
    const previousEnv = {
      NODE_ENV: process.env.NODE_ENV,
      TICLAW_HOME: process.env.TICLAW_HOME,
      GATEWAY_URL: process.env.GATEWAY_URL,
      GATEWAY_HOSTPORT: process.env.GATEWAY_HOSTPORT,
      GATEWAY_HOST: process.env.GATEWAY_HOST,
      GATEWAY_PORT: process.env.GATEWAY_PORT,
      PORT: process.env.PORT,
    };

    delete process.env.GATEWAY_URL;
    delete process.env.GATEWAY_HOSTPORT;
    delete process.env.GATEWAY_HOST;
    delete process.env.GATEWAY_PORT;
    delete process.env.PORT;
    process.env.NODE_ENV = 'production';
    process.env.TICLAW_HOME = tempHome;

    try {
      vi.resetModules();
      const { readGatewayConfig } = await import('./gateway-config.js');
      expect(readGatewayConfig().gateway_url).toBe('wss://ticlaw-gateway.onrender.com');
    } finally {
      vi.resetModules();
      if (previousEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv.NODE_ENV;
      if (previousEnv.TICLAW_HOME === undefined) delete process.env.TICLAW_HOME;
      else process.env.TICLAW_HOME = previousEnv.TICLAW_HOME;
      if (previousEnv.GATEWAY_URL === undefined) delete process.env.GATEWAY_URL;
      else process.env.GATEWAY_URL = previousEnv.GATEWAY_URL;
      if (previousEnv.GATEWAY_HOSTPORT === undefined) delete process.env.GATEWAY_HOSTPORT;
      else process.env.GATEWAY_HOSTPORT = previousEnv.GATEWAY_HOSTPORT;
      if (previousEnv.GATEWAY_HOST === undefined) delete process.env.GATEWAY_HOST;
      else process.env.GATEWAY_HOST = previousEnv.GATEWAY_HOST;
      if (previousEnv.GATEWAY_PORT === undefined) delete process.env.GATEWAY_PORT;
      else process.env.GATEWAY_PORT = previousEnv.GATEWAY_PORT;
      if (previousEnv.PORT === undefined) delete process.env.PORT;
      else process.env.PORT = previousEnv.PORT;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
