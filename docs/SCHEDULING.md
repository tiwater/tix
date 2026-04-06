# Tix Scheduling Architecture

## Core Principle

Tix uses one scheduler loop for all periodic work. The loop runs every 60 seconds and evaluates schedule records under each agent.

Current runtime behavior is **cron-first**:
- due detection is based on `next_run <= now`
- `next_run` is computed from `cron` using `cron-parser`
- a forced refresh (`POST /api/schedules/refresh`) can run all active schedules immediately

## Schedule Record

Each schedule is a YAML file:

```
~/.tix/agents/{agent_id}/schedules/{schedule_id}.yaml
```

### Schema (Current Implementation)

```yaml
id: "6b4f3e9a-..."                # UUID when created via API/tool
agent_id: "web-agent"
cron: "0 9 * * *"                 # cron-parser-compatible expression
prompt: "Generate daily briefing"

# Optional (defaults shown)
type: "cron"                       # "cron" | "one-shot" (metadata)
session: "isolated"                # "main" | "isolated"
status: "active"                   # "active" | "paused"
target_jid: "feishu:app:chat"      # optional target routing
delete_after_run: false
next_run: "2026-03-18T01:00:00Z"
last_run: null
created_at: "2026-03-17T12:00:00Z"
```

### Field Notes

- `id`: API/tool creation uses UUID. Manual files can use custom IDs.
- `cron`: currently expected to be a cron expression. ISO one-shot timestamps are not parsed by the scheduler.
- `type`: retained as metadata; execution still uses cron + `next_run`.
- `delete_after_run`: if `true`, the file is deleted after execution.
- invalid `cron`: scheduler logs error and pauses the schedule (`status: paused`).

## Schedule Management Paths

### 1. Direct File Editing

```bash
# create
vim ~/.tix/agents/my-agent/schedules/my-task.yaml

# delete
rm ~/.tix/agents/my-agent/schedules/my-task.yaml
```

### 2. HTTP API (Current)

- `GET /api/schedules?agent_id=<id>`
- `POST /api/schedules`
- `POST /api/schedules/:id/toggle` (body: `{ "status": "active" | "paused" }`)
- `DELETE /api/schedules/:id`
- `POST /api/schedules/refresh`

`POST /api/schedules` body:

```json
{
  "agent_id": "web-agent",
  "prompt": "Send daily report",
  "cron": "0 9 * * *",
  "target_jid": "web:web-agent:web-session"
}
```

### 3. Built-in / MCP Tools

- `create_schedule`
- `list_my_schedules`
- `delete_schedule`

These map to the same store and scheduler loop.

## Scheduler Loop (Current)

1. Load due schedules (`status=active` and `next_run<=now`, or all active when forced refresh).
2. Build route target:
   - `baseJid = target_jid || web:{agent_id}`
   - isolated: `chat_jid = {baseJid}:sched-{schedule_id}`
   - main: `chat_jid = {baseJid}`
3. Ensure session exists.
4. Enqueue prompt as a normal inbound message.
5. After enqueue:
   - if `delete_after_run=true`, delete file
   - else recompute `next_run` from `cron`; pause if invalid

## Session Modes (Current Behavior)

### `session: main`

- Reuses `baseJid`.
- Session ID is derived as:
  - from `target_jid` suffix when provided
  - otherwise defaults to `agent_id`

### `session: isolated`

- Uses `sched-{schedule_id}` session ID.
- Chat JID is namespaced (`...:sched-{schedule_id}`), preventing pollution of main chat history.

## Time Configuration

| Item | Current Behavior |
|---|---|
| Scheduler poll interval | Fixed at 60s (`SCHEDULER_POLL_INTERVAL = 60000` in code) |
| Cron timezone | `TIMEZONE` from `process.env.TZ` or system timezone |

## Planned Enhancements

1. Native one-shot timestamp support (non-cron schedule input).
2. API-level update endpoint (`PUT /api/schedules/:id`) for full record edits.
3. Optional user-provided stable IDs in API creation flow.
