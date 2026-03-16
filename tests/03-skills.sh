#!/usr/bin/env bash
# tests/03-skills.sh — Does the agent actually use skills?
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 3: Skill Usage"

# ── Test 3.1: /skills command ──
echo -e "  Sending: \"/skills list\""
result=$(send_message "/skills list" "default" "e2e-skills-$$")
response=$(get_response_text "$result")

assert_no_error "Skills command accepted" "$result" || true
assert_not_empty "Skills list returned" "$response" || true

# ── Test 3.2: File listing (tests tool use) ──
echo ""
echo -e "  Sending: \"List the files in the current working directory\""
result=$(send_message "List the files and directories in the current working directory. Just the names, one per line." "default" "e2e-skills-$$")
response=$(get_response_text "$result")

assert_not_empty "Agent responds with file list" "$response" || true
assert_contains "Lists package.json" "$response" "package.json" || true

# ── Test 3.3: Quality check — web search should return formatted content ──
echo ""
echo -e "  Sending: \"What is the latest version of Node.js?\""
result=$(send_message "What is the latest version of Node.js? Give me a brief answer." "default" "e2e-skills-$$" "90")
response=$(get_response_text "$result")

assert_not_empty "Agent responds about Node.js" "$response" || true
# Use LLM-as-judge to verify the response is well-formatted and not raw HTML
judge_response "Response is well-formatted (not raw HTML)" "$response" \
  "The response should be a clean, readable answer about Node.js version. It should NOT be raw HTML, webpage source code, or garbled content. It should be a concise, well-formatted answer." || true

print_summary || true
