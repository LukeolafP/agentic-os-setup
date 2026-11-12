---
type: index
scope: agents
updated: 2026-10-20
maintained: by the agent-creator skill, in the same turn an agent is made, changed or removed
---

# 00 Agents Index

Up: [[00 Master Index]]

One note per background agent. Each note is a Claude Code subagent definition: the
frontmatter says who it is, the body is its instructions. Claude Code reads this folder
as `.claude/agents/`, which is a link to it, so an edit here is live for the next job.
Petra queues these from the [[00 Robonuggets Index|Agentic OS]]; finished jobs are filed
under [[00 Reports Index]] by [[Agent Report Filing]]. New agents are made with the
agent-creator skill.

This note is not an agent: it has no `name` in its frontmatter, so Claude Code skips it.

| Agent | Department | What it does |
|---|---|---|
| [[brand-checker\|Brand Checker]] | Brand | Lists the brand guideline rules a script, caption or thumbnail must follow, as a checklist. Read only |
| [[case-study-logos\|Case Study Logos]] | Brand | Finds each client's best logo, saves it beside the case study in Drive and puts it at the top of the doc |
| [[cta-auditor\|CTA Auditor]] | Content | Checks every script's CTA keyword against the Call To Actions notes and the keyword map; lists clashes and dead keywords. Read only |
| [[hook-analyst\|Hook Analyst]] | Content | Ranks a month's reels by completion, shares and saves, with the hooks of the top five and bottom five. Read only |
| [[scorecard-tracker\|Scorecard Tracker]] | Luke | Lists every scorecard target with what the vault shows about progress on it. Read only |
| [[ring-organizer\|Ring Organizer]] | GTD | Files every item on the OS ring into the ring's own folder tree (project, page, versions; reports by type, year, month), apart from the vault's folders. The OS runs it on new items |
| [[script-reviewer\|Script Reviewer]] | Scripting | Reviews scripts in a date range against [[Writing Instagram Content]], benchmarking hooks against the month's best. Read only |
| [[team-capacity\|Team Capacity]] | GTD | Works out how many reels and long-form videos the video team can finish per week. Read only |

## Related
- [[00 Robonuggets Index]] — Petra, the queue and the agent constellation
- [[00 Reports Index]] — what each agent found
