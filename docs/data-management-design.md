# TiClaw 数据管理设计文档 (Data Management Design)

## 1. 核心哲学：大脑与手脚 (Brain vs. Hands)

TiClaw 遵循“理性、极简、面向人类”的设计原则，将 Agent 的定义（大脑）与其执行环境（手脚）进行彻底的物理隔离。

- **大脑 (Brain - 心智与人设)**: 定义 Agent **“是谁”** 以及 **“如何思考”**。
- **手脚 (Hands - 操作与执行)**: 定义 Agent **“在做什么”**。

## 2. 目录结构标准 (Directory Standard)

所有配置与持久化数据均存放于全局基准目录 `~/.ticlaw/` 下。

### 2.1 全局配置
- `~/.ticlaw/config.yaml`: 全局系统配置（如 `hub_url`, `http_port`）。
- `~/.ticlaw/store/`: 统一的本地持久化存储（SQLite 数据库、`enrollment-state.json`）。

### 2.2 Agent 独立空间 (Brain Container)
每个 Agent 拥有一个专属的“大脑目录”：`~/.ticlaw/agents/[agent_id]/`。

**拒绝过度工程化**：我们坚决反对将描述性内容强行塞进 JSON/YAML 字典。因此，Agent 的灵魂完全由 **Markdown** 定义：
- `SOUL.md`: 核心人设、价值观、性格特质与行为准则（模糊、感性、易于人类微调）。
- `IDENTITY.md`: 身份背景、自我描述、已知的事实。
- `USER.md`: 用户针对该特定 Agent 的个性化指令。
- `MEMORY.md`: 长期记忆片段。
- `agent-config.yaml`: **理性参数区**。仅存放必须由程序逻辑消费的硬参数（如 `workspace` 路径、显式授权的 `capabilities`）。

## 3. 工作空间隔离 (Workspace Isolation - Hands)

Agent 的执行环境必须独立于其“大脑”。

- **隔离原则**: 在 `agent-config.yaml` 中定义的 `workspace` 路径（如 `~/workspace-dev/`）是 Agent 唯一的操作区域。
- **防止污染**: Agent 执行任务、克隆代码、读写临时文件均在各自的 Workspace 内完成。这确保了 `~/.ticlaw/` 始终保持核心心智资产的纯净，不被工程垃圾填满。

## 4. 架构分层 (Architecture Layers)

为消除术语混淆，我们将代码职责划分为以下清晰的三层结构：

1. **Agent (本体/魂)**: 
   - 存放于 `~/.ticlaw/agents/[id]/`。
   - 提供 Markdown 定义的人设（SOUL, IDENTITY）以及 `agent-config.yaml`（理性参数区）。
   - 它代表了 Agent **“是谁”**。

2. **AgentRunner (运行时/体)**: 
   - **核心宿主**: 负责管理会话、维护 HUB 长连接、隔离 Workspace 生命周期。
   - **任务队列 & 状态感知**: 维护 Agent 的 `status` (idle/busy/interrupted)。
   - **JSON 状态遥测 (Telemetry)**: 
     - **实时感知**: 基于 Executor (如 Claude Code) 的 `--json` 模式输出，实时通过 WebSocket 向上层（Hub/UI）透传结构化状态。
     - **精准打断 (Preemption)**: 根据从 Executor 捕获的 JSON 动作（如正在 `read_file` 还是 `git push`）来判断当前任务是否可被打断，并支持用户插话。
   - 它代表了 Agent **“当前在哪”**。

3. **Executor (执行器/能)**: 
   - **带脑子的执行体**: 如 Claude Code 或 Gemini CLI。
   - **自主规划 (Built-in Planning)**: 它们内部已具备思考、规划及工具调用的闭环。
   - **结构化输出**: 负责以协议化的 JSON 格式实时告知 AgentRunner 其当前动作。
   - 它代表了 Agent **“在干什么”**。

## 5. 交互协议逻辑 (Preemption & Interaction)

TiClaw 实现了类机器人的“全双工”交互模型：
- **插话机制**: 当 AgentRunner 处于 `busy` 状态时，新消息进入优先级队列。
- **抢占逻辑**: AgentRunner 接收到极速请求或紧急消息时，根据 Executor 当前的 JSON 状态动作（activity.is_interruptible），通过信号量（SIGINT/Abort）实现任务的优雅中断与上下文保存。

## 5. 术语一致性 (Naming Conventions)

- **Claw**: 指代整个节点/实例（替代旧称 `runtime`, `node`）。
- **Claw ID/Fingerprint**: 节点的唯一标识与硬件指纹。
- **Session**: 会话级别的上下文流。

## 6. 数据持久化策略

- **会话历史**: 存储于 `~/.ticlaw/agents/[agent_id]/sessions/`。
- **任务日志**: 存储于对应 Agent 的日志子目录中。
- **状态同步**: 默认支持本地存储，可选支持通过 `hub_url` 向中心网关汇报状态。

---
*TiClaw: 领悟大模型精神，回归极简理性。*
