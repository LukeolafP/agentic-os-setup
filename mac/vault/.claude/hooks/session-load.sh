#!/bin/bash
# Session start load. The logic is in session-load.js, shared with Windows (session-load.ps1).
# Slimmed 16 Nov 2026: a trigger list for the automations and the newest chats, under ~9,000
# characters. Previous versions: session-load.before-slim-2026-11-16.sh, session-load.before-node-2026-11-17.sh.
DIR="$(cd "$(dirname "$0")" && pwd)"
for n in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$n" >/dev/null 2>&1; then exec "$n" "$DIR/session-load.js"; fi
done
echo "=== session-load: node not found, so the automation list could not load. Read Memory/Automations/ notes when their trigger fires. ==="
true
