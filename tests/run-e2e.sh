#!/usr/bin/env bash
# tests/run-e2e.sh — E2E test orchestrator for TiClaw
#
# Usage:
#   bash tests/run-e2e.sh              # Start server & run all tests
#   bash tests/run-e2e.sh --no-server  # Run tests against already-running server
#   bash tests/run-e2e.sh 01           # Run only scenario 01
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

TICLAW_PORT="${TICLAW_PORT:-2756}"
TICLAW_HOME="/tmp/ticlaw-e2e-$$"
export TICLAW_HOME
mkdir -p "$TICLAW_HOME"

SERVER_PID=""
NO_SERVER=false
FILTER=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --no-server) NO_SERVER=true ;;
    [0-9]*) FILTER="$arg" ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo -e "\n${CYAN}Stopping server (PID ${SERVER_PID})...${NC}"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$NO_SERVER" = false ]; then
    echo -e "${CYAN}Cleaning up temporary TICLAW_HOME: ${TICLAW_HOME}${NC}"
    rm -rf "$TICLAW_HOME"
  fi
}
trap cleanup EXIT

# ── Step 1: Build CLI ──
echo -e "${BOLD}Building CLI...${NC}"
(cd cli && npx tsc) 2>&1 | tail -5
echo -e "${GREEN}CLI built${NC}"

# ── Step 2: Start server (unless --no-server) ──
if [ "$NO_SERVER" = false ]; then
  echo -e "${BOLD}Starting TiClaw server on port ${TICLAW_PORT}...${NC}"
  HTTP_PORT="$TICLAW_PORT" npx tsx packages/node/src/index.ts > /tmp/ticlaw-e2e-server.log 2>&1 &
  SERVER_PID=$!
  echo -e "  Server PID: ${SERVER_PID}"

  # Wait for health
  elapsed=0
  while [ $elapsed -lt 30 ]; do
    if curl --max-time 8 -sf "http://localhost:${TICLAW_PORT}/health" > /dev/null 2>&1; then
      echo -e "${GREEN}Server is ready${NC}"
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ $elapsed -ge 30 ]; then
    echo -e "${RED}Server failed to start. Logs:${NC}"
    tail -20 /tmp/ticlaw-e2e-server.log
    exit 1
  fi

  # ── Auto-enroll: ensure node is trusted ──
  echo -e "${BOLD}Enrolling node...${NC}"
  ENROLL_STATUS=$(curl --max-time 8 -sf "http://localhost:${TICLAW_PORT}/api/enroll/status")
  TRUST=$(echo "$ENROLL_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['trust_state'])" 2>/dev/null || echo "unknown")

  if [ "$TRUST" != "trusted" ]; then
    FP=$(echo "$ENROLL_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['fingerprint'])" 2>/dev/null)
    TOKEN_RESULT=$(curl --max-time 8 -sf -X POST "http://localhost:${TICLAW_PORT}/api/enroll/token" -H "Content-Type: application/json" -d '{"ttl_minutes":60}')
    TOKEN=$(echo "$TOKEN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)
    VERIFY=$(curl --max-time 8 -sf -X POST "http://localhost:${TICLAW_PORT}/api/enroll/verify" -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\",\"node_fingerprint\":\"$FP\"}")
    TRUST_AFTER=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('trust_state',''))" 2>/dev/null || echo "failed")
    if [ "$TRUST_AFTER" = "trusted" ]; then
      echo -e "${GREEN}Node enrolled and trusted${NC}"
    else
      echo -e "${RED}Enrollment failed: ${VERIFY}${NC}"
      exit 1
    fi
  else
    echo -e "${GREEN}Node already trusted${NC}"
  fi
else
  echo -e "${CYAN}Using existing server on port ${TICLAW_PORT}${NC}"
  if ! curl --max-time 8 -sf "http://localhost:${TICLAW_PORT}/health" > /dev/null 2>&1; then
    echo -e "${RED}No server running on port ${TICLAW_PORT}${NC}"
    exit 1
  fi
fi

# ── Step 3: Run tests ──
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║     TiClaw E2E Test Suite            ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"

TOTAL_PASSED=0
TOTAL_FAILED=0
START_TIME=$(date +%s)

for test_file in "$SCRIPT_DIR"/[0-9]*.sh; do
  test_name=$(basename "$test_file" .sh)

  # Filter if specified
  if [ -n "$FILTER" ] && [[ "$test_name" != *"$FILTER"* ]]; then
    continue
  fi

  echo ""
  export TICLAW_PORT
  bash "$test_file"

  # The test scripts print their own results via lib.sh
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"
echo -e "${BOLD}  Total time: ${ELAPSED}s${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"
