# TiClaw Requirements

## Mission

TiClaw is a self-hosted AI agent runtime that connects LLM agents to multi-channel messaging with filesystem-first persistence, durable session continuity, and optional hub/node deployment.

---

## Requirement Status Model

This document uses explicit status labels:
- **Current**: behavior implemented in the codebase now.
- **Planned**: target capability not yet fully implemented or not default.

---

## Current Requirements (Implemented)

### 1. Filesystem-First Persistence

- Filesystem is the primary data store under `~/.ticlaw/`.
- Session and message history are persisted as JSON/JSONL.
- Schedules are persisted as YAML.
- No SQLite dependency in current runtime path.

### 2. Multi-Channel Runtime (Current Wiring)

- Channel adapters self-register via channel registry.
- Default barrel wiring includes: Discord, Feishu, ACP, HTTP/SSE, Hub Client.
- DingTalk implementation exists but is not loaded by default barrel import.

### 3. Agent Execution

- Execution uses `@anthropic-ai/claude-agent-sdk` via `AgentRunner`.
- Prompt context includes mind files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`).
- Recent short-term journals (`memory/*.md`, latest 3) are injected into prompt.
- Streaming is emitted to web clients (`stream_delta`, `message`, progress events).

### 4. Session Continuity

- Multiple sessions per agent are supported.
- Session records are stored per-agent under `sessions/{session_id}`.
- Claude-side session continuation IDs are persisted per TiClaw session.

### 5. Scheduling (Current)

- One scheduler loop checks due schedules every 60 seconds.
- Schedule files are stored at `agents/{agent_id}/schedules/{schedule_id}.yaml`.
- Due criteria are based on `status=active` and `next_run<=now`.
- API supports list/create/toggle/delete/refresh schedule flows.

### 6. Enrollment & Trust (Node-Side)

- Node trust states: `discovered_untrusted`, `pending_verification`, `trusted`, `suspended`, `revoked`.
- Enrollment token model includes TTL, hash+salt persistence, failed-attempt freeze.
- `/runs` gate depends on node trust state (`trusted` required).

### 7. Skills System (Governed Runtime)

- Skills are discoverable and toggleable.
- Runtime includes admin/permission policy model and audit log paths.
- Skills can be enabled/disabled via API.

### 8. Web UI & HTTP API

- Web UI provides chat, sessions, schedules, skills, and node panels.
- Node API exposes `/runs`, `/api/*`, enrollment, and mind endpoints.
- SSE stream endpoint is available at `/runs/:id/stream`.

### 9. Deployment Topology

- Standalone node deployment is supported.
- Hub + Node topology is supported via outbound WebSocket from node to hub.

---

## Planned Requirements (Target State)

### A. Hub-Side Strong Authentication

- Enforce server-side verification for hub `enroll` / `auth` handshakes.
- Add explicit trust policy and credential rotation model.

### B. Route-Binding Unification

- Decide and converge on one canonical routing source:
  - keep `registered-groups.json` as long-term source, or
  - migrate to `agent.json.sources` with compatibility layer.

### C. Scheduling Enhancements

- Native one-shot timestamp scheduling (non-cron input).
- Full update API (`PUT /api/schedules/:id`) for schedule edits.
- Optional stable user-defined schedule IDs in API path.

### D. Runtime Queue/Concurrency Governance

- Move from per-chat mutex only to explicit global queue/backpressure model.
- Enforce and expose global/agent/session concurrency limits as operational controls.

### E. Task/Executor Observability

- Replace stub-like task/executor surfaces with real queue/run metrics.
- Add richer task lifecycle visibility and operational diagnostics.

### F. Memory Retrieval Evolution

- Introduce semantic retrieval provider (see `docs/MEMORY.md` planned sections).
- Add indexing/retrieval APIs and recall quality safeguards.

### G. Stream Reliability

- Add replay/recovery endpoint keyed by stream sequence.
- Improve reconnect semantics beyond best-effort SSE recovery.

---

## Technology Stack (Current)

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ (ESM) |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |
| Language | TypeScript |
| Build | `tsc` |
| Dev Runner | `tsx` |
| Channels | Discord.js, Lark SDK, HTTP/SSE, ACP (DingTalk implementation available) |
| Storage | Filesystem (JSON/JSONL/YAML/Markdown) |
| Sync | Supabase (optional) |
| Hub Transport | WebSocket (`ws`) |
| Logging | Pino |
| Testing | Vitest |
| Deployment | Render blueprint + self-hosted variants |

---

## Tracking

Implementation delta and priority backlog are tracked in:
- `docs/IMPLEMENTATION_GAPS.md`

---

*Last Updated: March 17, 2026*
