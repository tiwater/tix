#!/usr/bin/env bash
# tests/12-response-quality.sh — Does the agent return well-formatted, useful responses?
#
# These tests use LLM-as-judge to evaluate quality — catching issues like:
#   - Raw HTML/webpage source instead of clean content
#   - Garbled or unreadable output
#   - Missing or irrelevant information
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 12: Response Quality"

# ── Test 12.1: Latest news query ──
# This is a critical quality test. The agent should:
#   - Use web search to find real news
#   - Return well-formatted, readable summaries
#   - NOT return raw HTML, <div> tags, or webpage source code
echo -e "  Sending: \"What are the latest tech news today? Give me a brief summary.\""
result=$(send_message "What are the latest tech news today? Give me a brief summary of the top 3 stories." "default" "e2e-quality-news-$$" "90")
response=$(get_response_text "$result")

assert_no_error "News query accepted" "$result" || true
assert_not_empty "Agent returns a response" "$response" || true

# String-level checks: response should NOT contain raw HTML
assert_not_contains "No HTML tags in response" "$response" "<div" || true
assert_not_contains "No script tags in response" "$response" "<script" || true
assert_not_contains "No href attributes" "$response" "href=" || true

# LLM-as-judge quality check
judge_response "News response is well-formatted and useful" "$response" \
  "The response should contain a readable summary of recent news stories. It must be well-formatted with clear structure (headings, bullet points, or numbered items). It must NOT contain raw HTML tags, webpage source code, CSS classes, JavaScript, or garbled encoding artifacts. The content should read like a human-written news brief." || true

print_summary || true
