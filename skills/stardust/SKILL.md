---
name: stardust
description: Build and edit Stardust session config JSON — the realtime AI engine powering Ticos agents
version: 1.0.0
requires: []
install: []
permissions:
  - level 1
skill_api_version: "1.0.0"
---

# stardust

Build and edit **Stardust session configuration** JSON files. Stardust is the realtime AI engine that powers Ticos agents, connected via WebSocket at `wss://stardust.ticos.cn/realtime`.

This skill provides the complete protocol spec for `session.create` / `session.update` events.

---

## Quick Start — Agent ID Shorthand

The simplest config uses `agent_id` to let the server resolve all settings:

```json
{
  "event_id": "evt_id_x",
  "type": "session.update",
  "session": {
    "agent_id": "agent_id_x"
  }
}
```

When `agent_id` is set, all other config sections below are optional — the server fetches them from the Agent ConfigServer.

---

## Event Envelope

| Field    | Type   | Description      | Example                  |
|----------|--------|------------------|--------------------------|
| event_id | string | Unique event ID  | `"evt_7tkKpW9detewrGb1Q"` |
| type     | string | Event type       | `"session.update"`        |

---

## Config Sections

### 1. Model (`session.model`)

| Field                        | Type           | Description                   | Constraints                                                  |
|------------------------------|----------------|-------------------------------|--------------------------------------------------------------|
| provider                     | string         | Model provider                | `tiwater`(default)/`customization`/`aliyun`/`bytedance`/`qcloud`/`baidu`/`deepseek`/`zai`/`openai` |
| name                         | string         | Model name                    | tiwater: `stardust-6.0`/`stardust-5.0`/`stardust-3.0`/`stardust-2.5-max`/`stardust-2.5-pro`/`stardust-2.5-turbo`/`stardust-2.5-lite`; deepseek: `deepseek-v3`; openai: `gpt-4` etc. |
| modalities                   | string[]       | Interaction modes             | `text`/`audio`/`video`                                       |
| instructions                 | string\|object | System prompt                 | Supports `{{variable}}` syntax (see Template Variables). Object type for ext_config usage. |
| ext_config                   | object         | Extended model config         | See ext_config section below                                 |
| include_initial_prompt       | string         | Enable initial prompts        | `null`=off, `first`=prepend to history, `last`=append to history |
| initial_user_prompt          | string         | Initial user message          | Does not support `{{variable}}`                              |
| initial_assistant_prompt     | string         | Initial assistant message     | Does not support `{{variable}}`                              |
| history_conversation_length  | int            | Conversation turns            | Max 30                                                       |
| tools                        | object[]       | Function tool list            | See Tools section below                                      |
| tool_choice                  | string         | Tool call strategy            | `auto`/`none`/`required`/function name                       |
| use_inner_tools              | boolean        | Use built-in tools            | Default `false`                                              |
| use_inner_view_tools         | boolean        | Use built-in vision tools     | Default `true`                                               |
| emotion_classifier           | string         | Emotion classifier            | Implementation-dependent                                     |
| temperature                  | float          | Response randomness           | [0.01, 1.0]                                                  |
| top_p                        | float          | Nucleus sampling              | [0.0, 1.0]                                                   |
| top_k                        | int            | Top-K sampling                | ≥1                                                           |
| max_response_output_tokens   | int            | Max output tokens             | Default 4096                                                 |
| messages                     | object         | Preset conversation history   | Keyed by user ID (use `"nobody"` for default)                |

#### ext_config — Extended Model Configuration

Two modes of configuration:
1. **Direct**: specify `model_url` + `api_key` + `model_name`
2. **Provider-based**: specify `provider` + `model_name`, system resolves URL/key automatically

| Field      | Type   | Description                              |
|------------|--------|------------------------------------------|
| provider   | string | Model vendor for auto-resolve            |
| model_name | string | Actual model ID to call                  |
| model_url  | string | Explicit model endpoint URL              |
| api_key    | string | Explicit API key                         |

