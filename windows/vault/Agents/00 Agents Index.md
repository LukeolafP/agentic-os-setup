---
type: index
scope: agents
updated: 2026-10-30
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
| [[ac-brand-checker\|Alpha Carrier Brand Checker]] | Brand | Checks any Alpha Carrier page, snippet, graphic or mockup against the [[Alpha Carrier Brand System]] (classic red and black); pass/fail checklist with file:line and screenshot evidence. Read only |
| [[ac-creative-director\|Alpha Carrier Creative Director]] | Brand | **Leads the Alpha Carrier team.** Takes any Alpha Carrier design job, splits it across the ac- members through the Agent tool, has ac-brand-checker check it and returns one report |
| [[ac-graphic-designer\|Alpha Carrier Graphic Designer]] | Brand | New round-2 icons (line plus one tapering brush stroke), flat semis, scene parts, section graphics and favicons, built with the brand tools into `Brand/Alpha Carrier/` |
| [[ac-mockup-designer\|Alpha Carrier Mockup Designer]] | Brand | Alpha Carrier box renders and variations in box-4-b's studio (classic and blue), device mockups, Higgsfield renders when asked; web-ready exports |
| [[ac-motion-designer\|Alpha Carrier Motion Designer]] | Brand | Alpha Carrier web motion in the page's patterns (trucks, conveyor, header sign), reduced-motion safe, with frame-exact recordings |
| [[ac-page-builder\|Alpha Carrier Page Builder]] | Brand | Builds Alpha Carrier pages and sections from the page parts, checks them at 390/844/1440, makes GHL-ready snippets; drafts in `.work/` for Petra to merge |
| [[bp-brand-checker\|Blueprint Brand Checker]] | Brand | Checks any Blueprint page, snippet, graphic or mockup against the [[Blueprint Brand System]]; pass/fail checklist with file:line and screenshot evidence. Read only |
| [[bp-creative-director\|Blueprint Creative Director]] | Brand | **Leads the Blueprint team.** Takes any Blueprint design job, splits it across the bp- members through the Agent tool, has bp-brand-checker check it and returns one report |
| [[bp-graphic-designer\|Blueprint Graphic Designer]] | Brand | New stencil-plate icons, blueprint line trucks, section graphics and favicons, built with the brand tools into `Brand/Blueprint/` |
| [[bp-mockup-designer\|Blueprint Mockup Designer]] | Brand | Blueprint box renders and variations on box-4-b, offer stack (C1) and device mockups, Higgsfield renders when asked; web-ready exports |
| [[bp-motion-designer\|Blueprint Motion Designer]] | Brand | Blueprint web motion in the page's patterns (logo roll-out, drafted word, truck draw-on), reduced-motion safe, with frame-exact recordings |
| [[bp-page-builder\|Blueprint Page Builder]] | Brand | Builds Blueprint pages and sections from the component library, checks them at 390/844/1440, makes GHL-ready snippets; drafts in `.work/` for Petra to merge |
| [[brand-checker\|Brand Checker]] | Brand | Lists the brand guideline rules a script, caption or thumbnail must follow, as a checklist. Read only |
| [[case-study-logos\|Case Study Logos]] | Brand | Finds each client's best logo, saves it beside the case study in Drive and puts it at the top of the doc |
| [[cta-auditor\|CTA Auditor]] | Content | Checks every script's CTA keyword against the Call To Actions notes and the keyword map; lists clashes and dead keywords. Read only |
| [[hook-analyst\|Hook Analyst]] | Content | Ranks a month's reels by completion, shares and saves, with the hooks of the top five and bottom five. Read only |
| [[scorecard-tracker\|Scorecard Tracker]] | Luke | Lists every scorecard target with what the vault shows about progress on it. Read only |
| [[ring-organizer\|Ring Organizer]] | GTD | Files every item on the OS ring into the ring's own folder tree (project, page, versions; reports by type, year, month), apart from the vault's folders. The OS runs it on new items |
| [[script-reviewer\|Script Reviewer]] | Scripting | Reviews scripts in a date range against [[Writing Instagram Content]], benchmarking hooks against the month's best. Read only |
| [[team-capacity\|Team Capacity]] | GTD | Works out how many reels and long-form videos the video team can finish per week. Read only |

## Brand teams

The Blueprint (bp-) and Alpha Carrier (ac-) agents work as two teams. Send brand work to the team's
creative director; it briefs the members as subagents through the Agent tool and runs the brand checker
before reporting. Each member can also be queued on its own. Every agent reads its brand's Brand System
note first ([[Blueprint Brand System]], [[Alpha Carrier Brand System]]), and every file a member makes is
logged in [[Blueprint Agent Outputs]] or [[Alpha Carrier Agent Outputs]], so edits Luke makes later flow
back as rules through [[Brand Asset Feedback]]. Frontmatter for the OS team view: `team`, `team_role`
(lead or member) and, on members, `lead`.

## Related
- [[00 Robonuggets Index]] — Petra, the queue and the agent constellation
- [[00 Reports Index]] — what each agent found
