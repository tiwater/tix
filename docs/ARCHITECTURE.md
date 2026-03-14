# TiClaw Architecture Guide

This document outlines the architectural decisions that differentiate TiClaw from its parent project, NanoClaw.

## 1. High-Level Design Goals

*   **Transparency:** Every action taken by the AI must be visible to the developer in real-time.
*   **Isolation:** Each task must be physically separated from others to prevent cross-contamination of dependencies or environment variables.
*   **Observability:** Automated screenshots and diff summaries provide high-level status updates without requiring manual log review.
*   **Resilience:** The system must handle long-running tasks, network interruptions, and host reboots gracefully.

## 2. Core Components

### A. Multi-Channel Command Adapter
TiClaw treats Discord, Feishu, and other platforms as adapters. Messages route through a unified flow.
*   **Mind-first:** Natural conversation updates persona and memory. `/mind` for status, lock, unlock, package, diff, rollback.
*   **Workspace skill:** The agent handles most tasks directly. When it needs to build or fix things, it uses the optional workspace skill (coding CLI).
*   **Response Pattern:** Logs, screenshots, and status updates are sent to the active thread or chat.

### B. The Factory (`TcWorkspace`)
The physical engine that manages workspaces.
*   **Location:** `~/.ticlaw/factory/{thread_id}/`
*   **Workflow:** 
    1. Clone the repository into a unique directory.
    2. Manage independent `.envrc` and workspace-specific settings.
    3. Monitor directory for changes (using `chokidar` or similar).

### C. Native Agent SDK Loop
To ensure robust multi-turn task execution without fragile regex parsing or complex tmux session management, TiClaw utilizes the official `@anthropic-ai/claude-agent-sdk`.
*   **The SDK Core (`run-agent.ts`):** Instead of a multi-CLI driver pattern (Gemini CLI, Codex, etc.), TiClaw wraps the `query()` generator from the Claude SDK. This grants the LLM built-in access to its native toolchain (Bash, Edit, Read).
*   **Physical Execution:** The SDK executes safely on the host inside the restricted `~/.ticlaw/factory/` directories without requiring headless subprocess polling or Docker container layers.
*   **OpenRouter Routing:** By overriding `ANTHROPIC_BASE_URL` with standard OpenRouter credentials (`OPENROUTER_API_KEY`), the agent naturally executes models like MiniMax-M2.5 or Claude 3.5 Sonnet directly from the Node runtime.

### D. The Delta Feed (Gemini Powered Audit)
*   **Function:** Periodically (or upon file save/command completion) calculates the `git diff`.
*   **Logic:** Sends the diff to Gemini to generate a concise summary (e.g., "Modified login logic to handle null tokens").
*   **Visibility:** Sends the summary as a Discord rich card.

### E. Playwright Verification Loop
*   **Logic:** Before marking a task as "Ready for Review," TiClaw automatically spins up a Playwright environment, runs UI tests, and sends "Before vs After" screenshots to the Discord thread.

## 3. Workflow Diagram

```
[User (Discord/Feishu/etc)] --> [Message Router]
                                        |
                    [Mind Update] <-- natural conversation (via Agent Context)
                                        |
                    [/mind commands] --> status, lock, unlock, package, diff, rollback
                                        |
                    [Workspace delegation] --> [runAgent()] (Claude Agent SDK)
                                                        |
                                                [TcWorkspace Factory]
                                                        |
                                                (mkdir + git clone)
                                                        |
                                                [Built-in Tools (Bash/Edit/Read)]
                                                        |                           |
                                                (Streaming LLM Tokens) -------- [User Debugging]
                                                        |
                                                [Delta Feed/Screenshots]
                                                        |
                                                [PR Automation] --(gh pr create)--> [GitHub]
```

## 4. Key Security Decisions

*   **Host Lockdown:** TiClaw is restricted to operating within `~/.ticlaw/factory/`.
*   **Port Isolation:** Each task is assigned a unique port (e.g., 3000-3050) via a `PortLocker` utility.
*   **Physical Isolation:** Unlike Docker containers which can sometimes mask performance or system-level issues on macOS (like keychain access or GPU acceleration), physical isolation ensures the AI is working on the real metal, which is critical for TiCOS.

---

*Last Updated: March 3, 2026*
