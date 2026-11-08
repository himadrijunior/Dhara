#!/bin/bash
# Dhara full test harness — boots dev server, runs MCP smoke + full pentest in one
# process (sandbox kills background procs between tool calls, so everything in one run).
# Credentials are read from .dhara/config.json (untracked) — never hardcoded here.
cd /home/z/my-project

# kill any stale next dev servers from previous runs (they hold port 3000 + old config)
pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null; sleep 1

if [ -z "$DHARA_OWNER_PW" ] && [ -f .dhara/instance-creds ]; then
  export DHARA_OWNER_EMAIL=$(cut -d: -f1 .dhara/instance-creds)
  export DHARA_OWNER_PW=$(cut -d: -f2 .dhara/instance-creds)
fi
if [ -z "$DHARA_OWNER_PW" ]; then echo "ERROR: no owner credentials (env or .dhara/instance-creds)"; exit 2; fi

# start in its own process group so we can kill npm + next dev + next-server together
setsid npm run dev > /tmp/dhara-dev.log 2>&1 &
SERVER_PID=$!
trap 'kill -- -$SERVER_PID 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null' EXIT

READY=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then READY=1; echo "== server ready (poll $i) =="; break; fi
  sleep 2
done
if [ "$READY" != "1" ]; then echo "== SERVER FAILED TO START =="; tail -20 /tmp/dhara-dev.log; exit 2; fi

echo "== MCP SMOKE (before pentest — pentest's last section poisons the rate-limit bucket) =="
OWTOK=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$DHARA_OWNER_EMAIL\",\"password\":\"$DHARA_OWNER_PW\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")
TOOLCOUNT=$(curl -s -X POST http://127.0.0.1:3000/api/mcp \
  -H "Authorization: Bearer $OWTOK" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo 0)
echo "mcp tools/list -> $TOOLCOUNT tools"
if [ "$TOOLCOUNT" -lt 1 ]; then echo "== MCP SMOKE FAILED =="; EXIT=2; kill -- -$SERVER_PID 2>/dev/null; exit 2; fi

echo "== FULL SELF-HACK PENTEST =="
python3 scripts/pentest.py
EXIT=$?

kill -- -$SERVER_PID 2>/dev/null
pkill -f 'next dev' 2>/dev/null; pkill -f 'next-server' 2>/dev/null
echo "== server stopped, exit=$EXIT =="
exit $EXIT
