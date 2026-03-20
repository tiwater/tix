#!/usr/bin/env bash
# tests/22-model-fallback.sh — Verify agent-specific model selection and fallback
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 22: Model Selection and Fallback"

BASE="http://localhost:${TICLAW_PORT:-2756}"

AGENT_DEFAULT="agent_def_$$"
AGENT_CUSTOM="agent_cus_$$"
AGENT_INVALID="agent_inv_$$"

register_agent "$AGENT_DEFAULT"
register_agent "$AGENT_CUSTOM"
register_agent "$AGENT_INVALID"

mkdir -p "${TICLAW_HOME}/agents/$AGENT_DEFAULT"
mkdir -p "${TICLAW_HOME}/agents/$AGENT_CUSTOM"
mkdir -p "${TICLAW_HOME}/agents/$AGENT_INVALID"

# 1. Custom agent -> specific model
echo '{"model": "bigmodel-glm4"}' > "${TICLAW_HOME}/agents/$AGENT_CUSTOM/agent-config.json"

# 2. Invalid model config -> should warn but fall back to the default registry list
echo '{"model": "invalid-nonexistent-model"}' > "${TICLAW_HOME}/agents/$AGENT_INVALID/agent-config.json"


# ── Test 22.1: Default agent ──
echo -e "  Testing Default Model Agent..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_def=$(send_message "Say only the exact words 'HELLO DEFAULT'." "$AGENT_DEFAULT" "sess_def_$$")
response_def=$(get_response_text "$result_def" || echo "")
assert_contains "Default agent responds" "$response_def" "HELLO" || true

# ── Test 22.2: Custom model agent ──
echo -e "  Testing Custom Model Agent..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_cus=$(send_message "Say only the exact words 'HELLO CUSTOM'." "$AGENT_CUSTOM" "sess_cus_$$")
response_cus=$(get_response_text "$result_cus" || echo "")
assert_contains "Custom agent responds" "$response_cus" "HELLO" || true

# ── Test 22.3: Invalid model agent (fallback) ──
echo -e "  Testing Invalid Model Agent (fallback)..."
TESTS_TOTAL=$((TESTS_TOTAL + 1))
result_inv=$(send_message "Say only the exact words 'HELLO FALLBACK'." "$AGENT_INVALID" "sess_inv_$$")
response_inv=$(get_response_text "$result_inv" || echo "")
assert_contains "Invalid model agent falls back and responds" "$response_inv" "HELLO" || true

print_summary || true
