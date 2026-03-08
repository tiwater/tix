# Mind System Test Matrix

## Scope
- Natural conversation driven mind evolution
- Mind lock governance and anti-tamper behavior
- Slash command control plane

## Layers

### 1) Unit
- intent classification: task/persona/memory/mixed
- persona patch updates
- locked lifecycle blocks natural persona mutation
- package create/list/diff/rollback core logic

### 2) Integration
- router -> interaction event -> mind update
- slash command -> governance action -> db state
- rollback consistency across state/package tables

### 3) E2E
- multi-channel consistency (Discord + Feishu adapters)
- locked mind anti-tamper:
  - user natural prompt cannot mutate persona
  - main control group slash can lock/unlock/publish/rollback

## P0 Assertions
1. Locked mind rejects natural-language persona edits.
2. Governance actions require main control group.
3. Rollback restores expected persona state.
4. Governance logs are emitted for sensitive commands.

## CI Plan
- PR gate: Unit + Integration
- Nightly/manual: E2E

## Initial Cases Implemented
- `src/core/mind.test.ts`
  - persona update from natural text
  - lock blocks mutation
  - package create/list/rollback
  - diff output contains changed fields
