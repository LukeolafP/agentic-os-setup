# GTD Vault

This is an Obsidian vault, not a codebase. Notes are Markdown with YAML frontmatter.
Use `[[wiki links]]` between notes, not relative paths.

## Automations — always active

Automations are standing instructions I have written down. Each one is its own note in
`Memory/Automations/`.

**At the start of every session, read every note in `Memory/Automations/`.**
Then, throughout the conversation, watch for each automation's trigger and carry out
its action without waiting to be asked. Automation notes are instructions to you, not
reference material.

Rules:
- Follow the note's action steps exactly, including title format and templates.
- Fire only on a real trigger. If a trigger is ambiguous, ask in one line first.
- Never invent content to fill a template — leave unknown fields as `—`.
- If I describe a new recurring behaviour, offer to write it as a new automation note
  in `Memory/Automations/`.
- Every automation note lives in `Memory/Automations/` and nowhere else — never loose
  in `Memory/`, never in the vault root, never beside the content it acts on.

## What loads every session

Three things, and nothing else:

1. This file.
2. Every note in `Memory/Automations/`, in full.
3. [[00 Chat Index]], so you know what has already been worked on.

Do not scan, list or read the rest of the vault at the start of a session. Everything
else is read on demand, only when a question needs it.

## Finding things

In this order. Stop as soon as you have the answer.

1. **Answer from what is already loaded.** Most questions about how I work, what the
   rules are, or what a past chat covered need nothing further.
2. **Brain recall, for a stored fact.** When the question is about something already
   decided or recorded (a preference, a rule, a role, a date, a setting, a keyword, "what
   did we decide about X", "which chat was that"), the first tool call is
   `node Installers/Robonuggets/rubric-second-brain/brain.js recall "the question"` through Bash,
   before any Grep or Read. It reads the index chain and filenames, no model call, about
   20 ms, and prints the matching slice of the best notes. Answer from that slice and name
   the note. Open the note only if the slice is not enough. Add `--k 2` when the question
   spans two notes. If it misses, go to grep.
3. **Grep.** Exact, cheap, and it returns lines rather than whole files. First choice
   whenever the wording is known: a keyword, a name, a date, a phrase.
4. **[[00 Master Index]]** when grep comes up empty, when the question is about *why*
   something is the way it is, or when I ask you to look it up. It is the routing table:
   one read says which index to open, what is not in the vault at all, and which greps
   are worth running.
5. **Follow that index down.** Indexes lead to indexes: content narrows platform, then
   year, then month, and only the last level lists the notes. Open individual notes only
   for the ones the index says you need.
6. **Only then search broadly**, and say that is what you are doing.

## Saving facts

A durable fact about how I work or what was decided goes in the vault, not only in
Claude's own memory folder, so it shows up in Obsidian, the Second Brain map and recall.

- **Default:** `node Installers/Robonuggets/rubric-second-brain/brain.js store "the fact" --type
  feedback|project|user|reference --name short-slug --desc "one line for the index"
  --why "..." --how "..."`. It writes `Memory/Facts/<Title>.md` and files the line in
  [[00 Facts Index]] in one step. Use `--sandbox` to test without touching the vault.
- **Hand-write instead** when the fact needs more structure than a paragraph and a Why and
  How. Edit the note afterwards to add `[[links]]`, and keep its line in the index.
- A fact is not a rule set or an instruction. Voice and style rules stay as their own
  notes in `Memory/`, and a standing instruction is an automation note in
  `Memory/Automations/`.
- Never store secrets. `store` redacts token-shaped strings, but name the thing, not its
  value.

Never read a folder in full to answer a question an index already answers, and never
re-read an automation note that was already loaded at session start.

## Index rules

Each index sits at the top of its folder, named `00 <Thing> Index.md`, holding one line
per note with a link. The detail lives at the bottom level of the chain: the month index
carries each script's idea, CTA, what changed and what is still open.

**Every entry in an index links straight to the thing it indexes**, and so does every
later mention of that thing further down the page. A date, a name or a keyword in an
index is a link, not plain text, so I can click through from wherever I spot it. Use
`[[Full Note Name|short label]]` where a short label reads better, a path link like
`[[skills/builtin/loop/SKILL\|/loop]]` where several files share a basename, and a
`file:///` link where the target sits outside the vault.

**Inside a table cell, escape the pipe: `[[Note\|label]]`.** An unescaped pipe is read
as the next column, which splits the link in half. It still looks fine in the source, but
Obsidian never registers it, so it does not appear in graph view and does not show up in
backlinks. A `file:///` link is never a graph connection either, whatever the syntax,
because the target is not a note in the vault.

Indexes are kept current by the automation that owns the folder, in the same turn the
note is written, never in a later cleanup pass. A note with no index line is invisible.
An index with no owning automation says so in its frontmatter and is refreshed when I
ask. A new index gets a row in [[00 Master Index]] in the same turn it is created, or
nothing will ever find it. Each index links up to its parent on the line under its title,
so the chain reads in both directions. A level is created when the first note needs it,
never in advance.

## Content structure

- `Content/Instagram/Scripts/` — one note per finalised script
- `Content Ideas/` — unstructured ideas, not yet scripts
- `Memory/` — durable rules about how I work (voice, style)
- `Memory/Automations/` — one note per automation
- `Memory/Chats/` — one note per chat, written as the chat happens
- `Memory/Facts/` — one durable fact per note, saved by `brain.js store`, see Saving facts
- `Installers/Robonuggets/` — the RoboNuggets dashboards that read this vault, see [[00 Robonuggets Index]]
- `Reports/` — one note per finished background agent job, filed by the Agent Report Filing automation, see [[00 Reports Index]]
- `Agents/` — one file per background agent, made with the agent-creator skill, see [[00 Agents Index]]; Petra, the main agent, queues them. `.claude/agents/` is a link to this folder, which is how Claude Code finds them
- `00 <Thing> Index.md` — the index at the top of a folder, see above

## Connected data sources

Marketing APIs come from the `api-registry` MCP server, which is standalone at
`~/Coding/api-registry` with its own venv, `.env` and endpoint list.

- `list_services` — what is reachable and what credentials are missing
- `list_endpoints` — endpoints with params and recorded gotchas
- `call_endpoint` — call one
- `add_endpoint` — register a new one so it persists into future sessions

When you work out a useful call that is not registered, add it. That is what the registry
is for.

Live: Hyros, GoHighLevel, YouTube Data, Instagram (@amritdhanraaj, re-authenticated
15 September 2026 and kept alive by `~/Coding/api-registry/tools/ig_token.py`).
Facebook Ads is registered and reports itself configured, but `FB_ADS_TOKEN` is a
logged-out user token and every call fails; it needs a Business Manager System User
token. Facebook Page, YouTube Analytics and TikTok are registered but not yet
credentialed.

A service missing credentials returns unconfigured, and a failing API returns the
platform's own error. Never present either as a zero, and never estimate a number that
came back missing.

The `marketing` MCP server also exists, wrapping `~/Coding/carousel-builder` for computed
metrics with period-over-period change. It depends on that project being present. The
`.connectors/` folder in this vault is superseded and unused.
