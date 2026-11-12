---
type: index
indexes: Robonuggets
updated: 2026-10-20
maintained: by hand, on request
---

# 00 Robonuggets Index

Up: [[00 Master Index]]

Three RoboNuggets kits by Jay E (CC BY 4.0), installed on 15 October 2026 with this vault
as the files behind them. They live in `Installers/Robonuggets/` and find the vault by
walking up to the folder holding `CLAUDE.md`, so they survive being moved again. Nothing here holds notes of its own: every number, schedule
and memory the dashboards show is read from the vault or from this Mac's real
schedulers. Set up in [[2026-10-15 - RoboNuggets Setup On Vault]].

## What runs where

| Kit | Address | What it shows | Reads from the vault |
|---|---|---|---|
| Rubric console | http://localhost:5050 | Agent status, Flows, Skill Trees, Crons, Team | Flows open the real automation notes, such as [[Instagram Script Writing]], [[Instagram Vault Sync]], [[Chat Logging]] and [[Weekly Content Slack Post]] |
| Second Brain | http://localhost:5211 | The whole vault as one map, plus `brain.js` recall and store | Every note, its `[[links]]`, sorted into five departments |
| Agentic OS | http://localhost:50000 | Calendar, stats, routines board, ring of reports | Stats from this month's analytics notes under [[00 Analytics Index]]; the ring links every HTML report in `Content/` and `Dashboards/` |

All three start at login and restart if they crash, as launchd agents
`com.gettruckdrivers.rubric-console`, `.second-brain` and `.agentic-os` in
`~/Library/LaunchAgents`. They bind to localhost only. Logs are in `Installers/Robonuggets/.logs/`.
To restart one: `launchctl kickstart -k gui/$(id -u)/com.gettruckdrivers.agentic-os`.
To switch autostart off: `launchctl bootout gui/$(id -u)/com.gettruckdrivers.<name>`
and delete its plist. `start.sh` and `stop.sh` still work for a manual run.

## The OS: tabs and the round window

The Agentic OS has three tabs in a pill at the bottom centre: **OS**, **Second Brain** and
**Console** (the Rubric console, shown inside the OS). The Micro Apps rows open the same
two views in place, as do the orb and the click-and-hold wheel's STORE.

Clicking the orb opens the Second Brain as a round window inside the ring of report
balls, with the board still around it. Scroll or pinch over the brain to grow the window;
each widget it reaches blurs and fades, and comes back as the window shrinks. At full
screen the brain zooms normally, and zooming out past its fit starts shrinking the
window again. Zooming out past the smallest size closes it. Also closes with the ✕ on
the window's edge, "← Back to the OS" at the top when full screen, the OS tab, or Esc.
The brain side of this is `rubric-second-brain/public/_embed.js`.

## The look: GTD brand

Since 19 October 2026 the Agentic OS and the Second Brain follow the 2026 brand guideline,
`Brand/GTD update BG-2 (1).pdf`, in place of RoboNuggets' black and orange.

- **Ground:** Electric Blue light falling to Deep Navy, with the brand mark's vertical
  lines fading in from each side (guideline p1, p22, p27). On the OS the lines are on the
  background canvas, so Petra's voice warp still bends them.
- **Palette:** Deep Navy `#182A5B`, Electric Blue `#3164F5` for buttons and active tabs,
  Bright Blue `#1A8CF6` as the accent on navy, Periwinkle `#7DA0FF` for labels, Ice
  `#F5F8FF` for text. No orange and no teal anywhere.
- **Type:** Trajan Pro for titles and widget headers, always uppercase; Proxima Nova for
  everything else; numbers in solid white Proxima Extrabold, tracked tight.
  The fonts are served locally from `rubric-agentic-os/assets/brand/` (and a copy in
  `rubric-second-brain/public/brand/`).
