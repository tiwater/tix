#!/usr/bin/env bash
# tests/01-basic-chat.sh — Can the agent have a basic conversation?
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 1: Basic Chat"

# ── Test 1.1: Simple math ──
echo -e "  Sending: \"What is 2+2? Reply with just the number.\""
result=$(send_message "What is 2+2? Reply with just the number, nothing else." "default" "e2e-math-$$")
response=$(get_response_text "$result")

assert_no_error "Agent responds without error" "$result" || true
assert_not_empty "Agent returns a response" "$response" || true
assert_contains "Response contains 4" "$response" "4" || true

# ── Test 1.2: General knowledge ──
echo ""
echo -e "  Sending: \"What is the capital of France? One word answer.\""
result=$(send_message "What is the capital of France? Reply with just the city name, one word." "default" "e2e-geo-$$")
response=$(get_response_text "$result")

assert_not_empty "Agent returns a response" "$response" || true
assert_contains "Response contains Paris" "$response" "Paris" || true

# ── Test 1.3: Translation ──
echo ""
echo -e "  Sending: \"Translate 'hello' to French. One word only.\""
result=$(send_message "Translate 'hello' to French. Reply with just the one French word, nothing else." "default" "e2e-translate-$$")
response=$(get_response_text "$result")

assert_not_empty "Agent returns a response" "$response" || true
assert_contains "Response contains bonjour" "$response" "bonjour" || true

print_summary || true
