/**
 * GTD: Petra's text chat in the Agentic OS (20 Oct 2026).
 *
 * The keyboard way to talk to Petra. It is a full Claude Code session, not the voice
 * session: the installed CLI, started in the vault, with Luke's own settings
 * (~/.claude: model, permissions, memory, MCP servers), the vault's CLAUDE.md, hooks,
 * skills and agents, and slash commands. What the terminal asks with a prompt, this asks
 * with buttons in the chat: tool permissions (Allow, Always allow, Deny), Claude's
 * multiple-choice questions, and plan approval. Petra's gtd tools are added so she can
 * queue background agents from here too.
 *
 * Tabs (22 Oct 2026): Luke can have several chats with Petra open at once. Each tab is
 * its own Claude Code session with its own log, permission mode and prompts, and they run
 * side by side. The bridge owns them, so the OS page can reload (it does after every
 * resize) and every tab carries on. Open tabs, their logs and session ids are kept on disk
 * (.gtd-jobs/chat-tabs.json) and replayed to every page; a bridge restart resumes each
 * session. Closing a tab ends its session; the chat stays in history. A manager reports to
 * the tab that started it, and reopens it if Luke had closed it.
 *
 * Subagents: every Agent-tool call made here becomes an instance in gtd.mjs's activity
 * graph (the constellation draws it) and keeps its own transcript there, which the OS
 * shows when Luke clicks it.
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as gtd from './gtd.mjs'
import * as managers from './managers.mjs'

const DIR = join(homedir(), 'Coding/jarvis/.gtd-jobs')
const LOG_FILE = join(DIR, 'chat-log.json')          // before tabs: one chat; read once to carry it over
const TABS_FILE = join(DIR, 'chat-tabs.json')
const IMG_DIR = join(DIR, 'chat-images')
/* history: every Petra chat is kept. HIST_DIR holds the chat as the panel showed it, one file
   per Claude Code session; chats from before that (or lost from the panel) are rebuilt from
   Claude Code's own transcript in PROJECT_DIR. */
const HIST_DIR = join(DIR, 'chat-history')
const PROJECT_DIR = join(homedir(), '.claude/projects', gtd.VAULT.replace(/[^A-Za-z0-9]/g, '-'))
const RESUME_MS = 12 * 3600 * 1000
const ROOT = 'petra'                     // the chat's own top level, as the activity graph knows Petra

const CHAT_RULES = `
# You are Petra, in text

Your name is Petra: the main agent of Luke's GTD vault, the one he talks to and the one
who hands work to the other agents. This conversation is typed, in the chat panel of the
Agentic OS, and Luke reads your replies on screen. Nothing is read aloud, so write as you
would in the terminal: clear, direct, markdown where it helps, no filler, never "sir".

Everything Claude Code can do, you can do here, with Luke's normal permissions: he
approves anything that needs approval with buttons in the chat. The vault's CLAUDE.md
and its automations apply as they always do, including Chat Logging.

## You manage managers

Luke must always be able to talk to you, so keep your own turns short. Any piece of real
work that takes more than a minute goes to a manager: a clone of you that works on it in
the background, with mcp__petra__start_manager. Write a complete brief (goal, what is
decided, constraints, where things go, what to report). Reply to Luke in a line that it
is started. Several managers can run at once, each on its own piece.

You are the hub between them. They can read the team board, ask you questions and
message each other through you. When a message arrives that starts with "[Manager",
it is from one of them, not Luke:
- a question: answer it with mcp__petra__reply_manager (question id like q3) if you can;
  if only Luke can decide, ask him in one line and answer once he replies.
- a finished report: tell Luke in a line or two what it did and where, and if another
  manager needs that output, pass it on with mcp__petra__message_manager.
Use mcp__petra__managers to see them all. When two managers' work touches (graphics and
the website layout, say), keep each told of what the other decided.

When several managers change one deliverable, mark the file they all end up in as
official (start_manager's \`official\`, or mcp__petra__set_official). Each manager then
drafts its piece in its own .work/ folder and merges into the official file one at a time
through claim_file and release_file; the bridge blocks any other write. Claims and queues
show in mcp__petra__managers, and mcp__petra__release_claims frees a stuck one.

Background agents from Agents/ (mcp__gtd__queue_agent) are still there for the specialist
jobs they were made for, and the Agent tool for quick subagents in this turn.

## Voice

A message that starts with "(Voice)" was spoken by Luke and your reply is read aloud:
start it with one or two plain spoken sentences, no markdown in them; anything longer
(lists, tables, paths) can follow below, where he reads it.

## When the work is finished, say what there is to see

The Voice Agent (what Luke talks to through ⌃⌥) announces this chat when its work is done
and offers to walk him through the result on screen. So when a piece of work is finished
and there is something to look at, end your final reply with one line it reads:
[RESULT: path=<the vault path of the page, note or image, or the URL> | what=<what it is, in a few words, as it looks on screen> | view=<page, note, image or chrome>]
A plain answer, a plan or a confirmation gets no RESULT line; then it only tells him you
are done.
`

