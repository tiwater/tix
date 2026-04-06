# Tix Architecture

## Overview

Tix is a multi-channel AI agent runtime on Node.js. Messages flow in from channel adapters, are persisted to filesystem storage, executed by `AgentComputer` (Claude Agent SDK), and responses are routed back through the source channel.

The deployment model supports both:
- standalone node
- hub/node topology (`@tix/hub` + one or more Tix nodes)

---

## System Diagram

```text
                   ┌────────────────────────────────────┐
                   │ Hub (@tix/hub)                 │
                   │ - WebSocket node connections       │
                   │ - HTTP relay (/api/*, /runs*, etc) │
                   │ - SSE bridge                        │
                   └───────────────┬─────────────────────┘
                                   │ ws
                      ┌────────────▼────────────┐
                      │ Node (Tix runtime)   │
                      │ - Channels              │
                      │ - Message loop          │
                      │ - AgentComputer           │
                      │ - Filesystem store      │
                      └─────────────────────────┘
```

---

## Current Architecture (Implemented)

## Core Components

### 1. Channel Registry (`src/channels/registry.ts`)

Channels self-register with `registerChannel(name, factory)`.

Currently loaded by barrel (`src/channels/index.ts`):
- Discord (`dc:`)
- Feishu (`feishu:`)
- ACP (`acp:`)
- HTTP/SSE (`web:`)
- Hub Client (`hub:`)

Implemented but **not imported by default** in barrel:
- DingTalk (`dingtalk:`)

### 2. Message Processing (`src/index.ts`)

Two paths coexist:
- Event-driven: inbound channel `onMessage` triggers immediate processing
- Polling loop: every 2s scan/recovery path

Concurrency guard:
- `activeAgentLocks` ensures one active run per `chat_jid`

### 3. Agent Computer (`src/core/computer.ts`)

`AgentComputer` wraps `@anthropic-ai/claude-agent-sdk` query flow:
1. Builds system prompt from `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`
2. Injects recent short-term journals from `memory/*.md` (latest 3 files)
3. Compiles enabled skills into SDK plugin directory
4. Streams events (`stream_delta`, progress) to channel/UI
5. Executes in resolved workspace (`~/workspace-{agent}` by default)

Warm-session pooling:
- One warm subprocess per `agent_id + session_id`
- Cold resume using per-session Claude-side session IDs under `.claude_sessions/`
- Detailed memory spec: `docs/MEMORY.md`

### 4. Filesystem Store (`src/core/store.ts`)

Persistent data under `~/.tix/`:

| Data | Format | Path |
|---|---|---|
| Agents | JSON | `agents/{id}/agent.json` |
| Sessions | JSON | `agents/{id}/sessions/{sid}/session.json` |
| Messages | JSONL | `agents/{id}/sessions/{sid}/messages.jsonl` |
| Events | JSONL | `agents/{id}/sessions/{sid}/events.jsonl` |
| Schedules | YAML | `agents/{id}/schedules/{id}.yaml` |
| Router state | JSON | `router-state.json` |
| Registered routes | JSON | `registered-groups.json` |
| Enrollment | JSON | `security/enrollment-state.json` |

### 5. Hub (`hub/src/index.ts`)

`@tix/hub` provides:
- node connection tracking
- REST relay to active node
- SSE relay for `/runs/.../stream`

Important current behavior:
- Node `enroll` / `auth` messages are accepted and marked `trusted` in hub memory.
- Hub-side token/fingerprint verification is not yet enforced.

### 6. Task Scheduler (`src/task-scheduler.ts`)

- Poll interval: 60s
- Source: schedule YAML files
- Due rule: `status=active && next_run<=now`
- Execution: enqueue as normal inbound message
- Next run: recompute from `cron`; invalid cron pauses schedule

---

## Data Flow

```text
1) Channel receives message
2) Store message to session JSONL
3) Dispatch path (event-driven or polling recovery)
4) processMessages() handles control commands (/enroll, /skills) or normal run
5) AgentComputer streams progress/delta + emits final reply
6) Reply routed back via originating channel and persisted as bot message
```

---

## Deployment Topology

### Standalone (Development)

Single Tix process with direct channel adapters.

### Hub + Node (Production)

- Hub: public relay/API edge
- Node: private executor, outbound WebSocket to hub

Node does not require public inbound port exposure.

---

## Planned Architecture

1. Hub-side strong node authentication and trust policy.
2. Unified route binding migration from `registered-groups.json` to `agent.json.sources` (if adopted).
3. Global queue/backpressure model beyond per-chat mutex.

---

*Last Updated: March 17, 2026*
