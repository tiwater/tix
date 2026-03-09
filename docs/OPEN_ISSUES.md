# Open Issues (Future Implementation)

Items discussed but deferred for later implementation. Report as GitHub issues when ready.

---

## 1. Built-in Robot Skills

**Context:** TiClaw is a robot mind builder; it should control physical robots when configured. Ticos defines: `terminal_motion`, `text_to_speech`, `navigate_to`, `pick_up_object`.

**TODO:**
- MCP client bridge: connect to robot MCP server, expose tools to agent
- Config: `robot.enabled`, `robot.mcp_url` in config.yaml
- Merge robot tools into agent when configured; graceful fallback when not

**Ref:** [docs/ROBOT_SKILLS.md](ROBOT_SKILLS.md)

---

## 2. Curated Skills List

**Context:** No ClawHub; skills come from a curated list only (REQUIREMENTS.md).

**TODO:**
- Define curated skills registry (e.g. `skills/curated.yaml` or similar)
- Implement install flow: `ticlaw skills install <curated-skill-name>`
- No runtime download from external marketplaces

---

## 3. Sub-Agents for Complex Tasks

**Context:** Each agent can have sub-agents for complex tasks (OpenClaw supports this).

**TODO:**
- Design sub-agent delegation model
- Agent A delegates to Agent B for specific task types
- Integration with OpenClaw sub-agent patterns if applicable

---

## 4. DB Schema Rename (group → agent)

**Context:** Full consistency: `registered_groups` → `registered_agents`, `group_folder` → `agent_folder`.

**Done:** Supabase schema uses `registered_agents` and `agent_folder` (migration never executed, updated in place).

**TODO (local SQLite):**
- Migration: `ALTER TABLE registered_groups RENAME TO registered_agents`
- Migration: add `agent_folder` column, backfill, drop `group_folder` (or use SQLite 3.35+ `RENAME COLUMN`)
- Update all code references (db.ts, task-scheduler, cli, etc.)

---

*Last updated: March 2026*