// starts in auto mode, as Luke's terminal does; each tab's mode chip cycles it like shift+tab
const MODES = ['auto', 'default', 'acceptEdits', 'plan']
const tabs = new Map()                   // id -> tab: { id, state, log, info, mode, open, created }
let order = []                           // the open tabs, in the order the bar shows them
let commands = []
const listeners = new Set()
const perms = new Map()                  // toolUseID -> { resolve, input, suggestions, tab }
let saveTimer = null

export const onChat = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const broadcast = (ev) => { for (const fn of listeners) { try { fn(ev) } catch {} } }
function emit(t, ev, keep = true) {
  ev.at = ev.at || Date.now(); ev.tab = t.id
  if (keep) { t.log.push(ev); if (t.log.length > 900) t.log.splice(0, t.log.length - 900); scheduleSave() }
  broadcast(ev)
  if (keep && ev.k === 'user') pushTabs()           // a first message names the tab
}

function newTab(init = {}) {
  const id = 't' + Date.now().toString(36) + randomBytes(2).toString('hex')
  const t = { id, state: null, log: init.log || [], info: init.info || {}, mode: init.mode || 'auto', open: true, created: init.created || Date.now() }
  tabs.set(id, t); order.push(id)
  return t
}
const titleOf = (t) => {
  if (t.summary) return t.summary
  const u = t.log.find((e) => e.k === 'user' && e.text)
  return u ? u.text.replace(/\s+/g, ' ').slice(0, 160) : 'New chat'
}

/* ---------- tab names: what the chat is doing now, not its first message (30 Oct 2026) ----------
   A one-shot Haiku call reads the last stretch of the chat and names it in a few words. It runs
   when Luke sends a message (the new request) and when Petra finishes a reply (what came of it).
   No tools, no settings or hooks, no transcript saved, so it never shows in chat history. */
