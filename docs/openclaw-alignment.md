# TiClaw & OpenClaw Alignment Design

This document outlines how TiClaw's memory and persona architecture aligns with the [OpenClaw Templates Specification](https://docs.openclaw.ai/reference), and identifies gaps for future development.

## Current Alignment

TiClaw implements an almost 1:1 mapping of the OpenClaw standard due to its utilization of the Claude Agent SDK and local file system permissions.

1. **`SOUL.md`**: Implemented. The TiClaw agent loads this as its highest priority set of immutable rules.
2. **`IDENTITY.md` and `USER.md`**: Implemented. The agent is explicitly instructed to mutate these files actively when its persona or the user's preferences change.
3. **`MEMORY.md`**: Implemented. The agent actively preserves long-term facts by editing this file during sessions.
4. **Session Startup (`AGENTS.md`)**: Implemented. TiClaw natively mimics the OpenClaw `AGENTS.md` spec by automatically prepending recent `memory/YYYY-MM-DD.md` logs to the system prompt. It also automatically handles saving to daily logs upon task completion.

---

## Technical Gaps & Future Work

While the core functionality is aligned, the following three implementation gaps remain to achieve full feature parity with the OpenClaw standard:

### 1. Weak Initial Defaults for Mind Files
Currently, `packages/node/src/core/runner.ts` initializes new agents with blank files (e.g., `# SOUL.md\n\nInitialized.`). 
**Design Goal**: We should inject robust default templates holding standard safety boundaries (e.g., *"Private things stay private. When in doubt, ask before acting externally"*) during the initial `fs.writeFileSync()` creation sequence.

### 2. Lack of Automatic "First Run" Bootstrapping
OpenClaw designates a `BOOTSTRAP.md` workflow designed to interview the user on their first session.
**Design Goal**: TiClaw could implement an automated onboarding flow. If `IDENTITY.md` only contains the default boilerplate, the frontend or backend could trigger a specialized "Bootstrap" instruction telling the agent to interview the user before accepting normal commands.

### 3. Automated Memory Maintenance (Heartbeats)
OpenClaw relies on a "Heartbeat" cron pattern to routinely read, compress, and consolidate `memory/*.md` daily logs into `MEMORY.md`. Currently, TiClaw only consolidates memories actively during an engaged user session.
**Design Goal**: We should leverage the existing TiClaw `mcp-scheduler` to dispatch an automatic background event (e.g., daily at 2:00 AM) that commands the agent to read yesterday's logs and extract the salient points into long-term `MEMORY.md`. 
