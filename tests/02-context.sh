#!/usr/bin/env bash
# tests/02-context.sh — Does the agent maintain context across turns?
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 2: Multi-Turn Context"

SESSION_A="e2e-context-A-$$"
SESSION_B="e2e-context-B-$$"

# ── Test 2.1: Set a fact in session A ──
echo -e "  Sending to session A: \"My name is TestBot42. Remember it.\""
result=$(send_message "My name is TestBot42. Please remember this exact name. Just acknowledge with one sentence." "default" "$SESSION_A")
response=$(get_response_text "$result")

assert_no_error "Session A: first message accepted" "$result" || true
assert_not_empty "Session A: agent acknowledges" "$response" || true

# Brief pause to allow the server to fully commit the prior turn's state
# and release the session lock before the next message.
sleep 3

# ── Test 2.2: Recall the fact in the same session ──
echo ""
echo -e "  Sending to session A: \"What is my name?\""
result=$(send_message "What is my name? Reply with just the name." "default" "$SESSION_A")
response=$(get_response_text "$result")

assert_not_empty "Session A: agent responds" "$response" || true
assert_contains "Session A: remembers the name" "$response" "TestBot42" || true

# ── Test 2.3: Different session should NOT know the name ──
echo ""
echo -e "  Sending to session B: \"What is my name?\""
result=$(send_message "Do you know my name? If yes, say it. If not, say 'I do not know your name'." "default" "$SESSION_B")
response=$(get_response_text "$result")

assert_not_empty "Session B: agent responds" "$response" || true
assert_not_contains "Session B: does NOT know TestBot42" "$response" "TestBot42" || true

print_summary || true
