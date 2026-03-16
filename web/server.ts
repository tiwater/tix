/**
 * TiClaw Web — Reference implementation of a TiClaw controller.
 *
 * Demonstrates how to use @ticlaw/hub to build a controller that:
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

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { attachHub, handleHubRequest } from '@ticlaw/hub';

const PORT = parseInt(process.env.PORT || '2756', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DEV = process.env.NODE_ENV !== 'production';

// ── Workspace file serving ──

const TICLAW_HOME = path.join(os.homedir(), '.ticlaw');
const AGENTS_DIR = path.join(TICLAW_HOME, 'agents');

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain',
  '.csv': 'text/csv', '.xml': 'application/xml', '.zip': 'application/zip',
};

function getWorkspace(agentId: string): string {
  const configPath = path.join(AGENTS_DIR, agentId, 'agent-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.workspace) {
        const ws = config.workspace.startsWith('~')
          ? path.join(os.homedir(), config.workspace.slice(1))
          : config.workspace;
        return ws;
      }
    }
  } catch { /* ignore */ }
  return path.join(os.homedir(), `workspace-${agentId}`);
}

/**
 * Handle /api/workspace/* requests directly (bypasses hub JSON relay).
 * Returns true if handled, false if not a workspace request.
 *
 * NOTE: This only works when web server and node are co-located (same machine).
 * For remote nodes, the hub relay protocol needs binary message support.
 * TODO: Add binary relay via WebSocket for remote node file access.
 */
function handleWorkspaceRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/api\/workspace\/(.+)$/);
  if (!match || req.method !== 'GET') return false;

  const agentId = url.searchParams.get('agent_id');
  if (!agentId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'agent_id query parameter is required' }));
    return true;
  }

  const relPath = decodeURIComponent(match[1]);
  const normalized = path.normalize(relPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid path' }));
    return true;
  }

  const workspace = getWorkspace(agentId);
  const filePath = path.join(workspace, normalized);

  // Verify resolved path stays within workspace
  if (!filePath.startsWith(workspace + path.sep) && filePath !== workspace) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Path outside workspace' }));
    return true;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return true;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath).map((name) => {
      const entryPath = path.join(filePath, name);
      const entryStat = fs.statSync(entryPath);
      return {
        name,
        type: entryStat.isDirectory() ? 'directory' : 'file',
        size: entryStat.isDirectory() ? undefined : entryStat.size,
        modified: entryStat.mtime.toISOString(),
      };
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ path: relPath, entries }));
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=60',
    'Access-Control-Allow-Origin': '*',
    'Content-Disposition': mime === 'application/octet-stream'
      ? `attachment; filename="${path.basename(filePath)}"`
      : 'inline',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ── Main ──

async function start() {
  const httpServer = http.createServer();

  // 1. Attach hub WebSocket server (same in dev and prod)
  attachHub(httpServer);

  // 2. Set up request handling
  if (DEV) {
    // Development: use Vite's documented middlewareMode API
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    httpServer.on('request', (req, res) => {
      // Workspace files first (binary-safe, bypasses hub JSON relay)
      if (handleWorkspaceRequest(req, res)) return;
      // Hub API routes
      if (handleHubRequest(req, res)) return;
      // Then Vite + SvelteKit dev server
      vite.middlewares(req, res);
    });

    console.log('[web] Development mode with Vite HMR');
  } else {
    // Production: use SvelteKit adapter-node handler
    const { handler } = await import('./build/handler.js');

    httpServer.on('request', (req, res) => {
      // Workspace files first (binary-safe, bypasses hub JSON relay)
      if (handleWorkspaceRequest(req, res)) return;
      // Hub API routes
      if (handleHubRequest(req, res)) return;
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
    console.log(`[web] TiClaw controller listening on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[web] Failed to start:', err);
  process.exit(1);
});
