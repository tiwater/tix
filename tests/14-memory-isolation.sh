#!/usr/bin/env bash
# tests/14-memory-isolation.sh — Memory isolation and session-scoped resume files
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 14: Memory Isolation Internals"

AGENT_ID="memory_iso_$$"
SESSION_A="mem_sess_a_$$"
SESSION_B="mem_sess_b_$$"
BASE_DIR="${TIX_HOME}/agents/$AGENT_ID"
SESS_DIR="$BASE_DIR/.claude_sessions"

register_agent "$AGENT_ID"

mkdir -p "$BASE_DIR"
echo "You are $AGENT_ID." > "$BASE_DIR/SOUL.md"
echo "Long-term memory for $AGENT_ID." > "$BASE_DIR/MEMORY.md"

echo -e "  Priming session A..."
result_a=$(send_message "Reply with exactly: ACK-A" "$AGENT_ID" "$SESSION_A" "120")
assert_no_error "Session A run completed" "$result_a" || true

echo -e "  Priming session B..."
result_b=$(send_message "Reply with exactly: ACK-B" "$AGENT_ID" "$SESSION_B" "120")
assert_no_error "Session B run completed" "$result_b" || true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -d "$SESS_DIR" ]; then
  echo -e "  ${GREEN}✓${NC} Session resume directory created"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Session resume directory missing: $SESS_DIR"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

TESTS_TOTAL=$((TESTS_TOTAL + 1))
count=$(find "$SESS_DIR" -maxdepth 1 -type f -name '*.id' 2>/dev/null | wc -l | tr -d ' ')
if [ "${count:-0}" -ge 2 ]; then
  echo -e "  ${GREEN}✓${NC} Session-scoped resume ID files created (${count})"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Expected >=2 session resume files, got ${count:-0}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
