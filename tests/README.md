# TiClaw E2E Test Suite

## Quick Start

```bash
pnpm test:e2e                       # start server + run all tests
bash tests/run-e2e.sh --no-server   # run against already-running server
bash tests/run-e2e.sh 01            # run a single scenario (by number)
TC_PORT=3000 pnpm test:e2e          # custom port
```

## How to Write a New Test Case

### Principles

1. **Test real behavior, not implementation.** Send real HTTP requests or CLI commands. Never mock, stub, or import internal modules.
2. **One scenario per file.** Name files `NN-description.sh` (e.g., `12-file-upload.sh`). Each file tests one feature area.
3. **Each test checks one thing.** Use clear assertion names that describe the expected behavior.
4. **Report failures honestly.** Never suppress errors to make tests pass. A failing test = a real bug = a GitHub issue.
5. **LLM-as-judge for quality.** When string matching isn't enough (e.g., "is this well-formatted?"), use `judge_response` to let the LLM evaluate quality.
6. **Known bug: sequential messages.** Due to [#2](https://github.com/dustland/ticlaw/issues/2), the 2nd chat message to the agent in a single script run returns empty. Keep chat tests to 1 message per script, or accept failures for messages after the first.

### File Template

```bash
#!/usr/bin/env bash
# tests/NN-my-feature.sh — Short description of what this tests
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario NN: My Feature"

BASE="http://localhost:${TC_PORT}"

# ── Test NN.1: Description ──
echo -e "  Doing something..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result=$(curl -sf "${BASE}/api/something" 2>/dev/null) || result=""
if [ expected_condition ]; then
  echo -e "  ${GREEN}✓${NC} What passed"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} What failed"
  echo -e "    ${RED}Got:${NC} $result"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
```

### Available Helpers (from `lib.sh`)

| Function | Usage | Notes |
|----------|-------|-------|
| `send_message "msg" [agent] [session] [timeout]` | Send a chat message via CLI | Writes to temp file; result in stdout |
| `get_response_text "$json"` | Extract `response` field from JSON | |
| `is_error "$json"` | Returns `"yes"` or `"no"` | |
| `assert_contains "name" "$text" "expected"` | Case-insensitive grep | |
| `assert_not_contains "name" "$text" "unexpected"` | Inverse of above | |
| `assert_not_empty "name" "$text"` | Fails on empty string | |
| `assert_no_error "name" "$json"` | Checks no `error` key in JSON | |
| `judge_response "name" "$text" "criteria"` | LLM-as-judge quality check | Sends criteria + response to agent for PASS/FAIL |
| `print_scenario_header "title"` | Print section header | |
| `print_summary` | Print pass/fail counts | |

### Two Types of Tests

**API tests** (fast, no LLM needed):
```bash
# Just hit HTTP endpoints and check status codes / JSON structure
result=$(curl -sf "${BASE}/api/sessions" 2>/dev/null) || result=""
```

**Chat tests** (slow, needs LLM API key):
```bash
# Send a real message and check the agent's response
result=$(send_message "What is 2+2?" "default" "unique-session-id")
response=$(get_response_text "$result")
assert_contains "Math works" "$response" "4" || true
```

### Checklist Before Submitting

- [ ] File is executable (`chmod +x`)
- [ ] Passes `bash -n tests/NN-my-feature.sh` (syntax check)
- [ ] Sources `lib.sh` at the top
- [ ] Uses unique session IDs (include `$$` for PID uniqueness)
- [ ] Each assertion has `|| true` to prevent early exit
- [ ] `print_summary` at the end
- [ ] File name follows the `NN-name.sh` pattern

## Test Coverage Map

| Area | Test File | Type |
|------|-----------|------|
| Basic conversation | `01-basic-chat.sh` | Chat |
| Multi-turn context | `02-context.sh` | Chat |
| Skill invocation | `03-skills.sh` | Chat |
| Edge cases (i18n, long input) | `04-edge-cases.sh` | Chat |
| Schedule CRUD | `05-schedules.sh` | API |
| Health, node, enrollment status | `06-api-health.sh` | API |
| Skills API + CLI | `07-api-skills.sh` | API + CLI |
| Sessions, agents, tasks, messages | `08-api-sessions.sh` | API |
| Enrollment lifecycle | `09-enrollment.sh` | API |
| Mind/memory API | `10-api-mind.sh` | API |
| Error handling | `11-error-handling.sh` | API |

## Prerequisites

- LLM API key configured in `~/.ticlaw/config.yaml` (for chat tests)
- `python3` available (for JSON parsing)
- `curl` available (for API tests)
