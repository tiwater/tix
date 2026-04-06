#!/usr/bin/env bash
# tests/lib.sh — E2E test helpers for Tix
# Source this in every test script: source "$(dirname "$0")/lib.sh"

set -euo pipefail

# ────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────
TIX_PORT="${TIX_PORT:-2756}"
TIX_TIMEOUT="${TIX_TIMEOUT:-120}"
TIX_CURL_TIMEOUT="${TIX_CURL_TIMEOUT:-8}"   # seconds before curl gives up
TIX_CLI="node $(dirname "$0")/../cli/dist/index.js"

# Resolve TIX_HOME to ensure tests use the same directory as the server
# Respect existing environment variable, otherwise default to ~/.tix
if [ -z "${TIX_HOME:-}" ]; then
  export TIX_HOME="$HOME/.tix"
fi

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Cleanup registry to track resources created during the test
CLEANUP_SCHEDULES=()
CLEANUP_AGENTS=()
CLEANUP_SESSIONS=()
CLEANUP_FILES=()

register_schedule() { CLEANUP_SCHEDULES+=("$1"); }
register_agent() { CLEANUP_AGENTS+=("$1"); }
register_session() { CLEANUP_SESSIONS+=("$1"); } # $1 is agent_id:session_id
register_file() { CLEANUP_FILES+=("$1"); }

perform_cleanup() {
  local base_url="http://localhost:${TIX_PORT}"
  
  # 1. Delete schedules via API (safer as it updates server state)
  for sched_id in "${CLEANUP_SCHEDULES[@]}"; do
    curl --max-time 2 -sf -X DELETE "${base_url}/api/schedules/${sched_id}" >/dev/null 2>&1 || true
  done

  # 2. Delete sessions via API
  for sess in "${CLEANUP_SESSIONS[@]}"; do
    local agent_id="${sess%%:*}"
    local session_id="${sess#*:}"
    curl --max-time 2 -sf -X DELETE "${base_url}/api/sessions/${session_id}?agent_id=${agent_id}" >/dev/null 2>&1 || true
  done

  # 3. Delete agents/directories from filesystem
  for agent_id in "${CLEANUP_AGENTS[@]}"; do
    local agent_dir="${TIX_HOME}/agents/${agent_id}"
    if [ -d "$agent_dir" ]; then
      rm -rf "$agent_dir"
    fi
  done

  # 4. Delete temp files
  for f in "${CLEANUP_FILES[@]}"; do
    rm -rf "$f"
  done
}

# Automatically perform cleanup on exit
trap perform_cleanup EXIT

# Convenience wrapper: curl with a short timeout so tests never hang
tix_curl() { curl --max-time "$TIX_CURL_TIMEOUT" "$@"; }

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ────────────────────────────────────────────────────
# Server management
# ────────────────────────────────────────────────────
wait_for_server() {
  local port="${1:-$TIX_PORT}"
  local timeout="${2:-30}"
  local elapsed=0
  echo -e "${CYAN}Waiting for server on port ${port}...${NC}"
  while [ $elapsed -lt $timeout ]; do
    if curl --max-time 8 -sf "http://localhost:${port}/health" > /dev/null 2>&1; then
      echo -e "${GREEN}Server is ready${NC}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo -e "${RED}Server did not start within ${timeout}s${NC}"
  return 1
}

# ────────────────────────────────────────────────────
# Send a message and get the response
# ────────────────────────────────────────────────────
# Usage: send_message "Hello" [agent_id] [session_id] [timeout]
#   Sets LAST_RESULT variable with the JSON output
send_message() {
  local message="$1"
  local agent="${2:-default}"
  local session="${3:-}"
  local timeout="${4:-$TIX_TIMEOUT}"

  local session_flag=""
  if [ -n "$session" ]; then
    session_flag="--session $session"
  fi

  # Use temp file instead of $() subshell — Node.js process.exit() with active
  # SSE connections doesn't flush stdout properly in subshell capture mode
  local tmpfile="/tmp/tix-e2e-$$-${RANDOM}.json"

  $TIX_CLI chat "$message" \
    --agent "$agent" \
    $session_flag \
    --json \
    --timeout "$timeout" \
    --port "$TIX_PORT" \
    > "$tmpfile" 2>/dev/null || true

  LAST_RESULT=""
  if [ -f "$tmpfile" ]; then
    LAST_RESULT=$(cat "$tmpfile")
    rm -f "$tmpfile"
  fi
  echo "$LAST_RESULT"
}

