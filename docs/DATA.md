# TiClaw 数据管理设计文档 (Data Management Design)

## 1. 核心哲学：大脑与手脚 (Brain vs. Hands)

TiClaw 采用“文件即数据库”的模型：
- **大脑 (Brain)**：Agent 身份、心智、长期记忆（Markdown + JSON）
- **手脚 (Hands)**：运行时会话、消息、调度、任务执行（JSON/JSONL/YAML）

## 2. 存储哲学：文件即数据库 (Filesystem-First)

> 设计原则：目录结构即资源关系，文件内容即状态。

优点：
- 人类可读、可审计（`cat`, `rg`, `tail`）
- 无外部数据库依赖
- Agent 级目录隔离

当前实现不使用 SQLite。

## 3. 当前目录结构标准 (Current Directory Standard)

所有数据位于 `~/.ticlaw/`：

```text
~/.ticlaw/
├── config.yaml
├── router-state.json
├── registered-groups.json                 # 当前路由绑定来源（chat_jid -> RegisteredProject）
├── security/
│   └── enrollment-state.json
│
└── agents/
    └── {agent_id}/
        ├── agent.json                     # Agent 元数据
        ├── agent-config.json              # 可选，workspace 覆盖配置
        ├── SOUL.md
        ├── IDENTITY.md
        ├── USER.md
        ├── MEMORY.md
        ├── .claude_sessions/
        │   └── {encoded_session_id}.id    # Claude 侧 session 续接 ID（按 TiClaw session 隔离）
        ├── memory/
        │   └── YYYY-MM-DD.md              # 日志式记忆归档
        ├── skills.json                    # 可选，Agent 允许技能名单
        ├── sdk_plugin/                    # 运行时技能插件编译目录
        │   └── ...
        ├── sessions/
        │   └── {session_id}/
        │       ├── session.json
        │       ├── messages.jsonl
        │       └── events.jsonl
        └── schedules/
            └── {schedule_id}.yaml
```

### 3.1 `agent.json`（当前实现）

```json
{
  "agent_id": "web-agent",
  "name": "Web Agent",
  "created_at": "2026-03-17T00:00:00.000Z",
  "updated_at": "2026-03-17T00:00:00.000Z"
}
```

说明：
- 当前实现中，渠道/会话路由绑定仍在 `registered-groups.json`。
- `agent.json.sources` 方案是可选演进方向，尚未成为主路由来源。

### 3.2 文件格式约定

| 文件类型 | 格式 | 用途 |
|---|---|---|
| `*.md` | Markdown | 心智定义与人类可维护内容 |
| `*.json` | JSON | 元数据状态 |
| `*.jsonl` | JSON Lines | 追加事件流（消息/事件） |
| `*.yaml` | YAML | 调度记录 |

### 3.3 `messages.jsonl`（当前存储字段）

每行一条记录，append-only：

```jsonl
{"id":"web-1","ts":"2026-03-17T10:00:00.000Z","role":"user","sender":"web-user","sender_name":"Web User","text":"你好"}
{"id":"bot-1","ts":"2026-03-17T10:00:03.000Z","role":"bot","sender":"Shaw","sender_name":"Shaw","text":"你好！"}
```

可选字段：
- `is_from_me`
- `attachments`

### 3.4 `events.jsonl`（交互事件）

会话级细粒度事件写入 `sessions/{session_id}/events.jsonl`。

### 3.5 记忆分层约定 (Memory Tiers)

- 长期记忆（Long-term）：`agents/{id}/MEMORY.md`，由人或系统维护的稳定记忆。
- 短期记忆（Short-term）：`agents/{id}/memory/*.md`，运行时自动追加的任务日志摘要。
- 当前 Runner 会将最近 3 个 journal 文件注入系统提示词。
- `/api/mind` 返回长期视图（`SOUL.md` + `MEMORY.md`）。
- `/api/mind/files` 返回根目录心智文件（`SOUL.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`），不包含 `memory/` journals。

## 4. 架构分层 (Architecture Layers)

1. **Agent Definition 层**
   - 位于 `agents/{agent_id}/`
   - 包含 mind 文件、技能策略、Agent 元信息

2. **Session/Store 层**
   - 会话、消息、事件、调度持久化
   - 为 HTTP/Hub/Channel 统一提供读写模型

3. **Runner/Executor 层**
   - `AgentRunner` 驱动 Claude Agent SDK
   - 通过 warm session、streaming、工具链完成执行

## 5. 工作空间隔离 (Workspace Isolation)

当前 workspace 解析规则：
1. 默认：`~/workspace-{agent_id}`
2. 若存在 `agents/{agent_id}/agent-config.json` 且含 `workspace`，则覆盖默认值

为了避免 Agent 生成的截图、上传文件、临时文件直接污染业务仓库根目录，TiClaw 现在会直接在 workspace 根目录下预置清晰的托管文件夹：

```text
{workspace}/
├── artifacts/
│   ├── README.md
│   ├── screenshots/
│   ├── generated/
│   └── shared/
├── uploads/
└── scratch/
```

约定：
- `artifacts/screenshots/`：浏览器截图、页面抓图、图片/PDF 产物。
- `artifacts/generated/`：需要分享给用户的生成文件。
- `artifacts/shared/`：从 workspace 外部复制进来的文件。
- `uploads/`：通过 workspace upload API 上传的用户文件。
- `scratch/`：中间产物和临时文件。

只有当用户明确要求修改项目源码或指定某个业务路径时，Agent 才应直接把文件写到项目目录。

`~/.ticlaw/` 保存状态，不建议作为业务工程产物目录。

## 6. 交互与并发 (Interaction & Concurrency)

- 每个 `chat_jid` 由 `activeAgentLocks` 保护，避免同一会话并发运行。
- Runner busy 时不会并行执行第二个同 chat 的 run。
- 强抢占/优先级队列机制尚未形成统一调度系统（属于后续增强方向）。

## 7. SQLite 迁移状态

核心迁移已完成：
- 会话/消息/调度/路由状态均已落地文件系统。

仍待统一的历史术语：
- 旧文档中 `db.ts`、`*.json` schedule、`agent.json.sources` 路由等描述需与当前实现区分“现状 vs 规划”。

## 8. Planned Data Evolution

1. 路由绑定模型统一（`registered-groups.json` 与 `agent.json.sources` 二选一或兼容迁移）。
2. 会话检索索引化（避免按 `session_id` 全目录扫描）。
3. JSONL 大文件优化（seek/tail 流式读取，减少全量加载）。
4. 调度模型增强（one-shot 原生表达与更完整更新 API）。

## 9. 术语一致性 (Naming Conventions)

- **Node**：运行中的 TiClaw 实例
- **Agent**：一个独立人格与工作目录
- **Session**：单一上下文流
- **chat_jid**：跨渠道统一会话地址

---
*TiClaw: 文件即数据库；现状与规划分离描述，避免文档漂移。*
