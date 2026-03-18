#!/usr/bin/env bash
# tests/13-schedules.sh — E2E tests for agent schedules

source "$(dirname "$0")/lib.sh"

echo -e "\n${BOLD}${CYAN}=== Testing Schedules ===${NC}"

# Use an isolated home directory for schedules so they don't persist into dev
export TICLAW_HOME="/tmp/ticlaw-schedules-test-$$"
mkdir -p "$TICLAW_HOME"

# Start server in background
TEST_PORT=2759
HTTP_PORT=$TEST_PORT npx tsx packages/node/src/index.ts > /tmp/ticlaw-schedules.log 2>&1 &
SERVER_PID=$!

cleanup() {
  echo -e "${YELLOW}Stopping server (PID $SERVER_PID)...${NC}"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  rm -rf "$TICLAW_HOME"
}
trap cleanup EXIT
wait_for_server $TEST_PORT

AGENT_ID="sched-agent-$(date +%s)"

# Create a schedule
echo -e "\n${YELLOW}▶ Creating a schedule for $AGENT_ID...${NC}"
CREATE_RES=$(curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"prompt\":\"Reply with exactly: 'SCHEDULE_TICK'\",\"cron\":\"* * * * *\"}")

SCHED_ID=$(echo "$CREATE_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('schedule',{}).get('id',''))")

if [ -z "$SCHED_ID" ]; then
  echo -e "${RED}Failed to create schedule. Response: $CREATE_RES${NC}"
  exit 1
fi
echo -e "${GREEN}Created schedule ID: $SCHED_ID${NC}"

# Force scheduler tick
echo -e "\n${YELLOW}▶ Forcing scheduler tick...${NC}"
curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules/refresh"

echo -e "\n${YELLOW}▶ Waiting 8s for agent to run schedule...${NC}"
sleep 8

# Check messages
echo -e "\n${YELLOW}▶ Fetching messages for $AGENT_ID...${NC}"
MSGS_RES=$(curl --max-time 8 -sX GET "http://localhost:${TEST_PORT}/api/messages?agent_id=$AGENT_ID&session_id=web:$AGENT_ID:sched-$SCHED_ID")

LAST_MSG=$(echo "$MSGS_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('messages',[])[-1].get('text','') if isinstance(d.get('messages'), list) and len(d.get('messages')) > 0 else '')")

assert_contains "Schedule run result" "$LAST_MSG" "SCHEDULE_TICK"

echo -e "\n${YELLOW}▶ Creating a Cross-Channel schedule (Feishu)...${NC}"
CREATE_FEISHU=$(curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"prompt\":\"Reply with exactly: 'FEISHU_TICK'\",\"cron\":\"* * * * *\",\"target_jid\":\"feishu:testgrp\"}")

echo -e "\n${YELLOW}▶ Forcing scheduler tick...${NC}"
curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules/refresh"

echo -e "\n${YELLOW}▶ Waiting 8s for Feishu agent tick...${NC}"
sleep 8

echo -e "\n${YELLOW}▶ Fetching messages for Feishu group...${NC}"
# Based on task-scheduler logic, isolated schedules on a specific target_jid map to `${target_jid}:sched-${schedule_id}`. 
# However, the `/api/messages` reads everything for the agent in some frontends. Let's just check the agent's recent messages on that JID.
# Actually, the base JID is `feishu:testgrp` and isolated creates `feishu:testgrp:sched-XYZ`. But `storeMessage` routes it. Let's just fetch recent from `feishu:testgrp:sched-XYZ` or `feishu:testgrp`. The Dispatcher uses the session id `feishu:testgrp:sched-XYZ`.
SCHED2_ID=$(echo "$CREATE_FEISHU" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('schedule',{}).get('id',''))")
FEISHU_MSGS=$(curl --max-time 8 -sX GET "http://localhost:${TEST_PORT}/api/messages?agent_id=$AGENT_ID&session_id=feishu:testgrp:sched-$SCHED2_ID")
LAST_FEISHU=$(echo "$FEISHU_MSGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('messages',[])[-1].get('text','') if isinstance(d.get('messages'), list) and len(d.get('messages')) > 0 else '')")

assert_contains "Feishu schedule result" "$LAST_FEISHU" "FEISHU_TICK"

echo -e "\n${YELLOW}▶ Creating an INTERRUPTING schedule for $AGENT_ID...${NC}"
# This tests dispatcher preempting functionality
curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"prompt\":\"STOP everything right now.\",\"cron\":\"* * * * *\"}" > /dev/null

echo -e "\n${YELLOW}▶ Forcing scheduler tick...${NC}"
curl --max-time 8 -sX POST "http://localhost:${TEST_PORT}/api/schedules/refresh"

echo -e "\n${YELLOW}▶ Waiting 5s...${NC}"
sleep 5

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ All checks passed (13-schedules.sh)${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}⨯ Some checks failed (13-schedules.sh)${NC}"
  echo "See /tmp/ticlaw-schedules.log for details."
  exit 1
fi
