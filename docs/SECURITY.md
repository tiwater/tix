# TiClaw Security Model

This document is the single source of truth for TiClaw security boundaries, trust flows, pairing behavior, and recommended production posture.

## Security Objectives

1. Protect node administrative surfaces from unauthorized access.
2. Keep node trust and agent/channel binding as separate concerns.
3. Limit browser and network attack surface by default.
4. Keep audit trails attributable to authenticated actors, not client-claimed fields.
5. Make the secure path the default path for operators and users.

## Threat Model

In-scope attacker classes:
- Remote network client reaching TiClaw HTTP or WebSocket endpoints.
- Browser-based attacker attempting cross-origin access to node APIs.
- Client attempting to spoof sender identity on `/runs` or WebSocket message paths.
- Unpaired channel/user attempting to talk to an agent without authorization.
- Operator misconfiguration exposing trust or admin endpoints without strong controls.
- Malicious or compromised skill attempting filesystem escape or secret exfiltration.

Assumptions:
- Host OS and runtime are not already fully compromised.
- Operators control deployment topology and can set environment variables.
- Gateway, proxy, or ingress may add extra transport protections, but node security must still stand on its own.

## Core Model

TiClaw has two distinct security layers:

### Layer 1: Node security
A **node** is the machine-side TiClaw runtime. In this document, `node` and `device` refer to the same security object.

Node security answers two separate questions:
1. **Who may operate the node API?**
   - Answered by **token-based node admin access**.
2. **Is this node trusted by the control plane/system?**
   - Answered by **enrollment / pairing / trust-state transitions**.

### Layer 2: Agent access security
An **agent** is the conversational/service identity exposed to users across channels.

Agent access security answers:
1. **Which users/chats/channels are allowed to talk to this agent?**
2. **Which identities are bound to which agent?**
3. **What should happen when an unbound identity first contacts the agent?**

This layer is handled by **agent pairing / channel binding**, not by node trust.

## Core Principles

### Principle A: Node admin access uses a token
Node HTTP/WS management surfaces are protected by a node-level token mechanism such as `HTTP_API_KEY`.

This protects operations like:
- node HTTP API access
- admin WebSocket auth
- schedules, sessions, skills, enrollment token issuance

### Principle B: Node trust uses enrollment / pairing
A node does not become trusted by calling a generic “trust me” endpoint.

Instead, trust is established through controlled enrollment/pairing and represented by trust state.

### Principle C: Agent access uses channel/user binding
A user or chat may not talk to an agent merely because it can reach the node.

Instead, the channel identity must be explicitly bound to the target agent, typically via a pair-code or equivalent approval flow.

### Principle D: Unpaired identities do not get normal conversation access
If a channel identity is not paired/bound to an agent, it should not enter standard chat flow.

Its allowed behavior should be limited to:
- requesting a pair code
- receiving pairing instructions
- waiting for approval/binding

## Trust Boundaries

```text
External users/channels
  -> Channel identity boundary
  -> Agent binding / pairing boundary
  -> TiClaw agent conversation boundary
  -> Node HTTP/WS admin boundary
  -> Task runner boundary
  -> Local filesystem (~/.ticlaw)
                |
                +-> Node enrollment / trust boundary
                +-> Optional Hub / control-plane boundary
```

Primary protection boundary:
- TiClaw node process and data under `~/.ticlaw/`.

Secondary boundaries:
- Node enrollment and trust-state lifecycle.
- Agent/channel binding lifecycle.
- Hub/control-plane transport when enabled.
- Agent workspaces under configured allowed roots.

## Current Security Model

## 1) Node-Level API Authentication

Admin-protected surfaces:
- All `/api/*` endpoints.
- `POST /runs`.
- WebSocket `auth` handshake used for interactive HTTP/WS clients.

Authorization behavior:
- If `HTTP_API_KEY` is configured:
  - Requests must present a valid key via `X-API-Key` or `Authorization: Bearer <key>`.
  - WebSocket `auth` must include `api_key`.
- If `HTTP_API_KEY` is not configured:
  - Admin surfaces are restricted to loopback clients only (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).

Operational guidance:
- Loopback fallback is only for local development.
- Any non-local or production deployment should set `HTTP_API_KEY`.
- For future dynamic-node deployments, a per-node token model is preferred over a single shared static token.

## 2) Node Trust and Enrollment

Node trust is a state machine, not a generic admin toggle.

Trust states:
- `discovered_untrusted`
- `trusted`
- `suspended`
- `revoked`

Allowed trust operations:
- Issue an enrollment token via `POST /api/enroll/token` (admin protected).
- Verify the enrollment token via `POST /api/enroll/verify`.
- Revoke or suspend via admin-protected enrollment endpoints.