const SUM_MODEL = process.env.GTD_SUMMARY_MODEL || 'claude-haiku-4-5-20251001'
const SUM_DIR = join(DIR, 'summaries')
const SUM_RULES = `You name a tab in a chat app. Reply with only the name: a summary of what is being worked on in this chat right now, 3 to 9 words, sentence case, no full stop, no quotes, no emoji.
Weigh the most recent messages most: the name says what the chat is doing now, not how it started. Use the project, page or file names the chat uses. Start with a verb in -ing form when work is under way ("Building the Alpha Carrier products page"), or name the topic when it is a question or a finished piece ("Petra tab titles and hover pop-out").`
const summing = new Set()
function digest(t) {
  const out = []; let chars = 0
  for (let i = t.log.length - 1; i >= 0 && chars < 6000; i--) {
    const e = t.log[i]; let line = null
    if (e.k === 'user' && e.text) line = 'Luke: ' + e.text.slice(0, 1200)
    else if (e.k === 'text' && e.text) line = 'Petra: ' + e.text.slice(0, 700)
    else if (e.k === 'tool') line = `(Petra used ${e.name}${e.summary ? ': ' + e.summary : ''})`.slice(0, 160)
    else if (e.k === 'mgr' && e.title) line = `(manager "${e.title}": ${e.kind})`
    if (line) { out.unshift(line); chars += line.length }
  }
  return out.join('\n')
}
async function summarize(t) {
  if (!t.log.some((e) => e.k === 'user' && e.text)) return
  if (summing.has(t.id)) { t.sumAgain = true; return }
  summing.add(t.id)
  try {
    mkdirSync(SUM_DIR, { recursive: true })
    const env = cleanEnv(); delete env.CLAUDE_CODE_ENABLE_CFC; delete env.CLAUDE_CODE_ARTIFACT
    env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'          // no connectors to load: about 1.7 s a name
    const q = query({
      prompt: `${t.summary ? `The tab is named "${t.summary}" now; keep that name if it still fits.\n\n` : ''}The chat, oldest first:\n${digest(t)}`,
      options: { cwd: SUM_DIR, pathToClaudeCodeExecutable: gtd.CLAUDE_BIN, model: SUM_MODEL, systemPrompt: SUM_RULES,
        settingSources: [], tools: [], maxTurns: 1, persistSession: false,
        mcpServers: {}, strictMcpConfig: true, thinking: { type: 'disabled' }, env },   // thinking made it 20 to 45 s
    })
    let out = ''
    for await (const m of q) if (m.type === 'result' && m.subtype === 'success') out = m.result || ''
    out = out.split('\n')[0].replace(/^[\s"'“”*#-]+|[\s"'“”*.]+$/g, '').replace(/\s+/g, ' ').slice(0, 90)
    if (out && tabs.has(t.id) && out !== t.summary) { t.summary = out; scheduleSave(); pushTabs() }
  } catch (err) { console.log('[chat] tab summary failed:', String(err?.message || err).slice(0, 200)) }
  finally {
    summing.delete(t.id)
    if (t.sumAgain) { t.sumAgain = false; void summarize(t) }
  }
}
/* ---------- tab colours (4 Nov 2026) ----------
   One state per tab, most urgent first, for the tab bar:
     failed    red     the last turn failed, or a manager it started failed, since Luke last wrote
     question  yellow  waiting on Luke: a permission or question card, a manager question nobody
                       has answered for 30 s, or Petra's finished reply ends asking him something
     working   orange  Petra is replying, or a manager this tab started is queued, working or waiting
     done      green   it finished something Luke has not looked at yet (the page sends chat-seen)
     ''                nothing to say */
function tabState(t) {
  let lu = -1
  for (let i = t.log.length - 1; i >= 0; i--) if (t.log[i].k === 'user') { lu = i; break }
  const since = lu >= 0 ? t.log[lu].at || 0 : 0
  const after = t.log.slice(lu + 1)
  const mine = managers.listManagers().filter((m) => managers.tabOf(m.id) === t.id)
  const busy = !!t.state?.busy
  const working = busy || mine.some((m) => m.status === 'working' || m.status === 'waiting' || m.status === 'queued')
  const lastDone = [...after].reverse().find((e) => e.k === 'done' || e.k === 'error')
  const stopped = t.stoppedAt && lastDone && t.stoppedAt <= (lastDone.at || 0) && t.stoppedAt >= since
  const turnFailed = !busy && lastDone && !stopped && (lastDone.k === 'error' || lastDone.ok === false)
  const mgrFailed = mine.some((m) => m.status === 'failed' && (m.ended || 0) > since)
  if (turnFailed || mgrFailed) return 'failed'
  const perm = [...perms.values()].some((p) => p.tab === t.id)
  const mgrAsk = managers.openQuestions().some((q) => managers.tabOf(q.id) === t.id && Date.now() - q.at > 30_000)
  const lastText = !busy && [...after].reverse().find((e) => e.k === 'text')
  const asks = lastText && /\?\s*$/.test(String(lastText.text).trim().split('\n').filter((l) => l.trim()).pop() || '')
  if (perm || mgrAsk || asks) return 'question'
  if (working) return 'working'
  if ((t.doneAt || 0) > (t.seenAt || 0)) return 'done'
  return ''
}
export function chatSeen(id) {
  const t = tabs.get(id); if (!t) return
  if ((t.doneAt || 0) <= (t.seenAt || 0)) { t.seenAt = Date.now(); return }
  t.seenAt = Date.now(); scheduleSave(); pushTabs()
}
/* a manager's question goes yellow after 30 s unanswered: look again then */
setInterval(() => { if (managers.openQuestions().some((q) => Date.now() - q.at > 30_000 && Date.now() - q.at < 45_000)) pushTabs() }, 15_000)
export function chatTabs() {
  return order.map((id) => tabs.get(id)).filter(Boolean).map((t) => ({ id: t.id, title: titleOf(t), busy: !!t.state?.busy, session: t.info.session || null, state: tabState(t) }))
}
function pushTabs(focus) { broadcast({ k: 'tabs', tabs: chatTabs(), focus: focus || null, at: Date.now() }) }
function syncPetra() { gtd.setPetra([...tabs.values()].some((t) => t.state?.busy) ? 'thinking' : 'idle') }

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const open = order.map((id) => tabs.get(id)).filter(Boolean)
    try {
      mkdirSync(DIR, { recursive: true })
      writeFileSync(TABS_FILE, JSON.stringify({ savedAt: Date.now(), commands, order,
        tabs: Object.fromEntries(open.map((t) => [t.id, { session: t.info.session || null, mode: t.mode, created: t.created, summary: t.summary || null, doneAt: t.doneAt || 0, seenAt: t.seenAt || 0, log: t.log }])) }))
    } catch {}
    for (const t of tabs.values()) {
      if (!t.info.session || !t.log.some((e) => e.k === 'user')) continue
      try { mkdirSync(HIST_DIR, { recursive: true }); writeFileSync(join(HIST_DIR, t.info.session + '.json'), JSON.stringify({ id: t.info.session, savedAt: Date.now(), log: t.log })) } catch {}
    }
  }, 400)
}
// a permission still pending when the bridge stopped can never be answered now
const staleOut = (log) => (log || []).map((e) => (e.k === 'perm' && !log.some((x) => x.k === 'perm-done' && x.id === e.id) ? { ...e, stale: true } : e))
function restore() {
  try {
    const d = JSON.parse(readFileSync(TABS_FILE, 'utf8'))
    commands = d.commands || []
    for (const id of d.order || []) {
      const x = d.tabs?.[id]; if (!x) continue
      const t = { id, state: null, log: staleOut(x.log), info: x.session ? { session: x.session, resumed: true } : {}, mode: x.mode || 'auto', open: true, created: x.created || Date.now(), summary: x.summary || null, doneAt: x.doneAt || 0, seenAt: x.seenAt || 0 }
      tabs.set(id, t); order.push(id)
    }
  } catch {
    // carry the single chat from before tabs over as the first tab
    try {
      const d = JSON.parse(readFileSync(LOG_FILE, 'utf8'))
      commands = d.commands || []
      newTab({ log: staleOut(d.log), info: d.session ? { session: d.session, resumed: true } : {} })
    } catch {}
  }
  if (!order.length) newTab()
  scheduleSave()                         // the tab list exists on disk from the start, so tab ids stay put
  // tabs from before summaries get theirs, one at a time
  const unnamed = order.map((id) => tabs.get(id)).filter((t) => t && !t.summary && t.log.some((e) => e.k === 'user'))
  unnamed.forEach((t, i) => setTimeout(() => void summarize(t), 4000 + i * 2500))
}

