# Production Readiness Review (OpenTix-Alternative Focus)

Date: 2026-03-17

## Verdict

**Not yet production-level** for broad multi-tenant deployment.

Architecture and UX foundations are solid, but there are still correctness and hardening gaps that should be addressed before labeling as production-grade.

## Current State (As Implemented)

## What is strong already

1. **End-to-end streaming pipeline exists**
   - Computer emits progressive events and streaming deltas.
   - Web client merges incremental output and reconciles with final authoritative message.

2. **Skill governance model is mature for a self-hosted runtime**
   - Permission levels, install/enable controls, compatibility checks, and audit signals are present.

3. **Filesystem persistence is simple and inspectable**
   - Sessions/messages/events/schedules are all human-readable on disk.

4. **Multi-channel and hub/node topology are already usable**
   - Discord/Feishu/HTTP/ACP + hub relay are integrated in one runtime model.

## Production blockers

1. **CI baseline is not production-ready**
   - `pnpm test` currently exits with "No test files found" (`vitest` include is `src/**/*.test.ts`).
   - A production pipeline should have stable, non-empty default test coverage.

2. **Hub-side authentication is weak**
   - Hub currently accepts `enroll` / `auth` and marks connections trusted without strong verification.
   - This must be hardened before zero-trust/public edge deployment.

3. **Store access patterns can degrade at scale**
   - `getSession(sessionId)` scans agent/session directories.
   - JSONL tail helper reads full file into memory before slicing.

4. **Executor/task telemetry path is incomplete**
   - `/api/tasks` and executor stats surfaces are currently stub-like in many flows.

5. **Concurrency/backpressure controls are limited**
   - Per-chat mutex exists, but global durable queue/circuit breaker policy is not yet implemented.

## Area-by-area assessment

### Streaming: **Good baseline, needs replay-grade robustness**

- Positive:
  - Stream sequence metadata (`stream_id`, `seq`) exists.
  - Client dedup logic is implemented.
- Gaps:
  - No server-side replay endpoint for reconnect-from-sequence semantics.

### Skills: **Strong governance, enterprise runtime hardening pending**

- Positive:
  - Capability checks and privilege gates are practical and explicit.
- Gaps:
  - Additional sandboxing/audit export controls are needed for strict enterprise controls.

### Memory/Store: **Functional, scan-heavy**

- Positive:
  - Transparent persistence model.
- Gaps:
  - Need indexes / seek-based reads for large agent/session counts.

### Security: **Node trust exists; hub trust requires hardening**

- Positive:
  - Node enrollment token model has TTL/hash/freeze controls.
- Gaps:
  - Hub handshake should enforce cryptographic verification and explicit trust policy.

## Planned Remediation

## Priority remediation plan

1. **Fix test baseline immediately**
   - Restore runnable default test suite and enforce pass/fail gate in CI.

2. **Harden hub authentication**
   - Verify token/fingerprint at hub side.
   - Add rotation and revocation strategy.

3. **Improve data access performance**
   - Add session index (`session_id -> agent_id`).
   - Implement true tail-read/seek for JSONL.

4. **Complete task/executor observability**
   - Make `/api/tasks` and executor stats non-stub, with real queue/run metrics.

5. **Add robust delivery/replay semantics**
   - Add stream replay by `(stream_id, seq)` and reconnect recovery endpoints.

## Final assessment

Tix is suitable for advanced staging/self-hosted use today, but should still be labeled **beta / pre-production** for broader production claims until hub auth, CI baseline, and scale/observability gaps are addressed.
