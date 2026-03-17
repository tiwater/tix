# TiClaw Security Model

This document defines the security model for TiClaw and the phased hardening plan.

## Security Objectives

1. Protect API keys and other secrets from disclosure and accidental propagation.
2. Block node/hub communication with untrusted endpoints by default.
3. Enforce execution and filesystem scope for agents and skills.

## Threat Model

In-scope attacker classes:
- Remote network client reaching TiClaw HTTP/WS or Hub endpoints.
- Malicious or compromised skill attempting filesystem escape or secret exfiltration.
- Misconfigured operator exposing endpoints without authentication.

Assumptions:
- Host OS and runtime are not already fully compromised.
- Operators can control environment variables and deployment topology.

## Trust Boundaries

```text
External clients/channels -> TiClaw HTTP/WS boundary -> Task runner boundary -> Local filesystem (~/.ticlaw)
                                      |
                                      +-> Optional Hub relay boundary
```

Primary protection boundary:
- TiClaw node process and data under `~/.ticlaw/`.

Secondary boundary:
- Hub transport (if enabled) and node enrollment/authentication.

## Security Model (Current Implementation)

### 1) API Access and Privilege Model

Admin-protected surfaces:
- All `/api/*` endpoints.
- `POST /runs`.
- WebSocket `auth` handshake.

Authorization behavior:
- If `HTTP_API_KEY` is configured:
  - Request must present valid key via `X-API-Key` or `Authorization: Bearer <key>`.
  - WebSocket `auth` must include `api_key` in payload.
- If `HTTP_API_KEY` is not configured:
  - Admin surfaces are restricted to loopback clients only (`127.0.0.1` / `::1`).

Skills lifecycle:
- Skill enable/disable now uses authorized admin context only.
- No implicit hardcoded privileged bypass for web skill mutations.

### 2) Secrets and API Key Protection

Implemented controls:
- Structured logging redaction for common secret/key/token fields.
- Child-process environment minimization:
  - Only base runtime keys + known skill secret patterns + optional `CHILD_ENV_ALLOWLIST`.
- Avoided logging API key fragments in runner lifecycle logs.

### 3) Network Trust Model (Node/Hub)

Outbound endpoint controls:
- ACP and Hub client URLs are validated before connect.
- Allowed protocols enforced (`https/wss` by default; insecure override optional).
- Optional host allowlist via `SECURITY_TRUSTED_REMOTE_HOSTS`.

Inbound hub controls:
- Optional allowlist checks for enrolling/authenticating nodes:
  - `HUB_ALLOWED_NODE_IDS`
  - `HUB_ALLOWED_NODE_FINGERPRINTS`

Enrollment/trust state:
- Node trust states and token verification flow remain enforced.

### 4) Execution and Filesystem Isolation

Path safety controls:
- Agent/session/schedule identifiers validated as safe path segments.
- Path resolution enforced inside expected roots via safe resolver helpers.

Agent/workspace scope:
- Agent paths resolve under `AGENTS_DIR` only.
- Workspace path constrained by `WORKSPACE_ALLOWED_ROOTS`.

Skill scope:
- Managed skill operations blocked for out-of-root paths.
- Managed skill enable blocked on content hash drift diagnostics.
- Runner links only in-scope skill directories.

## Required Production Settings

At minimum, configure:
- `HTTP_API_KEY` (required for non-local deployments)
- `SECURITY_TRUSTED_REMOTE_HOSTS`
- `WORKSPACE_ALLOWED_ROOTS`
- `CHILD_ENV_ALLOWLIST` (minimal, explicit)
- `HUB_ALLOWED_NODE_IDS` and/or `HUB_ALLOWED_NODE_FINGERPRINTS` (when using Hub)

## Known Gaps and Residual Risk

1. Loopback fallback is a development convenience.
- In production, always set `HTTP_API_KEY` and enforce network auth at gateway/proxy.

2. Skills are policy-constrained but not full OS sandbox isolation.
- Strong multi-tenant isolation still requires container/VM hardening.

3. Hub allowlists are admission controls, not full cryptographic mutual authentication.
- mTLS and signed enrollment assertions are still recommended roadmap items.

## Step-by-Step Implementation Plan

### Phase 1 (Done): Baseline Access and Secret Hardening
- Admin gate on `/api/*`, `POST /runs`, WS auth.
- Logging redaction and child env allowlist.
- Remove privileged web-skill bypass.

### Phase 2 (Done): Endpoint Trust Controls
- Validate ACP/Hub outbound endpoints (protocol + host policy).
- Add hub-side node allowlists for enrollment/auth.

### Phase 3 (Done): Scope and Path Enforcement
- Safe identifier/path validation for agent/session/schedule storage.
- Workspace root allowlist enforcement.
- Skill root boundary and hash-drift enforcement.

### Phase 4 (Next): Strong Isolation and Defense-in-Depth
1. Add stronger Hub identity (mTLS or signed node attestations).
2. Add per-skill execution profiles (network/filesystem permissions).
3. Add explicit deny-by-default egress policy per runtime/skill.
4. Add security regression tests for authz, path escape, and endpoint policy.

## Incident Response

If compromise is suspected:
1. Isolate node/hub from network.
2. Set trust state to `revoked` or `suspended`.
3. Rotate all API/channel/LLM keys.
4. Review:
   - `~/.ticlaw/security/enrollment-state.json`
   - `~/.ticlaw/skills/registry.json`
   - `~/.ticlaw/skills/audit.log`
   - `~/.ticlaw/agents/*/sessions/*/messages.jsonl`
5. Re-enroll and re-enable only required skills.

---

Last updated: March 17, 2026
