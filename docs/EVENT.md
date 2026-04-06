# Tix Event System

This document describes the real-time event system used for communication between Tix Node and consumer applications.

## Architecture

The Node connects **outbound** to the Gateway via a persistent WebSocket. Consumer applications connect to the Gateway, which transparently relays events and API calls to the Node.

```
┌─────────────┐                  ┌─────────────────┐                  ┌──────────────┐
│  Tix     │  outbound WS     │  Tix Gateway  │   SSE / HTTP     │  Consumer    │
│  Node       │ ────────────▶   │  (relay)          │ ◀──────────────  │  App         │
│             │ ◀────────────   │                   │ ──────────────▶  │              │
└─────────────┘  sse_event /    └─────────────────┘  SSE data frames  └──────────────┘
                 api_response
```

**How it works:**

1. **API relay**: Consumer sends an HTTP request to the Gateway → Gateway wraps it as an `api_request` WebSocket message to the Node → Node processes it locally and returns an `api_response` → Gateway writes the HTTP response back to the consumer.
2. **SSE relay**: Consumer opens an SSE stream to the Gateway → Gateway sends `sse_subscribe` to the Node → Node subscribes to its own local SSE endpoint and forwards events as `sse_event` messages back through the WebSocket → Gateway writes these as SSE data frames to the consumer.

The Gateway does not interpret or transform events — it passes them through verbatim. All event types documented below are defined and emitted by the Node.

## Transport

- **SSE (Server-Sent Events)**: `GET /api/v1/agents/:agent_id/sessions/:session_id/stream`
- **WebSocket**: Available on the Node's HTTP server for bidirectional communication
- **Gateway relay**: When a Gateway is present, SSE streams are transparently relayed. Consumers connect to the Gateway URL and receive the same events as a direct connection.
- **Broadcast delivery**: `broadcastToChat(chatJid, event)` sends a JSON payload to all SSE/WS clients subscribed to that session

## Event Types

### `connected`

Sent immediately when a client subscribes to the SSE stream.

```json
{
  "type": "connected",
  "chat_jid": "web:agent-id:session-id",
  "agent_id": "agent-id",
  "session_id": "session-id"
}
```

### `computer_state`

Broadcast on every status transition. This is the **authoritative real-time status update** for session status.

```json
{
  "type": "computer_state",
  "chat_jid": "web:agent-id:session-id",
  "status": "idle",
  "activity": {
    "phase": "done",
    "action": "",
    "target": "",
    "elapsed_ms": 12345
  },
  "recent_logs": ["[done] "]
}
```

**Status values:**
| Status | Meaning |
|--------|---------|
| `idle` | Agent finished successfully or was interrupted |
| `busy` | Agent is actively processing (consumers may display this as `running`) |
| `error` | Agent encountered an error |
| `interrupted` | Agent was preempted (treated as `idle` on disk) |

### `progress`

Sent periodically while the agent is working, providing live progress information about the current tool or thinking phase.

```json
{
  "type": "progress",
  "category": "tool_use",
  "skill": "bash",
  "tool": "execute",
  "args": "ls -la",
  "target": "...",
  "elapsed_s": 5.2
}
```

### `progress_end`

Sent when the agent finishes processing and is about to deliver the reply. Consumers should clear any progress indicators upon receiving this event.

```json
{ "type": "progress_end" }
```

### `stream_delta`

Sent for real-time token streaming as the agent generates its response.

```json
{
  "type": "stream_delta",
  "text": "partial token",
  "full_text": "accumulated full text so far",
  "stream_id": "unique-stream-id",
  "seq": 42
}
```

**Fields:**
- `text`: Incremental delta text
- `full_text`: Complete accumulated text (more reliable, used when available)
- `stream_id`: Identifies the stream for deduplication
- `seq`: Monotonic sequence number for ordering and dedup

### `stream_end`

Sent when the streaming phase completes, just before the final `message` event. Consumers should finalize any in-progress streaming message (set `streaming: false`) upon receiving this.

