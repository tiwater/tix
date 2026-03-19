#!/usr/bin/env bash
# tests/12-skills-isolation.sh — Verify that agents only load skills assigned to them via skills.json
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 12: Multi-Agent Skill Isolation"

BASE="http://localhost:${TICLAW_PORT:-2756}"

# 1. Setup isolated agents
AGENT_A="agent_a_$$"
AGENT_B="agent_b_$$"
AGENT_C="agent_c_$$"
AGENT_D="agent_d_$$"

mkdir -p "$HOME/.ticlaw/agents/$AGENT_A"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_B"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_C"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_D"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_A/memory"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_B/memory"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_C/memory"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_D/memory"

# Agent A gets ONLY web-search
echo '["web-search"]' > "$HOME/.ticlaw/agents/$AGENT_A/skills.json"
# Give A and B distinct identities too
echo "I am Agent A. My favorite color is red." > "$HOME/.ticlaw/agents/$AGENT_A/SOUL.md"
echo "I remember that I love testing." > "$HOME/.ticlaw/agents/$AGENT_A/MEMORY.md"

# Agent B gets ONLY github 
echo '["github"]' > "$HOME/.ticlaw/agents/$AGENT_B/skills.json"
echo "I am Agent B. My favorite color is blue." > "$HOME/.ticlaw/agents/$AGENT_B/SOUL.md"
echo "I remember that I like to code." > "$HOME/.ticlaw/agents/$AGENT_B/MEMORY.md"

# Agent C gets NO skills 
echo '[]' > "$HOME/.ticlaw/agents/$AGENT_C/skills.json"
echo "I am Agent C. My favorite color is green." > "$HOME/.ticlaw/agents/$AGENT_C/SOUL.md"
echo "I remember that yesterday I found a dollar." > "$HOME/.ticlaw/agents/$AGENT_C/MEMORY.md"

# Agent D gets BOTH web-search and github
echo '["web-search", "github"]' > "$HOME/.ticlaw/agents/$AGENT_D/skills.json"
echo "I am Agent D. My favorite color is purple." > "$HOME/.ticlaw/agents/$AGENT_D/SOUL.md"
echo "I remember that yesterday I lost my keys." > "$HOME/.ticlaw/agents/$AGENT_D/MEMORY.md"

# ── Test 12.1: Agent A skills and identity ──
echo -e "  Testing Agent A skills and identity..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_a=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise. Then tell me your favorite color and what you remember." "$AGENT_A" "sess_a_$$")
response_a=$(get_response_text "$result_a" || echo "")

assert_not_empty "Agent A responded" "$response_a" || true
assert_contains "Agent A has web-search" "$response_a" "web-search" || true
assert_not_contains "Agent A does NOT have github" "$response_a" "github" || true
assert_contains "Agent A knows its color" "$response_a" "red" || true
assert_contains "Agent A knows its memory" "$response_a" "testing" || true
assert_not_contains "Agent A does NOT leak B's color" "$response_a" "blue" || true

# ── Test 12.2: Agent B skills and identity ──
echo -e "  Testing Agent B skills and identity..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_b=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise. Then tell me your favorite color and what you remember." "$AGENT_B" "sess_b_$$")
response_b=$(get_response_text "$result_b" || echo "")

assert_not_empty "Agent B responded" "$response_b" || true
assert_contains "Agent B has github" "$response_b" "github" || true
assert_not_contains "Agent B does NOT have web-search" "$response_b" "web-search" || true
assert_contains "Agent B knows its color" "$response_b" "blue" || true
assert_contains "Agent B knows its memory" "$response_b" "code" || true
assert_not_contains "Agent B does NOT leak A's color" "$response_b" "red" || true

# ── Test 12.3: Agent C has no skills and isolated identity ──
echo -e "  Testing Agent C identity and skills..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_c=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise. Then tell me your favorite color and what you remember from yesterday." "$AGENT_C" "sess_c_$$")
response_c=$(get_response_text "$result_c" || echo "")

assert_not_empty "Agent C responded" "$response_c" || true
assert_not_contains "Agent C does NOT have github" "$response_c" "github" || true
assert_not_contains "Agent C does NOT have web-search" "$response_c" "web-search" || true
assert_contains "Agent C knows its color" "$response_c" "green" || true
assert_contains "Agent C knows its memory" "$response_c" "dollar" || true
assert_not_contains "Agent C does NOT leak D's color" "$response_c" "purple" || true
assert_not_contains "Agent C does NOT leak D's memory" "$response_c" "keys" || true

# ── Test 12.4: Agent D has multiple skills and isolated identity ──
echo -e "  Testing Agent D identity and skills..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_d=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise. Then tell me your favorite color and what you remember from yesterday." "$AGENT_D" "sess_d_$$")
response_d=$(get_response_text "$result_d" || echo "")

assert_not_empty "Agent D responded" "$response_d" || true
assert_contains "Agent D has github" "$response_d" "github" || true
assert_contains "Agent D has web-search" "$response_d" "web-search" || true
assert_contains "Agent D knows its color" "$response_d" "purple" || true
assert_contains "Agent D knows its memory" "$response_d" "keys" || true
assert_not_contains "Agent D does NOT leak C's color" "$response_d" "green" || true
assert_not_contains "Agent D does NOT leak C's memory" "$response_d" "dollar" || true

print_summary || true
