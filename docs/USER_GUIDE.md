# 🦀 TiClaw User Guide

Welcome to TiClaw, a mind builder. This guide explains how to use the system via your chosen channel (Discord, Feishu, etc.) — from mind evolution to build tasks.

---

## 🚀 Getting Started

### 1. Engine Initialization
Before the AI can work, the engine must be running on your host machine (e.g., Mac Mini):

```bash
pnpm install
pnpm run build
pnpm start
```
*Look for channel connection messages in the terminal (e.g. `Discord bot connected`, `Feishu long connection active`).*

### 2. Configuration
Configure `~/.ticlaw/config.yaml` with at least one channel:
- **Discord:** Disabled by default. Set `channels.discord.enabled: true` and `channels.discord.token` (or `TC_DISCORD_ENABLED=true` and `TC_DISCORD_TOKEN`) to enable.
- **Feishu:** `channels.feishu.app_id` and `channels.feishu.app_secret` — see [Feishu Setup](FEISHU_SETUP.md)
- **LLM:** `llm.api_key` (OpenRouter), `llm.model`
- **Workspace skill:** `TC_CODING_CLI` — optional. Set to `"gemini"`, `"codex"`, or `"claude"` when you want the agent to use a coding CLI for repo/code tasks. The agent handles most tasks directly; this is just one skill.
- **Proxy:** `proxy` (or `HTTPS_PROXY` / `HTTP_PROXY`) — **required in China** for LLM calls, Discord, and Feishu. Example: `proxy: "http://127.0.0.1:7890"` in config.yaml, or `HTTPS_PROXY="http://127.0.0.1:7890"` in .env.

### 3. Repository Environment Seeding (Optional but Recommended)
To automate the creation of `.env` files for the projects TiClaw works on:
1. Create a directory: `config/environments/`.
2. Add `.env` files named after your repositories (e.g., `ticos.env` for `tiwater/ticos`).
3. TiClaw will automatically copy this file into the workspace when setting up a build task.

---

## 🛠 Command Reference

TiClaw is commanded through your channels (Discord, Feishu, etc.). All task-specific commands should be run within the **thread** or **chat** created for that task.

### 🧠 Mind-first: natural conversation

**Every message you send** (except `/mind` commands) updates the agent's mind. Persona and memory evolve through daily interaction. No special command needed — just talk.

### 🧠 `/mind` — Mind control plane

**Usage:** Inspect and govern the agent's mind.

| Subcommand | Description |
|------------|-------------|
| `/mind status` | Show mind version, lifecycle, persona |
| `/mind lock` | Lock the mind for production (main group only) |
| `/mind unlock` | Unlock for further evolution |
| `/mind set <tone\|verbosity\|emoji> <value>` | Adjust persona |
| `/mind package create` | Create a mind snapshot (main group only) |
| `/mind package list` | List recent mind packages |
| `/mind diff <from> <to>` | Diff two mind versions |
| `/mind rollback <version>` | Roll back to a previous mind version (main group only) |

### 🦀 Workspace and build tasks

**Usage:** @mention the bot. The agent handles most tasks directly. When it needs to run code or access a repo, it uses the workspace skill (coding CLI in Tmux).

- **Discord:** `@TiClaw fix the bug in auth.ts` or `@TiClaw what was the last commit?`
- **Feishu:** Same pattern — mention the bot and describe the task.
- **Legacy `/claw`:** On Discord, `/claw <task>` is converted to `@TiClaw <task>`.

The workspace skill creates `~/.ticlaw/factory/{folder}` when needed, clones the repo, and runs the coding CLI (Gemini, Codex, or Claude) in headless mode.

### 📸 `/verify [URL]` (planned)

**Usage:** Trigger automated UI verification.

- **Planned:** Playwright browser, screenshot, upload to channel.

### 🚀 `/push` (planned)

**Usage:** Finalize the task and create a PR.

- **Planned:** Summarize changes, create PR via GitHub CLI, optionally relay live preview URL.

---

## 📺 Monitoring & Observability

TiClaw provides three layers of "Live Monitoring":

1.  **The Delta Feed:** Every time the AI modifies a file, a Gemini-powered summary (e.g., *"Modified auth logic to support JWT"*) is posted to the channel.
2.  **Live Snapshots:** If the AI is working on UI, it may automatically trigger snapshots that appear in the thread.
3.  **Workspace output:** When the workspace skill completes, the result is delivered to the channel.

---

## 🛡 Security & Best Practices

- **Physical Isolation:** Each task is isolated in its own folder. TiClaw will never touch files outside of `~/.ticlaw/factory/`.
- **Port Locking:** If your task starts a web server, TiClaw assigns a unique port (3000-3050) to prevent conflicts.
- **Review Before Merge:** Always review the AI-generated PR before merging. Use the automated Playwright screenshots to verify UI changes visually from your phone or desktop app.

---

*TiClaw: Mind builder — personality and memory through interaction.*
