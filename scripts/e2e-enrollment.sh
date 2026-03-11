#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3280}"
BASE="http://127.0.0.1:${PORT}"

echo "[1/7] get enrollment status"
STATUS=$(curl -sS "${BASE}/api/enroll/status")
echo "$STATUS"
FP=$(echo "$STATUS" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["runtime_fingerprint"])')


echo "[2/7] reset to discovered_untrusted"
curl -sS -X POST "${BASE}/api/enroll/reenroll" >/dev/null


echo "[3/7] create token"
TOKEN_JSON=$(curl -sS -X POST "${BASE}/api/enroll/token" -H 'Content-Type: application/json' -d '{"ttl_minutes":20}')
echo "$TOKEN_JSON"
TOKEN=$(echo "$TOKEN_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["token"])')


echo "[4/7] untrusted runtime blocked from /runs"
HTTP_CODE=$(curl -s -o /tmp/ticlaw-e2e-runs-untrusted.json -w "%{http_code}" -X POST "${BASE}/runs" -H 'Content-Type: application/json' -d '{"chat_jid":"web:e2e-enroll","sender":"e2e","sender_name":"e2e","content":"hello"}')
cat /tmp/ticlaw-e2e-runs-untrusted.json
if [[ "$HTTP_CODE" != "403" ]]; then
  echo "Expected 403 when untrusted, got $HTTP_CODE" >&2
  exit 1
fi


echo "[5/7] verify with token + fingerprint"
VERIFY_JSON=$(curl -sS -X POST "${BASE}/api/enroll/verify" -H 'Content-Type: application/json' -d "{\"token\":\"${TOKEN}\",\"runtime_fingerprint\":\"${FP}\"}")
echo "$VERIFY_JSON"
OK=$(echo "$VERIFY_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(str(d.get("ok", False)).lower())')
if [[ "$OK" != "true" ]]; then
  echo "Verification failed" >&2
  exit 1
fi


echo "[6/7] trusted runtime can run /runs"
HTTP_CODE2=$(curl -s -o /tmp/ticlaw-e2e-runs-trusted.json -w "%{http_code}" -X POST "${BASE}/runs" -H 'Content-Type: application/json' -d '{"chat_jid":"web:e2e-enroll","sender":"e2e","sender_name":"e2e","content":"hello after trust"}')
cat /tmp/ticlaw-e2e-runs-trusted.json
if [[ "$HTTP_CODE2" != "202" ]]; then
  echo "Expected 202 when trusted, got $HTTP_CODE2" >&2
  exit 1
fi


echo "[7/7] one-time token cannot be reused"
HTTP_CODE3=$(curl -s -o /tmp/ticlaw-e2e-token-reuse.json -w "%{http_code}" -X POST "${BASE}/api/enroll/verify" -H 'Content-Type: application/json' -d "{\"token\":\"${TOKEN}\",\"runtime_fingerprint\":\"${FP}\"}")
cat /tmp/ticlaw-e2e-token-reuse.json
if [[ "$HTTP_CODE3" == "200" ]]; then
  echo "Expected non-200 on token reuse" >&2
  exit 1
fi

echo "E2E enrollment test passed"
