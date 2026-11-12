#!/bin/bash
# Session start load. Deliberately small: automations in full, plus the chat index.
# Nothing else from the vault is loaded. Everything else is read on demand, grep first,
# then 00 Master Index.md. See the "What loads every session" section of CLAUDE.md.

VAULT="__VAULT__"
shopt -s nullglob

found=0
for f in "$VAULT"/Memory/Automations/*.md; do
  found=1
  echo "=== ACTIVE AUTOMATION: $f ==="
  cat "$f"
  echo
done
[ $found -eq 1 ] && echo "Follow the triggers and actions in the automation notes above without being asked."

idx="$VAULT/Memory/Chats/00 Chat Index.md"
if [ -f "$idx" ]; then
  echo
  echo "=== CHAT INDEX: every past chat, one line each ==="
  cat "$idx"
  echo
fi

echo
echo "That is the whole session load. Do not scan, list or read the rest of the vault."
echo "To find something: grep first, then $VAULT/00 Master Index.md, then follow it down."
true
