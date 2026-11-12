#!/bin/bash
# Starts the three RoboNuggets dashboards on this Mac, bound to localhost only.
#   Rubric console  http://localhost:5050    Second Brain  http://localhost:5211
#   Agentic OS      http://localhost:50000
# Already running? It leaves that one alone. Logs: Robonuggets/.logs/
# GTD 3 Nov 2026: run from Obsidian's "Start dashboards" button the PATH has no Homebrew, so
# node was "No such file or directory". Give it the usual places first.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
R="$(cd "$(dirname "$0")" && pwd)"; mkdir -p "$R/.logs"
# each one normally runs as a login service (launchd); when its job is loaded, ask launchd to
# start it rather than starting a second copy that would fight it for the port
job() { launchctl print "gui/$(id -u)/com.gettruckdrivers.$1" >/dev/null 2>&1; }
# the vault is the nearest folder above this one holding CLAUDE.md and .obsidian
VAULT="$R"; while [ "$VAULT" != "/" ]; do VAULT="$(dirname "$VAULT")"; [ -f "$VAULT/CLAUDE.md" ] && [ -d "$VAULT/.obsidian" ] && break; done
up() { curl -s -m 1 -o /dev/null "http://127.0.0.1:$1" ; }
start() { # name dir port [env...]
  local name=$1 dir=$2 port=$3; shift 3
  if up "$port"; then echo "  $name already on :$port"; return; fi
  if job "$name"; then launchctl kickstart "gui/$(id -u)/com.gettruckdrivers.$name" 2>/dev/null; echo "  $name starting (login service) -> http://localhost:$port"; return; fi
  (cd "$dir" && env PORT="$port" "$@" nohup node server.js >>"$R/.logs/$name.log" 2>&1 &)
  echo "  $name -> http://localhost:$port"
}
start rubric-console "$R/rubric/templates/scaffold" 5050 SKILL_TREE_ROOT="$VAULT" VAULT_ROOT="$VAULT"
start second-brain   "$R/rubric-second-brain"       5211
start agentic-os     "$R/rubric-agentic-os"         50000 VAULT_ROOT="$VAULT"
# JARVIS bridge (voice + agent queue), lives outside the vault in ~/Coding/jarvis; normally run by launchd
if ! up 8790 && job jarvis-bridge; then
  launchctl kickstart "gui/$(id -u)/com.gettruckdrivers.jarvis-bridge" 2>/dev/null; echo "  jarvis bridge starting (login service) -> ws://localhost:8790"
elif ! up 8790; then
  (cd "$HOME/Coding/jarvis" && env JARVIS_MODE=gtd JARVIS_CWD="$VAULT" JARVIS_BRIDGE_PORT=8790 JARVIS_MODEL=claude-opus-5-5 JARVIS_EFFORT=high \
    JARVIS_ALLOWED_ORIGINS=http://localhost:50000,http://127.0.0.1:50000 nohup node bridge/server.mjs >>"$HOME/Coding/jarvis/.gtd-jobs/bridge.log" 2>&1 &)
  echo "  jarvis bridge -> ws://localhost:8790"
else echo "  jarvis bridge already on :8790"; fi
