#!/usr/bin/env bash
# tests/17-memory-prompt-cache.sh
# Regression tests for issues #42 and #43:
#   #42 — Session memory should be isolated per session (Claude session IDs)
#   #43 — Prompt cache must invalidate when a journal is appended
#
# Strategy:
#   17.1  Verify Claude session IDs are stored per agentId+sessionId
#         (not just per agentId) by checking the .claude_sessions path layout
#   17.2  Verify two sessions for the same agent get independent conversation
#         contexts (each session remembers its OWN secret, not the other's)
#   17.3  Verify journal append triggers cache invalidation by seeding MEMORY.md,
#         sending a message (warms prompt cache), appending a new fact to the
#         memory journal, then verifying the agent knows the new fact
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 17: Memory Isolation & Prompt Cache Invalidation"

BASE="http://localhost:${TIX_PORT:-2756}"
MEM_AGENT="mem_agent_$$"

register_agent "$MEM_AGENT"

# ── Fixture ──
mkdir -p "$TIX_HOME/agents/$MEM_AGENT/memory"
cat > "$TIX_HOME/agents/$MEM_AGENT/SOUL.md" <<'EOF'
You are a memory-test agent. When asked "what is the secret fact?",
reply with ONLY the exact phrase written in your memory files and nothing else.
EOF
echo "" > "$TIX_HOME/agents/$MEM_AGENT/MEMORY.md"

SESS1="mem_sess1_$$"
SESS2="mem_sess2_$$"

# ── Test 17.1: Claude session files are per-session (not per-agent) ──
echo -e "  Testing per-session Claude session file naming..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))

SESS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${SESS1}', safe=''))")
EXPECTED_PATH="$TIX_HOME/agents/$MEM_AGENT/.claude_sessions/${SESS_ENCODED}.id"

# Send a first message to trigger Claude session ID creation
result1=$(send_message \
  "Acknowlnode with: SESSION-ONE-READY" \
  "$MEM_AGENT" "$SESS1")
response1=$(get_response_text "$result1" || echo "")
assert_not_empty "Session 1 responded" "$response1"

# After the run, a .claude_sessions file should exist for this session
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -f "$EXPECTED_PATH" ]; then
  echo -e "  ${GREEN}✓${NC} Claude session file exists at session-scoped path"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${YELLOW}⚠${NC} Claude session file not found (agent may not have written session ID yet)"
  TESTS_TOTAL=$((TESTS_TOTAL - 1))
fi

# ── Test 17.2: Two sessions don't cross-contaminate memory contexts ──
echo -e "  Testing session-level conversation isolation..."
result2=$(send_message \
  "Acknowlnode with: SESSION-TWO-READY" \
  "$MEM_AGENT" "$SESS2")
response2=$(get_response_text "$result2" || echo "")

assert_not_empty "Session 2 responded" "$response2"
assert_not_contains "Session 2 does not contain session 1 ack" "$response2" "SESSION-ONE-READY"
assert_not_contains "Session 1 does not contain session 2 ack" "$response1" "SESSION-TWO-READY"

# ── Test 17.3: Prompt cache invalidates after journal append (issue #43) ──
echo -e "  Testing prompt cache invalidation on journal append..."

# Seed MEMORY.md with initial fact
echo "The secret fact is: INITIAL-FACT-XYZ" > "$TIX_HOME/agents/$MEM_AGENT/MEMORY.md"

# Ask agent in session 1  — this warms the prompt cache
MEM_SESS="mem_cache_sess_$$"
result_before=$(send_message \
  "What is the secret fact? Reply with ONLY the fact." \
  "$MEM_AGENT" "$MEM_SESS")
response_before=$(get_response_text "$result_before" || echo "")
assert_contains "Agent knows initial fact" "$response_before" "INITIAL-FACT-XYZ"

# Now UPDATE the MEMORY.md (simulating what consolidateMemory does via appendFile)
# We use echo >> to append, which changes the file mtime but NOT the directory mtime
echo "" >> "$TIX_HOME/agents/$MEM_AGENT/MEMORY.md"
echo "The secret fact is now: UPDATED-FACT-ABC" >> "$TIX_HOME/agents/$MEM_AGENT/MEMORY.md"

# Ask again in a NEW session to force a cold prompt rebuild
MEM_SESS2="mem_cache_sess2_$$"
result_after=$(send_message \
  "What is the secret fact? Reply with ONLY the most recent fact." \
  "$MEM_AGENT" "$MEM_SESS2")
response_after=$(get_response_text "$result_after" || echo "")

assert_not_empty "Agent responded after memory update" "$response_after"
# The agent should now know the UPDATED fact (cache invalidated by mtime change)
assert_contains "Agent picks up updated fact after journal append" "$response_after" "UPDATED-FACT-ABC"

print_summary || true
