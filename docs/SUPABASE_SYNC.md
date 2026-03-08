# Supabase Sync (Robot / Cloud Backup)

TiClaw supports **sync mode**: local-first operation with continuous background push to Supabase. Connectivity and latency to Supabase do not affect normal operation—the robot always reads/writes locally and syncs asynchronously.

## Configuration

Sync is **off by default**. To enable, set `SUPABASE_SYNC_ENABLED=true` and add credentials.

Add to `~/ticlaw/config.yaml` or `.env`:

```yaml
supabase:
  sync_enabled: true
  url: https://your-project.supabase.co
  service_key: your-service-role-key
```

Or as environment variables:

```
SUPABASE_SYNC_ENABLED=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

If `SUPABASE_SYNC_ENABLED` is not set or not `true`, sync is disabled and TiClaw uses local storage only.

## What Gets Synced

| Data | Push | Pull |
|------|------|------|
| Mind state (persona, memory_summary) | ✓ | ✓ (cloud wins) |
| Mind packages (version history) | ✓ | ✓ |
| Sessions | ✓ | ✓ |
| Registered groups | ✓ | ✓ |
| Router state | ✓ | ✓ |
| `agents/{SOUL,IDENTITY,USER,MEMORY}.md`, `agents/{folder}/*.md` | ✓ | ✓ |

## Behavior

- **Pull:** On startup, if Supabase is configured, TiClaw pulls from Supabase before loading local state. If Supabase is unreachable, it continues from the last local copy.
- **Push:** Debounced (5s) after mind updates, session changes, or group registration. A periodic push runs every 5 minutes to catch group file changes.
- **Conflict strategy:** Single-device robot: cloud wins on pull. Multi-device: last-write-wins (eventual consistency).

## Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Run the migration to create tables:

   ```bash
   supabase db push
   # Or apply supabase/migrations/20250308000000_ticlaw_sync_schema.sql manually
   ```

3. Create a Storage bucket named `ticlaw` (private) for group memory files.
4. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (Project Settings → API → service_role key) to your config.

## Alignment with tiwater/ticlaw#6

Layered memory (short-term SQLite + long-term persistence) is implemented by keeping short-term in local SQLite and using Supabase as the long-term, cloud layer for mind state and agent mind files (SOUL, IDENTITY, USER, MEMORY — OpenClaw-compatible).
