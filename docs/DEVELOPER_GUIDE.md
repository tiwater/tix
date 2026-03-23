# TiClaw Developer Guide

How to integrate TiClaw as an AI backend via the gateway relay and node APIs.

---

## Overview

Topology:
- **Gateway** (`@ticlaw/gateway`): WebSocket node gateway + HTTP relay + SSE relay
- **Node** (TiClaw): actual runtime (channels, storage, runner, scheduler)

Your app usually talks only to gateway HTTP endpoints; gateway relays to the active node.

---

## 1. Install the Gateway

```bash
npm install @ticlaw/gateway
# or
pnpm add @ticlaw/gateway
```

---

## 2. Embed the Gateway

### Attach to existing server

```ts
import http from 'node:http';
import { attachGateway, handleGatewayRequest } from '@ticlaw/gateway';

const server = http.createServer((req, res) => {
  if (handleGatewayRequest(req, res)) return;
  res.writeHead(404);
  res.end('not found');
});

attachGateway(server);
server.listen(3000);
```

### Standalone

```ts
import { startGateway } from '@ticlaw/gateway';

await startGateway({ port: 3000 });
```

---

## 3. Gateway API Surface

### Gateway-native endpoint

- `GET /api/gateway/nodes`

### Relayed endpoint prefixes

Gateway relays these to node:
- `/api/*`
- `/runs*`
- `/health`

SSE is relayed for:
- `GET /runs/:id/stream?...`

---

## 4. Node API Reference (Current)

### Chat / Streaming

- `POST /runs`
- `GET /runs/:id/stream?agent_id=<id>&session_id=<id>`

`POST /runs` body:

```json
{
  "agent_id": "web-agent",
  "session_id": "web-session",
  "sender": "web-user",
  "content": "Hello"
}
```

Possible trust failure:

```json
{
  "error": "node_not_trusted",
  "trust_state": "discovered_untrusted"
}
```

### Agents

- `GET /api/agents`
- `POST /api/agents`

`POST /api/agents` body (current):

```json
{ "name": "My Agent" }
```

### Sessions

- `GET /api/sessions?agent_id=<id>`
- `POST /api/sessions`
- `DELETE /api/sessions/:id`

`POST /api/sessions` body:

```json
{
  "agent_id": "my-agent",
  "session_id": "optional-custom-session"
}
```

### Messages

- `GET /api/messages?agent_id=<id>&session_id=<id>&limit=50`

### Schedules

- `GET /api/schedules?agent_id=<id>`
- `POST /api/schedules`
- `POST /api/schedules/:id/toggle`
- `DELETE /api/schedules/:id`
- `POST /api/schedules/refresh`

`POST /api/schedules` body:

```json
{
  "agent_id": "my-agent",
  "prompt": "Daily report",
  "cron": "0 9 * * *",
  "target_jid": "web:my-agent:web-session"
}
```

`POST /api/schedules/:id/toggle` body:

```json
{ "status": "paused" }
```

### Skills

- `GET /api/skills`
- `POST /api/skills/:name/enable`
- `POST /api/skills/:name/disable`

### Node / Enrollment

- `GET /api/node`
- `POST /api/node/trust`
- `GET /api/enroll/status`
- `POST /api/enroll/token`
- `POST /api/enroll/verify`
- `POST /api/enroll/revoke`
- `POST /api/enroll/suspend`
- `POST /api/enroll/reenroll`

### Misc

- `GET /api/mind` (long-term view: `SOUL.md` + `MEMORY.md`)
- `GET /api/mind/files` (root mind files: `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`)
- `GET /api/workspace/:relativePath?agent_id=<id>`
- `GET /api/tasks` (currently often empty/stub)
- `GET /agents`
- `GET /health`

---

## 5. SSE Event Types

Common events from `/runs/.../stream`:
- `connected`
- `progress`
- `progress_end`
- `stream_delta` (includes `stream_id`, `seq`, `text`, `full_text`)
- `message` (authoritative final output)

---

## 6. Gateway Exports

`@ticlaw/gateway` exports:
- `attachGateway(server, opts?)`
- `handleGatewayRequest(req, res)`
- `startGateway(opts?)`
- `listNodes()`
- `getActiveNode()`
- `relayToNode(method, path, body?, timeout?)`
- `NodeInfo`, `GatewayOptions`, `StartGatewayOptions`, `RelayResult`

---

## 7. Error Handling

Typical relay-level errors:

| Status | Error | Meaning |
|---|---|---|
| `503` | `no_node_connected` | no active node connection |
| `504` | `timeout` | node relay timeout |

Typical node-level errors:

| Status | Error | Meaning |
|---|---|---|
| `403` | `node_not_trusted` | node trust_state is not `trusted` |
| `400` | protocol validation errors | missing required input |
| `404` | `not_found` | unknown route/resource |

---

## 8. Node Configuration

Common node env:

```env
GATEWAY_URL=wss://your-gateway.example.com
GATEWAY_TRUST_TOKEN=your-token
TC_NODE_NAME=my-node
LLM_API_KEY=your-llm-key
LLM_BASE_URL=https://api.anthropic.com
```

---

## 9. Security Caveat (Current)

Current gateway handshake marks `enroll`/`auth` connections as trusted in-memory without strong verification.

For production today:
1. Keep gateway behind controlled network access.
2. Treat node-side enrollment trust checks as required.
3. Plan gateway-side auth hardening before zero-trust/public deployments.

---

## 10. Planned API Evolution

1. Gateway-side strong auth verification for node enrollment/auth handshakes.
2. Schedule API parity improvements (full update endpoint, optional agent-scoped aliases).
3. Stronger task/executor telemetry endpoints beyond stub-like responses.
4. Stream replay/recovery APIs keyed by sequence cursor.

---

## 11. Related Specs

- Memory system and semantic retrieval roadmap: `docs/MEMORY.md`

---

*Last Updated: March 23, 2026*
