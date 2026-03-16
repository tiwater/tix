---
description: How to run the dev server and access the web UI
---

## Dev Server

// turbo
1. Start the dev server:
```bash
pnpm dev
```

## Ports

| Service | Port | Notes |
|---------|------|-------|
| Web UI  | 2756 | `web/server.ts` — the primary dev URL |
| Hub     | 2755 | `hub/src/index.ts` — WebSocket + API |
| Vite HMR| 5173 | SvelteKit dev server (proxied through 2756) |

## Access

- **Web UI**: http://localhost:2756
- **API**: http://localhost:2756/api/*
- **Health**: http://localhost:2756/health