```json
// Direct mode
"ext_config": {
  "model_url": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "api_key": "sk-xxxx",
  "model_name": "doubao-seed-2-0-pro-260215"
}

// Provider-based mode
"ext_config": {
  "provider": "bytedance",
  "model_name": "doubao-seed-2-0-pro-260215"
}
```

#### Preset Messages (`model.messages`)

```json
"messages": {
  "nobody": [
    {"role": "system", "content": "你是一个助手"},
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好！有什么可以帮助你的？"}
  ]
}
```

#### Tools — Function Type (`type: "function"`)

| Field           | Type   | Description          | Constraints                                     |
|-----------------|--------|----------------------|-------------------------------------------------|
| type            | string | Tool type            | `"function"`                                     |
| name            | string | Function name        | Unique, `[a-z0-9_]+` format                     |
| description     | string | When to call         | Be precise — affects model decision              |
| parameters      | object | JSON Schema params   | Standard JSON Schema `object` type               |
| code            | string | Code (server_mode)   | Only when operation_mode=server_mode             |
| language        | string | Code language        | `python`/`shell` (server_mode only)              |
| platform        | string | Run platform         | Default `linux` (server_mode only)               |
| operation_mode  | string | Operation mode       | `client_mode`(default)/`server_mode`/`mcp_mode`  |
| execution_type  | string | Execution type       | `synchronous`(default)/`asynchronous`            |
| result_handling | string | Result handling      | `process_in_client`(default)/`process_in_llm`/`ignore_result` |

```json
{
  "type": "function",
  "name": "get_weather",
  "description": "当用户询问天气信息时触发，需明确提供中文拼音格式的地理位置参数",
  "parameters": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "中文拼音格式的地理位置",
        "enum": ["beijing", "shanghai", "guangzhou"]
      }
    },
    "required": ["location"]
  }
}
```

#### Tools — MCP Type (`type: "mcp"`)

| Field              | Type     | Description                   | Constraints                        |
|--------------------|----------|-------------------------------|------------------------------------|
| type               | string   | Tool type                     | `"mcp"`                            |
| server_label       | string   | MCP server identifier         | Required                           |
| server_url         | string   | SSE endpoint URL              | HTTPS, mutually exclusive with connector_id |
| connector_id       | string   | Preset connector ID           | Mutually exclusive with server_url |
| server_description | string   | Server purpose description    | Optional, helps model decisions    |
| allowed_tools      | string[] | Tool whitelist                | Optional, all tools if omitted     |
| require_approval   | string   | Approval requirement          | `null`(default)/`"always"`         |
| authorization      | string   | Auth header value             | e.g. `"Bearer token123"`          |
| headers            | object   | Custom HTTP headers           | Optional                           |

```json
{
  "type": "mcp",
  "server_label": "my_weather_server",
  "server_url": "https://mcp-weather.example.com/sse",
  "server_description": "提供实时天气信息和预报",
  "authorization": "Bearer my_secret_token_123",
  "allowed_tools": ["get_current_weather", "get_forecast"]
}
```

---

### 2. Speech (`session.speech`)

| Field               | Type   | Description        | Constraints              |
|---------------------|--------|--------------------|--------------------------|
| provider            | string | TTS provider       | System-configured        |
| voice               | string | Voice identifier   | From voice library       |
| output_audio_format | string | Audio format       | `pcm16` (16-bit/mono/24kHz) |
| emotion             | string | Voice emotion      | `happy`/`sad`/`angry`/`surprised`/`fearful`/`disgusted`/`neutral` |
| speed_ratio         | int    | Speed (1-100)      | 1=slowest, 50=default, 100=fastest |
| pitch_ratio         | int    | Pitch (1-100)      | 1=lowest, 50=default, 100=highest  |
| volume_ratio        | int    | Volume (1-100)     | 1=quietest, 50=default, 100=loudest |

