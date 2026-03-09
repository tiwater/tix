# Built-in Robot Skills Design

TiClaw can control physical robots when configured. This document defines the built-in skills for robot interaction, based on [Ticos](https://github.com/tiwater/ticos) library skills and scene tools.

---

## Reference: Ticos Skills

From `ticos/packages/web/src/lib/components/skills/library-skills.ts` and `ticos/docs/design/agent-vs-scene.md`:

| Skill | Params | Description |
|-------|--------|-------------|
| `terminal_motion` | `motion`, `emotion` | Control humanoid actions and expressions |
| `text_to_speech` | `text` | Convert text to speech |
| `navigate_to` | `location` (waypoint_id or waypoint_name) | Navigate to specified location |
| `pick_up_object` | `object_name` | Pick up specified object |

**Scene tools** (when robot is in a scene):

| Tool | Params | Description |
|------|--------|-------------|
| `get_current_location` | — | Get current position |
| `get_nearby_waypoints` | `radius` (optional) | List nearby waypoints |
| `get_route` | `route_id` | Get route info |
| `follow_route` | `route_id` | Navigate along a route |
| `get_zone_info` | `zone_id` | Get zone info |

---

## Architecture Options

### Option A: MCP Client (Recommended)

Ticos robots expose an MCP server. TiClaw connects as an MCP client and discovers tools at runtime.

- **Config**: `config.yaml` → `robot.mcp_url` (SSE or STDIO)
- **When configured**: Agent gets robot tools in addition to workspace tools
- **When not configured**: No robot tools; agent behaves as today

### Option B: HTTP API

Robot exposes a REST/WebSocket API. TiClaw has built-in tools that call fixed endpoints.

- **Config**: `robot.api_url`, `robot.api_key` (optional)
- **Pros**: Simple, no MCP dependency
- **Cons**: Tight coupling to API shape; Ticos uses MCP

### Option C: Curated Skill (add-robot-control)

Robot skills as a TiClaw skill package (like add-discord). User applies when they have a robot.

- **Pros**: Follows existing skill pattern
- **Cons**: Robot control is core to "robot mind builder" — should be built-in, not optional add-on

---

## Recommended: Option A (MCP)

1. **Config** (`config.yaml`):

```yaml
robot:
  enabled: true
  mcp_url: "https://robot-xyz.ticos.ai/mcp"   # or stdio for local
  # Optional: filter which tools to expose
  # tools: [terminal_motion, text_to_speech, navigate_to, pick_up_object]
```

2. **Runtime**: On startup, if `robot.enabled` and `robot.mcp_url`:
   - Connect to MCP server
   - List tools
   - Register as agent tools (same pattern as workspace tools)

3. **Agent prompt**: When robot tools are present, add to system prompt:

```
## Robot control (when connected)

You can control the robot using: terminal_motion, text_to_speech, navigate_to, pick_up_object, ...
Use these when the user asks the robot to move, speak, or perform physical actions.
```

4. **Fallback**: If MCP unreachable, log warning and run without robot tools.

---

## Implementation Phases

### Phase 1: MCP Tool Bridge

- Add `src/robot/mcp-bridge.ts`: connect to MCP server, list tools, wrap as AI SDK tools
- Add `getRobotTools()` that returns `Record<string, Tool>` or `null` when disabled
- In `agent.ts`: merge `getRobotTools()` into `tools` when non-null

### Phase 2: Config Integration

- Add `robot` block to `config.example.yaml`
- Read `robot.enabled`, `robot.mcp_url` from config
- Wire into `getEnabledChannelsFromConfig()` pattern (or separate `getRobotConfig()`)

### Phase 3: System Prompt Injection

- When robot tools exist, append robot-specific guidance to system prompt
- List available tool names so the agent knows what it can do

### Phase 4: Error Handling

- MCP connection failures: graceful degradation
- Tool call timeouts: configurable, default 30s
- Retry logic for transient failures

---

## Tool Schema (from Ticos)

For reference when implementing the MCP bridge or fallback stubs:

```typescript
// terminal_motion
{ motion: string, emotion: string }

// text_to_speech
{ text: string }

// navigate_to
{ location: string }  // waypoint_id or waypoint_name

// pick_up_object
{ object_name: string }
```

---

## Open Questions

1. **Multi-robot**: Does one TiClaw instance control one robot, or multiple? (Ticos supports multiple robots; each may have its own MCP.)
2. **Tool filtering**: Expose all MCP tools or only a curated allowlist?
3. **Auth**: MCP over HTTPS may need API key header; STDIO for local robot needs no auth.

---

*Ref: Ticos `library-skills.ts`, `agent-vs-scene.md`, `scene.md`*
