#!/bin/bash
# Chat Logging automation, safety net half.
# Runs on every user prompt (UserPromptSubmit hook).
#   1. Appends the prompt verbatim to Memory/Chats/.raw/<session>.md so nothing is
#      lost if the chat is closed mid-turn.
#   2. Prints a reminder into Claude's context pointing at the chat note to update.
# The readable summary note is written by Claude, per
# Memory/Automations/Chat Logging.md.

# A queued background agent (run by the JARVIS bridge with GTD_JOB=1) is not a chat:
# its result is filed as a report on the Agentic OS ring instead.
[ "$GTD_JOB" = "1" ] && { cat >/dev/null; exit 0; }

VAULT="__VAULT__"
CHATS="$VAULT/Memory/Chats"
RAW="$CHATS/.raw"
mkdir -p "$RAW"

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)
prompt=$(printf '%s' "$input" | jq -r '.prompt // ""' 2>/dev/null)
[ -z "$sid" ] && sid="unknown"

log="$RAW/$sid.md"
if [ ! -f "$log" ]; then
  printf 'Raw prompt log, session `%s`, opened %s.\nAppend only, written by the Chat Logging hook. The readable summary is the\nmatching note in `Memory/Chats/`.\n' "$sid" "$(date '+%Y-%m-%d %H:%M')" > "$log"
fi
printf '\n## %s\n\n%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$prompt" >> "$log"

note=$(grep -l -F "$sid" "$CHATS"/*.md 2>/dev/null | head -1)

echo "=== CHAT LOGGING AUTOMATION ==="
echo "session: $sid"
echo "raw log: Memory/Chats/.raw/$sid.md (this prompt is already appended)"
if [ -n "$note" ]; then
  echo "chat note: ${note#$VAULT/}"
  echo "Update that note during this turn, per Memory/Automations/Chat Logging.md."
else
  echo "chat note: none yet for this session"
  echo "Create it before other work, per Memory/Automations/Chat Logging.md. Its"
  echo "frontmatter must carry: session: $sid"
fi
# Petra's voice sessions (the JARVIS bridge sets GTD_VOICE=1): Luke is waiting in silence,
# so the spoken reply comes first and the note is written straight after it
if [ "$GTD_VOICE" = "1" ]; then
  echo "VOICE SESSION: reply to Luke first, in speech, then create or update the chat note"
  echo "in the same turn. The note still has to be written; it just never delays the answer."
fi