```json
"speech": {
  "voice": "zh_male_beijingxiaoye_moon_bigtts",
  "output_audio_format": "pcm16",
  "speed_ratio": 65,
  "pitch_ratio": 45,
  "volume_ratio": 70
}
```

---

### 3. Hearing (`session.hearing`)

| Field                              | Type        | Description            | Default      |
|------------------------------------|-------------|------------------------|--------------|
| provider                           | string      | ASR provider           | System-configured |
| input_audio_format                 | string      | Audio input format     | `pcm16`      |
| turn_detection                     | object\|null | VAD config (null=off)  | server_vad   |
| turn_detection.type                | string      | Detection type         | `server_vad` |
| turn_detection.threshold           | float       | Activation threshold   | 0.09 (quiet: 0.02-0.09, noisy: 0.09-0.2) |
| turn_detection.prefix_padding_ms   | int         | Pre-speech buffer (ms) | 300          |
| turn_detection.silence_duration_ms | int         | Silence cutoff (ms)    | 520          |
| turn_voiceprint                    | object\|null | Voiceprint config      | null (off)   |
| turn_voiceprint.use                | boolean     | Enable voiceprint      | false        |
| turn_voiceprint.type               | string      | Match type             | `group`/`single` |
| turn_voiceprint.group_id           | string      | Group ID (type=group)  | —            |
| turn_voiceprint.profile_id         | string      | Profile ID (type=single) | —          |
| turn_voiceprint.threshold          | float       | Match threshold (0-100) | 75          |

```json
"hearing": {
  "input_audio_format": "pcm16",
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.07,
    "prefix_padding_ms": 300,
    "silence_duration_ms": 520
  },
  "turn_voiceprint": null
}
```

---

### 4. Vision (`session.vision`)

| Field                            | Type          | Description             | Default |
|----------------------------------|---------------|-------------------------|---------|
| enable_face_detection            | boolean       | Enable face detection   | false   |
| enable_face_identification       | boolean       | Enable face recognition | false   |
| enable_gesture_detection         | boolean       | Enable gesture detection | false  |
| enable_object_detection          | boolean       | Enable object detection | false   |
| object_detection_target_classes  | string[]\|null | Target object classes  | null    |
| face_album_id                    | string\|null  | Face album ID           | null (auto-generated from group_id+robot_id) |

**Supported object classes**: person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic light, fire hydrant, stop sign, parking meter, bench, bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake, chair, couch, potted plant, bed, dining table, toilet, tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator, book, clock, vase, scissors, teddy bear, hair drier, toothbrush

```json
"vision": {
  "enable_face_detection": true,
  "enable_face_identification": true,
  "enable_object_detection": true,
  "object_detection_target_classes": ["person", "book"]
}
```

---

### 5. Knowledge (`session.knowledge`)

#### Memories

| Field  | Type    | Description          | Default |
|--------|---------|----------------------|---------|
| enable | boolean | Enable memory recall | false   |

#### Scripts (Dialogue Rules)

| Layer         | Field      | Type     | Description                         |
|---------------|------------|----------|-------------------------------------|
| scripts[]     | id         | string   | Unique script ID                    |
|               | name       | string   | Knowledge base name (cloud-synced)  |
|               | priority   | int      | Match priority (1-10, higher first) |
|               | dialogues[]| object[] | Dialogue rule set                   |
| dialogues[]   | id         | string   | Unique dialogue ID                  |
|               | prompts[]  | string[] | Trigger phrases (semantic match)    |
|               | responses[]| object[] | Response action chain (sequential)  |
| responses[]   | id         | string   | Unique response ID                  |
|               | type       | string   | `string`/`label`/`function`         |

Response types:
- `string`: `{"type": "string", "message": "text content"}`
- `label`: `{"type": "label", "label": "action_label"}`
- `function`: `{"type": "function", "function": "fn_name", "arguments": {...}}`

