---
type: automation
status: active
trigger: Every session, every prompt
created: 2026-09-15
---

# Chat Logging

Every chat writes itself down as it happens. One note per chat in `Memory/Chats/`,
holding what we did, what was learned about how Luke wants things, and links to
everything the chat created or touched in the vault.

The note is kept current **during** the session, never written at the end. If the chat
is closed without warning, the note is already accurate to the last prompt.

## How the two halves fit together

- **The hook** (`.claude/hooks/chat-log.ps1`, `chat-log.sh` on a Mac, fired on `UserPromptSubmit`) appends every
  prompt verbatim to `Memory/Chats/.raw/<session id>.md` before Claude sees it, and
  prints the session id plus the matching chat note path into context. Raw capture is
  automatic and cannot be forgotten. The `.raw` folder starts with a dot so Obsidian
  ignores it.
- **This automation** is Claude's half: turning that raw stream into the readable note.

## Trigger

Fires on every prompt in every session. There is no "off" case and nothing to ask about.

## Action

### First prompt of a session
Create the chat note **before** starting the work the prompt asked for. Writing it takes
one tool call and it is what makes a sudden close survivable.

1. Path: `Memory/Chats/<YYYY-MM-DD> - <Topic>.md`
   - Date is the day the chat started, ISO, so chats sort chronologically.
   - Topic is 2 to 6 words in Title Case, taken from what the chat is actually for.
     Recognisable in Obsidian search a month later.
     - Good: `2026-09-15 - Chat Logging Automation`
     - Bad: `2026-09-15 - Chat`, `2026-09-15 - Various`
   - If the filename exists, append ` (2)`, ` (3)`. Two chats can share a day.
2. Frontmatter **must** carry `session:` with the session id from the hook output. That
   line is how the hook finds this note again on the next prompt. Without it, the next
   prompt reports "none yet" and a second note gets created for the same chat.
3. Use the template below. Fill only what the chat has so far. Everything unknown stays
   as `—`.
4. Add the chat to [[00 Chat Index]] in the same turn, under the right theme heading.
   A chat note with no index line is invisible, which defeats the point of writing it.

### Every prompt after that
Update the same note. Never open a second note for the same session, and never rewrite
history: sections accumulate, they do not get replaced by a tidier version.

- Short exchange: update the note as part of the turn.
- Long turn (several tool calls, a script, research): write the intent into **Thread**
  first, do the work, then record the outcome before replying.
- Update the file in place. Add new bullets, rewrite `## Summary` so it still describes
  the whole chat, and move anything that is now settled out of `## Open items`.
- When the chat turns to something the index line no longer describes, rewrite that line.
  The index sentence must always match what the chat actually ended up being about.

### What goes where
- **Summary** — three to five lines. What this chat was for and where it ended up.
  Written so it makes sense with no other context.
- **Thread** — the chronological spine, one bullet per meaningful exchange, newest last.
  Skip the trivia. What was asked, what was decided, what changed.
- **Learned about how Luke works** — preferences, corrections, standing decisions, things
  he pushed back on and why. This is the section the vault gets value from later.
  When something here is durable rather than chat-specific, offer to promote it: a new or
  updated note in `Memory/`, or a new automation note in `Memory/Automations/`. Offer in
  one line, do not write it unprompted.
- **Created and changed in the vault** — every note this chat wrote or edited, as a
  `[[wiki link]]`, with created/updated and one line on why. This is the connective
  tissue back to the rest of the vault, so it is never left as `—` when files moved.
- **Outside the vault** — Notion cards, Drive docs, Fathom calls, marketing metrics,
  Gmail threads. Full links, and the number plus its date for any metric, because a
  metric read today is wrong next week.
- **Open items** — anything unfinished, undecided, or declined, and who it is waiting on.
  Where the next chat picks up.

### The index
`Memory/Chats/00 Chat Index.md` is the entry point to every chat. It carries one line per
chat, grouped by theme, and it is read instead of the chat notes whenever the question is
"which chat was that in".

- One line per chat: `- [[note name]] — one sentence on what it was about.` One sentence,
  not a summary. Enough to decide whether to open the note.
- Always a link, never a bare title, and that holds anywhere else in the index a chat
  gets mentioned. The index is navigated by clicking.
- Group by what the chat was *for*, not by date. Existing themes are Vault systems and
  automation, Instagram scripting, Tracking and marketing numbers, and Other.
- A chat that fits nothing goes under **Other**. When two chats sit in Other on the same
  subject, give that subject its own heading and move both. Themes grow out of the work,
  they are not invented in advance.
- Newest chat at the bottom of its theme, so each theme reads chronologically.
- A chat that genuinely spans two themes is listed under both, same sentence.
- Set `updated:` in the index frontmatter to today whenever it is touched.
- **This index is loaded at every session start**, so it is the one note whose size costs
  something on every conversation. Keep it to one line per chat, no sub-bullets, no
  detail that belongs in the chat note. Currently about 8 tokens per chat.
- Once it passes roughly 60 chats, split it the way the scripts are split: a year folder
  with its own index, and this note demoted to the router that lists the years. Say so
  when it gets close rather than letting it grow quietly.

### Rules
- Never invent content to fill a section. `—` is the correct answer for a section the
  chat has not produced yet.
- Record what actually happened, including work that failed, was abandoned, or was
  reverted. A chat note that only lists wins is not worth reading.
- Never copy secrets, tokens or credentials into the note. Name the thing, not its value.
- Do not paste long outputs. Link the file or the source instead.
- Sensitive detail stays out: no driver PII from screen recordings or CRM rows.
- The index is the navigation layer. Because it is already loaded, a question about past
  work is answered from it, not by searching `Memory/Chats/`. Open a chat note only when
  its index line says it holds what is needed. For anything outside chats, the order is
  in the "Finding things" section of CLAUDE.md: grep first, then [[00 Master Index]].
- The raw log in `.raw/` is a safety net, not a deliverable. Do not tidy it, and do not
  point Luke at it unless something in the summary needs checking against it.

## Template

```markdown
---
type: chat
date: YYYY-MM-DD
session: <session id from the hook>
status: open
topic: <Topic>
---

# <YYYY-MM-DD> - <Topic>

## Summary
<3 to 5 lines: what this chat was for, where it got to>

## Thread
- <what was asked, what was decided, what changed>

## Learned about how Luke works
- <preference, correction, standing decision, or "—">

## Created and changed in the vault
- [[Note Name]] — created/updated, why

## Outside the vault
- <Notion, Drive, Fathom, metrics links, or "—">

## Open items
- <unfinished, undecided, declined, or "—">

## Related
- [[Chat Logging]] — the automation that maintains this note
```

## Related
- [[00 Chat Index]] — the index this automation maintains, and the way in to every chat
- [[Instagram Script Writing]] — the other active automation, which maintains [[00 Script Index]]
- Chat notes themselves live in `Memory/Chats/`
