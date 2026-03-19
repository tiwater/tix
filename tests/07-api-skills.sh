#!/usr/bin/env bash
# tests/07-api-skills.sh — Skills API and management
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 7: Skills API"

BASE="http://localhost:${TICLAW_PORT}"

# ── Test 7.1: List skills via API ──
echo -e "  GET /api/skills"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
skills=$(curl --max-time 8 -sf "${BASE}/api/skills" 2>/dev/null) || skills=""
if [ -n "$skills" ] && echo "$skills" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, (list, dict))" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Skills API returns data"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Skills API returned no data"
  echo -e "    ${RED}Got:${NC} $(echo "$skills" | head -3)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 7.2: Skills contain expected names ──
echo ""
echo -e "  Checking skills contain known skills"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if echo "$skills" | grep -q "web-search\|browser\|web-content"; then
  echo -e "  ${GREEN}✓${NC} Skills include web-search/browser/web-content"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Expected web-search/browser/web-content in skills list"
  echo -e "    ${RED}Got:${NC} $(echo "$skills" | head -5)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 7.3: Skills have required fields ──
echo ""
echo -e "  Checking skill entries have required fields"
TESTS_TOTAL=$((TESTS_TOTAL + 1))
has_fields=$(echo "$skills" | python3 -c "
import sys, json
d = json.load(sys.stdin)
skills = d if isinstance(d, list) else d.get('skills', [])
if not skills:
    print('no')
else:
    s = skills[0]
    # Check for name at minimum
    print('yes' if 'name' in s or 'skill' in s else 'no')
" 2>/dev/null || echo "no")
if [ "$has_fields" = "yes" ]; then
  echo -e "  ${GREEN}✓${NC} Skill entries have required fields"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Skill entries missing required fields"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
