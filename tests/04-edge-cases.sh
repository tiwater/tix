#!/usr/bin/env bash
# tests/04-node-cases.sh — How does the agent handle node cases?
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 4: Edge Cases"

# ── Test 4.1: Non-English (Chinese) ──
echo -e "  Sending: \"你好，1加1等于几？\""
result=$(send_message "你好，1加1等于几？只回答数字。" "default" "e2e-node-$$")
response=$(get_response_text "$result")

assert_no_error "Chinese input accepted" "$result" || true
assert_not_empty "Agent responds to Chinese" "$response" || true
assert_contains "Response contains 2" "$response" "2" || true

# ── Test 4.2: Long input ──
echo ""
echo -e "  Sending: (long repeated message, ~5000 chars)"
long_input="This is a test message that is repeated many times to test how the agent handles long input. "
# Repeat to ~5000 chars
long_message=""
for i in $(seq 1 50); do
  long_message="${long_message}${long_input}"
done
long_message="${long_message} After all that repeated text, what is 3+3? Reply with just the number."

result=$(send_message "$long_message" "default" "e2e-node-long-$$" "90")
response=$(get_response_text "$result")

assert_no_error "Long input accepted" "$result" || true
assert_not_empty "Agent responds to long input" "$response" || true
assert_contains "Response contains 6" "$response" "6" || true

# ── Test 4.3: Special characters ──
echo ""
echo -e "  Sending: message with special chars"
result=$(send_message 'What is the result of this expression: 10 > 5 && 3 < 7? Answer true or false only.' "default" "e2e-node-special-$$")
response=$(get_response_text "$result")

assert_no_error "Special chars accepted" "$result" || true
assert_not_empty "Agent responds" "$response" || true
assert_contains "Response contains true" "$response" "true" || true

print_summary || true
