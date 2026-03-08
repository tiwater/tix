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
*   **Location:** `~/ticlaw/factory/{thread_id}/`
*   **Workflow:** 
    1. Clone the repository into a unique directory.
    2. Manage independent `.envrc` and workspace-specific settings.
    3. Monitor directory for changes (using `chokidar` or similar).

### C. The Multi-CLI Driver Pattern
To ensure flexibility and resilience against account-level issues, TiClaw abstracts the actual coding agent logic into a **Driver** pattern.
*   **Gemini Driver (Default):** Spawns the `gemini` CLI in non-interactive YOLO mode. It utilizes `--resume latest` to maintain state across turns and `stream-json` for real-time feedback.
*   **Claude Driver:** Utilizes the `@anthropic-ai/claude-agent-sdk` for deep integration with the AI coding CLI.
*   **Codex Driver:** A specialized driver for Codex-based workflows.
*   **Switching:** Controlled via the `TC_CODING_CLI` environment variable.

### D. Workspace Skill (Headless)
Runs the coding CLI (Gemini, Codex, Claude) in headless mode — no persistent terminal.
*   **Subprocess:** Each prompt spawns a fresh process. Output is captured and delivered to the channel when done.

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
                    [Mind Update] <-- natural conversation
                                        |
                    [/mind commands] --> status, lock, unlock, package, diff, rollback
                                        |
                    [Workspace delegation] --> [Mind Builder Agent]
                                                        |
                                                [TcWorkspace Factory]
                                                        |
                                                (mkdir + git clone)
                                                        |
                                                [Subprocess (Gemini/Claude headless)] <--- (--prompt)
                                                        |                           |
                                                (Streaming Logs) -------------- [User Debugging]
                                                        |
                                                [Delta Feed/Screenshots]
                                                        |
                                                [PR Automation] --(gh pr create)--> [GitHub]
```

## 4. Key Security Decisions

*   **Host Lockdown:** TiClaw is restricted to operating within `~/ticlaw/factory/`.
*   **Port Isolation:** Each task is assigned a unique port (e.g., 3000-3050) via a `PortLocker` utility.
*   **Physical Isolation:** Unlike Docker containers which can sometimes mask performance or system-level issues on macOS (like keychain access or GPU acceleration), physical isolation ensures the AI is working on the real metal, which is critical for TiCOS.

---

*Last Updated: March 3, 2026*
