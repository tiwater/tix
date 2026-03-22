# Pairing & Binding API

This document describes the current pairing/binding HTTP API exposed by the TiClaw node and relayed by the gateway.

> Status: first backend iteration
>
> Latest backend commit at time of writing: `44004e1` — `expand pairing management endpoints`

## Overview

The pairing flow is designed to block normal conversation until an external identity (chat/user/session) has been explicitly paired to an agent.

Current backend concepts:

- **Pending pairing**: a short-lived pair code waiting for admin approval
- **Binding**: a persisted mapping from `chat_jid` to `agent_id`
- **Approval**: the act of turning a pending pair code into an approved pairing and persisted binding
- **Unbind**: removal of an existing binding

## Auth / access model

Pairing management endpoints are **admin endpoints**.

On the node HTTP API, access requires one of:

- `X-API-Key: <HTTP_API_KEY>`
- `Authorization: Bearer <HTTP_API_KEY>`
- loopback access when `HTTP_API_KEY` is not configured

When routed via gateway, use the gateway auth header as usual:

```http
Authorization: Bearer <GATEWAY_API_KEY>
```

If multiple nodes are connected, also send:

```http
X-Node-Id: <node_id>
```

## Data model

### Binding object

```json
{
  "chat_jid": "feishu:app123:userB",
  "agent_id": "agent-security",
  "kind": "chat",
  "channel": "feishu",
  "pair_code": "AB12CD",
  "approved_by": "http-api-key",
  "created_at": "2026-03-22T00:01:02.000Z",
  "updated_at": "2026-03-22T00:03:04.000Z"
}
```

Fields:

- `chat_jid`: unique external identity key
- `agent_id`: currently bound agent
- `kind`: currently `user` or `chat`
- `channel`: inferred from `chat_jid` prefix
- `pair_code`: code that led to approval, if present
- `approved_by`: actor that approved the pairing
- `created_at`, `updated_at`: ISO timestamps

### Pending pairing object

```json
{
  "pair_code": "AB12CD",
  "chat_jid": "feishu:app123:userB",
  "requested_agent_id": "app123",
  "kind": "chat",
  "channel": "feishu",
  "status": "pending",
  "created_at": "2026-03-22T00:01:02.000Z",
  "expires_at": "2026-03-22T00:21:02.000Z",
  "approved_at": null,
  "approved_by": null,
  "bound_agent_id": null
}
```

Fields:

- `pair_code`: short approval code
- `chat_jid`: identity waiting to be paired
- `requested_agent_id`: requested/default target agent inferred by backend
- `kind`: `user` or `chat`
- `channel`: inferred from `chat_jid`
- `status`: `pending`, `approved`, or `expired`
- `created_at`, `expires_at`, `approved_at`: ISO timestamps
- `approved_by`: admin actor who approved the request
- `bound_agent_id`: final agent chosen during approval

## Endpoint summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/pairings` | List bindings and pending pairings |
| `POST` | `/api/v1/pairings/approve` | Approve a pair code and create/update binding |
| `DELETE` | `/api/v1/pairings` | Remove a binding by `chat_jid` |

## 1) List bindings and pending pairings

```http
GET /api/v1/pairings
```

### Example request

```bash
curl "$BASE_URL/api/v1/pairings" \
  -H "Authorization: Bearer $API_KEY"
```

### 200 response

```json
{
  "ok": true,
  "bindings": [
    {
      "chat_jid": "feishu:app123:userB",
      "agent_id": "agent-security",
      "kind": "chat",
      "channel": "feishu",
      "pair_code": "AB12CD",
      "approved_by": "http-api-key",
      "created_at": "2026-03-22T00:01:02.000Z",
      "updated_at": "2026-03-22T00:03:04.000Z"
    }
  ],
  "pending": [
    {
      "pair_code": "ZX98QP",
      "chat_jid": "feishu:app123:userC",
      "requested_agent_id": "app123",
      "kind": "chat",
      "channel": "feishu",
      "status": "pending",
      "created_at": "2026-03-22T00:05:00.000Z",
      "expires_at": "2026-03-22T00:25:00.000Z"
    }
  ]
}
```

### Notes for UI

- This endpoint is the current source for:
  - existing binding list
  - pending approval list
  - empty state detection
- Expired pending records may still be returned, but with `status: "expired"`
- Frontend should treat `bindings: []` and `pending: []` as valid empty states

## 2) Approve pair code

```http
POST /api/v1/pairings/approve
Content-Type: application/json
```

### Request body

```json
{
  "code": "AB12CD",
  "agent_id": "agent-security"
}
```

Fields:

- `code` (**required**): pair code to approve
- `agent_id` (optional): override final bound agent; if omitted, backend uses `requested_agent_id`

### Example request

```bash
curl -X POST "$BASE_URL/api/v1/pairings/approve" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"AB12CD","agent_id":"agent-security"}'
```

### 200 response