#### Retrieval

| Field                              | Type     | Description         |
|------------------------------------|----------|---------------------|
| enable                             | boolean  | Enable retrieval    |
| knowledge_base_ids                 | string[] | Knowledge base IDs  |
| retrieval_strategy.type            | string   | `vector`/`keyword`/`hybrid` |
| retrieval_strategy.top_k           | int      | Number of results   |
| retrieval_strategy.score_threshold | float    | Similarity threshold |

```json
"knowledge": {
  "memories": { "enable": true },
  "scripts": [
    {
      "id": "script_01",
      "name": "greetings",
      "priority": 1,
      "dialogues": [
        {
          "id": "greeting_001",
          "prompts": ["你好", "早上好"],
          "responses": [
            {"id": "resp_01", "type": "string", "message": "你好！"}
          ]
        }
      ]
    }
  ],
  "retrieval": {
    "enable": true,
    "knowledge_base_ids": ["kb_id_1"],
    "retrieval_strategy": {
      "type": "hybrid",
      "top_k": 5,
      "score_threshold": 0.7
    }
  }
}
```

---

### 6. Webhook (`session.webhook`)

| Field         | Type     | Description               | Default |
|---------------|----------|---------------------------|---------|
| url           | string   | Callback URL              | —       |
| timeout       | int      | Timeout (seconds)         | 5       |
| retry_times   | int      | Retry count               | 0       |
| events        | string[] | Event types to push       | `[]`    |
| headers       | object   | Custom headers (supports `{{variable}}`) | `{}` |
| custom_fields | object   | Extra fields in body      | `{}`    |
| enabled       | boolean  | Enable webhook            | false   |

Supported events: `response.done.ext`, `error`

```json
"webhook": {
  "url": "https://your-server.com/webhook",
  "timeout": 5,
  "retry_times": 0,
  "events": ["response.done.ext", "error"],
  "headers": {
    "Authorization": "Bearer xxx",
    "Content-Type": "application/json"
  },
  "custom_fields": { "source": "stardust" },
  "enabled": true
}
```

---

### 7. Triggers (`session.triggers`)

Perception-event rules that fire actions automatically.

| Field      | Type     | Description          | Constraints                  |
|------------|----------|----------------------|------------------------------|
| id         | string   | Rule ID (unique)     | —                            |
| name       | string   | Rule name            | —                            |
| enabled    | boolean  | Active               | Default `true`               |
| event      | string   | Event type           | See events below             |
| conditions | object   | Trigger conditions   | Event-type dependent         |
| actions    | object[] | Actions (sequential) | At least one                 |

**Events**: `PERCEPTION_FACE_APPEARED`, `PERCEPTION_FACE_DISAPPEARED`, `PERCEPTION_FACE_RECOGNIZED`, `PERCEPTION_GESTURE_DETECTED`, `PERCEPTION_OBJECT_DETECTED`

**Condition fields**: `is_known` (boolean), `cooldown_seconds` (int), `gesture_type` (string), `object_class` (string)

**Action types**:
- `tts`: `{"type": "tts", "template": "{name}，你好！"}`
- `function_call`: `{"type": "function_call", "function": "fn_name", "arguments": {...}}`
- `event`: `{"type": "event", "event_type": "type", "data": {...}}`

TTS template variables: `{name}`, `{face_id}`, `{gesture_type}`, `{object_class}`

```json
"triggers": [
  {
    "id": "greet_known_face",
    "name": "已知人脸打招呼",
    "enabled": true,
    "event": "PERCEPTION_FACE_APPEARED",
    "conditions": { "is_known": true, "cooldown_seconds": 300 },
    "actions": [
      { "type": "tts", "template": "{name}，很高兴又见到你！" }
    ]
  }
]
```

---

### 8. Extra (`session.extra`)

Passthrough object for custom fields. Structure is user-defined.

```json
"extra": {
  "custom_field_1": "value1",
  "custom_field_2": { "nested_key": "nested_value" }
}
```

