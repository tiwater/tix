# TiClaw Architecture

## Overview

TiClaw is a multi-channel AI agent runtime built on Node.js. It receives messages from external platforms (Discord, Feishu, DingTalk, web UI), dispatches them to an LLM agent powered by the Claude Agent SDK, and relays responses back through the originating channel.

The system follows a **hub/node** topology for cloud deployment: a public-facing **Hub** accepts WebSocket connections from one or more **Nodes** (TiClaw instances), while also serving the web UI. Nodes can also run standalone with direct channel connections.

---

## System Diagram

```
                         ┌──────────────────────────────────┐
                         │           Hub  (@ticlaw/hub)      │
                         │   WebSocket server + web UI proxy │
                         │   ┌────────────────────────────┐  │
                         │   │  /api/hub/nodes (REST)     │  │
                         │   │  /runs (relay to node)     │  │
                         │   │  /runs/:id/stream (SSE)    │  │
                         │   └────────────────────────────┘  │
                         └──────┬──────────────┬─────────────┘
                                │ WebSocket    │ WebSocket
                    ┌───────────┘              └───────────┐
                    ▼                                      ▼
          ┌──────────────────┐                  ┌──────────────────┐
          │  Node (TiClaw)   │                  │  Node (TiClaw)   │
          │  ┌────────────┐  │                  │  ┌────────────┐  │
          │  │ Channels   │  │                  │  │ Channels   │  │
          │  │ Discord    │  │                  │  │ HTTP/SSE   │  │
          │  │ Feishu     │  │                  │  │ DingTalk   │  │
          │  │ HTTP/SSE   │  │                  │  │ ACP        │  │
          │  │ Hub Client │  │                  │  │ Hub Client │  │
          │  └─────┬──────┘  │                  │  └────────────┘  │
          │        │         │                  │                  │
          │  ┌─────▼──────┐  │                  └──────────────────┘
          │  │ Message    │  │
          │  │ Loop       │  │
          │  │ (poll 2s)  │  │
          │  └─────┬──────┘  │
          │        │         │
          │  ┌─────▼──────┐  │
          │  │ AgentRunner │  │
          │  │ Claude SDK  │  │
          │  │ (query())   │  │
          │  └─────┬──────┘  │
          │        │         │
          │  ┌─────▼──────┐  │
          │  │ Filesystem  │  │
          │  │ Store       │  │
          │  │ (~/.ticlaw/)│  │
          │  └────────────┘  │
          └──────────────────┘
```

---

## Core Components

### 1. Channel Registry (`src/channels/registry.ts`)

Channels self-register via `registerChannel(name, factory)` at module import time. The barrel file `src/channels/index.ts` imports all active channels. At startup, the main process iterates registered channels, instantiates each via its factory, and calls `connect()`.

**Active channels:**
- **Discord** (`discord.ts`) — `dc:` JID prefix
- **HTTP/SSE** (`http.ts`) — `web:` JID prefix, serves REST API + SSE streaming
- **Hub Client** (`hub-client.ts`) — `hub:` JID prefix, connects node to hub
- **ACP** (`acp.ts`) — Agent Communication Protocol bridge
- **DingTalk** (`dingtalk/`) — DingTalk bot stream
- **Feishu** (`feishu/`) — Lark/Feishu long connection (currently removed from barrel)

### 2. Message Loop (`src/index.ts`)

A polling loop runs every 2 seconds, scanning all registered projects for new messages. When a trigger match is found (e.g., `@Shaw`), the message is dispatched to `processMessages()`. Web channel messages are dispatched immediately (event-driven) without waiting for the poll cycle.

A per-channel mutex (`activeAgentLocks`) prevents overlapping agent runs for the same chat.

### 3. Agent Runner (`src/core/runner.ts`)

Wraps the `@anthropic-ai/claude-agent-sdk` `query()` generator. Each invocation:
1. Loads mind files (SOUL.md, IDENTITY.md, USER.md, MEMORY.md) as system prompt
2. Loads active skills as additional context
3. Streams LLM tokens back via callbacks
4. Executes in the agent's workspace directory

The runner resolves the Claude CLI path from the SDK package and spawns it with configurable LLM provider (Anthropic, BigModel/MiniMax via `LLM_BASE_URL`).

### 4. Filesystem Store (`src/core/store.ts`)

All persistent data lives under `~/.ticlaw/` as plain files:

| Data | Format | Path |
|------|--------|------|
| Agents | JSON | `agents/{id}/agent.json` |
| Sessions | JSON | `agents/{id}/sessions/{sid}/session.json` |
| Messages | JSONL (append-only) | `agents/{id}/sessions/{sid}/messages.jsonl` |
| Schedules | JSON | `agents/{id}/schedules/{id}.json` |
| Router state | JSON | `router-state.json` |
| Registered groups | JSON | `registered-groups.json` |
| Enrollment | JSON | `security/enrollment-state.json` |

No SQLite. The filesystem IS the database.

### 5. Hub (`hub/src/index.ts`)

Standalone `@ticlaw/hub` package with zero core dependencies. Accepts WebSocket connections from nodes, tracks connected nodes, and relays HTTP requests to the active node. The hub can be embedded into any Node.js server via `attachHub()`.

Key flows:
- **Enroll/Auth**: Node sends `{type: 'enroll', node_id, node_fingerprint}` on connect
- **Relay**: Hub forwards incoming HTTP requests to the active node via WebSocket and returns the response
- **SSE Bridge**: Hub proxies SSE streams from nodes to web clients

### 6. Task Scheduler (`src/task-scheduler.ts`)

Runs a polling loop (60s interval) checking for due scheduled tasks. Supports cron expressions, intervals, and one-time tasks. Tasks execute through the same `runAgent()` path as regular messages.

---

## Data Flow

```
1. Channel receives message
   ├── Discord: gateway event → onMessage callback
   ├── HTTP/SSE: POST /runs → direct dispatch
   └── Hub: WebSocket relay → local HTTP handler

2. Message stored to JSONL file

3. Message loop (2s poll) or event-driven dispatch
   └── Trigger pattern check (@AssistantName)

4. processMessages()
   ├── /enroll commands → enrollment control plane
   ├── /skills commands → skills registry
   └── Regular messages → runAgent()

5. AgentRunner (Claude Agent SDK)
   ├── Loads mind files + skills context
   ├── Streams tokens via onEvent callback
   └── Final response via onReply callback

6. Response relayed back through originating channel
   └── Stored as bot message in JSONL
```

---

## Deployment Topology

### Standalone (Development)
Node runs directly with all channels connected. `pnpm dev` or `pnpm start`.

### Hub + Node (Production)
Defined in `render.yaml`:
- **Hub** (`web` service): Public-facing, serves web UI + hub WebSocket
- **Node** (`pserv` service): Private, connects to hub via WebSocket

The node does not need a public IP — it connects outbound to the hub's WebSocket endpoint.

---

*Last Updated: March 2026*