```json
{
  "ok": true,
  "pairing": {
    "pair_code": "AB12CD",
    "chat_jid": "feishu:app123:userB",
    "requested_agent_id": "app123",
    "kind": "chat",
    "channel": "feishu",
    "status": "approved",
    "created_at": "2026-03-22T00:01:02.000Z",
    "expires_at": "2026-03-22T00:21:02.000Z",
    "approved_at": "2026-03-22T00:03:04.000Z",
    "approved_by": "http-api-key",
    "bound_agent_id": "agent-security"
  },
  "binding": {
    "chat_jid": "feishu:app123:userB",
    "agent_id": "agent-security",
    "kind": "chat",
    "channel": "feishu",
    "pair_code": "AB12CD",
    "approved_by": "http-api-key",
    "created_at": "2026-03-22T00:03:04.000Z",
    "updated_at": "2026-03-22T00:03:04.000Z"
  }
}
```

### Error responses

Pairing endpoints now use the standard protocol error envelope:

```json
{
  "error": {
    "classification": "input_error",
    "code": "code_required",
    "message": "Pair code is required."
  }
}
```

#### 400 — missing code

```json
{
  "error": {
    "classification": "input_error",
    "code": "code_required",
    "message": "Pair code is required."
  }
}
```

#### 404 — unknown code

```json
{
  "error": {
    "classification": "input_error",
    "code": "pair_code_not_found",
    "message": "Pair code not found: AB12CD"
  }
}
```

#### 410 — expired code

```json
{
  "error": {
    "classification": "input_error",
    "code": "pair_code_expired",
    "message": "Pair code has expired: AB12CD",
    "details": {
      "pair_code": "AB12CD",
      "expires_at": "2026-03-22T00:21:02.000Z"
    }
  }
}
```

#### 403 — not admin

```json
{
  "error": {
    "classification": "auth_error",
    "code": "admin_required",
    "message": "Admin access required for pairing approval."
  }
}
```

### Notes for UI

Recommended UX mapping:

- `code_required` → form validation error
- `pair_code_not_found` → invalid code state
- `pair_code_expired` → expired code state with refresh/retry guidance
- `admin_required` → permission-denied state
- transport/network failure → generic request error with retry option

## 3) Remove binding

```http
DELETE /api/v1/pairings
Content-Type: application/json
```

### Request body

```json
{
  "chat_jid": "feishu:app123:userB"
}
```

### Example request

```bash
curl -X DELETE "$BASE_URL/api/v1/pairings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chat_jid":"feishu:app123:userB"}'
```

### 200 response

```json
{
  "ok": true,
  "removed": true,
  "chat_jid": "feishu:app123:userB"
}
```

### Edge case: binding not found

The current backend still returns HTTP 200, with:

```json
{
  "ok": true,
  "removed": false,
  "chat_jid": "feishu:app123:userB"
}
```

### Error responses

#### 400 — missing `chat_jid`

```json
{
  "error": {
    "classification": "input_error",
    "code": "chat_jid_required",
    "message": "chat_jid is required."
  }
}
```

#### 403 — not admin

```json
{
  "error": {
    "classification": "auth_error",
    "code": "admin_required",
    "message": "Admin access required for binding removal."
  }
}
```

### Notes for UI

- Always show a destructive-action confirmation before calling unbind
- Treat `removed: false` as a soft no-op, not a hard failure
- After success, refresh the list via `GET /api/v1/pairings`

## End-to-end flow examples

### A. Initial pairing flow

1. An unpaired identity attempts to use TiClaw
2. Backend creates or reuses a pending pair code
3. Admin opens pairing UI
4. UI calls `GET /api/v1/pairings`
5. Admin sees pending request and submits approval
6. UI calls `POST /api/v1/pairings/approve`
7. Backend marks pairing approved and persists binding
8. UI refreshes list and shows success

### B. Unbind flow

1. Admin opens binding management view
2. UI calls `GET /api/v1/pairings`
3. Admin chooses an existing binding
4. UI asks for confirmation
5. UI calls `DELETE /api/v1/pairings`
6. UI refreshes list and shows updated state

## Current limitations / contract caveats

This is the first backend iteration, so consumers should be aware of the following:

1. **No dedicated create-pairing HTTP endpoint yet**
   - Pending pairings are currently created through runtime/chat flow, not a public HTTP create endpoint.

2. **No separate reject endpoint yet**
   - Current HTTP API supports approve and unbind, but not an explicit “reject pending pairing” action.

3. **Success shape is documented, but error schemas are not yet fully emitted in OpenAPI**
   - Runtime now uses the standard protocol error envelope, but the lightweight route registry still focuses mainly on 200-response schemas.

4. **No pagination/filtering yet**
   - `GET /api/v1/pairings` returns full arrays.

5. **No dedicated binding detail endpoint yet**
   - Current management is list-oriented.

6. **No stable enum package exported yet**
   - Frontends should currently map states from string literals in payloads.

## Suggested frontend handling

For Supen or other UIs, recommended state buckets are:

- `unpaired`
- `pending_approval`
- `approved`
- `expired`
- `unbind_confirm`
- `empty_bindings`
- `request_error`
- `permission_denied`

Suggested retry behavior:

- retry list fetch on transient network failure
- do not auto-retry approval on unknown result
- refresh after successful approval/unbind

## OpenAPI

The node exposes an auto-generated OpenAPI document at:

```http
GET /api/v1/openapi.json
```

The pairing endpoints are included there, but this document is the more practical integration guide for UI work.
