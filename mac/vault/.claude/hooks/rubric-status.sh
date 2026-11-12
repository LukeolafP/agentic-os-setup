#!/bin/bash
# Reports this vault's Claude session to the Rubric console (http://127.0.0.1:5050).
# Usage from settings.json hooks: rubric-status.sh <active|idle> [fallback task text]
# Fire and forget: runs in the background, 2s timeout, always exits 0, so a stopped
# console never slows or blocks a session.
status="$1"; fallback="${2:-}"
input=$(cat)
(
  task=$(printf '%s' "$input" | /usr/bin/python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: d = {}
p = " ".join((d.get("prompt") or "").split())
print(p[:70] + ("…" if len(p) > 70 else ""))' 2>/dev/null)
  [ -z "$task" ] && task="$fallback"
  # a queued agent run sets RUBRIC_AGENT_ID, so it reports as itself, not as the vault agent
body=$(/usr/bin/python3 -c 'import json, sys; print(json.dumps({"agent": sys.argv[3], "status": sys.argv[1], "task": sys.argv[2]}))' "$status" "$task" "${RUBRIC_AGENT_ID:-gtd-vault}")
  curl -s -m 2 -X POST http://127.0.0.1:5050/api/agent-status -H 'Content-Type: application/json' -d "$body"
) </dev/null >/dev/null 2>&1 &
exit 0
