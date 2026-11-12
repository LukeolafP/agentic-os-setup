---
name: agent-creator
description: Create a new background agent for Luke's GTD vault, by voice through Petra (the main agent on the OS) or by text. Writes the agent's definition to Agents/<id>.md and registers it on the Rubric console and the Agentic OS, so Petra can queue it and it shows while it works. Use whenever Luke says "create an agent", "make a new agent", "I need an agent that...", "build me an agent for...", "add an agent", or asks to change or rename an existing agent.
---

# Agent Creator

An agent is one file, `Agents/<id>.md` in the vault: a Claude Code subagent
definition. `.claude/agents/` is a link to `Agents/`, so Claude Code finds it there and
Luke sees it in Obsidian. Always write to `Agents/`. Petra queues it as its own background session (`claude -p --agent <id>`),
it shows as active on the Rubric console and in the OS queue while it works, and its
final message becomes a report on the OS ring. A keyboard session can hand it work
too.

## 1. Find out what the agent is for

Gather four things. Propose a sensible default for each instead of asking a bare
question, and skip anything Luke already said.

1. **The job.** What it does, and the phrases that should send work to it. This becomes
   the description, which is what Petra reads when choosing an agent, so make it
   specific.
2. **Department.** One of Luke's six: Brand, Content, Scripting, Memory, GTD, Luke.
   It decides which notes the agent starts from (see the table below).
3. **What it may touch.** By default an agent may read anything and edit files inside
   the vault. Anything else is a permission it has to be given by name: an MCP tool
   (`mcp__api-registry__call_endpoint`), a scoped shell command
   (`Bash(node Installers/Robonuggets/rubric-second-brain/brain.js recall:*)`). Never
   grant plain `Bash`, and never a tool that sends, posts, deletes or pays.
4. **Model.** Default `claude-opus-5-5` at `high`. Offer `claude-sonnet-5` for routine,
   high-volume work.

**By voice** (the request came through Petra): ask at most three short questions, one
at a time, each with a proposed answer Luke can accept by saying yes. Then build it and
say in one line that it exists.

**By text**: show the plan in one short block (id, name, department, permissions,
model) and build it once Luke confirms, unless he already gave all four.

## 2. Check the name

Run `node Installers/Robonuggets/tools/agents.mjs list`. The id is lowercase words
joined by dashes, 2 to 4 words, named for the job: `scripting-drafter`,
`reel-analyst`, `brand-checker`. If the id exists, ask whether to update it or pick
another name.

## 3. Write `Agents/<id>.md`

Use this template exactly. Fill every field; never leave a placeholder in the file.

```markdown
---
name: <id>
label: <Display Name>
description: <one or two sentences: what it does and when to send work to it. Petra reads this to choose the agent.>
department: <Brand | Content | Scripting | Memory | GTD | Luke>
role: <short role line for the Team tab, e.g. "Scripting · drafts reels">
model: <claude-opus-5-5 | claude-sonnet-5>
effort: <low | medium | high>
ui_color: "<hex colour in quotes (YAML reads an unquoted # as a comment), the department's: Brand #ff3d71, Content #2196f3, Scripting #fdd835, Memory #e040fb, GTD #00c853, Luke #ff9100>"
icon: <one of the 15 Rubric sidebar icons: Robo Crown Sentinel Fortress Phantom Spark Apex Drift Halo Orb Rune Nova Sage Warden Echo>
tags:
  - <2 to 4 short capability chips for the Team tab>
permissions:
  - <each extra permission by exact tool name, or leave the list empty>
---

You are <Display Name>, a background agent in Luke's GTD Obsidian vault. You were
queued with a brief and nobody is watching while you work: there is no one to answer
questions, so make reasonable calls, note any assumption, and finish.

## Your job
<what it does, in a short paragraph>

## Start from
<the notes and indexes this agent reads first, as vault paths, from the department
table below. Follow CLAUDE.md's Finding things order: brain recall for stored facts,
then grep, then the Master Index.>

## How you work
<3 to 7 numbered steps specific to the job>

## Rules
- The vault's CLAUDE.md and every note in Memory/Automations/ apply to you.
- Write notes the vault's way: YAML frontmatter, [[wiki links]], and an index line in
  the same step as the note. Never invent facts, quotes or numbers; leave unknowns as —.
- Never send, post, publish, delete or pay for anything. Draft it and say where it is.
- <job-specific rules>

## Finish with
Your final message is filed as a report on the Agentic OS and may be read aloud by
Petra. Lead with one sentence saying what you did, then list every note you created or
changed as a vault path, then anything left open.
```

### Where each department starts

| Department | Start from |
|---|---|
| Brand | `Brand/`, the animate skill's design system for motion |
| Content | `Content/00 Content Index.md`, `Memory/Call To Actions/`, `Content/Instagram/Analytics/`, `Content/Instagram/Monthly Reports/` |
| Scripting | `Memory/Writing Instagram Content.md`, `Memory/Writing Instagram Captions.md`, `Memory/Writing Instagram Stories.md`, `Memory/Automations/Instagram Script Writing.md`, then the scripts and CTAs they link in Content |
| Memory | `00 Master Index.md`, `Memory/Chats/00 Chat Index.md`, `Memory/Facts/00 Facts Index.md` |
| GTD | `GTD/` and its indexes, such as `GTD/Efficiency/00 Efficiency Index.md` |
| Luke | `Luke/Responsibilities.md`, `Luke/Organic Growth Manager Scorecard.md` |

## 4. Register it

Run `node Installers/Robonuggets/tools/agents.mjs register <id>`. It checks the file
(name matches the id, a description exists) and adds the agent to the Rubric console
sidebar, the Agents tab and the Team tab. If it reports an error, fix the file and run
it again. The OS and JARVIS read the folder directly.

Then add the agent's row to [[00 Agents Index]] in the same turn: `| [[<id>\|<Label>]] |
<Department> | <one line on what it does> |`, keeping the table sorted by id.

## 5. Report

- **Voice:** one line, for example "The scripting drafter is ready. Ask me to queue it."
  No paths.
- **Text:** the id, what it does, its permissions, and how to use it: ask Petra to
  queue it, or say "use the <id> agent" in a keyboard session. Reload the Rubric
  console to see it in the sidebar.

The chat note for this conversation records the new agent under Created and changed in
the vault, per the Chat Logging automation.

## Changing or removing an agent

- **Change:** edit `Agents/<id>.md`, then run `register <id>` again, and update its row in
  [[00 Agents Index]].
- **Remove from the dashboards:** `node Installers/Robonuggets/tools/agents.mjs remove
  <id>`. Deleting the file itself is Luke's call, by keyboard. Never delete it by voice.
