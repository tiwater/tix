# 🦞 Tix (v1.3.0)

```text
  _____ _      
 |_   _(_)_  __
   | | | \ \/ /
   |_| |_|>  < 
         /_/\_\   Tix v1.3.0
                  [ Tiwater Agent Harness Framework ]
```

> **The Tiwater Agent Harness Framework.**
> Built for serious developers who need industrial-grade reliability, multi-tenant bot management, and drop-dead gorgeous interactive experiences.

Tix is a modular, high-performance foundation for building AI agents that live where your team works: **Feishu (Lark)**, **DingTalk**, **Discord**, and beyond. It doesn't just "chat"—it manages complex tasks through a unified command hub and rich interactive cards.

---

## 💎 Why Tix?

While other frameworks focus on generic chat, Tix is engineered for the enterprise:

- **🚀 Industrial-Grade Channels**: Real-world Feishu and DingTalk integrations with automatic WebSocket reconnection (Stream Mode), multi-account routing, and rich text parsing.
- **🎨 Interactive Card Native**: Say goodbye to walls of Markdown text. Tix renders data into beautiful, actionable UI components directly in your chat app.
- **⚡ Zero-Latency Slash Commands**: A dedicated interceptor bypasses the LLM for system commands (`/status`, `/reload`), giving you instant feedback.
- **🏗️ Unified Abstract Architecture**: A rock-solid `AbstractChannel` base makes adding new platforms a matter of minutes, not days.
- **🧠 Brain-Body Sync**: Built on top of the latest Claude Agent SDK, separating high-level reasoning from low-level execution.

---

## 🛠️ Key Capabilities (Built-in Skills)

Tix comes pre-loaded with essential tools for the modern agent:

- **`web-search`**: Synthesized real-time intelligence via Perplexity (Sonar Pro) or Serper.
- **`web-content`**: Ultra-clean Markdown extraction from any URL (powered by Jina Reader).
- **`browser`**: Full visual automation with Playwright (Chromium) for screenshots and complex interactions.
- **`office`**: Cross-platform Word and Excel manipulation.
- **`github`**: GitHub-native operations via `gh`, with built-in auth helpers.

---

## 🚀 Quick Start

### 1. Install

```bash
npm install -g tix
```

### 2. Configure

Use `~/.tix/config.yaml` as the single runtime config file:

```bash
mkdir -p ~/.tix
cp ./config.example.yaml ~/.tix/config.yaml
```

Then edit `~/.tix/config.yaml` with your channel + LLM credentials.

### 3. Secure the HTTP/Web UI surface

Before exposing Tix beyond localhost, set a real admin token and explicit browser allowlist:

```bash
export HTTP_API_KEY="replace-with-a-long-random-secret"
export ALLOWED_ORIGINS='^https://app\.example\.com$'
```

- `HTTP_API_KEY` protects node admin/API surfaces
- `ALLOWED_ORIGINS` prevents arbitrary browser origins from calling the node API
- if `HTTP_API_KEY` is unset, Tix falls back to **loopback-only admin access** for local development
- in that mode, the HTTP listener binds to `127.0.0.1` instead of a wider interface
- this loopback fallback is a development convenience, **not** a production mode

### 4. Launch

```bash
tix start
```

### 4. Developer CLI

You can test agent behavior instantly from the command line without setting up external chat platforms:

```bash
pnpm chat "Hello!" --agent my-agent
```

This connects to the local SSE stream and outputs the agent's response in real-time.

Skill auth convenience commands:

```bash
tix skills auth status
tix skills auth login github
tix skills auth logout github
```

---

## ☁️ Render deployment

This repository is now set up for **separate container deployments** of the
public gateway and the background node service on Render:

- `packages/gateway/Dockerfile` builds the public gateway container.
- `packages/node/Dockerfile` builds the background node container with Chrome included for browser automation.
- `render.yaml` wires the node to the gateway over Render's private network.

Deploy the Blueprint, then point your consumer app to the gateway service URL
and send `Authorization: Bearer <TIX_GATEWAY_API_KEY>` on every request. The node
service should stay private. See `docs/INTEGRATING.md` for the end-to-end flow.
If you configure Render services manually instead of syncing the Blueprint, set
the public web service Dockerfile path to `packages/gateway/Dockerfile` and the
background worker service Dockerfile path to `packages/node/Dockerfile`.
The node service also needs `HTTP_API_KEY` configured so it binds `0.0.0.0` on
Render; the Blueprint now generates that value automatically.

---

## 🎮 Command Hub & UI

Type commands directly in Feishu/DingTalk or your custom ChatUI:

- `/status` - View real-time health of all bot instances in a beautiful dashboard card.
- `/help` - Show available skills and instructions.
- `/web <url>` - Instantly grab and summarize webpage content.

---

## 🏗️ Architecture for Developers

Tix uses a tri-tier architecture designed for extensibility:

1.  **Standardized Transport**: Every channel inherits from `AbstractChannel<T>`, enforcing a unified JID format: `{channel}:{app_id}:{chat_id}`.
2.  **Logic Engine**: Powered by `AgentComputer`, an object-oriented execution loop that manages persona, memory, and tool use.
3.  **Unified Management**: Management is done _through the conversation_. No clunky web dashboards required—your agent is its own administrator.

---

## ⚖️ License

MIT © [tiwater](https://github.com/tiwater)
