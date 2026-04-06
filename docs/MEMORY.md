# Tix Memory System

## 1. Purpose

This document defines the complete memory model used by Tix today and the next-step design for a built-in embedding + semantic search provider.

Goals:
- Make memory behavior explicit and debuggable.
- Keep filesystem-first design.
- Preserve strict agent/session isolation boundaries.
- Add semantic retrieval without requiring an external DB by default.

---

## 2. Memory Tiers (Current)

| Tier | Files | Owner | Read Path | Write Path |
|---|---|---|---|---|
| Identity/persona | `SOUL.md`, `IDENTITY.md`, `USER.md` | Human/admin | `AgentComputer.preparePrompt()` | Manual edit / sync |
| Long-term memory | `MEMORY.md` | Human/admin (and future memory tools) | `AgentComputer.preparePrompt()`, `/api/mind`, `/api/mind/files` | Manual edit / sync |
| Short-term journals | `memory/YYYY-MM-DD.md` | Runtime | `AgentComputer.preparePrompt()` (latest 3 files) | `AgentComputer.consolidateMemory()` |
| Session transcript | `sessions/{sid}/messages.jsonl` | Runtime | `processMessages()` (`getMessagesSince`, `getRecentMessages`) | `storeMessage()` |
| Session continuation handle | `.claude_sessions/{encoded_session_id}.id` | Runtime | `loadClaudeSessionId()` | `saveClaudeSessionId()` |
| Ephemeral run state | in-memory maps (`warmSessions`, `activeHandlers`) | Runtime process | `AgentComputer.run()` | `AgentComputer.run()` |

---

## 3. End-to-End Memory Flow (Current)

1. Channel receives message and appends it to `messages.jsonl`.
2. `processMessages()` collects:
   - new pending user messages since last processed timestamp;
   - recent history window (currently 10 messages) for short-term context.
3. `AgentComputer` prepares system prompt from:
   - root mind files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`);
   - recent short-term journals (`memory/*.md`, latest 3 files).
4. `AgentComputer.run()` sends the assembled context text as the user prompt.
5. Run result is sent back to channel and appended to transcript.
6. `consolidateMemory()` appends a compact task-result bullet into the current day journal file.
7. Prompt cache invalidates on root mind-file changes and journal file mtime changes.

---

## 4. Isolation Rules (Current)

### Agent isolation
- All memory artifacts are scoped under `~/.tix/agents/{agent_id}/`.
- No memory should be read/written across agent directories.

### Session isolation
- Warm computer subprocess key is `agent_id + session_id`.
- Claude resume ID file is session-scoped (`.claude_sessions/{encoded_session_id}.id`).
- Concurrent runs in different sessions of the same agent must not share handlers.

### API scope
- `GET /api/mind?agent_id=...` exposes long-term view (`SOUL.md` + `MEMORY.md`).
- `GET /api/mind/files?agent_id=...` exposes root mind files only (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`).
- Journals under `memory/` are runtime short-term memory and not included in `/api/mind/files`.

---

## 5. Known Gaps

- Retrieval is mostly recency-based (recent transcript + recent journals).
- No semantic recall ranking across large history.
- No conflict-resolution policy between old memories and new facts.
- Journal compaction and transcript summarization lifecycle are minimal.

---

## 6. Built-in Embedding + Search Provider (Planned)

## 6.1 Why

We need semantic retrieval so long-lived agents can find relevant memory across large transcripts/journals while keeping local-first behavior.

## 6.2 Design Principles

- Built-in and enabled via config (no mandatory external DB).
- Filesystem-first artifacts, inspectable by humans.
- Strict per-agent isolation and optional per-session filtering.
- Best-effort fallback to lexical retrieval if embedding backend is unavailable.

## 6.3 Provider Contract

```ts
export interface MemoryChunk {
  id: string;
  agent_id: string;
  session_id?: string;
  source: 'message' | 'journal' | 'memory_md';
  source_ref: string;
  created_at: string;
  text: string;
  tags?: string[];
}

export interface MemoryHit {
  chunk: MemoryChunk;
  similarity: number;
  recency: number;
  final_score: number;
}

export interface MemoryProvider {
  ingest(chunks: MemoryChunk[]): Promise<void>;
  search(input: {
    agent_id: string;
    session_id?: string;
    query: string;
    top_k: number;
  }): Promise<MemoryHit[]>;
  deleteBySession(agent_id: string, session_id: string): Promise<void>;
}
```

## 6.4 Built-in Implementation: `builtin-fs-vector`

Per-agent index files:

```text
agents/{agent_id}/memory/index/
  meta.json                # provider version, model, dimensions
  chunks.jsonl             # MemoryChunk records
  vectors.jsonl            # {chunk_id, vector:[...], model, dims}
  cursors.json             # last indexed message/journal offsets
```

Notes:
- JSONL keeps data inspectable and easy to migrate.
- `vectors.jsonl` is acceptable for small/medium scale; can evolve to packed binary later.

## 6.5 Ingestion Strategy

Sources:
- session transcript (`messages.jsonl`) user+bot content;
- journals (`memory/*.md`) entries;
- optional chunking of `MEMORY.md` sections.

Chunking defaults:
- target chunk size: ~500 chars;
- overlap: ~50 chars;
- preserve metadata (`agent_id`, `session_id`, source file/date).

## 6.6 Retrieval Strategy

1. Embed incoming query.
2. Compute cosine similarity against candidate vectors.
3. Apply blended score:
   - `final = sim * 0.75 + recency * 0.20 + source_weight * 0.05`
4. Return top-K with hard scope filter on `agent_id`.
5. Optional session boost when `session_id` is provided.

Prompt injection policy:
- add a `## Relevant Memory` block before task execution;
- include top 4-8 snippets, bounded by token budget;
- keep existing root mind files and recent journals.

## 6.7 Fallback Behavior

If embedding provider fails:
- log warning;
- fallback to lexical retrieval over recent transcripts + journals;
- do not block run execution.

---

## 7. Config (Planned)

```env
MEMORY_PROVIDER=none|builtin-fs-vector
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MEMORY_SEARCH_TOP_K=8
MEMORY_SEARCH_MIN_SCORE=0.35
MEMORY_RETRIEVAL_MAX_SNIPPETS=6
```

Default recommended rollout:
- `MEMORY_PROVIDER=none` initially;
- enable `builtin-fs-vector` behind feature flag.

---

## 8. API Additions (Planned)

- `POST /api/memory/search` (admin/debug):
  - input: `agent_id`, optional `session_id`, `query`, optional `top_k`;
  - output: scored hits with source metadata.
- `POST /api/memory/reindex`:
  - rebuild index for one agent.
- `GET /api/memory/status?agent_id=...`:
  - provider status, index counts, last cursor.

---

## 9. Rollout Plan

1. **Phase 1 (foundation)**
   - Add `MemoryProvider` interfaces and config plumbing.
   - Add index schema (`memory/index/*`) and cursor tracking.
2. **Phase 2 (ingestion + search)**
   - Implement chunker + embedding + cosine ranking.
   - Add fallback lexical search.
3. **Phase 3 (prompt integration)**
   - Inject `Relevant Memory` snippets in computer prompt with strict budget.
4. **Phase 4 (ops + tests)**
   - Add E2E tests for memory recall/isolation.
   - Add reindex tooling and health metrics.

---

## 10. Acceptance Criteria

- No cross-agent memory leakage.
- No cross-session handler/resume leakage.
- Deterministic retrieval given fixed corpus/query.
- Prompt budget protected when injecting retrieved memories.
- System remains functional when provider is disabled or degraded.

---

Last updated: 2026-03-17