```json
{
  "type": "stream_end",
  "stream_id": "unique-stream-id"
}
```

### `message`

Sent when the agent delivers a complete reply. This is the final, authoritative text of the bot response.

```json
{
  "type": "message",
  "chat_jid": "web:agent-id:session-id",
  "text": "Full reply text",
  "agent_id": "agent-id",
  "session_id": "session-id"
}
```

### `session_updated`

Sent when session metadata changes (e.g. auto-generated title).

```json
{
  "type": "session_updated",
  "session": {
    "session_id": "session-id",
    "title": "Generated title"
  }
}
```

### `artifact_updated`

Sent when files in the agent's workspace change (via filesystem watcher).

```json
{
  "type": "artifact_updated",
  "agent_id": "agent-id",
  "file": "relative/path/to/file",
  "event": "change"
}
```

## Event Lifecycle for a Typical Request

```
User sends message
    │
    ▼
[POST /runs] ──▶ storeMessage() ──▶ scheduleRun()
                                        │
                                        ▼
                                  processMessages()
                                        │
                                        ▼
                                  AgentComputer.run()
                                        │
                                  computer_state (busy)
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
              progress (N×)      stream_delta (N×)    computer_state
              progress_end            │                (idle/error)
                                      ▼
                                  stream_end
                                      │
                                      ▼
                                   message
```

1. **`computer_state`** (`busy`) — emitted when agent starts processing
2. **`progress`** — emitted periodically while agent is thinking/executing tools
3. **`stream_delta`** — emitted as the agent generates tokens
4. **`stream_end`** — emitted when streaming is complete
5. **`progress_end`** — emitted when reply is ready
6. **`message`** — emitted with the final complete reply
7. **`computer_state`** (`idle`/`error`) — emitted with terminal status

## Session Status Lifecycle

```
           ┌──────────┐    run() called    ┌──────────┐
           │          │ ────────────────▶   │          │
           │   idle   │                    │  running  │
           │          │ ◀────────────────   │  (busy)  │
           └──────────┘    success /        └──────────┘
                           interrupt              │
                                                  │ error
                                                  ▼
                                           ┌──────────┐
                                           │  error   │
                                           └──────────┘
```

**Persistence:** Status is written to `session.json` on disk via `updateSessionStatus()` in `store.ts`. On node restart, `cleanupStaleSessions()` resets any lingering `running` sessions to `idle`.

## Gateway Internal Protocol

When the Gateway is in use, events are wrapped in a WebSocket protocol between the Gateway and Node. These are internal to Tix — consumers never see them.

| WS Message Type | Direction | Purpose |
|-----------------|-----------|---------|
| `sse_subscribe` | Gateway → Node | Request to subscribe to an SSE stream at a given path |
| `sse_event` | Node → Gateway | Wraps an SSE event (contains `stream_key` + `event` payload) |
| `api_request` | Gateway → Node | Relayed HTTP API request (contains `method`, `path`, `body`) |
| `api_response` | Node → Gateway | HTTP response (contains `status`, `headers`, `body`) |
| `auth` | Node → Gateway | Authentication on connect |
| `enroll` | Node → Gateway | Enrollment with trust token |
| `report` | Node → Gateway | Periodic health report |

## Key Source Files

| File | Role |
|------|------|
| `node/src/core/computer.ts` | `AgentComputer` — sets status, calls `notifyState()` |
| `node/src/core/store.ts` | `updateSessionStatus()` — writes to disk |
| `node/src/index.ts` | `processMessages()` — creates computer, emits events via `onStateChange` |
| `node/src/channels/http.ts` | `broadcastToChat()` — SSE/WS delivery to direct clients |
| `node/src/core/gateway.ts` | Node-side gateway uplink — handles `sse_subscribe`, relays events back |
| `gateway/src/index.ts` | Gateway server — SSE relay, API relay, node WebSocket management |
| `node/src/core/dispatcher.ts` | Alternative computer manager (broadcasts `computer_state`) |
