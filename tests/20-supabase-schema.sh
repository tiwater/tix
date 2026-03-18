#!/usr/bin/env bash
# tests/20-supabase-schema.sh
# Regression tests for issue #37: Supabase sync uses sessions schema
# that does not match the migration.
#
# Tests (static analysis — no live Supabase connection needed):
#   20.1 — Migration v2 file exists with corrected sessions schema
#   20.2 — supabase-sync.ts pushes agent_id and session_id columns
#   20.3 — supabase-sync.ts upserts with onConflict: 'agent_id,session_id'
#   20.4 — registered_agents push includes agent_id field
set -euo pipefail
source "$(dirname "$0")/lib.sh"

print_scenario_header "Scenario 20: Supabase Sync Schema Alignment"

SYNC_FILE="packages/node/src/sync/supabase-sync.ts"
MIGRATION_V2="supabase/migrations/20250317000000_fix_sessions_schema.sql"

# ── Test 20.1: Migration v2 exists ──
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -f "$MIGRATION_V2" ]; then
  echo -e "  ${GREEN}✓${NC} Migration v2 exists: $MIGRATION_V2"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Migration v2 missing: $MIGRATION_V2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 20.2: Migration v2 defines composite PK ──
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if grep -q "PRIMARY KEY (agent_id, session_id)" "$MIGRATION_V2" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Migration v2 defines composite PK (agent_id, session_id)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Migration v2 missing composite PK"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 20.3: Sync pushes correct session fields ──
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if grep -q "agent_id: session.agent_id" "$SYNC_FILE" 2>/dev/null \
   && grep -q "session_id: session.session_id" "$SYNC_FILE" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Sessions push contains agent_id + session_id fields"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Sessions push missing required fields"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 20.4: Upsert conflict key matches migration PK ──
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if grep -q "onConflict: 'agent_id,session_id'" "$SYNC_FILE" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Sessions upsert uses correct conflict key 'agent_id,session_id'"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Sessions upsert conflict key mismatch"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 20.5: registered_agents push includes agent_id ──
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if grep -q "agent_id: g.agent_id" "$SYNC_FILE" 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} registered_agents push includes agent_id field"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} registered_agents push missing agent_id"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

print_summary || true
