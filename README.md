# 🦀 TiClaw

<p align="center">
  <img src="assets/ticlaw-logo.png" alt="TiClaw" width="400">
</p>

<p align="center">
  <b>Mind Builder.</b><br>
  Multi-channel, personality & memory evolution, production-ready.
</p>

<p align="center">
  Forked from <a href="https://github.com/qwibitai/nanoclaw">NanoClaw</a>
</p>

TiClaw is a platform for building minds: personality and memory that evolve through daily interaction. Connect via Discord, Feishu, or other channels; the mind forms stable identity and usable memory over time, with lock, rollback, and cloud sync for deployment.

## 🌊 The Vision

TiClaw is a **mind builder**. It focuses on:
- **Mind System:** Persona and memory evolve through daily conversation; lock for production, rollback when needed.
- **Multi-Channel:** Discord, Feishu (飞书), and more. One mind, many touchpoints.
- **Physical Factory:** Isolated workspaces for tasks when the agent needs to build or fix things.
- **💻 Workspace Agent:** Built on the `@anthropic-ai/claude-agent-sdk`, capable of native bash, glob, and edit tools inside the factory.

## 🛠 Core Capabilities

- **🧠 Mind System:** Persona and memory evolve through daily conversation. Lock for production, rollback when needed. `/mind` for status, lock, unlock, package, diff, rollback.
- **🦀 Workspace skill:** The agent handles most tasks directly. When it needs to run code or access a repo, it utilizes the native Claude Agent SDK. Physical `~/.ticlaw/factory/{folder}` isolation.
- **📺 Live Monitoring:** Agent stdout and tools stream delivered to the channel in real-time.
- **📸 Vision-Backed Audit:** Automated macOS screenshots for UI changes and Gemini-powered "Delta Feeds" for code summaries.
- **🚀 PR Pipeline:** Seamless transition from "Issue Solved" to "PR Created" with automated context-aware descriptions (when configured).
- **🔐 TOFU Enrollment:** Runtime-generated one-time token + out-of-band pairing, with fingerprint binding and trust-state enforcement.

## 📂 Structure & Workspaces (The "Brain vs. Hands")

TiClaw separates an agent's internal logic ("Brain") from its operational workspace ("Hands"):

-   **The Brain (Logic/Persona):** `~/.ticlaw/agents/[agent_id]/`
    -   `SOUL.md`: Personality and behavioral core.
    -   `IDENTITY.md`: Fixed identity and background.
    -   `USER.md`: Known user preferences and context.
    -   `MEMORY.md`: Long-term facts and preferences.
    -   `agent-config.json`: Agent-specific settings (e.g., custom `workspace` path).
    -   `logs/`: Local session metadata and logs.

-   **The Hands (Operations/Workspace):** Each agent operates in its own dedicated directory (e.g., `~/workspace-dev/`). All file operations, git clones, and task executions are confined to this workspace to prevent cluttering the "Brain" and cross-contamination between agents.

## 🚀 Quick Start

```bash
git clone https://github.com/tiwater/ticlaw.git
cd ticlaw
pnpm install
# Setup config: ~/.ticlaw/config.yaml (channels: discord/feishu, llm, etc.)
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
- At least one channel: [Discord](https://discord.com/developers/applications), [Feishu](docs/FEISHU_SETUP.md), etc.

## Architecture

TiClaw operates on a **Command -> Factory -> Relay** loop:

1.  **Command:** Your channel (Discord, Feishu, etc.) receives messages; TiClaw processes them.
2.  **Factory:** A dedicated workspace is created. The Claude Agent SDK assumes control.
3.  **Relay:** Context stream, logs, screenshots, and diffs are sent back to the channel.
4.  **Verification:** Playwright runs automated UI tests.
5.  **Delivery:** PR is submitted to GitHub.

For a complete guide on how to operate the system, see the [User Guide](docs/USER_GUIDE.md).

## Configuration

TiClaw uses a local configuration file `~/.ticlaw/config.yaml` to manage its settings, including upstream hub connections.

### Hub Client Mode

If you want TiClaw to connect to a central Hub (Gateway), configure the following in `~/.ticlaw/config.yaml`:

```yaml
hub_url: "ws://your-hub-gateway.com"
trust_token: "your-enrollment-token"
reporting_interval: 60000
```

- `hub_url`: The WebSocket URL of the central gateway.
- `trust_token`: (Optional) An enrollment token to automatically trust the claw on the hub.
- `reporting_interval`: (Optional) How often (in ms) to report status to the hub. Default is 60000.

Environment variables can also be used to override these settings:
- `HUB_URL`
- `HUB_TRUST_TOKEN`
- `HUB_REPORTING_INTERVAL`

## Enrollment (TOFU + Out-of-Band Verification)

TiClaw now supports generic control-plane enrollment primitives:

- runtime-generated one-time token (default TTL 20 minutes, bounded to 10-30)
- token + runtime fingerprint verification
- runtime trust states: `discovered_untrusted -> pending_verification -> trusted -> suspended/revoked`
- untrusted runtime can expose metadata/heartbeat endpoints but cannot execute jobs via HTTP run endpoint

CLI examples:

```bash
# Create one-time enrollment token
pnpm --filter @ticlaw/cli run build
node cli/dist/index.js enroll token-create --ttl 20

# Check trust status
node cli/dist/index.js enroll status

# Verify (integration/testing)
node cli/dist/index.js enroll verify <TOKEN>

# Revoke or re-enroll
node cli/dist/index.js enroll revoke
node cli/dist/index.js enroll reenroll
```

HTTP endpoints:

- `GET /api/enroll/status`
- `POST /api/enroll/token`
- `POST /api/enroll/verify`
- `POST /api/enroll/revoke`
- `POST /api/enroll/suspend`
- `POST /api/enroll/reenroll`

## FAQ

**Why native Agent SDK over subprocess CLIs?**

The workspace skill runs the `@anthropic-ai/claude-agent-sdk` purely in the Node.js runtime. This removes the fragility of screen scraping `tmux` or forcing JSON outputs from the Gemini CLI, allowing smooth tool use natively.

**Is this secure?**

TiClaw uses physical isolation and port-locking. However, it is designed for controlled environments. Always review the code changes and use dedicated machines (like a Mac Mini).

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
