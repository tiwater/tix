# Open Issues (Future Implementation)

Items discussed but deferred for later implementation. Report as GitHub issues when ready.

---

## 1. Curated Skills List

**Context:** No ClawHub; skills come from a curated list only (REQUIREMENTS.md).

**TODO:**
- Define curated skills registry (e.g. `skills/curated.yaml` or similar)
- Implement install flow: `ticlaw skills install <curated-skill-name>`
- No runtime download from external marketplaces

---

## 2. Sub-Agents for Complex Tasks

**Context:** Each agent can have sub-agents for complex tasks (OpenClaw supports this).

**TODO:**
- Design sub-agent delegation model
- Agent A delegates to Agent B for specific task types
- Integration with OpenClaw sub-agent patterns if applicable

---

## 3. DB Schema Rename (group → agent)

**Context:** Full consistency: `registered_groups` → `registered_agents`, `group_folder` → `agent_folder`.

**TODO:**
- Migration: `ALTER TABLE registered_groups RENAME TO registered_agents`
- Migration: add `agent_folder` column, backfill, drop `group_folder` (or use SQLite 3.35+ `RENAME COLUMN`)
- Update all code references

---

*Last updated: March 2026*
