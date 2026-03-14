# TiClaw Developer Guide

How to integrate TiClaw as an AI compute backend into your own project.

---

## Overview

TiClaw follows a **hub/node** topology. Your application embeds the **hub** (a lightweight WebSocket server), which accepts connections from one or more **nodes** (TiClaw instances running the AI agent). Your app communicates with nodes entirely through the hub's REST and SSE APIs.

```
┌─────────────────────────────────────┐
│         Your Application            │
│                                     │
│  ┌───────────────────────────────┐  │
│  │         @ticlaw/hub           │  │
│  │  • WebSocket server (nodes)   │  │
│  │  • REST relay middleware      │  │
│  │  • SSE stream proxy           │  │
│  └──────────┬────────────────────┘  │
│             │ WebSocket              │
└─────────────┼───────────────────────┘
              │
    ┌─────────▼─────────┐
    │   TiClaw Node(s)  │
    │   (AI agent runs) │
    └───────────────────┘
```

---

## 1. Install the Hub

```bash
npm install @ticlaw/hub
# or
pnpm add @ticlaw/hub
```

The hub has a single dependency (`ws`) and no TiClaw core dependencies.

---

## 2. Embed the Hub

### Option A: Attach to an Existing HTTP Server

```typescript
import http from 'node:http';
import { attachHub, handleHubRequest } from '@ticlaw/hub';

const server = http.createServer((req, res) => {
  // Let the hub handle API and relay routes first
  if (handleHubRequest(req, res)) return;

  // Your app handles everything else
  res.writeHead(200);
  res.end('Hello from my app');
});

// Attach WebSocket server for node connections
attachHub(server);

server.listen(3000, () => {
  console.log('Server + hub running on :3000');
});
```

### Option B: Standalone Hub

```typescript
import { startHub } from '@ticlaw/hub';

await startHub({
  port: 3000,
  onRequest: (req, res) => {
    // Optional: handle non-hub routes
    res.writeHead(404);
    res.end('Not found');
  },
});
```

### Option C: With a Framework (Express, SvelteKit, etc.)

The `web/server.ts` in this repo is a reference implementation using SvelteKit:

```typescript
import http from 'node:http';
import { attachHub, handleHubRequest } from '@ticlaw/hub';

const server = http.createServer();
attachHub(server);

server.on('request', (req, res) => {
  if (handleHubRequest(req, res)) return;
  // Pass to your framework's handler
  frameworkHandler(req, res);
});

server.listen(3000);
```

---

## 3. Hub API Reference

All routes below are handled by `handleHubRequest()`. They are either served directly by the hub or relayed to the connected node.

### Hub-Native Routes

These are handled by the hub itself (no node required):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/hub/nodes` | List connected nodes |

**Response:**
```json
{
  "nodes": [
    {
      "node_id": "my-mac-mini",
      "node_fingerprint": "abc123...",
      "trusted": true
    }
  ]
}
```

### Node-Relayed Routes

These are forwarded to the active node via WebSocket and the response is returned. Requires at least one connected and trusted node.

#### Chat / Agent Interaction

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/runs` | Send a message to an agent |
| `GET` | `/runs/:id/stream` | SSE stream for real-time responses |

#### Agent Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create a new agent |

#### Session Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/messages` | Get message history for a session |

#### Schedule Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/schedules` | List all schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `POST` | `/api/schedules/:id/toggle` | Pause/resume a schedule |

#### Node Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/node` | Node status + enrollment info |
| `POST` | `/api/node/trust` | Trust the connected node |

#### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills` | List available skills |
| `GET` | `/api/tasks` | List active tasks |
| `GET` | `/api/mind` | Get agent mind state |
| `GET` | `/api/mind/files` | Get mind files (SOUL.md, etc.) |
| `GET` | `/health` | Health check |

---

## 4. Chat Integration

### Sending a Message

```typescript
const res = await fetch('/runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_id: 'web-agent',
    session_id: 'my-session',
    sender: 'user-123',
    content: 'Hello, can you help me?',
  }),
});
```

If the node is not trusted, the response will be `403` with:
```json
{ "error": "node_not_trusted", "trust_state": "discovered_untrusted" }
```

### Streaming Responses (SSE)

