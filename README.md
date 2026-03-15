# 🦞 TiClaw (v1.3.0)

```text
    _ _      _
   | | |__ _| |__  ___| |_ ___ _ _
   | | / _` | '_ \(_-<|  _/ -_) '_|
   |_|_\__,_|_.__//__/ \__\___|_|
   
      /\|___/\      TiClaw v1.3.0
     (  o   o  )     [ The Enterprise Shell ]
      \  -^-  /      
       /|   |\       Status: ONLINE 🟢
      (_|___|_)
```

> **The Most Polished Enterprise AI Agent Base.** 
> Built for serious developers who need industrial-grade reliability, multi-tenant bot management, and drop-dead gorgeous interactive experiences.

TiClaw is a modular, high-performance foundation for building AI agents that live where your team works: **Feishu (Lark)**, **DingTalk**, **Discord**, and beyond. It doesn't just "chat"—it manages complex tasks through a unified command hub and rich interactive cards.

---

## 💎 Why TiClaw? (The "OpenClaw" Crusher)

While other frameworks focus on generic chat, TiClaw is engineered for the enterprise:

- **🚀 Industrial-Grade Channels**: Real-world Feishu and DingTalk integrations with automatic WebSocket reconnection (Stream Mode), multi-account routing, and rich text parsing.
- **🎨 Interactive Card Native**: Say goodbye to walls of Markdown text. TiClaw renders data into beautiful, actionable UI components directly in your chat app.
- **⚡ Zero-Latency Slash Commands**: A dedicated interceptor bypasses the LLM for system commands (`/status`, `/reload`), giving you instant feedback.
- **🏗️ Unified Abstract Architecture**: A rock-solid `AbstractChannel` base makes adding new platforms a matter of minutes, not days.
- **🧠 Brain-Body Sync**: Built on top of the latest Claude Agent SDK, separating high-level reasoning from low-level execution.

---

## 🛠️ Key Capabilities (Built-in Skills)

TiClaw comes pre-loaded with essential tools for the modern agent:

*   **`web-search`**: Synthesized real-time intelligence via Perplexity (Sonar Pro) or Serper.
*   **`web-content`**: Ultra-clean Markdown extraction from any URL (powered by Jina Reader).
*   **`browser`**: Full visual automation with Playwright (Chromium) for screenshots and complex interactions.
*   **`office`**: Cross-platform Word and Excel manipulation.

---

## 🚀 Quick Start

### 1. Install
```bash
npm install -g ticlaw
```

### 2. Configure
Create a `.env` file or export environment variables:
```env
# Multi-account Feishu configuration
TC_FEISHU_ENABLED=true
TC_FEISHU_ACCOUNTS='[{"appId": "cli_xxx", "appSecret": "..."}]'

# Multi-account DingTalk configuration
TC_DINGTALK_ENABLED=true
TC_DINGTALK_ACCOUNTS='[{"appId": "dingxxx", "appSecret": "..."}]'
```

### 3. Launch
```bash
ticlaw start
```

### 4. Developer CLI
You can test agent behavior instantly from the command line without setting up external chat platforms:
```bash
pnpm chat "Hello!" --agent my-agent
```
This connects to the local SSE stream and outputs the agent's response in real-time.

---

## 🎮 Command Hub & UI

Type commands directly in Feishu/DingTalk or your custom ChatUI:

- `/status` - View real-time health of all bot instances in a beautiful dashboard card.
- `/help` - Show available skills and instructions.
- `/web <url>` - Instantly grab and summarize webpage content.

---

## 🏗️ Architecture for Developers

TiClaw uses a tri-tier architecture designed for extensibility:

1.  **Standardized Transport**: Every channel inherits from `AbstractChannel<T>`, enforcing a unified JID format: `{channel}:{app_id}:{chat_id}`.
2.  **Logic Engine**: Powered by `AgentRunner`, an object-oriented execution loop that manages persona, memory, and tool use.
3.  **Unified Management**: Management is done *through the conversation*. No clunky web dashboards required—your agent is its own administrator.

---

## ⚖️ License

MIT © [tiwater](https://github.com/tiwater)
