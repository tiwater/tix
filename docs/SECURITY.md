# TiClaw Security Model

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    UNTRUSTED ZONE                       │
│  Inbound messages (Discord, Feishu, DingTalk, Web)     │
└────────────────────────┬────────────────────────────────┘
                         │ Trigger check, message routing
                         ▼
┌─────────────────────────────────────────────────────────┐
│                NODE (TiClaw Instance)                   │
│  • Channel adapters (message I/O)                      │
│  • Message loop + trigger matching                     │
│  • Agent runner (Claude SDK)                           │
│  • Filesystem store (~/.ticlaw/)                       │
│  • Enrollment state machine                            │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket (outbound)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                HUB (Public-Facing)                      │
│  • WebSocket server (accepts node connections)         │
│  • HTTP relay (proxies requests to active node)        │
│  • SSE bridge (streams responses to web clients)       │
│  • Web UI static files                                 │
└─────────────────────────────────────────────────────────┘
```

---

## Node Enrollment & Trust

Nodes identify themselves via a hardware-derived fingerprint and go through a trust lifecycle before they can process requests from the hub.

### Trust States

| State | Description |
|-------|-------------|
| `discovered_untrusted` | Node registered but not yet verified |
| `pending_verification` | Enrollment token generated, awaiting verification |
| `trusted` | Fully operational |
| `suspended` | Temporarily disabled |
| `revoked` | Permanently disabled |

### Enrollment Flow

1. Node derives its fingerprint: `SHA-256(hostname|platform|arch)` → base64url
2. Node generates a time-limited enrollment token (default: 20 min TTL)
3. Operator verifies the token via web UI or `/enroll verify <token>` command
4. On success, the node transitions to `trusted`

### Rate Limiting

- Maximum **5 failed verification attempts** before freeze
- **15-minute freeze period** after exceeding limit
- Failed attempt counter resets on successful verification

### Storage

Enrollment state is persisted at `~/.ticlaw/security/enrollment-state.json`, containing:
- `node_id` and `node_fingerprint`
- `trust_state`
- Token hashes (never plaintext)
- Attempt counters and freeze timestamps

---

## Hub Authentication

When a node connects to the hub, it sends an `enroll` or `auth` message containing:
- `node_id` — unique identifier
- `node_fingerprint` — hardware fingerprint

The hub tracks all connected nodes by WebSocket connection and only relays requests to nodes marked as `trusted`.

---

## Data Security

### Filesystem Isolation
All TiClaw data resides under `~/.ticlaw/`:
- Agent mind files, session data, and messages are isolated per agent directory
- No cross-agent data access at the application level
- Router state, enrollment state, and registered groups stored as separate JSON files

### Credential Handling
- LLM API keys are read from environment variables or `.env` files
- Keys are passed to the agent runner process but not persisted in the store
- Hub trust tokens are configured via environment variables (`HUB_TRUST_TOKEN`)

### Token Security
- Enrollment tokens are hashed with SHA-256 + random salt before storage
- Plaintext tokens are never persisted
- Tokens have configurable TTL (default: 20 minutes, max: 30 minutes)

---

## Channel Security

| Channel | Trust Level | Notes |
|---------|-------------|-------|
| Web UI (HTTP/SSE) | Local/Hub-proxied | No built-in auth; relies on hub-level access control |
| Discord | Platform-authenticated | Bot token required; trigger pattern prevents unintended activation |
| Feishu | Platform-authenticated | App credentials required; long connection mode |
| DingTalk | Platform-authenticated | Stream SDK with app credentials |
| Hub Client | Token-authenticated | WebSocket with enrollment verification |

---

## Concurrency Controls

- **Per-channel mutex**: Only one agent run per chat at a time (`activeAgentLocks`)
- **Global concurrency limit**: Configurable max concurrent agent runs (`CONCURRENCY_LIMIT`, default: 5)
- **Agent-level limit**: Max concurrent runs per agent (`AGENT_CONCURRENCY_LIMIT`, default: 3)
- **Session-level limit**: Max concurrent runs per session (`SESSION_CONCURRENCY_LIMIT`, default: 1)

---

*Last Updated: March 2026*