/* what Luke and Petra said in a manager's own tab, for its read_petra_chat */
function chatTail(limit, managerId) {
  const t = tabFor(managers.tabOf(managerId), false)
  const out = []
  if (!t) return out
  for (let i = t.log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = t.log[i]
    if (e.k === 'user') out.unshift('Luke: ' + e.text)
    else if (e.k === 'text') out.unshift('Petra: ' + e.text)
    else if (e.k === 'mgr' && (e.kind === 'finished' || e.kind === 'question')) out.unshift(`[${e.title}] ${e.kind}: ${e.text}`)
  }
  return out
}

/** the tab a manager reports to: reopened if Luke closed it; the first open tab if it is gone */
function tabFor(id, reopen = true) {
  const t = id && tabs.get(id)
  if (t) {
    if (!t.open && reopen) { t.open = true; order.push(t.id); scheduleSave(); pushTabs() }
    return t
  }
  return tabs.get(order[0]) || (reopen ? (newTab(), pushTabs(), tabs.get(order[0])) : null)
}

/* a permission, question or plan for Luke, from Petra or one of her managers, in that tab */
export function askLuke(t, who, toolName, input, opts = {}) {
  return new Promise((resolve) => {
    const id = opts.toolUseID || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))
    perms.set(id, { resolve, input, suggestions: opts.suggestions || [], tab: t.id })
    setTimeout(pushTabs, 50)
    emit(t, {
      k: 'perm', id, tool: gtd.toolLabel(toolName), raw: toolName, who: who || null,
      title: opts.title || '', summary: gtd.toolSummary(toolName, input), description: opts.description || '',
      reason: opts.decisionReason || '', agent: opts.agentID ? 'subagent' : null,
      canAlways: !!(opts.suggestions && opts.suggestions.length),
      questions: toolName === 'AskUserQuestion' ? (input.questions || []) : null,
      plan: toolName === 'ExitPlanMode' ? String(input.plan || '') : null,
      input: trimInput(input),
    })
    opts.signal?.addEventListener('abort', () => {
      if (!perms.has(id)) return
      perms.delete(id); setTimeout(pushTabs, 50); emit(t, { k: 'perm-done', id, outcome: 'cancelled' })
      resolve({ behavior: 'deny', message: 'Cancelled.' })
    })
  })
}

/* managers report to the Petra that started them: a card in her tab, and for questions and
   reports a message to her */
