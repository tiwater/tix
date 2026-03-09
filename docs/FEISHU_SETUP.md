# 飞书 (Feishu) Channel 配置指南

TiClaw 支持飞书作为渠道之一。使用**长连接**接收事件，**无需公网 URL**。可同时配置 Discord、飞书等多个渠道。

## 1. 飞书应用配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建自建应用后：

1. **凭证与基础信息**：获取 `App ID` 和 `App Secret`
2. **事件订阅**：选择 **「使用长连接接收事件」**（非 Webhook）
   - 订阅事件：勾选 `im.message.receive_v1`（接收消息）
3. **权限**：为应用开通 `im:message`、`im:message.group_at_msg` 等
4. **发布应用**：长连接模式需先发布应用才能生效

## 2. TiClaw 配置

在 `~/ticlaw/config.yaml` 中添加：

```yaml
channels:
  feishu:
    app_id: "cli_xxxxxxxx"
    app_secret: "xxxxxxxx"
```

或使用环境变量：

```
TC_FEISHU_APP_ID=cli_xxxxxxxx
TC_FEISHU_APP_SECRET=xxxxxxxx
```

## 3. 机器人名称（可选）

触发词由 `assistant_name` 决定（如 `@Andy`）。在 config.yaml 中配置：

```yaml
assistant_name: YourBot
```

## 4. 启动

```bash
pnpm run dev
```

启动后会看到 `Feishu: long connection active`。在飞书群聊或私聊中 @机器人 发送消息即可触发。