# Extract just the response text from JSON output
get_response_text() {
  local json="$1"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response',''))" 2>/dev/null || echo ""
}

# Check if JSON result is an error
is_error() {
  local json="$1"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'error' in d else 'no')" 2>/dev/null || echo "yes"
}

# ────────────────────────────────────────────────────
# Assertions
# ────────────────────────────────────────────────────
assert_contains() {
  local test_name="$1"
  local response="$2"
  local expected="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))

  if echo "$response" | grep -qi "$expected"; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "  ${RED}✗${NC} $test_name"
    echo -e "    ${RED}Expected to contain:${NC} $expected"
    echo -e "    ${RED}Got:${NC} $(echo "$response" | head -3)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

assert_not_contains() {
  local test_name="$1"
  local response="$2"
  local unexpected="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))

  if echo "$response" | grep -qi "$unexpected"; then
    echo -e "  ${RED}✗${NC} $test_name"
    echo -e "    ${RED}Should NOT contain:${NC} $unexpected"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  else
    echo -e "  ${GREEN}✓${NC} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  fi
}

assert_not_empty() {
  local test_name="$1"
  local response="$2"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))

  if [ -n "$response" ] && [ "$response" != "{}" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "  ${RED}✗${NC} $test_name"
    echo -e "    ${RED}Response was empty${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

assert_no_error() {
  local test_name="$1"
  local json="$2"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))

  if [ "$(is_error "$json")" = "no" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "  ${RED}✗${NC} $test_name"
    echo -e "    ${RED}Got error:${NC} $(echo "$json" | head -3)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# ────────────────────────────────────────────────────
# LLM-as-Judge: evaluate response quality
# ────────────────────────────────────────────────────
# Uses the Tix agent itself to judge whether a response
# meets quality criteria. This catches problems like:
#   - Raw HTML/webpage content instead of a clean answer
#   - Hallucinated or irrelevant information
#   - Poorly formatted or garbled output
#
# Usage: judge_response "test name" "$response" "criteria description"
# Example: judge_response "news quality" "$response" \
#   "The response should be well-formatted news with clear headlines and summaries, NOT raw HTML or webpage source code"
judge_response() {
  local test_name="$1"
  local response="$2"
  local criteria="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))

  # Ask the agent to judge the response
  local judge_prompt="You are a test evaluator. Judge the following response against the criteria.

CRITERIA: ${criteria}

RESPONSE TO JUDGE:
---
$(echo "$response" | head -100)
---

Reply with ONLY one word: PASS or FAIL"

  local verdict_json
  verdict_json=$(send_message "$judge_prompt" "default" "judge-$$" "30")
  local verdict
  verdict=$(get_response_text "$verdict_json")

  if echo "$verdict" | grep -qi "PASS"; then
    echo -e "  ${GREEN}✓${NC} $test_name ${YELLOW}(LLM judge)${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "  ${RED}✗${NC} $test_name ${YELLOW}(LLM judge)${NC}"
    echo -e "    ${RED}Criteria:${NC} $criteria"
    echo -e "    ${RED}Verdict:${NC} $verdict"
    echo -e "    ${RED}Response (first 200 chars):${NC} $(echo "$response" | head -c 200)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# ────────────────────────────────────────────────────
# Test reporting
# ────────────────────────────────────────────────────
print_scenario_header() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━ $1 ━━━${NC}"
}

print_summary() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  Results: ${GREEN}${TESTS_PASSED} passed${NC} / ${RED}${TESTS_FAILED} failed${NC} / ${TESTS_TOTAL} total"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if [ "$TESTS_FAILED" -gt 0 ]; then
    return 1
  fi
  return 0
}
