#!/usr/bin/env bash
# tests/06-api-health.sh — Health, node info, and enrollment status
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 6: API Health & Node Info"

BASE="http://localhost:${TIX_PORT}"

# ── Test 6.1: Health endpoint ──
echo -e "  GET /health"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
health=$(curl --max-time 8 -sf "${BASE}/health" 2>/dev/null) || health=""
if echo "$health" | grep -q '"status":"ok"'; then
  echo -e "  ${GREEN}✓${NC} Health endpoint returns ok"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Health endpoint"
  echo -e "    ${RED}Got:${NC} $health"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 6.2: Node info ──
echo ""
echo -e "  GET /api/node"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
node_info=$(curl --max-time 8 -sf "${BASE}/api/node" 2>/dev/null) || node_info=""
if echo "$node_info" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('enrollment',{}).get('trust_state')" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Node info returns enrollment data"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Node info endpoint"
  echo -e "    ${RED}Got:${NC} $(echo "$node_info" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 6.3: Enrollment status ──
echo ""
echo -e "  GET /api/enroll/status"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
enroll=$(curl --max-time 8 -sf "${BASE}/api/enroll/status" 2>/dev/null) || enroll=""
if echo "$enroll" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('trust_state')" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Enrollment status returns trust_state"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Enrollment status"
  echo -e "    ${RED}Got:${NC} $(echo "$enroll" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 6.4: App info (GET /agents returns app metadata) ──
echo ""
echo -e "  GET /agents"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
agents=$(curl --max-time 8 -sf "${BASE}/agents" 2>/dev/null) || agents=""
if echo "$agents" | grep -q "Tix"; then
  echo -e "  ${GREEN}✓${NC} App info returns Tix metadata"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} App info"
  echo -e "    ${RED}Got:${NC} $(echo "$agents" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
