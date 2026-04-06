#!/usr/bin/env bash
# tests/05-schedules.sh — Schedule CRUD lifecycle via API
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 5: Schedule CRUD"

TIX_PORT="${TIX_PORT:-2756}"
BASE="http://localhost:${TIX_PORT}"

# ── Test 5.1: Create a schedule ──
echo -e "  Creating a test schedule..."
create_result=$(curl --max-time 8 -sf -X POST "${BASE}/api/schedules" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"default","prompt":"E2E test schedule","cron":"0 0 1 1 *","enabled":false}' 2>/dev/null) || create_result=""

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -n "$create_result" ]; then
  echo -e "  ${GREEN}✓${NC} Schedule created"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  SCHEDULE_ID=$(echo "$create_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id', d.get('schedule',{}).get('id','')))" 2>/dev/null || echo "")
  # Register for cleanup
  [ -n "$SCHEDULE_ID" ] && register_schedule "$SCHEDULE_ID"
else
  echo -e "  ${RED}✗${NC} Failed to create schedule"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  SCHEDULE_ID=""
fi

# ── Test 5.2: List schedules ──
echo ""
echo -e "  Listing schedules..."
list_result=$(curl --max-time 8 -sf "${BASE}/api/schedules" 2>/dev/null) || list_result=""

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if echo "$list_result" | grep -q "E2E test schedule"; then
  echo -e "  ${GREEN}✓${NC} Schedule appears in list"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Schedule not found in list"
  echo -e "    ${RED}Got:${NC} $(echo "$list_result" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 5.3: Delete the schedule ──
if [ -n "$SCHEDULE_ID" ]; then
  echo ""
  echo -e "  Deleting schedule ${SCHEDULE_ID}..."
  delete_result=$(curl --max-time 8 -sf -X DELETE "${BASE}/api/schedules/${SCHEDULE_ID}" 2>/dev/null) || delete_result=""

  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ -n "$delete_result" ]; then
    echo -e "  ${GREEN}✓${NC} Schedule deleted"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} Failed to delete schedule"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi

  # ── Test 5.4: Verify deletion ──
  echo ""
  echo -e "  Verifying schedule is gone..."
  list_after=$(curl --max-time 8 -sf "${BASE}/api/schedules" 2>/dev/null) || list_after=""

  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if echo "$list_after" | grep -q "E2E test schedule"; then
    echo -e "  ${RED}✗${NC} Schedule still in list after deletion"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  else
    echo -e "  ${GREEN}✓${NC} Schedule removed from list"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  fi
fi

print_summary || true
