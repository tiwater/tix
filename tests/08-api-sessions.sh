#!/usr/bin/env bash
# tests/08-api-sessions.sh — Sessions and agents CRUD
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 8: Sessions & Agents API"

BASE="http://localhost:${TICLAW_PORT}"

# ── Test 8.1: List sessions ──
echo -e "  GET /api/sessions"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
sessions=$(curl --max-time 8 -sf "${BASE}/api/sessions" 2>/dev/null) || sessions=""
if [ -n "$sessions" ] && echo "$sessions" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Sessions API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Sessions API"
  echo -e "    ${RED}Got:${NC} $(echo "$sessions" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 8.2: Create a session ──
echo ""
echo -e "  POST /api/sessions"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
create_session=$(curl --max-time 8 -sf -X POST "${BASE}/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"default","session_id":"e2e-test-session","channel":"http"}' 2>/dev/null) || create_session=""
if [ -n "$create_session" ]; then
  echo -e "  ${GREEN}✓${NC} Session created"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  register_session "default:e2e-test-session"
else
  echo -e "  ${RED}✗${NC} Failed to create session"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 8.3: List agents via API ──
echo ""
echo -e "  GET /api/agents"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
agents=$(curl --max-time 8 -sf "${BASE}/api/agents" 2>/dev/null) || agents=""
if [ -n "$agents" ] && echo "$agents" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Agents API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Agents API"
  echo -e "    ${RED}Got:${NC} $(echo "$agents" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 8.4: List tasks ──
echo ""
echo -e "  GET /api/tasks"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
tasks=$(curl --max-time 8 -sf "${BASE}/api/tasks" 2>/dev/null) || tasks=""
if [ -n "$tasks" ] && echo "$tasks" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Tasks API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Tasks API"
  echo -e "    ${RED}Got:${NC} $(echo "$tasks" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 8.5: Get messages ──
echo ""
echo -e "  GET /api/messages"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
messages=$(curl --max-time 8 -sf "${BASE}/api/messages?agent_id=default&session_id=e2e-test-session" 2>/dev/null) || messages=""
if [ -n "$messages" ] && echo "$messages" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Messages API returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Messages API"
  echo -e "    ${RED}Got:${NC} $(echo "$messages" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
