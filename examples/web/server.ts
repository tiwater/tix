/**
 * Tix Web — Reference implementation of a Tix controller.
 *
 * Demonstrates how to use @tiwater/claw-gateway to build a controller that:
 * - Accepts inbound WebSocket connections from nodes
 * - Provides a web UI for interacting with connected nodes
 * - Relays API requests from the UI to nodes
 *
 * Same code runs in both development and production:
 * - Dev:  Vite middlewareMode for HMR + SvelteKit dev
 * - Prod: SvelteKit adapter-node handler for built output
 *
 * Usage:
 *   pnpm dev    — development with HMR
 *   pnpm start  — production
 */

import http from 'node:http';
import { attachGateway, handleGatewayRequest } from '@tix/gateway';

const PORT = parseInt(process.env.PORT || '2756', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DEV = process.env.NODE_ENV !== 'production';

async function start() {
  const httpServer = http.createServer();

  // 1. Attach gateway WebSocket server (same in dev and prod)
  attachGateway(httpServer);

  // 2. Set up request handling
  if (DEV) {
    // Development: use Vite's documented middlewareMode API
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    httpServer.on('request', async (req, res) => {
      // Gateway API routes first (relays to node via WebSocket, including binary files)
      if (await handleGatewayRequest(req, res)) return;
      // Then Vite + SvelteKit dev server
      vite.middlewares(req, res);
    });

    console.log('[web] Development mode with Vite HMR');
  } else {
    // Production: use SvelteKit adapter-node handler
    const { handler } = await import('./build/handler.js');

    httpServer.on('request', async (req, res) => {
      // Gateway API routes first (relays to node via WebSocket, including binary files)
      if (await handleGatewayRequest(req, res)) return;
      // Then SvelteKit
      handler(req, res, () => {
        res.writeHead(404);
        res.end('Not found');
      });
    });

    console.log('[web] Production mode');
  }

  // 3. Start listening
  httpServer.listen(PORT, HOST, () => {
    console.log(`[web] Claw controller listening on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[web] Failed to start:', err);
  process.exit(1);
});