Direct trust elevation:
- `POST /api/v1/node/trust` / `POST /api/node/trust` is deprecated and should not be used for production trust transitions.
- The preferred and documented path is enrollment/pairing.

### Local manually started node
A node manually started on a local machine is fully within scope of this model.

Expected flow:
1. Start the node locally.
2. Perform a manual enrollment/pairing step with the control plane.
3. Approve or verify the node.
4. Persist node identity locally.
5. Continue operating with normal trusted-node behavior.

This means “manually joining the control plane” is part of the intended enrollment model, not a special exception.

## 3) Dynamic Node Token Strategy

For dynamic or ephemeral node deployments, the long-term preferred model is:
- enrollment establishes trust
- control plane issues a node-scoped token
- token is bound to node identity
- node refreshes or rotates token automatically

Preferred properties of a node token:
- per-node, not globally shared
- revocable
- auditable
- short-lived or refreshable
- bound to stable node identity and, where appropriate, node fingerprint

A recommended future model is:
1. Node enrolls.
2. Control plane marks node trusted.
3. Control plane issues node token.
4. Node uses that token for node-admin/API access.
5. Token rotates or refreshes automatically.

## 4) Agent Pairing and Channel Binding

Node trust does **not** imply that every channel/user may talk to every agent.

Agent access must be modeled separately.

An agent may be bound to:
- multiple channels
- multiple identities within the same channel
- optionally, group/chat identities as distinct bindings

Examples:
- one agent bound to one Feishu user and one Telegram user
- one agent bound to multiple Feishu users
- one agent bound to a specific Feishu group chat

### Default rule
If a channel identity is not bound to the target agent, it should not get normal conversation access.

### Expected pairing flow for unbound identities
1. An unbound user or chat sends an initial message.
2. TiClaw detects that the identity is not bound to an agent.
3. TiClaw returns a pair code or pairing instruction.
4. The owner/admin completes pairing in a trusted control surface.
5. The channel identity becomes bound to the target agent.
6. Normal conversation access is enabled.

This mirrors the OpenClaw-style model where an initial greeting can generate a pair code that must be completed from a trusted surface.

## 5) Multi-User Agent Binding

A single agent **may** be paired with multiple users from the same channel.

Example:
- `feishu:ou_a -> agentA`
- `feishu:ou_b -> agentA`
- `feishu:ou_c -> agentA`

This is allowed and considered a normal use case.

### Default recommended behavior
- multiple users may bind to the same agent
- conversations remain isolated by default
- management rights remain restricted to owner/admin roles

This means:
- shared agent
- separate user histories by default
- explicit shared/group behavior only when intentionally configured

### Group/chat binding
A group or chat binding should be treated as a distinct kind of binding, not merely as several user bindings.

Examples:
- `feishu:chat_xxx -> agentA`
- `discord:channel_yyy -> agentA`

This keeps direct-user bindings and shared-chat bindings conceptually separate.

## 6) Sender Identity Integrity

Client-provided sender identity is not authoritative.

For trusted HTTP/WS entry paths:
- message actor identity must be derived from authenticated context
- client-provided fields such as `sender` and `sender_name` must be ignored or treated as untrusted display-only input

Current implementation direction:
- `/runs` and authenticated WebSocket message handling derive sender identity from the authenticated HTTP admin context
- this preserves audit integrity and avoids spoofed actor attribution

## 7) Browser and CORS Policy

CORS policy is deny-by-default.

Behavior:
- if `ALLOWED_ORIGINS` is configured, only matching origins are echoed back
- if `ALLOWED_ORIGINS` is empty or invalid, TiClaw does **not** emit wildcard `Access-Control-Allow-Origin: *`
- credentials are not broadly enabled for arbitrary origins

Implication:
- a browser frontend must be explicitly allowlisted
- sensitive node APIs should not be reachable cross-origin from arbitrary websites

## 8) Secrets and API Key Protection

Implemented controls:
- structured logging redaction for common secret/key/token fields
- child-process environment minimization:
  - only base runtime keys + known skill secret patterns + optional `CHILD_ENV_ALLOWLIST`
- avoid logging API key fragments in routine lifecycle logs

## 9) Execution and Filesystem Isolation

Path safety controls:
- agent/session/schedule identifiers validated as safe path segments
- path resolution enforced inside expected roots
- workspace access constrained to the agent workspace root
- workspace roots constrained by `WORKSPACE_ALLOWED_ROOTS`

Skill scope:
- managed skill operations blocked for out-of-root paths
- managed skill enable blocked on content hash drift diagnostics
- runner links only in-scope skill directories

## 10) Network Trust Model (Node/Hub)

Outbound endpoint controls:
- ACP and Hub client URLs are validated before connect
- allowed protocols enforced (`https` / `wss` by default unless explicitly overridden)
- optional host allowlist via `SECURITY_TRUSTED_REMOTE_HOSTS`