- **Flat glass** (Luke, 19 Oct 2026, in [[2026-10-19 - Organic Lead Tracker Restyle]], saved as
  [[Brand Flat Glass]]): widgets are translucent navy glass on the blue ground, built on
  Apple's materials (github.com/emilkowalski/skills, apple-design): blur plus saturation, a
  bright hairline on the top edge, a neutral shadow. Everything inside is flat: no glow, no
  shaded spheres, no gradient ink. Icon discs, buttons and active tabs are flat Electric
  Blue, and buttons dip to 97% on press. White cards were tried the same day and rejected.
  The flat layer is the last block of `brand.css`; the canvas parts are in `dashboard.html`
  (the ring is a flat navy band with a hairline at each edge, no bevel or glow, and no drop
  shadow under the balls) and `constellation.js` (Petra is a flat Electric Blue disc with a
  white hairline). The calendar clock's hands now follow local time, not Sydney. Copies
  from before the change: `brand.css.bak-2026-10-19`, `dashboard.html.bak-2026-10-19`,
  `constellation.js.bak-2026-10-19`. The [[2026-10-19 - Organic Lead Tracker Restyle|organic lead tracker]]
  follows the same look.
- **Shapes:** widgets have 24 px corners; buttons and tabs are pills; header icons are solid
  brand icons in a flat blue circle; the title is the GTD mark and wordmark with "Agentic OS".
- **Documents** in the pop-up viewer sit on the Ice ground with navy Trajan headings, the
  way the guideline sets document pages (p5, p7).
- **Kept on purpose:** the six department colours. They are data, shared with the Second
  Brain map, so an agent keeps its colour when you click through. The Second Brain's ARMS
  rings are now brand blues, light to deep: Applications, Routines, Memory, Skills.
- **Where it lives:** `rubric-agentic-os/brand.css` (loaded last, so it wins), the GTD
  skin in `rubric-second-brain/public/index.html`, and colour swaps across the OS files.
  Pre-brand copies are in `rubric-agentic-os/.before-brand/` and
  `rubric-second-brain/public/.before-brand/`.
- **Not yet restyled:** the Rubric console (the Console tab), the routine source pixel
  icons, and the OS tweak sliders for colours, which still work but no longer change the
  background.

## Three shapes: wide, square and tall

Since 19 October 2026 the OS lays itself out to fit its pane, so it works side by side
with a chat in Obsidian. The shape is picked when the page loads, and it reloads after a
lasting resize.

- **Wide** (wider than 1.4:1): the designed board, cards on both sides of the ring.
- **Square** (0.8:1 to 1.4:1): the ring on the left, the cards in one column on the right
  that scrolls up and down.
- **Tall** (narrower than 0.8:1): the ring on top, the cards in one row along the bottom
  that scrolls sideways.

In square and tall the layout is automatic: edit mode and the widget library are hidden
there, and the saved wide layout is never changed. The code is `SHAPE`, `DOCK` and
`applyDock()` in `rubric-agentic-os/dashboard.html`; the styles are at the end of
`brand.css`. The version before this change is `.dashboard.before-dock.html`.

**Calendar card:** the current time, then events from 2 hours ago to 2 hours ahead, with a
NOW line between them. Past events dim and say how long ago; coming ones say how long
until. The other time zones and the year grid were removed at Luke's request. The feed
keeps the past 2 hours: the snapshot fallback in `server.js`, and `timeMin` in
`tools/google-calendar.js` once Google sign-in is done.

## Petra's chat: talk or type

Since 20 October 2026, clicking Petra offers **Talk** (the microphone, as before) or
**Type**. The keyboard button beside the wave in the tab pill opens Type directly.

- **The board makes room.** Wide: cards in a column on the left, the ring in the middle,
  the chat on the right. Square: the chat on the right, the cards in a row under the
  ring. Tall: the chat under the ring, the cards in a row at the bottom. The ring glides
  to its new place; closing the chat (✕) puts everything back. The layout is remembered,
  so a reload keeps the chat open.
- **It is Claude Code.** A full session in the vault run by the bridge (`bridge/chat.mjs`):
  your model and settings from `~/.claude` (Opus 5.5 1M), every MCP server, the vault's
  CLAUDE.md, hooks, skills, agents and slash commands (type `/` for the list), plus Petra's
  queue tools. It starts in **auto** mode like your terminal; the mode chip (or
  shift+tab in the box) cycles auto, ask, accept edits and plan. Permission prompts,
  Claude's multiple-choice questions and plan approval appear as buttons. `[[Wiki links]]`
  in replies open the note in a pop-up. Esc or STOP interrupts.
- **It keeps going.** One session for the Mac, shared by every OS page; the conversation is
  saved in `~/Coding/jarvis/.gtd-jobs/chat-log.json` and resumes after a bridge restart
  (within 12 hours). **+** starts a new chat; the old one stays in Claude Code's history.
