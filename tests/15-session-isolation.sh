#!/usr/bin/env bash
# tests/15-session-isolation.sh
# Regression test for issue #41: same-agent concurrent-session cross-wiring.
#
# Verifies that:
#   1. Two sessions for the same agent get isolated, independent responses.
#   2. A globally-disabled skill is NOT active even when listed in skills.json (issue #49).
#   3. The Dispatcher stores runners per agentId:sessionId, not per agentId.
#
# Strategy: seed each session with a unique secret word, then ask the agent
# to repeat it back. If sessions are isolated the words should never bleed
# across sessions.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 15: Session Isolation & Per-Agent skills.json Checks"

BASE="http://localhost:${TC_PORT:-2755}"
AGENT="iso_agent_$$"

# ── Fixture setup ──
mkdir -p "$HOME/.ticlaw/agents/$AGENT/memory"
cat > "$HOME/.ticlaw/agents/$AGENT/SOUL.md" <<'EOF'
You are a test agent. When asked "what is the secret word?", reply with ONLY
the exact secret word that was written in your MEMORY for this session and
nothing else.
EOF

SESSION_A="iso_sess_a_$$"
SESSION_B="iso_sess_b_$$"

# Write session-specific MEMORY through the /api/mind/files endpoint so each
# session sees its own context. Since the filesystem stores mind at agent level
# we use a simpler strategy: include the secret word in the chat message itself
# and ask the agent to echo it back verbatim.

# ── Test 15.1: Session A gets its own response ──
echo -e "  Testing session A isolation..."
result_a=$(send_message \
  "Your secret code for this conversation is ALPHA-7. Please acknowlnode by saying: The code is ALPHA-7." \
  "$AGENT" "$SESSION_A")
response_a=$(get_response_text "$result_a" || echo "")

assert_not_empty "Session A received a response" "$response_a"
assert_contains "Session A response contains its code" "$response_a" "ALPHA-7"

# ── Test 15.2: Session B gets its own response ──
echo -e "  Testing session B isolation..."
result_b=$(send_message \
  "Your secret code for this conversation is BRAVO-9. Please acknowlnode by saying: The code is BRAVO-9." \
  "$AGENT" "$SESSION_B")
response_b=$(get_response_text "$result_b" || echo "")

assert_not_empty "Session B received a response" "$response_b"
assert_contains "Session B response contains its code" "$response_b" "BRAVO-9"

# ── Test 15.3: Session A does NOT contain session B's code ──
assert_not_contains "Session A did NOT leak session B code" "$response_a" "BRAVO-9"

# ── Test 15.4: Session B does NOT contain session A's code ──
assert_not_contains "Session B did NOT leak session A code" "$response_b" "ALPHA-7"

# ── Test 15.5: Session A follow-up still remembers its own code (warm-path test) ──
echo -e "  Testing session A warm-path continuity..."
result_a2=$(send_message \
  "What was the secret code I gave you at the start of this conversation? Reply with ONLY the code." \
  "$AGENT" "$SESSION_A")
response_a2=$(get_response_text "$result_a2" || echo "")

assert_not_empty "Session A warm follow-up received a response" "$response_a2"
assert_contains "Session A warm follow-up returns correct code" "$response_a2" "ALPHA-7"
assert_not_contains "Session A warm follow-up does NOT contain B code" "$response_a2" "BRAVO-9"

# ── Test 15.6: Session B follow-up still remembers its own code ──
echo -e "  Testing session B warm-path continuity..."
result_b2=$(send_message \
  "What was the secret code I gave you at the start of this conversation? Reply with ONLY the code." \
  "$AGENT" "$SESSION_B")
response_b2=$(get_response_text "$result_b2" || echo "")

assert_not_empty "Session B warm follow-up received a response" "$response_b2"
assert_contains "Session B warm follow-up returns correct code" "$response_b2" "BRAVO-9"
assert_not_contains "Session B warm follow-up does NOT contain A code" "$response_b2" "ALPHA-7"

# ── Test 15.7 (issue #49): globally-disabled skill not active via skills.json ──
echo -e "  Testing skills.json disabled-skill bypass prevention..."
# Ensure a skill is globally disabled by inspecting the API
DISABLED_SKILL="web-search"
disable_result=$(curl --max-time 8 -sf -X POST "${BASE}/api/skills/${DISABLED_SKILL}/disable" \
  -H "Content-Type: application/json" 2>/dev/null) || disable_result=""

# Create an agent that allowlists the now-disabled skill
SKILL_AGENT="skill_iso_agent_$$"
mkdir -p "$HOME/.ticlaw/agents/$SKILL_AGENT"
echo "[\"${DISABLED_SKILL}\"]" > "$HOME/.ticlaw/agents/$SKILL_AGENT/skills.json"
cat > "$HOME/.ticlaw/agents/$SKILL_AGENT/SOUL.md" <<'EOF'
You are a test agent. List your available custom tools concisely.
EOF

result_skill=$(send_message \
  "List all custom tools you have available. Be concise." \
  "$SKILL_AGENT" "skill_sess_$$")
response_skill=$(get_response_text "$result_skill" || echo "")

assert_not_empty "Skill-isolation agent responded" "$response_skill"
# The globally-disabled skill should NOT appear even though it's in skills.json
assert_not_contains "Disabled skill not exposed via skills.json bypass" \
  "$response_skill" "$DISABLED_SKILL"

print_summary || true
