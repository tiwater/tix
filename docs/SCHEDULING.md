# TiClaw Scheduling Architecture

## Core Principle

**There is one unified scheduler.** All periodic or delayed actions ("check every 30 minutes", "remind me in 30 minutes", "wake me up at 8am") are handled by a single deterministic Cron-based system.

There is no separate "Heartbeat" concept or `HEARTBEAT.md` file. Agents are entirely driven by their explicit schedules.

## Schedule Record

Every schedule is a single YAML file stored at:

```
~/.ticlaw/agents/{agent_id}/schedules/{schedule_id}.yaml
```

### Schema

```yaml
# Required
id: morning-briefing              # Human-readable identifier (slug)
cron: "0 9 * * *"                 # Standard 5-field/6-field cron expression or ISO date
prompt: |
  Generate today's briefing:
  weather, calendar, top emails.

# Optional (defaults shown)
type: cron                        # "cron" | "one-shot"
session: isolated                 # "main" | "isolated"
status: active                    # "active" | "paused"
delete_after_run: false           # true for one-shot reminders
created_at: 2026-03-15T10:00:00Z
next_run: 2026-03-16T09:00:00Z    # Computed by the scheduler
last_run: null
```

### Field Reference

| Field | Description |
|---|---|
| `id` | Human-readable slug. Must be unique per agent. |
| `cron` | Standard cron expression (`*/30 * * * *` = every 30 min) OR exact ISO date for one-shot. |
| `prompt` | The message sent to the agent when the schedule fires. |
| `type` | `cron` (recurring) or `one-shot` (runs once). |
| `session` | `main` = agent's primary conversational context (remembers recent chats). `isolated` = fresh context, no history pollution. |
| `status` | `active` or `paused`. Paused schedules are skipped. |
| `delete_after_run` | If true, the schedule file is deleted after execution. |

## How Users Manage Schedules

Schedules are **plain YAML files on disk**. Users can manage them in three ways:

### 1. Edit Files Directly

```bash
# Create a new schedule
vim ~/.ticlaw/agents/my-agent/schedules/daily-report.yaml

# Delete a schedule
rm ~/.ticlaw/agents/my-agent/schedules/daily-report.yaml
```

The scheduler picks up changes on the next poll cycle.

### 2. Via the Web UI

API endpoints:
- `GET /api/agents/:id/schedules` — list
- `POST /api/agents/:id/schedules` — create
- `PUT /api/agents/:id/schedules/:sid` — update
- `DELETE /api/agents/:id/schedules/:sid` — delete
- `POST /api/schedules/refresh` — force the scheduler to immediately check and execute due schedules

### 3. Via Agent Conversation (The "Schedule Skill")

The primary way users will interact with schedules is by conversing with the agent. 

When a user says *"remind me to set out after 30 minutes"*, the agent uses its **Schedule Skill** to parse the intent, generate the correct cron expression/timestamp, and write a `standup-reminder.yaml` file into its own `schedules/` directory.

## Scheduler Loop

```
┌─────────────────────────────────────────────┐
│               Scheduler Loop                │
│           (polls every 60 seconds)          │
├─────────────────────────────────────────────┤
│                                             │
│  1. Scan all agents/{id}/schedules/*.yaml   │
│  2. Filter: status === 'active'             │
│     AND next_run <= now                     │
│  3. For each due schedule:                  │
│     ├── Determine session mode              │
│     │   ├── main → use agent's latest       │
│     │   └── isolated → use cron:{id}        │
│     ├── Submit prompt to AgentRunner        │
│     ├── On completion:                      │
│     │   └── Emit result to chat             │
│     ├── Compute next_run from cron          │
│     └── If delete_after_run → remove file   │
│                                             │
└─────────────────────────────────────────────┘
```

## Session Modes

### Main Session (`session: main`)
- Runs within the agent's primary conversational context.
- The agent remembers recent user conversations.
- Best for: reminders, contextual check-ins, continuous monitoring tasks ("check my email every 30 mins").

### Isolated Session (`session: isolated`)
- Runs in a fresh context (`cron:{schedule_id}`).
- No history pollution — the main chat stays clean.
- Best for: heavy analysis, daily reports, autonomous background jobs.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SCHEDULER_POLL_INTERVAL` | `60000` (1m) | How often the scheduler checks for due schedules. |
| `TIMEZONE` | `Asia/Shanghai` | Timezone for cron evaluation. |
