#!/usr/bin/env bash
# tests/12-skills-isolation.sh — Verify that agents only load skills assigned to them via skills.json
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 12: Multi-Agent Skill Isolation"

BASE="http://localhost:${TC_PORT:-3000}"

# 1. Setup two isolated agents
AGENT_A="agent_a_$$"
AGENT_B="agent_b_$$"

mkdir -p "$HOME/.ticlaw/agents/$AGENT_A"
mkdir -p "$HOME/.ticlaw/agents/$AGENT_B"

# Agent A gets ONLY web-search (assuming it exists in global registry)
echo '["web-search"]' > "$HOME/.ticlaw/agents/$AGENT_A/skills.json"

# Agent B gets ONLY github 
echo '["github"]' > "$HOME/.ticlaw/agents/$AGENT_B/skills.json"

# ── Test 12.1: Agent A only has web-search ──
echo -e "  Testing Agent A skills..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_a=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise." "$AGENT_A" "sess_a_$$" "60")
response_a=$(get_response_text "$result_a" || echo "")

assert_not_empty "Agent A responded" "$response_a" || true
assert_contains "Agent A has web-search" "$response_a" "web-search" || true
assert_not_contains "Agent A does NOT have github" "$response_a" "github" || true

# ── Test 12.2: Agent B only has github ──
echo -e "  Testing Agent B skills..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_b=$(send_message "List all custom tools you have available that are related to skills. Do not use any tools, just list them. Be concise." "$AGENT_B" "sess_b_$$" "60")
response_b=$(get_response_text "$result_b" || echo "")

assert_not_empty "Agent B responded" "$response_b" || true
assert_contains "Agent B has github" "$response_b" "github" || true
assert_not_contains "Agent B does NOT have web-search" "$response_b" "web-search" || true

print_summary || true