Inbound hub controls:
- optional allowlists for enrolling/authenticating nodes:
  - `HUB_ALLOWED_NODE_IDS`
  - `HUB_ALLOWED_NODE_FINGERPRINTS`

## Required Production Settings

At minimum, configure:
- `HTTP_API_KEY`
- `ALLOWED_ORIGINS`
- `SECURITY_TRUSTED_REMOTE_HOSTS`
- `WORKSPACE_ALLOWED_ROOTS`
- `CHILD_ENV_ALLOWLIST` (minimal, explicit)
- `HUB_ALLOWED_NODE_IDS` and/or `HUB_ALLOWED_NODE_FINGERPRINTS` when Hub is used

## Secure-by-Default Operator Guidance

Use this rule of thumb:

- **local-only development**: loopback fallback is acceptable
- **anything reachable by another machine, browser, tunnel, reverse proxy, or public network**: set `HTTP_API_KEY` and explicit `ALLOWED_ORIGINS`

Unsafe operator assumption to avoid:
- “the node is behind some other layer, so built-in auth is optional”

Recommended stance:
- built-in node auth is the primary protection
- private networking / reverse proxies / VPN / gateway auth are defense-in-depth

### Intentional dev/unsafe mode

TiClaw currently allows a local-development fallback when `HTTP_API_KEY` is unset:
- admin/API endpoints are restricted to loopback clients only
- this is intended only for same-machine development workflows

This should be treated as an explicit **dev-only** mode, not a production deployment strategy.
If an operator chooses to expose the node beyond localhost without `HTTP_API_KEY`, that is an unsafe configuration.

Recommended examples:

```bash
HTTP_API_KEY=<long-random-secret>
ALLOWED_ORIGINS=^https://(app\.example\.com|admin\.example\.com)$
SECURITY_TRUSTED_REMOTE_HOSTS=hub.example.com,api.example.com
WORKSPACE_ALLOWED_ROOTS=/srv/ticlaw/workspaces
CHILD_ENV_ALLOWLIST=GITHUB_TOKEN,RENDER_API_KEY
```

## Recommended Future Design Direction

These are the intended next-step directions and should guide implementation:

### Phase 1: Secure Defaults at the Node Boundary
- require token auth for all node admin/API surfaces
- keep loopback-only fallback strictly for local dev
- remove wildcard CORS and require explicit origin allowlists
- derive actor identity from authenticated context, not payload fields

### Phase 2: Pairing-Centric Node Trust
- keep node trust transitions on enrollment/pairing flows
- avoid generic direct trust-promotion endpoints
- add stronger audit logs around enrollment token issuance, verification, revoke, and suspend
- support local manually started nodes through explicit approval/enrollment flow

### Phase 3: Agent Pairing Model
- introduce explicit agent/channel binding records
- require unbound identities to complete pair-code flow before conversation
- support multiple users bound to one agent
- support group/chat bindings as first-class records
- default to per-user conversation isolation

### Phase 4: Dynamic Node Tokening
- move toward per-node tokens rather than shared static tokens
- bind tokens to node identity and lifecycle
- support rotation, revocation, and refresh
- add auditability around issuance and use

### Phase 5: Defense in Depth
- signed enrollment assertions or stronger attestation
- optional mTLS for hub/node deployments
- security regression tests for auth, CORS, spoofing, trust, binding, and path escape
- more explicit egress/network controls per skill/runtime

## Known Gaps and Residual Risk

1. Loopback fallback is still a development convenience.
- Production deployments should always set `HTTP_API_KEY`.

2. Enrollment is stronger than direct trust toggles, but still benefits from stronger attestations.
- Signed proofs or mTLS remain future hardening steps.

3. Agent pairing/channel binding is now the intended model, but may not yet be fully enforced across every channel path.
- Until fully implemented, some channel entry points may still rely on legacy assumptions.

4. Skills are policy-constrained, not fully sandboxed.
- Strong multi-tenant isolation still requires OS/container controls.

5. CORS is not an auth mechanism.
- Browser allowlists reduce exposure but do not replace token-based auth.

## Incident Response

If compromise is suspected:
1. Isolate the node/hub from the network.
2. Set node trust state to `revoked` or `suspended`.
3. Rotate `HTTP_API_KEY`, channel keys, LLM keys, and any skill secrets.
4. Review:
   - `~/.ticlaw/security/enrollment-state.json`
   - `~/.ticlaw/skills/registry.json`
   - `~/.ticlaw/skills/audit.log`
   - `~/.ticlaw/agents/*/sessions/*/messages.jsonl`
5. Re-enroll nodes and re-enable only required skills.
6. Review agent/channel bindings and remove any unauthorized pairings.

---

Last updated: March 21, 2026
