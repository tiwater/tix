# 🦀 TiClaw

<p align="center">
  <img src="assets/ticlaw-logo.png" alt="TiClaw" width="400">
</p>

<p align="center">
  <b>Robot Mind Builder.</b><br>
  Multi-channel, personality & memory evolution, production-ready.
</p>

<p align="center">
  Forked from <a href="https://github.com/qwibitai/nanoclaw">NanoClaw</a>
</p>

TiClaw is a platform for building robot minds: personality and memory that evolve through daily interaction. Connect via Discord, Feishu, or other channels; the mind forms stable identity and usable memory over time, with lock, rollback, and cloud sync for deployment.

## 🌊 The Vision

TiClaw is a **robot mind builder**. It focuses on:
- **Mind System:** Persona and memory evolve through daily conversation; lock for production, rollback when needed.
- **Multi-Channel:** Discord, Feishu (飞书), and more. One mind, many touchpoints.
- **Physical Factory:** Isolated workspaces for coding tasks when the robot needs to build or fix things.
- **💻 Workspace skill:** Optional coding CLI (Gemini, Codex, Claude) — used only when the agent needs to run code or access a repo.

## 🛠 Core Capabilities

- **🧠 Mind System:** Persona and memory evolve through daily conversation. Lock for production, rollback when needed. `/mind` for status, lock, unlock, package, diff, rollback.
- **🦀 Workspace skill:** The agent handles most tasks directly. When it needs to run code or access a repo, it can use the optional workspace skill (Gemini/Codex/Claude CLI). Physical `~/ticlaw/factory/{folder}` isolation.
- **📺 Live Monitoring:** Workspace skill output delivered to the channel when done.
- **📸 Vision-Backed Audit:** Automated macOS screenshots for UI changes and Gemini-powered "Delta Feeds" for code summaries.
- **🚀 PR Pipeline:** Seamless transition from "Issue Solved" to "PR Created" with automated context-aware descriptions (when configured).

## 🚀 Quick Start

```bash
git clone https://github.com/tiwater/ticlaw.git
cd ticlaw
pnpm install
# Setup config: ~/ticlaw/config.yaml (channels: discord/feishu, llm, etc.)
pnpm start
```

## Why We Built TiClaw

TiClaw extends [NanoClaw](https://github.com/qwibitai/nanoclaw) with a **mind system**: personality and memory that form through interaction, persist across sessions, and can be locked for production. Transparency and reliability are non-negotiable.

## Philosophy

**Transparent by Default.** Every shell command and log is streamed in real-time. No "black box" AI actions.

**Physical over Virtual.** While we support container isolation, TiClaw prefers physical directory isolation to ensure native performance and full access to system-level tools (GPU, Keychain, etc.) when needed.

**Customization = code changes.** No configuration sprawl. If you want different behavior, you modify the TiClaw engine directly.

## Requirements

- macOS (optimized for Mac Mini) or Linux
- Node.js 20+
- [Gemini CLI](https://github.com/google/gemini) (for workspace skill, headless mode) or [Claude Code](https://claude.ai/download)
- At least one channel: [Discord](https://discord.com/developers/applications), [Feishu](docs/FEISHU_SETUP.md), etc.

## Architecture

TiClaw operates on a **Command -> Factory -> Relay** loop:

1.  **Command:** Your channel (Discord, Feishu, etc.) receives messages; TiClaw processes them.
2.  **Factory:** A dedicated workspace is created. Coding CLI runs in headless mode when needed.
3.  **Relay:** Logs, screenshots, and diffs are streamed back to the channel.
4.  **Verification:** Playwright runs automated UI tests.
5.  **Delivery:** PR is submitted to GitHub.

For a complete guide on how to operate the system, see the [User Guide](docs/USER_GUIDE.md).

## FAQ

**Why headless mode for the workspace skill?**

The workspace skill runs the coding CLI (Gemini, Codex, Claude) in headless mode — no persistent terminal. Each prompt is a fresh subprocess. This keeps the system simple and not terminal-focused.

**Is this secure?**

TiClaw uses physical isolation and port-locking. However, it is designed for controlled environments. Always review the code changes and use dedicated machines (like a Mac Mini).

**Can I switch between Gemini and Claude?**

Yes! Set `TC_CODING_CLI="claude"` or `TC_CODING_CLI="gemini"` in your `.env`.

**Can I use third-party LLM providers?**

Yes! TiClaw defaults to **OpenRouter** which provides access to Claude 4.5 Sonnet and other powerful models via an Anthropic-compatible API. You can switch to direct Anthropic or Gemini by updating your `.env` file.

**How do I configure OpenRouter?**

Simply set your key and preferred model in `.env`:
```bash
OPENROUTER_API_KEY="your-openrouter-key"
TC_MODEL="anthropic/claude-sonnet-4.6"
```
TiClaw automatically handles the routing and provider-specific mapping.

## Credits

TiClaw is proudly built on the foundation of **[NanoClaw](https://github.com/qwibitai/nanoclaw)**. We maintain NanoClaw's core message routing and task scheduling while extending it with the mind system (persona, memory, lock, rollback) and multi-channel support.
