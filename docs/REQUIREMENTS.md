# TiClaw Requirements & Philosophy

This document outlines the foundational requirements and design principles for TiClaw — a mind builder designed as a black-box core with a plugin ecosystem.

---

## 🎯 The Mission: Mind Builder

TiClaw is designed to be a **mind builder**. It builds personality and memory that evolve through daily interaction, with lock, rollback, and cloud sync for deployment. It can also execute coding tasks when the mind needs to build or fix things.

---

## 📜 Core Philosophy

### 1. Small Enough to Understand (Clean Architecture)
The codebase must remain readable by a single senior engineer. We avoid unnecessary abstraction layers. Logic flows linearly: **Request -> Factory -> Execution -> Relay**.

### 2. Black-Box Core + Plugin Ecosystem
The engine core is a **closed, installable package** (`npm install -g ticlaw`). Users never modify engine source code. Extensibility is achieved through:
- **Channel plugins** — npm packages that implement the `Channel` interface (e.g., `@ticlaw/channel-discord`, `@ticlaw/channel-telegram`)
- **CLI drivers** — pluggable agent backends (Gemini CLI, Claude Code, Codex)
- **Configuration files** — not code changes

This enables clean upgrades (`npm update ticlaw`), broad adoption, and a healthy ecosystem.

### 3. Physical-First Isolation
While we support containers for generic tasks, TiClaw prioritizes **Physical Workspace Isolation**.
- Every task lives in a dedicated directory: `~/ticlaw/factory/{id}`.
- This provides the AI native access to host toolchains (Node, Go, Rust, etc.) while preventing cross-task contamination.

### 4. Agent-Centric Model
Each **agent** has one mind (SOUL, MEMORY, IDENTITY, USER) and multiple **channels** (Discord, Feishu, etc.). One agent can serve multiple rooms (chats) across channels. For cloud deployment, multiple agents can run on one instance, each with its own Feishu bot mapping.

### 5. Config-Driven Channels
Channels are enabled via `config.yaml`, not code changes. Only channels with a config block and `enabled !== false` are started. Add `channels.discord` or `channels.feishu` to enable; omit or set `enabled: false` to disable. No code merge required.

### 6. Workspace Skill (Optional)
The agent handles most tasks directly. When it needs to run code or access a repo, it can use the **workspace skill** — a pluggable coding CLI:
- **Gemini CLI (Default):** Personal subscriptions, high-speed execution.
- **Claude Code:** Anthropic's agentic SDK.
- **Codex:** Alternative coding CLI.

---

## 🛠 Functional Requirements

### A. Automated Workspace "The Factory"
- **Workspace Orchestration:** A standardized flow to clone, branch, and bootstrap any GitHub repository.
- **Environment Seeding:** Granular, recursive `.env` seeding from `~/ticlaw/config/environments/` to support complex monorepos.
- **Auto-Bootstrap:** Automatic detection and execution of project-specific setup scripts and package managers.

### B. Deep Observability (The Audit Trail)
- **The Delta Feed:** An engine-level event that generates Gemini-powered "Plain English" summaries of code changes.
- **Artifact Relay:** Automated mechanism to push screenshots and terminal logs back to the control channel.
- **Headless Workspace:** The workspace skill runs the coding CLI in headless mode (subprocess per prompt). No persistent terminal.

### C. Verification & Delivery
- **UI Verification Loop:** Integrated browser automation (Playwright) within the physical factory for visual audits.
- **PR Automation:** Pipeline to finalize tasks by creating GitHub Pull Requests with context-aware descriptions derived from the Git Diff and conversation history.
- **Live Preview Environments:** We strongly recommend integrating branch-based deployment platforms (e.g., **Render.com**, **Vercel**, **Railway**) into the project's CI/CD. This allows the AI-generated PR to be accompanied by a live, shareable URL for manual stakeholder verification.

---

## 🏗 Architectural Guidelines

### Skills-Based Extensibility

The engine extends through **skills** — self-contained packages that combine agent instructions (SKILL.md) with implementation code:

| Extension Point | Mechanism | Example |
|----------------|-----------|---------|
| **Channels** | Skill with `Channel` implementation | `skills/add-discord/`, `skills/add-feishu/` — adds channel connectivity |
| **CLI Drivers** | Config (`TC_CODING_CLI`) | `TC_CODING_CLI=gemini` switches the agent backend |
| **MCP Tools** | Standard MCP config | MCP server discovery and tool calling |

Skills are the primary extensibility mechanism. Adding a new channel means creating a skill that provides a `Channel` implementation, handles credential setup, and self-registers at startup.

### OpenClaw Mind Spec (SOUL / MEMORY / IDENTITY / USER)

TiClaw uses the **OpenClaw mind format** for full compatibility: SOUL.md (personality), MEMORY.md (facts), IDENTITY.md, USER.md. These evolve through conversation — persona and memory updates sync to files automatically. No ClawHub; skills come from a curated list only.

### Data Decentralization
All transient data, databases, and logs must reside in **`~/ticlaw/`**, keeping the source repository strictly for engine logic.

---

*TiClaw: Mind builder — personality and memory through interaction.*
