# Integrating with Tix Gateway

Tix follows an **N:1 architecture**: many worker nodes connect outbound to
one gateway. Controller platforms like **Supen** talk to the gateway over HTTP
to drive agent conversations on any connected node.

```
Supen (browser / server)
  │  HTTP REST + SSE
  ▼
Gateway  ws://host:2755   ← your integration point
  │  WebSocket (persistent)
  ▼
Node(s)  :2756, :2757 …  ← worker machines running agents
```

---

## Quick Start

### 1. Start the gateway

```bash
# Standalone (development)
pnpm --filter @tix/gateway dev

# With auth enabled (production)
TIX_GATEWAY_API_KEY=your-secret pnpm --filter @tix/gateway start
```

### 2. Start one or more nodes

```bash
# Node 1 (connects to gateway automatically)
TIX_GATEWAY_URL=ws://localhost:2755 pnpm --filter @tix/computer dev

# Node 2 (different HTTP port)
HTTP_PORT=2757 TIX_GATEWAY_URL=ws://localhost:2755 pnpm --filter @tix/computer dev
```

### 3. Verify connectivity

```bash
curl http://localhost:2755/health
# {"status":"ok","gateway":true,"nodes_connected":1,"uptime_s":12}

curl http://localhost:2755/api/gateway/nodes
# {"nodes":[{"node_id":"my-machine","trusted":true,"online":true,"last_seen":"..."}]}
```

---

## Authentication

Set `TIX_GATEWAY_API_KEY` on the gateway. All HTTP requests (except `/health` and
`OPTIONS` preflight) must carry the header:

```
Authorization: Bearer <TIX_GATEWAY_API_KEY>
```

If `TIX_GATEWAY_API_KEY` is not set, the gateway is in **open mode** — fine for
local development, not for production.

### Node-side security posture

Even when you primarily integrate through the gateway, the node should still be
run in a secure posture:

- set `HTTP_API_KEY` for node admin/API protection
- set `ALLOWED_ORIGINS` if a browser-based UI may call the node directly
- rely on loopback-only fallback only for local development

In other words: reverse proxies, private networking, or Render private services
are defense-in-depth — not substitutes for built-in auth.

---

## Core API (via gateway relay)

All standard node API calls are proxied transparently. With one node connected
you need no special headers. With multiple nodes, use `X-Node-Id` to target a
specific one.

```
X-Node-Id: my-machine                     # optional — omit to use first connected node
Authorization: Bearer key                 # required if TIX_GATEWAY_API_KEY is set
```

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/agents` | List all agents |
| `POST` | `/api/v1/agents` | Create agent |
| `GET` | `/api/v1/agents/:id` | Get agent config |
| `PATCH` | `/api/v1/agents/:id` | Update agent config |
| `DELETE` | `/api/v1/agents/:id` | Delete agent |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/agents/:id/sessions` | List sessions |
| `POST` | `/api/v1/agents/:id/sessions` | Create session |
| `GET` | `/api/v1/agents/:id/sessions/:sid` | Get session |
| `PATCH` | `/api/v1/agents/:id/sessions/:sid` | Update title |
| `DELETE` | `/api/v1/agents/:id/sessions/:sid` | Delete session |
| `GET` | `/api/v1/agents/:id/sessions/:sid/messages` | Chat history |
| `POST` | `/api/v1/agents/:id/sessions/:sid/messages` | Send message |
| `GET` | `/api/v1/agents/:id/sessions/:sid/stream` | **SSE stream** |

### Pairing

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/pairings` | List bindings and pending pairings |
| `POST` | `/api/v1/pairings/approve` | Approve pair code and create/update binding |
| `DELETE` | `/api/v1/pairings` | Remove binding by `chat_jid` |

See also: `docs/PAIRING_API.md` for request/response examples and UI-oriented integration notes.

### Node / System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Gateway health (native, no relay) |
| `GET` | `/api/gateway/nodes` | List connected nodes |
| `GET` | `/api/v1/node` | Node status |
| `GET` | `/api/v1/skills` | List skills |
| `GET` | `/api/v1/models` | Available LLM models |

---

## Real-time Streaming (SSE)

Subscribe to a session stream to receive agent responses as they are generated:

```js
const url = `http://gateway:2755/api/v1/agents/${agentId}/sessions/${sessionId}/stream`;
const es = new EventSource(url, {
  headers: { Authorization: 'Bearer your-key' },
});

