#!/usr/bin/env bash
# tests/10-api-mind.sh — Mind/memory API
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 10: Mind API"

BASE="http://localhost:${TC_PORT}"

# ── Test 10.1: Get mind state ──
echo -e "  GET /api/mind"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
mind=$(curl -sf "${BASE}/api/mind" 2>/dev/null) || mind=""
if [ -n "$mind" ] && echo "$mind" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Mind API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Mind API"
  echo -e "    ${RED}Got:${NC} $(echo "$mind" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 10.2: Get mind files ──
echo ""
echo -e "  GET /api/mind/files"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
files=$(curl -sf "${BASE}/api/mind/files" 2>/dev/null) || files=""
if [ -n "$files" ] && echo "$files" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Mind files API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Mind files API"
  echo -e "    ${RED}Got:${NC} $(echo "$files" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
