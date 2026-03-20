# Integrating with TiClaw Gateway

TiClaw follows an **N:1 architecture**: many worker nodes connect outbound to
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
pnpm --filter @ticlaw/gateway dev

# With auth enabled (production)
GATEWAY_API_KEY=your-secret pnpm --filter @ticlaw/gateway start
```

### 2. Start one or more nodes

```bash
# Node 1 (connects to gateway automatically)
GATEWAY_URL=ws://localhost:2755 pnpm --filter @ticlaw/node dev

# Node 2 (different HTTP port)
HTTP_PORT=2757 GATEWAY_URL=ws://localhost:2755 pnpm --filter @ticlaw/node dev
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

Set `GATEWAY_API_KEY` on the gateway. All HTTP requests (except `/health` and
`OPTIONS` preflight) must carry the header:

```
Authorization: Bearer <GATEWAY_API_KEY>
```

If `GATEWAY_API_KEY` is not set, the gateway is in **open mode** — fine for
local development, not for production.

---

## Core API (via gateway relay)

All standard node API calls are proxied transparently. With one node connected
you need no special headers. With multiple nodes, use `X-Node-Id` to target a
specific one.

```
X-Node-Id: my-machine      # optional — omit to use first connected node
Authorization: Bearer key  # required if GATEWAY_API_KEY is set
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

## Render deployment (separate gateway + node containers)

The repository includes a `render.yaml` Blueprint that deploys the TiClaw
gateway and the TiClaw node as **two separate Docker services**:

- `ticlaw-gateway` (`type: web`) is the public HTTPS/WebSocket entrypoint for your consumer app.
- `ticlaw-node` (`type: pserv`) stays private on Render's internal network and connects outward to the gateway.

### How the Render wiring works

1. Render assigns `ticlaw-gateway` an internal `host:port`.
2. The Blueprint injects that value into the node as `GATEWAY_HOSTPORT`.
3. The node turns `GATEWAY_HOSTPORT` into `ws://<host:port>` automatically at startup.
4. Your consumer app should call the public gateway URL and never call the node directly.

### Required secrets on Render

- `GATEWAY_API_KEY`: bearer token your consumer app sends to the gateway.
- `LLM_API_KEY`: model provider key for the node runtime.
- `LLM_BASE_URL`: optional override for the model endpoint used by the node.

`GATEWAY_SECRET` is generated once on the gateway and shared to the node via a
Blueprint service reference so the node can authenticate with HMAC.

### Consumer app connection

Point your consumer application at the **gateway** service URL, for example:

```
https://ticlaw-gateway.onrender.com
```

Use that base URL for both REST and SSE traffic, and include:

```
Authorization: Bearer <GATEWAY_API_KEY>
```

The node service remains private and should not be exposed publicly.

---

## Environment Variables

### Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | *(platform-managed)* | Preferred HTTP port in containers/platforms like Render |
| `GATEWAY_PORT` | `2755` | Port the gateway listens on outside platform-managed environments |
| `GATEWAY_API_KEY` | *(none)* | Controller auth key. Empty = open mode |
| `GATEWAY_SECRET` | *(none)* | HMAC secret for node authentication |
| `GATEWAY_ALLOWED_NODE_IDS` | *(all)* | CSV allowlist of permitted node IDs |

### Node

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `ws://localhost:2755` | Full WebSocket URL for the gateway |
| `GATEWAY_HOSTPORT` | *(none)* | Internal `<host>:<port>` pair; node converts it to `ws://...` automatically |
| `HTTP_PORT` | `2756` | Node's local HTTP port |
| `GATEWAY_SECRET` | *(none)* | Must match gateway's secret |
| `GATEWAY_TRUST_TOKEN` | *(none)* | One-time enrollment token |

---

## Node Authentication Flow

Nodes authenticate to the gateway using **HMAC tokens** when `GATEWAY_SECRET`
is set on both sides:

1. Node computes `HMAC-SHA256(secret, "${nodeId}:${timestamp}")`.
2. Node sends `{ type: "auth", token: "${nodeId}.${ts}.${hmac}" }` over WebSocket.
3. Gateway verifies the HMAC and timestamp (5-minute window, replay-safe).

For first-time enrollment, use `GATEWAY_TRUST_TOKEN` (a one-time secret issued
via the node's enroll API).
