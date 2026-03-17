# Implementation Gaps (Docs vs Runtime)

Date: 2026-03-17

This backlog tracks concrete gaps found when comparing design docs with current implementation.

## Current Gaps

## P0 (Security / correctness)

1. **Hub-side node authentication hardening**
   - Current: hub trusts `enroll`/`auth` messages without strong verification.
   - Target: token/fingerprint validation and explicit trust policy on hub side.

2. **Route-binding source unification**
   - Current: runtime routing source is `registered-groups.json`.
   - Target: either formalize this as long-term source, or migrate to `agent.json.sources` with backward compatibility.

## P1 (API and scheduler behavior)

1. **Schedule API parity improvements**
   - Add full update endpoint (`PUT /api/schedules/:id`) instead of toggle-only status updates.
   - Optional: add agent-scoped REST aliases (`/api/agents/:id/schedules`).

2. **True one-shot scheduling**
   - Current scheduler expects cron-compatible input for `next_run` computation.
   - Target: support explicit one-shot timestamps in create/update flow.

3. **`session: main` semantics cleanup**
   - Define and implement deterministic “main session” resolution per agent/channel.

4. **DingTalk default wiring decision**
   - Either import DingTalk in channel barrel by default, or keep optional and document as such everywhere.

## P2 (Observability and scale)

1. **Executor/task API completion**
   - `/api/tasks` and executor stats should expose real queue and active run metrics.

2. **Store access optimization**
   - Add session index to avoid full scans by `session_id`.
   - Use seek/stream tail for large JSONL files.

3. **Stream replay for reconnect**
   - Add replay endpoint keyed by `(stream_id, seq)` to improve delivery guarantees.

## Planned Work Management

- Prioritize P0 items first in implementation sequencing.
- Keep this file synchronized whenever docs are updated or roadmap items are completed.

## Status

- Docs have been updated to reflect current behavior as of 2026-03-17.
- This file tracks feature work still required to close the remaining drift.