- **Subagents.** The SUBAGENTS strip lists every agent working: subagents this chat started,
  Petra's voice subagents and queued background jobs, with how long each has been going.
  Click one (or WATCH on its row, or its copy on the constellation) and its own chat
  replaces Petra's: its brief, what it says, each tool call. The Second Brain opens
  floating over the ring's area beside it, focused on that agent and the files it
  touches, and zooms normally. **← PETRA** goes back and closes the brain.
- **Voice is unchanged.** Talk still goes to the voice session with its safety gate; typing
  to Petra from the caption box now goes to this chat.
- **Files:** `rubric-agentic-os/chat.js`, `chat.css`; the live layout is `computeDock`,
  `osSetChat` and `osBrainFloat` in `dashboard.html`; the picker is in `constellation.js`;
  the float mode is in `rubric-second-brain/public/_embed.js`; transcripts are kept by
  `bridge/gtd.mjs` (`recordStream`, `getTranscript`). Copies from before:
  `.dashboard.before-chat.html`, `.constellation.before-chat.js`, `.windows.before-chat.js`,
  `bridge/server.before-chat.mjs`, `bridge/gtd.before-chat.mjs`. Tested 20 Oct 2026 with a
  real turn that started an Explore subagent, watched beside the floating brain.

### Voice in the chat, and managers (20 Oct 2026)

- **Voice in the side chat.** The microphone in the chat's header turns voice on and off.
  On: what you say goes into this chat (shown with a 🎙), Petra leads her reply with a
  sentence or two that are read aloud, the full answer stays on screen, and the mic opens
  again when she has finished speaking. Say nothing and it waits for the next click. While
  the chat is open the wave and the little caption card leave the bottom bar.
- **From the little card to the chat.** The caption card that appears when you talk by voice
  has **OPEN CHAT ⤢**: the side chat opens with voice on, shows what was just said, and
  Petra is given that exchange with your next message so she carries on from it.
- **`/` lists every command** you can run: Claude Code's built-ins, your own and your
  skills (67 on 20 Oct), searchable, ↑↓ and Tab to pick. The list is ready before the first
  message.
- **The message box grows** with what you type, up to 8 lines, and only scrolls past that.
  SEND stays available while Petra works, so you can always send her another message.
- **Photos.** Paste one or more into the message box, or drag them onto the chat. They
  wait as thumbnails (✕ removes one, up to 20 a message), are scaled to 2000 px and under
  4.5 MB, and go to Petra as images with your text. The bridge keeps a copy in
  `~/Coding/jarvis/.gtd-jobs/chat-images/` and gives Petra the paths, so a manager or
  subagent she hands them to can open them.
- **Chat history.** The clock in the chat's header lists every chat with Petra, newest first,
  with Claude Code's own title, a preview and how many messages; search filters them.
  Open one to read it, **CONTINUE THIS CHAT** to pick it back up (Claude Code resumes that
  session, so Petra remembers it; the chat you were in stays in the list). The bridge keeps
  each chat as the panel showed it in `~/Coding/jarvis/.gtd-jobs/chat-history/`, and
  rebuilds older ones from Claude Code's transcripts in `~/.claude/projects/`. **+** (new
  chat) no longer loses anything.
- **Tabs.** Several chats with Petra at once. The tab bar under the chat's header has one
  tab per chat and **+** for a new one (the **+** in the header does the same). Each tab is
  its own Claude Code session, with its own messages, mode and prompts, and they all keep
  working while you look at another: a pulsing dot means Petra is working there, a ring
  means something new arrived. ✕ closes a tab (asks first if Petra is mid-reply) and its
  chat stays in history; history's **OPEN IN A TAB** brings any past chat back. Ctrl+Tab
  steps through tabs. A manager reports to the tab that started it, and reopens it if you
  closed it. Open tabs are kept in `~/Coding/jarvis/.gtd-jobs/chat-tabs.json` and come back
  after a bridge restart. Added 22 Oct 2026; tested with two tabs answering at the same time.
