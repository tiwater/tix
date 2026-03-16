#!/usr/bin/env bash
# tests/09-enrollment.sh — Full enrollment lifecycle
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 9: Enrollment Lifecycle"

BASE="http://localhost:${TC_PORT}"

# ── Test 9.1: Get enrollment status ──
echo -e "  GET /api/enroll/status"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
status=$(curl -sf "${BASE}/api/enroll/status" 2>/dev/null) || status=""
TRUST=$(echo "$status" | python3 -c "import sys,json; print(json.load(sys.stdin)['trust_state'])" 2>/dev/null || echo "unknown")
FP=$(echo "$status" | python3 -c "import sys,json; print(json.load(sys.stdin)['fingerprint'])" 2>/dev/null || echo "")

if [ -n "$TRUST" ] && [ "$TRUST" != "unknown" ]; then
  echo -e "  ${GREEN}✓${NC} Enrollment status: trust_state=$TRUST"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Failed to get enrollment status"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 9.2: Create enrollment token ──
echo ""
echo -e "  POST /api/enroll/token"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
token_result=$(curl -sf -X POST "${BASE}/api/enroll/token" \
  -H "Content-Type: application/json" \
  -d '{"ttl_minutes":5}' 2>/dev/null) || token_result=""
TOKEN=$(echo "$token_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")

if [ -n "$TOKEN" ]; then
  echo -e "  ${GREEN}✓${NC} Token created (${#TOKEN} chars)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Failed to create enrollment token"
  echo -e "    ${RED}Got:${NC} $token_result"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 9.3: Verify with wrong token should fail ──
echo ""
echo -e "  POST /api/enroll/verify (bad token)"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
bad_verify=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/enroll/verify" \
  -H "Content-Type: application/json" \
  -d '{"token":"bad-token-123","node_fingerprint":"bad-fp"}' 2>/dev/null) || bad_verify="0"

if [ "$bad_verify" != "200" ] && [ "$bad_verify" != "0" ]; then
  echo -e "  ${GREEN}✓${NC} Bad token correctly rejected (HTTP $bad_verify)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Bad token was accepted (HTTP $bad_verify)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 9.4: Verify with correct token ──
echo ""
echo -e "  POST /api/enroll/verify (correct)"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -n "$TOKEN" ] && [ -n "$FP" ]; then
  verify_result=$(curl -sf -X POST "${BASE}/api/enroll/verify" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\",\"node_fingerprint\":\"$FP\"}" 2>/dev/null) || verify_result=""
  VERIFY_OK=$(echo "$verify_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

  if [ "$VERIFY_OK" = "True" ]; then
    echo -e "  ${GREEN}✓${NC} Correct token verified successfully"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} Correct token verification failed"
    echo -e "    ${RED}Got:${NC} $verify_result"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  echo -e "  ${RED}✗${NC} Skipped (no token/fingerprint from earlier steps)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 9.5: Missing fields should return 400 ──
echo ""
echo -e "  POST /api/enroll/verify (missing fields)"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
missing_verify=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/enroll/verify" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null) || missing_verify="0"

if [ "$missing_verify" = "400" ]; then
  echo -e "  ${GREEN}✓${NC} Missing fields correctly rejected (HTTP 400)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Expected 400, got HTTP $missing_verify"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