es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'delta') console.log(event.text);
  if (event.type === 'done') es.close();
};
```

The gateway relays the SSE stream seamlessly from the node through the
persistent WebSocket connection — no direct access to the node is needed.

---

## Multi-Node Routing

With multiple nodes connected, target a specific one by its `node_id`:

```bash
# Send a message to agent on node "office-machine"
curl -X POST http://localhost:2755/api/v1/agents/default/sessions/s1/messages \
  -H "X-Node-Id: office-machine" \
  -H "Authorization: Bearer key" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!"}'
```

Without `X-Node-Id`, the gateway routes to the **first connected trusted node**.

---

## Render deployment (gateway web service + node background worker)

The repository includes a `render.yaml` Blueprint that deploys the Tix
gateway and the Tix node as **two separate Docker services**:

- `tix-gateway` (`type: web`) is the public HTTPS/WebSocket entrypoint for your consumer app.
- `tix-node` (`type: worker`) runs as a background worker and connects outward to the gateway.

### How the Render wiring works

1. Set `TIX_GATEWAY_EXTERNAL_URL` on the gateway service to its public URL.
2. The provisioner injects `TIX_GATEWAY_URL`, `TIX_GATEWAY_SECRET`, and `TIX_NODE_NAME` into each cloud node.
3. Your consumer app calls the public gateway URL and never calls nodes directly.

### Required secrets on Render

- `TIX_GATEWAY_API_KEY`: bearer token your consumer app sends to the gateway.
- `TIX_GATEWAY_SECRET`: auto-generated HMAC secret; shared to nodes at provision time.
- `TIX_GATEWAY_EXTERNAL_URL`: the gateway's own public `wss://` URL (needed to inject into cloud nodes).
- `LLM_API_KEY`: model provider key for the node runtime.

### Consumer app connection

Point your consumer application at the **gateway** service URL, for example:

```
https://tix-gateway.onrender.com
```

Use that base URL for both REST and SSE traffic, and include:

```
Authorization: Bearer <TIX_GATEWAY_API_KEY>
```

The node runs as a background worker and should not be exposed publicly.

---

## Environment Variables

### Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | *(platform-managed)* | Preferred HTTP port in containers/platforms like Render |
| `TIX_GATEWAY_API_KEY` | *(none)* | Controller auth key. Empty = open mode |
| `TIX_GATEWAY_SECRET` | *(none)* | HMAC secret for node authentication |
| `TIX_GATEWAY_ALLOWED_NODE_IDS` | *(all)* | CSV allowlist of permitted node IDs |
| `TIX_GATEWAY_EXTERNAL_URL` | *(none)* | Gateway's own public WS URL (used by provisioner) |

### Node

| Variable | Default | Description |
|----------|---------|-------------|
| `TIX_GATEWAY_URL` | *(none — required)* | WebSocket URL of the gateway |
| `TIX_NODE_NAME` | *(hostname)* | This node's identity (sent during gateway auth) |
| `HTTP_PORT` | `2756` | Node's local HTTP port |
| `TIX_GATEWAY_SECRET` | *(none)* | Must match the gateway's secret |
| `TIX_GATEWAY_TRUST_TOKEN` | *(none)* | One-time enrollment token |

---

## Node Authentication Flow

Nodes authenticate to the gateway using **HMAC tokens** when `TIX_GATEWAY_SECRET`
is set on both sides:

1. Node computes `HMAC-SHA256(secret, "${nodeId}:${timestamp}")`.
2. Node sends `{ type: "auth", token: "${nodeId}.${ts}.${hmac}" }` over WebSocket.
3. Gateway verifies the HMAC and timestamp (5-minute window, replay-safe).

For first-time enrollment, use `TIX_GATEWAY_TRUST_TOKEN` (a one-time secret issued
via the node's enroll API).