- **Managers.** For any real piece of work Petra starts a manager: a clone of her (a full
  Claude Code session with your settings and her rules) that works in the background, so
  she stays free to talk. Several run at once (4 at a time, more queue). They coordinate
  through her on a team board: each can see what the others are doing, post updates, ask
  Petra a question (she answers, or asks you), and message another manager through her.
  Their questions, relays and finished reports appear in the chat as cards; you can answer
  a question yourself from its card. Managers are listed under SUBAGENTS; click one for its
  own chat beside the floating Second Brain, with a box to message it and a STOP. New chat
  clears finished managers. Tested 20 Oct 2026 with two managers (a poster colour and a
  headline that had to name it) that asked Petra for each other's output and finished in
  30 seconds.
- **Files:** `~/Coding/jarvis/bridge/managers.mjs` (the managers, the team board and both
  sets of tools), `bridge/chat.mjs` (Petra's side, voice turns, the command list); OS side
  in `chat.js`, `chat.css` and `jarvis.js`. Copies from before: `bridge/chat.before-managers.mjs`,
  `rubric-agentic-os/.chat.before-managers.js`, `.jarvis.before-chatvoice.js`.
- Managers are not filed as reports by [[Agent Report Filing]] (that covers queued
  background agents); their reports live in Petra's chat.

## Claude Code in the OS

Since 20 October 2026 the OS has a **CLAUDE CODE** tab, after Console. It is the real
Claude Code CLI in a terminal, started in the vault, the same as opening Terminal, going
to `~/Documents/GTD` and typing `claude`. So it reads this vault's CLAUDE.md and
`.claude/` settings, your own `~/.claude` settings, permissions and memory, every MCP
server, hooks, skills, slash commands and the agents in `Agents/`. When claude exits the
shell stays open in the vault; **New session** in its top bar starts a fresh `claude`.

- **Typing in the OS goes there.** The type box in the caption above the tab pill has a
  switch, **CLAUDE CODE** (the default) or **PETRA**. On Claude Code, Send opens the tab
  and enters the prompt into the terminal. Voice always goes to Petra.
- **It keeps running.** The session lives in the JARVIS bridge, not the page, so closing
  the tab, reloading the OS or resizing Obsidian does not end it; the last 1 MB of output
  is replayed when you come back. Restarting the bridge does end it (use `/resume`).
- **Who can reach it.** The page is served by the bridge (`http://127.0.0.1:8790/term`)
  and its socket accepts only that page's own origin. The OS, a vault HTML file opened
  in the OS, other websites and scripts with no origin are all refused (checked 20 Oct
  2026). The page can only be framed by the OS and Obsidian.
- **Obsidian command:** "GTD Rubric: Open Claude Code (the vault terminal)", or
  `obsidian://rubric?tab=term`.
- **Files:** `~/Coding/jarvis/bridge/term.mjs` (the terminal and its page), wired in
  `bridge/server.mjs`; `node-pty` lives apart from the bridge's lockfile in
  `~/Coding/jarvis/vendor-pty/`. Copies from before: `server.before-term.mjs`,
  `gtd.before-agents-folder.mjs`, `rubric-agentic-os/.jarvis.before-term.js`.
- **Petra is unchanged on purpose.** She already reads the vault's CLAUDE.md, hooks,
  skills and agents, but not your own `~/.claude` settings, whose allow rules would skip
  the voice safety gate. Anything that needs the full Claude Code goes in the tab.

## Agents live in `Agents/`

Since 20 October 2026 every agent definition is a note in `Agents/`, listed in
[[00 Agents Index]], so they show in Obsidian. `.claude/agents` is a link to that
folder, which is how Claude Code, Petra's queue, `tools/agents.mjs` and the constellation
find them. The index note has no `name` in its frontmatter, so nothing treats it as an
agent. Checked: `claude -p --agent hook-analyst` loads through the link.

## Inside Obsidian: the GTD Rubric plugin

A local plugin, not from the community store: `.obsidian/plugins/gtd-rubric/`. It opens
the Agentic OS as its own tab inside Obsidian, with the Second Brain and the Rubric
console in the OS's own tabs. Use this rather than the core Web viewer: the Web viewer
runs pages in a session Obsidian lets ask for nothing but the clipboard, so the
microphone is always refused there. The plugin frames the OS inside Obsidian's own
window, which Obsidian lets use the mic, so Petra can hear you. macOS asks once.

- **Open it:** the orbit icon in the ribbon, or the commands Open Rubric OS, Open Second
  Brain, Open Rubric Console, Talk to Petra (give that one a hotkey), Reload Rubric OS.
  From outside Obsidian: `obsidian://rubric`, `obsidian://rubric?tab=brain`.
- **Links** clicked inside the OS (ring reports, dashboards) open as Obsidian tabs.
- **If the dashboards are down** the tab says so, with a button that runs `start.sh`.
- **It fills the tab.** The plugin waits for the pane to finish sizing before loading the
  OS, the OS lays itself out again after a lasting resize (only while the plain OS view is
  showing), and on panes taller than 16:9 the rows grow so the widgets and ring fill it.

## Windows, tabs and the viewer

Anything can open inside the OS (`windows.js`, `viewer.html`):
- **Pop-up first.** A vault note, PDF, HTML report, image, video, dashboard or web app
  opens as a floating window with FULL SCREEN, OPEN OUTSIDE and close. Esc or a click
  outside closes it.
- **Tabs.** FULL SCREEN turns it into a tab with a chip in the bar right of the main pill.
  Tabs keep running in the background and are remembered across reloads. OS, Second Brain
  and Console bring their view back over any tab.
- **The +** at the end of the bar searches the vault, opens any web address you type, and
  lists **the apps on this Mac** from `rubric-agentic-os/apps.json`: Organic Lead Tracking,
  Daily Metrics (the same dashboard, opened on its Daily snapshot tab), Story Builder,
  Carousel Builder, the Transcription Dashboard and the Onboarding Form. A green dot means
  running; STOP stops it. Choosing a stopped app opens its tab on a starting screen that
  starts its backend and frontend on this Mac (only processes whose port is free), shows
  each one come up, then hands over to the app; if one fails it shows the logs
  (`rubric-agentic-os/.app-logs/`). Apps keep running when their tab is closed, until
  stopped. Only commands listed in `apps.json` can be started. Add an app by adding an
  entry there. Native Mac applications cannot run inside a web page.
- **The viewer** renders markdown the Obsidian way: frontmatter as a properties table,
  `[[wiki links]]` that open in the same window, embedded images, callouts, tables. PDFs
  are drawn page by page. Files come from the OS server's read-only `/vault/` route,
  which never serves dot folders or secret-looking files.
- **From the Second Brain:** clicking a selected file opens it as an OS pop-up instead of
  the side drawer, any file type.
- **Links everywhere** (ring reports, job chips, the viewer) open here as pop-ups.

**The ring of reports** turns as one piece when scrolled or dragged, exactly with your
fingers, and stops when they stop: no throw, no bounce. Touching it freezes it, and it
stays where it was left.

## Petra: the main agent, her voice, and the agent constellation

Petra is the agent Luke talks to. She is Claude Code running in the vault, with the
vault's CLAUDE.md, hooks, skills and agents, and she hands slow work to the other agents.
Since 15 Oct 2026 she talks on `claude-sonnet-5` at `low` effort for speed, while every
agent she queues still runs on `claude-opus-5-5` at `high` (`JARVIS_MODEL`/`JARVIS_EFFORT`
and `GTD_JOB_MODEL`/`GTD_JOB_EFFORT` in the bridge's launchd plist).

**How fast she answers** (measured 15 Oct 2026, M1 Pro): 0.7 s of silence ends your turn,
Parakeet transcribes it in about 0.15 s on the GPU, and she starts making sound 2.2 to 2.7 s
after that, 4.6 s when she has to look something up. About 3 to 3.5 s from the end of
your sentence to her voice, down from about 13 s. What changed: Sonnet 5 low instead of
Opus 5.5 high (first word 0.5 s against 1.7 to 4.7 s in a benchmark of her exact setup),
Parakeet instead of faster-whisper (0.1 s against 1 s), the chat-log hook telling voice
sessions to answer before writing the note (`GTD_VOICE=1`), a sentence spoken the moment
she pauses or calls a tool, 0.4 s voice chunks and a 0.2 s buffer, and a 0.7 s silence
wait instead of 1.3 s. Remarks about her own bookkeeping ("Done", "logged") after she
writes a file are shown but not spoken. Her bridge is built on
[adewaskar/jarvis](https://github.com/adewaskar/jarvis) (MIT), which lives outside the
vault in `~/Coding/jarvis` because its `node_modules` would flood Obsidian. Set up in
[[2026-10-15 - RoboNuggets Setup On Vault]].

**Her voice.** Voxtral TTS (Mistral, 4B, MLX 4-bit), voice `casual_female`, running on
this Mac's GPU and streamed in 0.8 s pieces: first audio about 1.35 s after a sentence is
written, produced as fast as it plays. Chosen 15 Oct 2026 for personal use (CC BY-NC).
Kokoro `af_heart` takes over if Voxtral is down, the Mac's own voice if the bridge is.
Samples of all three female voices, the two cloned Jenny voices, and how to switch:
[[Petra Voices]]. Your speech is transcribed on this Mac with Parakeet TDT 0.6B on the GPU
(faster-whisper `small` as the fallback).

**The centre of the OS tab** is the agent constellation (`constellation.js`), which
replaced the decorative orb:
- Petra in the middle. Her aura moves with her voice, or yours while you talk. Click her
  to talk; the wave in the tab pill, left of OS, does the same. The hex field behind her
  warps while she speaks.
- The outer ring has the six department arcs, in the map's colours, and every agent in
  `Agents/` (see [[00 Agents Index]]) sits in its department's arc.
- When an agent is called, a copy flies in from the ring and orbits whoever called it,
  with the call drawn as a line and particles flowing from caller to callee. Called
  twice, it shows twice. An agent called by another agent orbits that agent. Small dots
  around a working copy are the files it has touched (bright: changed, pale: read).
  Finished copies show a tick, go home and fade.
- Click an agent, on the ring or in flight, and the Second Brain opens full screen on a
  live node for that agent, linked to every file its copies have read or changed, with
  the folders opened to show them. The links grow while it works.

**The caption** above the tab pill shows what you said and what Petra says, with a box to
type instead. Esc stops her. Chips left of the pill are the queued jobs; click a finished
one for its report.

**What voice may do.** Read anything; edit files inside the vault only; run brain recall,
the agent registry and read-only shell commands. Nothing is sent, posted or deleted by
voice. 18 gate cases tested on 15 Oct 2026.

**The queue.** Petra hands work to a background agent with `queue_agent` and keeps
talking. Each job is its own `claude -p --agent <id>` in the vault, two at a time, 30
minute cap, edits allowed inside the vault and nothing else unless the agent's definition
grants it. A job is not a chat: the chat-log hook stays quiet (`GTD_JOB=1`) and the status
hook reports under the agent's own name (`RUBRIC_AGENT_ID`). Every call, by Petra or by a
job, is tracked with its parent and its files, which is what the constellation draws.
"general" is always available.

**Agent Creator.** The `agent-creator` skill in `.claude/skills/`, by voice ("make me an
agent that...") or as `/agent-creator`. It writes `Agents/<id>.md` and runs
`node Installers/Robonuggets/tools/agents.mjs register <id>`, which adds the agent to the
console sidebar, the Agents tab and the Team tab; the constellation picks it up on its own.
First agent: **Case Study Logos** (Brand), made by voice on 15 Oct 2026 in
[[2026-10-15 - Scripting Feature Improvements]].

**Running.** launchd `com.gettruckdrivers.jarvis-bridge` on port 8790. Log and every job's
transcript: `~/Coding/jarvis/.gtd-jobs/`. Restart:
`launchctl kickstart -k gui/$(id -u)/com.gettruckdrivers.jarvis-bridge`.

## The brain: recall and store

`brain.js` was rewritten to read Obsidian rather than RoboNuggets' own `MEMORY.md` layout:

- **Recall** starts from [[00 Master Index]], [[00 Chat Index]] and [[00 Facts Index]],
  resolves `[[wiki links]]` and `[[Note\|alias]]` the way Obsidian does, matches filenames
  across the whole vault, and follows one link hop. No model call, about 20 ms. Rare
  words in the question count for more than common ones, each word counts once per note,
  and Facts Index lines win ties. Eleven test questions all land on the right note first.
  CLAUDE.md makes it the first lookup for any stored fact.
  `node Installers/Robonuggets/rubric-second-brain/brain.js recall "what does the learn keyword send"`
- **Store** writes one fact as a vault note in `Memory/Facts/`, Title Case filename and
  frontmatter, and files a `[[link]]` line in `00 Facts Index`. The first store creates
  the folder and its index and adds the index's row to [[00 Master Index]] in the same
  step. CLAUDE.md makes it the default way to save a fact.
  `node Installers/Robonuggets/rubric-second-brain/brain.js store "fact" --type feedback --name short-slug --desc "index line" --why "..." --how "..."`
  Four facts were copied in on 15 Oct 2026 from Claude's own memory folder, which still
  holds the originals.

Departments on the map, set by Luke on 15 Oct 2026: six of them. A department is only a label on the
map; no note moves.

- **Brand** (pink): `Brand/`. Brand guidelines, graphics and video examples and templates,
  design systems. Holds one PDF so far.
- **Content** (blue): everything in `Content/` (scripts, posted transcripts, analytics,
  reports, plans, stories, newsletters), `Dashboards/`, and the CTA notes in
  `Memory/Call To Actions/`.
- **Scripting** (yellow): the rules and system for writing, [[Writing Instagram Content]],
  [[Writing Instagram Captions]], [[Writing Instagram Stories]] and
  [[Instagram Script Writing]]. CTAs and scripts stay in Content; each of these notes
  links to them under Related.
- **GTD** (green): everything in `GTD/`, currently [[00 Efficiency Index|Efficiency]].
- **Luke** (orange): everything in `Luke/`, the scorecard and responsibilities.
- **Memory** (purple): the rest of `Memory/` (chats, other automations, facts, skills), plus
  `Installers/` and anything else. The catch-all.

Rules are in `rubric-second-brain/config/departments.json`. Path rules apply first, so a
single note inside `Memory/` can belong to another department.

## Generated, do not hand-edit

`rubric-agentic-os/tools/vault-feeds.js` rebuilds these every 10 minutes while the OS runs:

- `snapshots/routines.json` and `snapshots/gtd-crons.json`, from the `com.gettruckdrivers.*`
  launchd jobs and the cloud routine. The cloud routine reads as paused because
  [[Weekly Content Slack Post]] says `status: paused`.
- `snapshots/stats.json`, reels posted this month, posting days and average completion,
  dated by the notes' `measured:` field.
- `artifacts/vault-*.html`, links to the vault's HTML. A dashboard whose folder has a
  `serve.py`, like the organic leads dashboard, opens through that server instead.

## Changed from the shipped kits

- **Security, Agentic OS.** The shipped server sent `Access-Control-Allow-Origin: *` and
  passed `/api/open` input straight into a shell `open` command, so any website open in
  the browser could run commands on this Mac. Fixed: no CORS header, no shell, and POSTs
  must be JSON from localhost.
- **Agentic OS:** right-click REMOVE on the ring was documented but never implemented;
  added. The three sample balls are in `artifacts/_trash`.
- **Second Brain:** "open file" only worked on Windows; it now opens Markdown in Obsidian
  on the Mac. It also sleeps when hidden behind the OS, and takes its size from the OS
  through `_embed.js`.
- **Agentic OS:** the orb used to open the brain full screen with no visible way back;
  replaced by the round window and tabs above. Original kept as `.dashboard.original.html`.
- **Rubric:** the `rubric` folder copied into the vault had only 4 of its 82 files. It
  was re-extracted from `~/Downloads/robonuggets-rubric.zip`.
- **Rubric:** Flows can open `vault/...` notes as their docs; the team scan skips
  `.trash`.
- Originals of every patched server are kept beside them as `.server.original.js` and
  `.brain.original.js`.
- **Agentic OS, local apps:** apps launched from the OS used to inherit the server's
  `PORT=50000`, so a Next.js app (the Onboarding Form) tried to take the OS's own port.
  Each app is now given its own port in `PORT`. Found and fixed 19 Oct 2026.

## Hooks added to `.claude/settings.json`

`.claude/hooks/rubric-status.sh` reports this vault's Claude session to the Rubric
sidebar: active on each prompt, idle when a turn or session ends. It runs in the
background with a 2 second timeout and does nothing when the console is off.

## Open items

- **Calendar** shows a one-off snapshot of 16 to 22 October. Live sync needs the
  one-time Google sign-in in `rubric-agentic-os/OAUTH.md`.
- **Email** widget is not wired: it needs a `gws` CLI, which is not installed.
- **Skills deck** is empty on purpose. Each card runs a headless Claude session with
  permission prompts bypassed.

## Related
- [[Petra Voices]] — the three Voxtral voices to compare, and how to change hers
- [[00 Master Index]] — the routing table for the vault
- [[2026-10-14 - RoboNuggets Animate Skill Source]] — the earlier RoboNuggets chat