---

## Template Variables (`{{variable}}` Syntax)

Used in `instructions` and other string fields.

### Syntax

| Syntax                                 | Description                    |
|----------------------------------------|--------------------------------|
| `{{path.to.var}}`                      | Basic variable substitution    |
| `{{path.to.var\|default}}`             | Default value if empty         |
| `{{?path.to.var}}...{{/path.to.var}}`  | Conditional (render if exists) |
| `{{#listPath}}...{{/listPath}}`        | Loop over list items           |

### Built-in Variables

| Variable                              | Description                                       |
|---------------------------------------|---------------------------------------------------|
| `{{tiwater.datetime}}`                | Current UTC+8 datetime (EN): YYYY-mm-dd week HH:MM:SS |
| `{{tiwater.datetime.cn}}`             | Current UTC+8 datetime (CN): YYYY年mm月dd日 星期 HH时MM分SS秒 |
| `{{tiwater.vision.user_emotion}}`     | User emotion: happy/sad/angry/surprised/fearful/disgusted/neutral |
| `{{tiwater.vision.user_emotion.cn}}`  | User emotion (CN): 快乐/伤心/生气/惊讶/害怕/厌恶/平静 |
| `{{tiwater.vision.user_gender}}`      | User gender: Man/Woman/unknown                    |
| `{{tiwater.vision.user_gender.cn}}`   | User gender (CN): 男/女/未知                       |
| `{{tiwater.vision.user_age}}`         | User age (number) or unknown                      |
| `{{tiwater.vision.user_age_subsection.cn}}` | Age range (CN): 少年/中年/老年                |
| `{{tiwater.vision.user_name}}`        | User name or 未知                                  |

### Example — Character prompt with conditionals and lists

```text
我的名字叫{{terminal.name}}，
{{?terminal.birthday}}我的生日是{{terminal.birthday}}{{/terminal.birthday}}，
我的性别是{{terminal.gender}}，
我的爱好是{{terminal.hobby|网球}}，

{{?terminal.relationships}}我和以下人物有关系：
{{#terminal.relationships}}
- 姓名：{{name|未知}}
  关系：{{relation|未知}}
  备注：{{note|无}}
{{/terminal.relationships}}
{{/terminal.relationships}}
```

Flat keys like `relationships.r1.name`, `relationships.r2.name` are auto-aggregated into a list for `{{#terminal.relationships}}` loops.

---

## Workflows

### Create a minimal agent config
1. Start with the event envelope: `{"event_id": "...", "type": "session.update", "session": {}}`
2. Set `session.model.provider` and `session.model.name`
3. Set `session.model.modalities` (e.g. `["text", "audio"]`)
4. Write `session.model.instructions` with the agent's persona
5. Configure `session.speech.voice` for TTS output
6. Configure `session.hearing.turn_detection` for microphone input
7. Save as `.json` file

### Add a function tool
1. Add an object to `session.model.tools[]` with `"type": "function"`
2. Set `name` (unique, lowercase, snake_case)
3. Write a precise `description` (explains WHEN to call)
4. Define `parameters` using JSON Schema format
5. Set `operation_mode` if using server-side execution

### Add an MCP server integration
1. Add an object to `session.model.tools[]` with `"type": "mcp"`
2. Set `server_label` and `server_url` (HTTPS SSE endpoint)
3. Optionally set `allowed_tools` to restrict available tools
4. Set `authorization` if the server requires auth

### Configure perception triggers
1. Enable detection in `session.vision` (e.g. `enable_face_detection: true`)
2. Add trigger rules to `session.triggers[]`
3. Set `event` type, `conditions`, and `actions`
4. Use `cooldown_seconds` to prevent repeated triggers

## Error Codes

- `STARDUST_CONFIG_INVALID` — JSON structure does not match session config schema
- `STARDUST_FIELD_MISSING` — Required field is missing from config
