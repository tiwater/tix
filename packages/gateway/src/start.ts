/**
 * Standalone TiClaw Gateway entrypoint.
 * Run with: node dist/start.js
 * Or via: pnpm --filter @ticlaw/gateway start
 */
import { startGateway } from './index.js';

startGateway().catch((err) => {
  console.error('[gateway] Failed to start:', err);
  process.exit(1);
});
