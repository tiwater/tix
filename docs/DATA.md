# TiClaw 数据管理设计文档 (Data Management Design)

## 1. 核心哲学：大脑与手脚 (Brain vs. Hands)

TiClaw 遵循"理性、极简、面向人类"的设计原则，将 Agent 的定义（大脑）与其执行环境（手脚）进行彻底的物理隔离。

- **大脑 (Brain - 心智与人设)**: 定义 Agent **"是谁"** 以及 **"如何思考"**。
- **手脚 (Hands - 操作与执行)**: 定义 Agent **"在做什么"**。

## 2. 存储哲学：文件即数据库 (Filesystem-First)

> **设计原则**: 文件系统就是数据库。文件夹结构即资源关系。JSON/JSONL 即记录。Markdown 即灵魂。

受 OpenClaw 启发，TiClaw 采用 **纯文件系统** 作为数据持久层：

- **人类可读**: `cat`, `grep`, `tail -f` 即可审计全部数据
- **无需工具**: 不依赖 `sqlite3` 或任何 DB 客户端
- **天然隔离**: 每个 Agent 的数据物理隔离在独立目录
- **Git 友好**: 可选将 Agent 定义纳入版本控制

**不使用 SQLite**。当一个 Node 不会有海量 Agent 或 Session 时，文件扫描的性能完全足够。未来如需向量搜索/FTS，可按需引入 SQLite 专门用于 memory/embedding 索引（参考 OpenClaw 做法）。

## 3. 目录结构标准 (Directory Standard)

所有配置与持久化数据均存放于全局基准目录 `~/.ticlaw/` 下。

```
~/.ticlaw/
├── config.yaml                          # 全局配置 (hub_url, http_port, etc.)
├── enrollment-state.json                # 信任状态
├── router-state.json                    # 路由状态 (key-value)
│
└── agents/                              # Agent 独立空间
    └── {agent_id}/
        ├── SOUL.md                      # 核心人设、价值观、性格
        ├── IDENTITY.md                  # 身份背景、自我描述
        ├── USER.md                      # 用户个性化指令
        ├── MEMORY.md                    # 长期记忆
        ├── agent.json                   # Agent 元数据 + 渠道绑定
        │
        ├── sessions/
        │   └── {session_id}/
        │       ├── session.json         # 会话元数据 {channel, status, created_at}
        │       └── messages.jsonl       # 对话记录 (append-only)
        │
        └── schedules/
            └── {schedule_id}.json       # 定时任务 {prompt, cron, status, next_run}
```

### 3.1 agent.json 格式

```json
{
  "name": "web-agent",
  "created_at": "2026-03-14T20:00:00Z",
  "updated_at": "2026-03-14T20:00:00Z",
  "workspace": "~/workspace-dev/",
  "sources": [
    { "channel": "http", "ref": "web:web-agent:web-session" },
    { "channel": "discord", "ref": "dc:123456789" }
  ]
}
```

`sources` 字段替代了旧的 `registered_groups` 表，定义了哪些外部渠道/群组由该 Agent 处理。路由时扫描所有 `agents/*/agent.json` 的 `sources` 即可确定目标 Agent。

### 3.2 文件格式约定

| 文件类型 | 格式 | 说明 |
|---------|------|------|
| `*.md` | Markdown | 灵魂定义，人类可读可编辑 |
| `*.json` | JSON | 结构化元数据，一次性读写 |
| `*.jsonl` | JSON Lines | 追加写入的事件流/消息日志 |

### 3.3 messages.jsonl 格式

每行一条消息，append-only：

```jsonl
{"ts":"2026-03-14T20:00:00.000Z","role":"user","sender":"Web User","text":"你好"}
{"ts":"2026-03-14T20:00:05.123Z","role":"bot","sender":"Shaw","text":"你好！有什么可以帮你的？"}
{"ts":"2026-03-14T20:01:00.456Z","role":"user","sender":"Web User","text":"帮我写个脚本"}
```

字段说明：
- `ts` — ISO 8601 时间戳
- `role` — `user` | `bot` | `system`
- `sender` — 发送者名称
- `text` — 消息内容
- `id` — (可选) 消息唯一 ID
- `metadata` — (可选) 扩展字段

### 3.4 interaction_events.jsonl (可选)

高级场景下的细粒度交互事件记录，也采用 JSONL，存放在 session 目录下：

```jsonl
{"ts":"...","type":"intent","role":"user","intent":"greeting","content":"你好","channel":"http"}
{"ts":"...","type":"action","role":"bot","action":"speaking","content":"你好！"}
```

## 4. 架构分层 (Architecture Layers)

1. **Agent (本体/魂)**:
   - 存放于 `~/.ticlaw/agents/[id]/`
   - Markdown 定义人设 + `agent.json` 理性参数
   - 代表 Agent **"是谁"**

2. **AgentRunner (运行时/体)**:
   - 管理会话、维护 HUB 长连接、隔离 Workspace
   - 维护 Agent 状态 (idle/busy/interrupted)
   - 代表 Agent **"当前在哪"**

3. **Executor (执行器/能)**:
   - Claude Code / Gemini CLI 等带脑子的执行体
   - 自主规划 + 结构化 JSON 输出
   - 代表 Agent **"在干什么"**

## 5. 工作空间隔离 (Workspace Isolation)

- **隔离原则**: `agent.json` 中定义的 `workspace` 路径是 Agent 唯一的操作区域
- **防止污染**: Agent 的工程产物不应出现在 `~/.ticlaw/` 中

## 6. 交互协议 (Preemption & Interaction)

- **插话机制**: AgentRunner 处于 `busy` 时，新消息进入优先级队列
- **抢占逻辑**: 根据 Executor JSON 状态判断是否可中断

## 7. 从 SQLite 迁移 (Migration from SQLite)

以下 SQLite 表将被文件系统替代：

| SQLite 表 | → 文件 | 说明 |
|-----------|--------|------|
| `messages` | `agents/{id}/sessions/{sid}/messages.jsonl` | 对话记录 |
| `agents` | `agents/{id}/agent.json` | Agent 元数据 |
| `sessions` | `agents/{id}/sessions/{sid}/session.json` | 会话元数据 |
| `schedules` | `agents/{id}/schedules/{id}.json` | 定时任务 |
| `mind_state` | **删除** — `SOUL.md` + `MEMORY.md` 即心智 | Markdown 即心智 |
| `mind_packages` | **删除** — 用 Git 管理 .md 文件版本 | Git 即快照 |
| `chats` | (合并到 session.json) | 聊天元数据 |
| `interaction_events` | `agents/{id}/sessions/{sid}/events.jsonl` | 交互事件 |
| `router_state` | `router-state.json` | 路由键值对 |
| `registered_groups` | `agents/{id}/agent.json` → `sources` 字段 | 渠道绑定 |

### 迁移策略

- **阶段一**: 实现新的文件系统读写层 (`src/core/store.ts`)，替代 `db.ts`
- **阶段二**: 迁移所有使用 `db.ts` 的调用方到新 store
- **阶段三**: 移除 `db.ts`、`better-sqlite3` 依赖和 SQLite 相关代码
- 不迁移旧数据 — 干净切换

## 8. 术语一致性 (Naming Conventions)

- **Node**: 整个节点/实例
- **Node ID/Fingerprint**: 节点唯一标识与硬件指纹
- **Session**: 会话级别的上下文流

---
*TiClaw: 领悟大模型精神，回归极简理性。文件即数据库。*
