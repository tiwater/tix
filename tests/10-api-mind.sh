#!/usr/bin/env bash
# tests/10-api-mind.sh — Mind/memory API
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 10: Mind API"

BASE="http://localhost:${TC_PORT}"
AGENT_ID="mind_api_$$"
AGENT_DIR="$HOME/.ticlaw/agents/$AGENT_ID"

mkdir -p "$AGENT_DIR/memory"
echo "SOUL:${AGENT_ID}" > "$AGENT_DIR/SOUL.md"
echo "MEMORY:${AGENT_ID}" > "$AGENT_DIR/MEMORY.md"
echo "IDENTITY:${AGENT_ID}" > "$AGENT_DIR/IDENTITY.md"
echo "USER:${AGENT_ID}" > "$AGENT_DIR/USER.md"
echo "JOURNAL:${AGENT_ID}" > "$AGENT_DIR/memory/2026-03-17.md"

# ── Test 10.1: Get mind state ──
echo -e "  GET /api/mind?agent_id=${AGENT_ID}"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
mind=$(curl --max-time 8 -sf "${BASE}/api/mind?agent_id=${AGENT_ID}" 2>/dev/null) || mind=""
if [ -n "$mind" ] && echo "$mind" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'SOUL:${AGENT_ID}' in d.get('soul',''); assert 'MEMORY:${AGENT_ID}' in d.get('memory','')" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Mind API returns expected long-term files"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Mind API"
  echo -e "    ${RED}Got:${NC} $(echo "$mind" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 10.2: Get mind files ──
echo ""
echo -e "  GET /api/mind/files?agent_id=${AGENT_ID}"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
files=$(curl --max-time 8 -sf "${BASE}/api/mind/files?agent_id=${AGENT_ID}" 2>/dev/null) || files=""
if [ -n "$files" ] && echo "$files" | python3 -c "import sys,json; d=json.load(sys.stdin); f=d.get('files',{}); assert 'SOUL.md' in f and 'MEMORY.md' in f and 'IDENTITY.md' in f and 'USER.md' in f; assert '2026-03-17.md' not in f" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Mind files API returns root mind files only"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Mind files API"
  echo -e "    ${RED}Got:${NC} $(echo "$files" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