managers.setHooks({
  chatTail,
  askPermission: (who, name, input, opts) => askLuke(tabFor(managers.tabOf(who?.id)), who, name, input, opts),
  notify(ev) {
    const t = tabFor(managers.tabOf(ev.id))
    emit(t, { k: 'mgr', ...ev })
    if (ev.kind === 'finished' || ev.kind === 'failed') t.doneAt = Date.now()
    if (ev.kind !== 'update') setTimeout(pushTabs, 50)      /* its tab's colour follows the manager */
    if (ev.kind === 'question') inject(t, `[Manager "${ev.title}" (${ev.id}) asks, question ${ev.qid}] ${ev.text}`)
    else if (ev.kind === 'finished') inject(t, `[Manager "${ev.title}" (${ev.id}) finished. Its report:]\n${ev.text}`)
    else if (ev.kind === 'failed') inject(t, `[Manager "${ev.title}" (${ev.id}) failed:] ${ev.text}`)
  },
})

export function chatHistory(id) {
  const t = tabs.get(id) || tabs.get(order[0])
  if (!t) return { tab: null, log: [], info: {}, commands, busy: false }
  return { tab: t.id, title: titleOf(t), log: t.log, info: { ...t.info, permissionMode: t.mode }, commands, busy: !!t.state?.busy, managers: managers.listManagers() }
}

function cleanEnv() {
  const env = { ...process.env }
  for (const k of ['GTD_VOICE', 'GTD_JOB', 'RUBRIC_AGENT_ID', 'JARVIS_MODE', 'JARVIS_MODEL', 'JARVIS_EFFORT',
    'JARVIS_ALLOWED_ORIGINS', 'JARVIS_BRIDGE_PORT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k]
  /* GTD (21 Oct 2026): the CLI withholds its Artifact tool from SDK sessions
     ("sdk_default_off") unless this is set, so Petra and her managers can publish
     claude.ai artifacts like the plain CLI does */
  env.CLAUDE_CODE_ARTIFACT = '1'
  /* GTD (26 Oct 2026): load the Claude in Chrome browser tools in SDK sessions, like `claude --chrome` */
  env.CLAUDE_CODE_ENABLE_CFC = '1'
  return env
}

const trimInput = (input) => { try { const s = JSON.stringify(input, null, 1); return s.length > 4000 ? s.slice(0, 4000) + '…' : s } catch { return '' } }
const cmdList = (c) => (c || []).map((x) => ({ name: x.name, description: x.description, hint: x.argumentHint }))

function start(t) {
  const s = { inbox: [], deliver: null, closed: false, busy: false, q: null }
  async function* messages() {
    while (!s.closed) {
      const content = s.inbox.shift() ?? (await new Promise((r) => { s.deliver = r }))
      if (s.closed || content == null) return
      // a string, or blocks (photos, then the text) when Luke attached images
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    }
  }
  s.q = query({
    prompt: messages(),
    options: {
      cwd: gtd.VAULT,
      pathToClaudeCodeExecutable: gtd.CLAUDE_BIN,
      // all of Claude Code's own settings, the same as the terminal: model, permissions,
      // memory, MCP servers (user and project), the vault's CLAUDE.md, hooks, skills, agents
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: CHAT_RULES },
      mcpServers: { gtd: gtd.gtdServer(), petra: managers.petraServer(t.id) },
      includePartialMessages: true,
      canUseTool: (toolName, input, opts) => askLuke(t, null, toolName, input, opts),
      permissionMode: t.mode,
      env: cleanEnv(),
      ...(t.info.session ? { resume: t.info.session } : {}),
    },
  })
  t.state = s
  void pump(t, s)
  // the slash commands, before the first message, so / lists them straight away
  if (!commands.length) s.q.supportedCommands().then((c) => { if (c?.length) { commands = cmdList(c); broadcast({ k: 'commands', list: commands }); scheduleSave() } }).catch(() => {})
  return s
}

/** warm a tab's session if the command list is still unknown */
export function chatEnsure(id) {
  const t = tabs.get(id) || tabs.get(order[0])
  if (t && !t.state && !commands.length) start(t)
}

/** a message to Petra that is not from Luke (a manager's question or report) */
function inject(t, text) {
  if (!t.state) start(t)
  t.state.busy = true; syncPetra()
  emit(t, { k: 'status', busy: true }, false); pushTabs()
  if (t.state.deliver) { const d = t.state.deliver; t.state.deliver = null; d(text) } else t.state.inbox.push(text)
}

async function pump(t, s) {
  try {
    for await (const msg of s.q) {
      if (s !== t.state) break
      switch (msg.type) {
        case 'system':
          gtd.trackTask(msg, ROOT)      // Petra's background helpers stay on the OS until they settle
          if (msg.subtype === 'init') {
            t.info = { model: msg.model, cwd: msg.cwd, session: msg.session_id, permissionMode: msg.permissionMode || t.mode,
              mcp: (msg.mcp_servers || []).map((x) => ({ name: x.name, status: x.status })), tools: (msg.tools || []).length }
            emit(t, { k: 'info', ...t.info }, false)
            scheduleSave(); pushTabs()
            s.q.supportedCommands().then((c) => { if (c?.length) { commands = cmdList(c); broadcast({ k: 'commands', list: commands }) } }).catch(() => {})
          } else if (msg.subtype === 'compact_boundary') emit(t, { k: 'note', text: 'Conversation compacted.' })
          break
        case 'stream_event': {
          if (msg.parent_tool_use_id) break
          const ev = msg.event
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit(t, { k: 'delta', text: ev.delta.text }, false)
          else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'thinking') emit(t, { k: 'thinking' }, false)
          break
        }
        case 'assistant': {
          const blocks = msg.message?.content || []
          for (const b of blocks) if (b.type === 'tool_use') gtd.trackToolUse(gtd.ownerOf(msg.parent_tool_use_id, ROOT), b)
          if (msg.parent_tool_use_id) { gtd.recordStream(ROOT, msg, true); break }
          for (const b of blocks) {
            if (b.type === 'text' && b.text?.trim()) emit(t, { k: 'text', text: b.text })
            else if (b.type === 'tool_use') {
              const sub = b.name === 'Agent' || b.name === 'Task'
              emit(t, { k: 'tool', id: b.id, name: gtd.toolLabel(b.name), summary: gtd.toolSummary(b.name, b.input), input: trimInput(b.input), sub,
                agent: sub ? (b.input?.subagent_type || 'general-purpose') : undefined })
            }
          }
          break
        }
        case 'user': {
          const blocks = Array.isArray(msg.message?.content) ? msg.message.content : []
          for (const b of blocks) if (b?.type === 'tool_result') gtd.trackToolResult(b)
          if (msg.parent_tool_use_id) { gtd.recordStream(ROOT, msg, true); break }
          for (const b of blocks) if (b?.type === 'tool_result') {
            const x = typeof b.content === 'string' ? b.content : (b.content || []).map((y) => y?.text || '').join('\n')
            emit(t, { k: 'result', id: b.tool_use_id, ok: b.is_error !== true, preview: x.length > 1500 ? x.slice(0, 1500) + '…' : x })
          }
          break
        }
        case 'result':
          s.busy = false; syncPetra(); t.doneAt = Date.now(); pushTabs(); void summarize(t)
          emit(t, { k: 'done', ok: msg.subtype === 'success', subtype: msg.subtype, cost: msg.total_cost_usd ?? null, ms: msg.duration_ms ?? null, turns: msg.num_turns ?? null })
          break
      }
    }
  } catch (err) {
    if (s === t.state) { s.busy = false; emit(t, { k: 'error', text: String(err?.message || err).slice(0, 600) }) }
  }
  if (s === t.state) { t.state = null; syncPetra(); emit(t, { k: 'status', busy: false }, false); pushTabs() }
}