Connect to the SSE stream to receive real-time agent responses:

```typescript
const agentId = 'web-agent';
const sessionId = 'my-session';
const url = `/runs/web-run/stream?agent_id=${agentId}&session_id=${sessionId}`;

const eventSource = new EventSource(url);

eventSource.onmessage = (ev) => {
  const data = JSON.parse(ev.data);

  switch (data.type) {
    case 'connected':
      // Stream established
      console.log('Connected:', data.chat_jid);
      break;

    case 'stream_delta':
      // Token-level streaming (append to current message)
      process.stdout.write(data.text);
      break;

    case 'message':
      // Final complete message
      console.log('\nAgent:', data.text);
      break;
  }
};
```

### Loading Message History

```typescript
const res = await fetch(
  `/api/messages?agent_id=web-agent&session_id=my-session&limit=50`
);
const { messages } = await res.json();
// messages: [{ id, role, text, time }, ...]
```

---

## 5. Node Management

### Checking Node Status

```typescript
const res = await fetch('/api/node');
const nodeInfo = await res.json();
// {
//   hostname: "my-mac-mini",
//   enrollment: {
//     trust_state: "trusted",
//     fingerprint: "abc123...",
//     trusted_at: "2026-03-14T...",
//     failed_attempts: 0
//   },
//   executor: {
//     active_tasks: 1,
//     queued_tasks: 0,
//     total_slots: 5
//   }
// }
```

### Trusting a Node

When a node first connects, it starts in `discovered_untrusted` state. Trust it via:

```typescript
await fetch('/api/node/trust', { method: 'POST' });
```

### Listing Connected Nodes

This hub-native endpoint works even without any node:

```typescript
const res = await fetch('/api/hub/nodes');
const { nodes } = await res.json();
// nodes: [{ node_id, node_fingerprint, trusted }]
```

---

## 6. Agent & Session Management

### Creating an Agent

```typescript
await fetch('/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ agent_id: 'my-agent', name: 'My Agent' }),
});
```

### Creating a Session

```typescript
await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_id: 'my-agent',
    session_id: 'session-001',
    channel: 'web',
  }),
});
```

---

## 7. Hub Exports

The `@ticlaw/hub` package exports:

| Export | Type | Description |
|--------|------|-------------|
| `attachHub(server, opts?)` | Function | Attach WebSocket hub to an HTTP server |
| `handleHubRequest(req, res)` | Function | HTTP middleware — returns `true` if handled |
| `startHub(opts?)` | Function | Create and start a standalone hub server |
| `listNodes()` | Function | Get currently connected nodes |
| `getActiveNode()` | Function | Get the first trusted connected node |
| `relayToNode(method, path, body?, timeout?)` | Function | Relay an HTTP request to the active node |
| `NodeInfo` | Interface | `{ node_id, node_fingerprint, trusted }` |
| `HubOptions` | Interface | Options for `attachHub` |
| `StartHubOptions` | Interface | Options for `startHub` |
| `RelayResult` | Interface | `{ status, headers, body }` |

### HubOptions

```typescript
interface HubOptions {
  logger?: Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'>;
  handleUpgrade?: boolean; // Use noServer mode for manual WebSocket upgrades
}
```

### StartHubOptions

```typescript
interface StartHubOptions extends HubOptions {
  port?: number;            // Default: 2755
  host?: string;            // Default: '0.0.0.0'
  onRequest?: (req, res) => void;  // Handle non-hub routes
}
```

---

## 8. Error Handling

| Status | Error | Meaning |
|--------|-------|---------|
| `403` | `node_not_trusted` | Node is connected but not trusted — call `POST /api/node/trust` |
| `503` | `no_node_connected` | No node is connected to the hub |
| `504` | `timeout` | Node did not respond within the timeout (default: 15s) |

---

## 9. Configuring a Node

To connect a TiClaw node to your hub, configure these environment variables on the node:

```env
HUB_URL=wss://your-hub.example.com
HUB_TRUST_TOKEN=your-token
TC_NODE_NAME=my-node
LLM_API_KEY=your-llm-key
LLM_BASE_URL=https://api.anthropic.com  # or compatible provider
```

The node connects outbound to the hub — no public IP or port forwarding required.

---

*Last Updated: March 2026*
