---
type: automation
status: active
trigger: A queued background agent job finishes
created: 2026-10-15
---

# Agent Report Filing

Every background agent's report is saved as a note in the vault. A report that only lives
on the OS ring is not useful to Luke: it cannot be opened, searched, linked or recalled.
Set on 15 October 2026, in [[2026-10-15 - Read Only Content Agents]].

## Trigger

A job queued through Petra's agent queue (`queue_agent`) shows as done or failed in
`agent_jobs`, and no note for that job id exists yet.

- Whoever queued the job files it: Petra, or a keyboard session.
- Any session that lists `agent_jobs` and sees a finished job with no note files it too.
  Grep `Reports/` for the job id first.
- The read-only agents never file their own reports. Filing is the queuing session's job,
  which keeps the agents read only.

## Action

1. **Get the full report.** The `agent_jobs` preview is cut short, so never file from it.
   The full transcript of every job is in `~/Coding/jarvis/.gtd-jobs/`; the report is the
   agent's final message. If that is unreachable, use the agent's session transcript in
   `~/.claude/projects/<the vault's project folder, e.g. -Users-you-Documents-GTD>/`. If neither can be read, file
   the preview and mark `status: partial`, saying in Open items that the full text is
   missing.
2. **Path:** `Reports/<YYYY>/<Month>/<YYYY-MM-DD> - <Agent Label> - <Topic>.md`
   - Date is the day the job finished.
   - Topic is 2 to 6 words in Title Case from the brief: `August 2026 Hooks`,
     `Scripts 1 To 15 October`, `November Plan Capacity`.
   - If the filename exists, append ` (2)`.
3. **Template:** below. The report goes in verbatim. Do not summarise, trim or tidy it.
4. **Index:** add the line to the month index in the same turn,
   `- [[note name]] — one sentence on what it found.` Create the year or month level only
   when the first report needs it, linked up to its parent, per the index rules in
   CLAUDE.md.
5. **Chat note:** list the report under Created and changed in the vault, per
   [[Chat Logging]].
6. **Voice:** tell Luke the report is filed in one short line. No path.

## Template

```markdown
---
type: report
date: YYYY-MM-DD
agent: <agent id>
job: <job id>
status: done | failed | partial
topic: <Topic>
chat: "[[<chat note that queued it>]]"
---

# <YYYY-MM-DD> - <Agent Label> - <Topic>

## Brief
<the task exactly as it was queued>

## Report
<the agent's final message, verbatim>

## Open items
- <anything the report left open, a failed or partial job, or "—">

## Related
- [[00 Reports Index]]
- [[<chat note that queued it>]]
```

## Rules

- File failed jobs too, with the error as the report. A failure is a result.
- When an agent called another agent as a sub-agent, the sub-agent's findings are part of
  the caller's report; do not file them separately unless they were queued separately.
- When a report's final message is only an addendum (a late sub-agent result that replaced
  the main findings), file what exists, mark `status: partial`, and say so in Open items.
- Never add secrets or driver PII. Name the thing, not its value.
- Never invent content to fill the template. `—` for anything unknown.

## Related
- [[00 Reports Index]] — every filed report, by year and month
- [[00 Robonuggets Index]] — Petra, the queue and the agents
- [[Chat Logging]] — records each filed report in the chat that queued it