const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
/* photos Luke pasted or dropped: kept as files (so a manager or subagent can Read them),
   and sent to Petra as image blocks before his text */
function takeImages(images) {
  const out = []
  if (!Array.isArray(images)) return out
  mkdirSync(IMG_DIR, { recursive: true })
  for (const im of images.slice(0, 20)) {
    const ext = IMG_TYPES[im?.type]
    if (!ext || typeof im.data !== 'string' || im.data.length > 14_000_000) continue
    const file = join(IMG_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.${ext}`)
    try { writeFileSync(file, Buffer.from(im.data, 'base64')) } catch { continue }
    out.push({ type: im.type, data: im.data, file, name: String(im.name || '').slice(0, 120), thumb: typeof im.thumb === 'string' && im.thumb.length < 60_000 ? im.thumb : null })
  }
  return out
}

export function chatSend(id, text, display, voice, images) {
  const t = tabs.get(id); if (!t) return
  text = String(text || '').trim()
  const imgs = takeImages(images)
  if (!text && !imgs.length) return
  if (!imgs.length && /^\/clear\s*$/.test(text)) return chatClear(id)
  if (!t.state) start(t)
  emit(t, { k: 'user', text: String(display ?? text), voice: !!voice, thumbs: imgs.map((i) => i.thumb).filter(Boolean), files: imgs.map((i) => i.file) })
  t.state.busy = true; syncPetra(); gtd.touchSession()
  emit(t, { k: 'status', busy: true }, false); pushTabs(); void summarize(t)
  let content = text
  if (imgs.length) {
    const where = `(${imgs.length} image${imgs.length > 1 ? 's' : ''} attached above, also saved as ${imgs.map((i) => i.file).join(', ')}. Hand those paths to any manager or subagent that needs to see them.)`
    content = [...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.type, data: i.data } })),
      { type: 'text', text: (text || 'Here are some images.') + '\n\n' + where }]
  }
  if (t.state.deliver) { const d = t.state.deliver; t.state.deliver = null; d(content) } else t.state.inbox.push(content)
}

export async function chatSetMode(id, m) {
  const t = tabs.get(id); if (!t || !MODES.includes(m)) return
  t.mode = m
  try { if (t.state?.q) await t.state.q.setPermissionMode(m) } catch {}
  t.info = { ...t.info, permissionMode: m }
  emit(t, { k: 'info', ...t.info }, false)
  scheduleSave()
}

export async function chatStop(id) {
  const st = tabs.get(id); if (st) st.stoppedAt = Date.now()     /* a stopped reply is not a failure */
  try { await tabs.get(id)?.state?.q?.interrupt() } catch {}
}

/** end a tab's session (it stays in history) */
function endSession(t, why) {
  for (const [pid, p] of perms) if (p.tab === t.id) { p.resolve({ behavior: 'deny', message: why }); perms.delete(pid) }
  if (t.state) { const s = t.state; s.closed = true; s.deliver?.(null); try { s.q?.interrupt() } catch {} }
  t.state = null
}

/** /clear: the same tab, a fresh chat */
export function chatClear(id) {
  const t = tabs.get(id); if (!t) return
  endSession(t, 'New chat.')
  t.log = []; t.info = {}; t.summary = null
  managers.clearFinished(t.id)
  scheduleSave(); syncPetra()
  emit(t, { k: 'reset' }, false); pushTabs()
}
export const chatNew = chatClear

/** a new tab, with a fresh chat */
export function chatNewTab() {
  const t = newTab()
  scheduleSave(); pushTabs(t.id)
  return t.id
}

/** close a tab: its session ends, its chat stays in history; the last tab is never left empty */
export function chatCloseTab(id) {
  const t = tabs.get(id); if (!t || !t.open) return
  endSession(t, 'Tab closed.')
  t.open = false; order = order.filter((x) => x !== id)
  if (![...managers.listManagers()].some((m) => managers.tabOf(m.id) === id && (m.status === 'working' || m.status === 'waiting' || m.status === 'queued'))) tabs.delete(id)
  if (!order.length) newTab()
  scheduleSave(); syncPetra(); pushTabs(order[order.length - 1])
}

/** open a past chat in a tab (or go to its tab if it is already open); Claude Code resumes it */
export function chatOpenSession(sessionId) {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) return null
  const already = order.map((id) => tabs.get(id)).find((t) => t?.info.session === sessionId)
  if (already) { pushTabs(already.id); return already.id }
  const t = newTab({ log: chatSessionLog(sessionId).slice(), info: { session: sessionId, resumed: true } })
  scheduleSave(); pushTabs(t.id)
  return t.id
}
export const chatResume = chatOpenSession

/** Luke answered a permission prompt, a question or a plan */
export function chatPermReply({ id, allow, always, answers }) {
  const p = perms.get(id)
  if (!p) return
  perms.delete(id); setTimeout(pushTabs, 50)
  const t = tabs.get(p.tab)
  if (allow) {
    const updatedInput = answers && typeof answers === 'object' ? { ...p.input, answers } : p.input
    p.resolve({ behavior: 'allow', updatedInput, ...(always && p.suggestions.length ? { updatedPermissions: p.suggestions } : {}) })
    if (t) emit(t, { k: 'perm-done', id, outcome: always ? 'always' : answers ? 'answered' : 'allowed' })
  } else {
    p.resolve({ behavior: 'deny', message: 'Luke declined this in the chat.' })
    if (t) emit(t, { k: 'perm-done', id, outcome: 'denied' })
  }
}

// open tabs survive a bridge restart; each session resumes on its first message
if (gtd.GTD) restore()

/* Luke, from the chat: answer a manager's question, message a manager, or stop one */
export const mgrReply = (qid, text) => managers.answerQuestion(qid, text, 'Luke')
export const mgrMessage = (id, text) => managers.messageManager(id, text, 'Luke')
export const mgrStop = (id) => managers.stopManager(id)

/* ------------------------------------------------------------ history */
const plainUser = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '')
const isNoise = (t) => !t || /^<(local-command|command-name|command-message|system-reminder)/.test(t.trim()) || /^\[Request interrupted/.test(t.trim())

/** one transcript, read once per change: its title, when, how long, whether it is Petra's chat */
const metaCache = new Map()
function transcriptMeta(file) {
  let st; try { st = statSync(file) } catch { return null }
  const hit = metaCache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit.meta
  let title = null, first = null, sdk = false, petra = false, manager = false, count = 0, started = null
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue
      let d; try { d = JSON.parse(line) } catch { continue }
      if (d.entrypoint && d.entrypoint.startsWith('sdk')) sdk = true
      if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle
      if (!started && d.timestamp) started = Date.parse(d.timestamp)
      if (d.type === 'user' && !d.isSidechain) {
        const t = plainUser(d.message?.content)
        if (/^\[Manager|^\(Voice\)/.test(t)) petra = true
        if (!isNoise(t)) { count++; if (!first) first = t }
      }
      if (d.type === 'assistant') for (const b of d.message?.content || []) {
        if (b.type === 'tool_use' && String(b.name).startsWith('mcp__petra__')) petra = true
        if (b.type === 'tool_use' && String(b.name).startsWith('mcp__team__')) manager = true
      }
    }
  } catch { return null }
  const meta = { sdk, petra, manager, title, first, count, started, updated: st.mtimeMs }
  metaCache.set(file, { mtime: st.mtimeMs, meta })
  return meta
}

/** every Petra chat, newest first */
export function chatSessions() {
  const seen = new Map()
  let saved = []; try { saved = readdirSync(HIST_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) } catch {}
  let all = []; try { all = readdirSync(PROJECT_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)) } catch {}
  for (const id of new Set([...saved, ...all])) {
    const meta = transcriptMeta(join(PROJECT_DIR, id + '.jsonl'))
    const isSaved = saved.includes(id)
    // Petra's chats: saved by the panel, or an SDK session that used her manager tools or voice
    if (!isSaved && !(meta && meta.sdk && meta.petra && !meta.manager)) continue
    let snap = null
    if (isSaved) { try { snap = JSON.parse(readFileSync(join(HIST_DIR, id + '.json'), 'utf8')) } catch {} }
    const firstUser = snap?.log?.find((e) => e.k === 'user')?.text
    seen.set(id, {
      id, current: order.some((tid) => tabs.get(tid)?.info.session === id), tab: order.find((tid) => tabs.get(tid)?.info.session === id) || null,
      title: (meta?.title || firstUser || meta?.first || 'Untitled chat').replace(/\s+/g, ' ').slice(0, 90),
      preview: String(firstUser || meta?.first || '').replace(/\s+/g, ' ').slice(0, 140),
      count: snap ? snap.log.filter((e) => e.k === 'user').length : meta?.count || 0,
      updated: Math.max(meta?.updated || 0, snap?.savedAt || 0), started: meta?.started || null,
    })
  }
  return [...seen.values()].sort((a, b) => b.updated - a.updated)
}

/** a past chat's log: as the panel showed it if saved, else rebuilt from the transcript */
export function chatSessionLog(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return []
  const open = [...tabs.values()].find((t) => t.info.session === id)
  if (open) return open.log
  try { return JSON.parse(readFileSync(join(HIST_DIR, id + '.json'), 'utf8')).log || [] } catch {}
  const out = []
  try {
    for (const line of readFileSync(join(PROJECT_DIR, id + '.jsonl'), 'utf8').split('\n')) {
      if (!line) continue
      let d; try { d = JSON.parse(line) } catch { continue }
      if (d.isSidechain) continue
      const at = d.timestamp ? Date.parse(d.timestamp) : undefined
      const c = d.message?.content
      if (d.type === 'user') {
        if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result') {
          const t = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x?.text || '').join('\n')
          out.push({ k: 'result', id: b.tool_use_id, ok: b.is_error !== true, preview: t.length > 1500 ? t.slice(0, 1500) + '…' : t, at })
        }
        const t = plainUser(c)
        if (isNoise(t)) continue
        if (/^\[Manager "([^"]+)"/.test(t)) { out.push({ k: 'note', text: t.slice(0, 600), at }); continue }
        const voice = /^\(Voice\) /.test(t)
        out.push({ k: 'user', text: t.replace(/^\(Voice\) /, '').replace(/\n\n\(\d+ images? attached above[\s\S]*$/, ''), voice, at })
      } else if (d.type === 'assistant' && Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'text' && b.text?.trim()) out.push({ k: 'text', text: b.text, at })
          else if (b.type === 'tool_use') out.push({ k: 'tool', id: b.id, name: gtd.toolLabel(b.name), summary: gtd.toolSummary(b.name, b.input), input: trimInput(b.input), at })
        }
      }
    }
  } catch {}
  return out
}

