# TiClaw Security Model

This document defines the current TiClaw security model, recommended production posture, and the next-step hardening plan.

## Security Objectives

1. Protect node-level administrative surfaces from unauthorized access.
2. Preserve the trust boundary between node identity and agent/session identity.
3. Limit browser and network attack surface by default.
4. Keep audit trails attributable to authenticated actors, not client-claimed fields.
5. Make the secure path the default path for operators.

## Threat Model

In-scope attacker classes:
- Remote network client reaching TiClaw HTTP or WebSocket endpoints.
- Browser-based attacker attempting cross-origin access to node APIs.
- Client attempting to spoof sender identity on `/runs` or WebSocket message paths.
- Operator misconfiguration exposing trust or admin endpoints without strong controls.
- Malicious or compromised skill attempting filesystem escape or secret exfiltration.

Assumptions:
- Host OS and runtime are not already fully compromised.
- Operators control deployment topology and can set environment variables.
- Gateway, proxy, or ingress can add additional transport protections, but node security must still stand on its own.

## Core Security Principle

**Node-level access uses a token. Agent-level trust uses pairing/enrollment.**

That principle matches TiClaw's architecture and should remain the default model:

- **Node-level admin/API boundary**
  - Protected by `HTTP_API_KEY` (or loopback-only fallback for local development).
  - Covers HTTP API, admin-style WebSocket auth, schedules, sessions, skills, and enrollment token issuance.
- **Agent/device trust boundary**
  - Protected by pairing/enrollment and trust-state transitions.
  - A node becomes `trusted` through enrollment proof, not by direct manual promotion over a general-purpose endpoint.

This keeps responsibilities separated:
- Token = who may operate the node API.
- Pairing/enrollment = whether a node/device is trusted to participate.

## Trust Boundaries

```text
External clients/channels -> TiClaw HTTP/WS boundary -> Task runner boundary -> Local filesystem (~/.ticlaw)
                                      |
                                      +-> Enrollment / pairing boundary
                                      +-> Optional Hub relay boundary
```

Primary protection boundary:
- TiClaw node process and data under `~/.ticlaw/`.

Secondary boundaries:
- Enrollment and trust-state lifecycle.
- Hub transport / relay when enabled.
- Agent workspaces under configured allowed roots.

## Current Security Model

### 1) Node-Level API Authentication

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

### 2) Agent-Level Trust: Pairing / Enrollment

Node trust is not a generic API toggle. It is a trust-state lifecycle:
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

### 3) Sender Identity Integrity

Client-provided sender identity is not authoritative.

For trusted HTTP/WS entry paths:
- Message actor identity should be derived from authenticated context.
- Client-provided fields such as `sender` and `sender_name` must be ignored or treated as display-only untrusted input.

Current direction:
- `/runs` and authenticated WebSocket message handling derive sender identity from the authenticated HTTP admin context.
- This preserves audit integrity and avoids spoofed actor attribution.

### 4) Browser and CORS Policy

CORS policy should be deny-by-default.

Behavior:
- If `ALLOWED_ORIGINS` is configured, only matching origins are echoed back.
- If `ALLOWED_ORIGINS` is empty or invalid, TiClaw does **not** emit wildcard `Access-Control-Allow-Origin: *`.
- Credentials are not broadly enabled for arbitrary origins.

Implication:
- A browser frontend must be explicitly allowlisted.
- Sensitive node APIs should not be reachable cross-origin from arbitrary websites.

### 5) Secrets and API Key Protection

Implemented controls:
- Structured logging redaction for common secret/key/token fields.
- Child-process environment minimization:
  - Only base runtime keys + known skill secret patterns + optional `CHILD_ENV_ALLOWLIST`.
- Avoid logging API key fragments in routine lifecycle logs.

### 6) Execution and Filesystem Isolation

Path safety controls:
- Agent/session/schedule identifiers validated as safe path segments.
- Path resolution enforced inside expected roots.
- Workspace access constrained to the agent workspace root.
- Workspace roots constrained by `WORKSPACE_ALLOWED_ROOTS`.

Skill scope:
- Managed skill operations blocked for out-of-root paths.
- Managed skill enable blocked on content hash drift diagnostics.
- Runner links only in-scope skill directories.

### 7) Network Trust Model (Node/Hub)

Outbound endpoint controls:
- ACP and Hub client URLs are validated before connect.
- Allowed protocols enforced (`https` / `wss` by default unless explicitly overridden).
- Optional host allowlist via `SECURITY_TRUSTED_REMOTE_HOSTS`.

Inbound hub controls:
- Optional allowlists for enrolling/authenticating nodes:
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

Recommended examples:

```bash
HTTP_API_KEY=<long-random-secret>
ALLOWED_ORIGINS=^https://(app\.example\.com|admin\.example\.com)$
SECURITY_TRUSTED_REMOTE_HOSTS=hub.example.com,api.example.com
WORKSPACE_ALLOWED_ROOTS=/srv/ticlaw/workspaces
CHILD_ENV_ALLOWLIST=GITHUB_TOKEN,RENDER_API_KEY
```

## OpenClaw-Aligned Improvement Plan

These improvements keep the current OpenClaw/TiClaw architecture intact instead of replacing it with a foreign auth model.

### Phase 1: Secure Defaults at the Node Boundary
- Require token auth for all node admin/API surfaces.
- Keep loopback-only fallback strictly for local dev.
- Remove wildcard CORS and require explicit origin allowlists.
- Derive actor identity from authenticated context, not payload fields.

### Phase 2: Pairing-Centric Trust Flow
- Keep node trust transitions on enrollment/pairing flows.
- Remove or disable generic direct trust-promotion endpoints.
- Add stronger audit logs around enrollment token issuance, verification, revoke, and suspend.

### Phase 3: Narrower Capability Boundaries
- Split admin vs operator vs read-only node API scopes where useful.
- Add explicit per-route capability checks for the most sensitive operations.
- Minimize what browser UIs can mutate directly.

### Phase 4: Defense in Depth
- Signed enrollment assertions or stronger attestation.
- Optional mTLS for hub/node deployments.
- Security regression tests for auth, CORS, spoofing, trust, and path escape.
- More explicit egress/network controls per skill/runtime.

## Known Gaps and Residual Risk

1. Loopback fallback is still a development convenience.
- Production deployments should always set `HTTP_API_KEY`.

2. Enrollment is stronger than direct trust toggles, but still benefits from stronger attestations.
- Signed proofs or mTLS remain future hardening steps.

3. Skills are policy-constrained, not fully sandboxed.
- Strong multi-tenant isolation still requires OS/container controls.

4. CORS is not an auth mechanism.
- Browser allowlists reduce exposure but do not replace token-based auth.

## Incident Response

If compromise is suspected:
1. Isolate the node/hub from the network.
2. Set trust state to `revoked` or `suspended`.
3. Rotate `HTTP_API_KEY`, channel keys, LLM keys, and any skill secrets.
4. Review:
   - `~/.ticlaw/security/enrollment-state.json`
   - `~/.ticlaw/skills/registry.json`
   - `~/.ticlaw/skills/audit.log`
   - `~/.ticlaw/agents/*/sessions/*/messages.jsonl`
5. Re-enroll and re-enable only required skills.

---

Last updated: March 21, 2026
