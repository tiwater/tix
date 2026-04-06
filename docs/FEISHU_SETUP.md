# 飞书 (Feishu) Channel 配置指南

Tix 支持飞书长连接模式（无需公网 webhook 回调地址）。

## 1. 飞书应用配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建自建应用后：

1. 获取 `App ID` / `App Secret`
2. 事件订阅选择「使用长连接接收事件」
3. 订阅 `im.message.receive_v1`
4. 配置必要 IM 权限并发布应用

## 2. Tix 配置（当前实现）

当前 Feishu channel loader 直接读取 `~/.tix/config.yaml` 的 `channels.feishu`。

```yaml
channels:
  feishu:
    enabled: true
    app_id: "cli_xxxxxxxx"
    app_secret: "xxxxxxxx"
    # 可选
    agent_id: "feishu-agent"
```

多账号：

```yaml
channels:
  feishu:
    enabled: true
    accounts:
      - app_id: "cli_a"
        app_secret: "secret_a"
        agent_id: "agent-a"
      - app_id: "cli_b"
        app_secret: "secret_b"
        agent_id: "agent-b"
```

> 说明：仅设置 `TC_FEISHU_APP_ID` / `TC_FEISHU_APP_SECRET` 环境变量，在当前版本下不足以启用 Feishu（因为 channel loader 不走该 env fallback）。

## 3. 触发词（可选）

触发词由 `assistant_name` 控制：

```yaml
assistant_name: YourBot
```

## 4. 启动

```bash
pnpm run dev
```

启动后会看到 channel 连接日志；在飞书群聊或私聊中 @机器人发送消息即可触发。

## 5. 当前限制

- `sendFile` 在 Feishu channel 中仍是 stub（未实现完整文件发送）
- 建议优先以文本与卡片消息为主

## 6. Planned Improvements

1. 为 Feishu channel loader 增加环境变量 fallback（`TC_FEISHU_APP_ID` / `TC_FEISHU_APP_SECRET`）。
2. 完成 `sendFile` 的生产可用实现（含 media 上传与消息引用）。
3. 增加连接与事件链路的健康指标暴露。
