# Agent Mind Architecture (MIND.md)

TiClaw agents possess a continuous memory and persona framework inspired by the OpenClaw standard. The agent's "mind" is defined by four distinct Markdown files that live inside the agent's dedicated workspace (`~/.ticlaw/agents/<agent_id>/`).

The agent is fully aware of these files and actively uses its file-editing capabilities to update them as it learns new information.

## The Core Files

### 1. `SOUL.md` (The DNA)
**Purpose:** Core system instructions, hard boundary rules, and immutable ethical directives.
**Maintained by:** Usually you (the operator).
**Behavior:** This file acts as the ultimate guardrail for the agent. It defines things like "Private things stay private," "When in doubt, ask before acting externally," and any specific rules the agent must never break. The agent rarely updates this file itself.

### 2. `IDENTITY.md` (The Persona)
**Purpose:** Who the agent is: its adopted name, background story, creature type, tone of voice, and signature emoji.
**Maintained by:** The Agent.
**Behavior:** The agent uses this file to construct its sense of self during conversations. If you instruct the agent to adopt a new name or a specific personality ("from now on, you are a snarky senior developer named Adam"), the agent will automatically update this file.

### 3. `USER.md` (The Human Counterpart)
**Purpose:** Who *you* are: your name, your timezone, your project context, and your behavioral preferences.
**Maintained by:** The Agent.
**Behavior:** Over time, as the agent learns your preferences (e.g., "I prefer concise JSON responses," or "my working directory is always `/src/app`"), it will document these facts here so it remembers them across all future sessions.

### 4. `MEMORY.md` (Long-Term Knowledge)
**Purpose:** Curated long-term facts, environmental knowledge, rules, and system details.
**Maintained by:** The Agent.
**Behavior:** While TiClaw captures everything in daily raw journals (`memory/YYYY-MM-DD.md`), `MEMORY.md` acts as the consolidated, high-signal knowledge base. The agent actively graduates important facts from the daily journal into this long-term memory file.

---
By allowing the agent to mutate its own `IDENTITY.md`, `USER.md`, and `MEMORY.md`, TiClaw agents natively achieve true continuity and an evolving relationship with their operators across sessions. 
