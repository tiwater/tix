# TiClaw Requirements

## Mission

TiClaw is an AI agent runtime — a lightweight, self-hosted platform that connects LLM agents to messaging channels with persistent memory, filesystem-first data management, and a hub/node deployment model.

---

## Design Principles

### 1. Filesystem-First
The filesystem IS the database. No SQLite, no external databases required. JSON for metadata, JSONL for append-only logs, Markdown for agent identity. Everything is human-readable via `cat`, `grep`, and `tail -f`.

### 2. Channel-Agnostic
The engine is decoupled from any specific messaging platform. Channels (Discord, Feishu, DingTalk, HTTP) are pluggable adapters that self-register at startup. Adding a new channel requires implementing the `Channel` interface and calling `registerChannel()`.

### 3. Hub/Node Topology
Nodes (TiClaw instances) connect outbound to a Hub via WebSocket. The Hub serves the web UI and relays requests to connected nodes. Nodes don't need a public IP. Multiple nodes can connect to a single hub.

### 4. Agent-Centric Model
Each agent has its own identity (SOUL.md, IDENTITY.md, USER.md, MEMORY.md) and can serve multiple sessions across channels. Agents are stored as filesystem directories under `~/.ticlaw/agents/`.

### 5. Config-Driven
Channels, LLM providers, hub connections, and features are configured via environment variables or `~/.ticlaw/config.yaml`. No code changes needed to enable/disable functionality.

### 6. Local-First with Optional Cloud Sync
All data lives locally under `~/.ticlaw/`. Supabase sync is opt-in for cloud backup and multi-device access.

---

## Functional Requirements

### A. Multi-Channel Message Routing
- Receive messages from Discord, Feishu, DingTalk, web UI, and ACP
- Route inbound messages to the correct agent based on registered projects
- Support trigger patterns (e.g., `@Shaw`) for channel activation
- Relay agent responses back through the originating channel
- Support typing indicators and message editing where platform supports it

### B. Agent Execution
- Run LLM agents via the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- Support configurable LLM providers (Anthropic, BigModel, MiniMax) via base URL override
- Stream response tokens in real-time via SSE to web clients
- Load agent context from mind files (SOUL.md, IDENTITY.md, USER.md, MEMORY.md)
- Per-channel concurrency control to prevent overlapping agent runs

### C. Session Management
- Maintain conversation continuity across messages
- Store full message history as append-only JSONL
- Support multiple concurrent sessions per agent
- Automatic session creation on first message

### D. Scheduled Tasks
- Cron-based, interval-based, and one-time scheduled tasks
- Tasks execute through the same agent pipeline as interactive messages
- CRUD operations via REST API and in-channel commands

### E. Enrollment & Trust
- Node identity via hardware fingerprint (hostname + platform + arch)
- Token-based enrollment flow with expiry and rate limiting
- Trust states: `discovered_untrusted` → `pending_verification` → `trusted`
- Freeze mechanism after failed verification attempts

### F. Skills System
- Discoverable, toggleable skill packages
- Admin-only installation controls
- Audit logging for skill operations

### G. Web UI
- Chat interface via HTTP SSE streaming
- Agent and session management
- Node status and enrollment controls
- Real-time message streaming

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |
| Language | TypeScript (strict) |
| Build | `tsc` (TypeScript compiler) |
| Dev Runner | `tsx` (watch mode) |
| Channels | Discord.js, Lark SDK, DingTalk Stream, HTTP/SSE |
| Storage | Filesystem (JSON/JSONL/Markdown) |
| Cloud Sync | Supabase (optional) |
| Hub Transport | WebSocket (`ws`) |
| Logging | Pino |
| Testing | Vitest |
| Deployment | Render.com (Blueprint) |

---

*Last Updated: March 2026*
