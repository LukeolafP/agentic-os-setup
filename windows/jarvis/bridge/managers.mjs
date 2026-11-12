/**
 * GTD: Petra's managers (20 Oct 2026).
 *
 * Luke keeps talking to Petra; Petra hands each piece of real work to a manager and
 * stays free. A manager is a clone of Petra: a full Claude Code session in the vault
 * with Luke's settings, Petra's rules, the brief she wrote, and read access to her chat
 * so it has the plan. Managers run side by side (up to MAX_RUNNING at once) and can
 * start their own subagents.
 *
 * They coordinate through Petra, on a shared team board:
 *   - team_board          what every manager is doing: brief, status, latest updates
 *   - post_update         share a decision, a plan or progress with Petra and the team
 *   - ask_petra           a question to Petra (or Luke); waits for the answer
 *   - message_manager     a note to another manager, relayed through Petra (she sees it)
 *   - check_messages      anything sent to this manager
 *   - read_petra_chat     the recent conversation between Luke and Petra
 * Petra gets start_manager, managers, message_manager, reply_manager and stop_manager.
 *
 * Shared files (21 Oct 2026): managers draft their pieces apart and merge into an official
 * file one at a time (locks.mjs holds the queue):
 *   - claim_file          claim a file, several, or a folder; waits in a FIFO queue
 *   - release_file        free it once merged, with a one-line note for Petra and the board
 * A PreToolUse hook blocks writes (Edit, Write, MultiEdit, NotebookEdit, file-writing Bash)
 * to a path another manager holds, or to an official file this manager does not hold.
 * Petra marks official files with start_manager's `official` or set_official, and frees a
 * stuck claim with release_claims. Claims go when a manager finishes, fails, is stopped or
 * goes idle.
 *
 * A manager's questions, relays and finished reports come to Petra's chat (chat.mjs) as
 * cards, and to Petra herself as a message, so she can answer, pass things on, and tell
 * Luke. Every manager is an instance in gtd.mjs's activity graph with its own transcript,
 * so it shows under SUBAGENTS and on the constellation.
 */
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as gtd from './gtd.mjs'
import { createLocks } from './locks.mjs'
import { computerServer } from './computer.mjs'

const MAX_RUNNING = Number(process.env.GTD_MANAGERS_MAX || 4)
const ASK_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_CLOSE_MS = 45 * 60 * 1000
const CLAIM_WAIT_MS = 15 * 60 * 1000      // one claim_file call waits this long, the same bound ask_petra has
const CLAIM_IDLE_MS = 15 * 60 * 1000      // a claim with no tool use from its holder this long is released
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const managers = new Map()
const questions = new Map()          // qid -> { id, text, resolve, answered }
/* GTD 2 Nov 2026: manager ids carry on across bridge restarts. They started again at mgr1, so a
   board open across a restart still held the old, finished mgr1 and never drew the new one. */
const SEQ_FILE = join(homedir(), 'Coding/jarvis/.gtd-jobs/manager-seq')
let seq = (() => { try { return parseInt(readFileSync(SEQ_FILE, 'utf8'), 10) || 0 } catch { return 0 } })(), qseq = 0
let hooks = { notify: () => {}, askPermission: async () => ({ behavior: 'deny', message: 'No one to ask.' }), chatTail: () => [] }
export const setHooks = (h) => { hooks = { ...hooks, ...h } }

const running = () => [...managers.values()].filter((m) => m.status === 'working' || m.status === 'waiting').length
const clip = (v, n) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t }
const pub = (m) => ({ id: m.id, title: m.title, kind: m.clicky ? 'screen' : 'manager', status: m.status, brief: m.brief, created: m.created, started: m.started, ended: m.ended,
  updates: m.updates.slice(-5), result: m.result ? clip(m.result, 4000) : null })
export const listManagers = () => [...managers.values()].map(pub)

/* GTD: file claims (21 Oct 2026). Every claim event is one line on the team board, in the
   manager's activity and as a card in Petra's chat (kind 'update', so it renders as the
   one-line manager updates do). A grant that arrives after claim_file stopped waiting, or
   an idle release, is also sent to the manager itself. */
const locks = createLocks({ root: gtd.VAULT, store: join(homedir(), 'Coding/jarvis/.gtd-jobs/official-files.json'), idleMs: CLAIM_IDLE_MS, onEvent: lockEvent })
export const fileClaims = () => locks.snapshot()

function lockEvent(ev) {
  const m = managers.get(ev.owner)
  const text = clip(ev.text, 300)
  if (m) { m.updates.push({ at: Date.now(), text }); if (m.updates.length > 40) m.updates.shift() }
  gtd.recordEvent(ev.owner, { k: 'note', text: 'Files: ' + text })
  hooks.notify({ kind: 'update', lock: ev.kind, id: ev.owner, title: m?.title || ev.owner, text })
  if (!m || !(m.status === 'working' || m.status === 'waiting')) return
  if (ev.kind === 'granted' && !ev.listening) deliver(m, `[File claim granted] You now hold ${ev.paths.join(' + ')}. Re-read the current file, merge your change as targeted edits, check it, add your change-log line, then mcp__team__release_file with a one-line note.`)
  if (ev.kind === 'auto-released' && /no activity|held over/.test(ev.why || '')) deliver(m, `[File claim released] ${ev.text}. Claim it again with mcp__team__claim_file before you change it.`)
}

/** the PreToolUse hook: any tool use keeps this manager's claims alive; a write to a file
    another manager holds, or to an official file it does not hold, is denied. Fires for the
    manager's subagents too, and they share its claims. */
async function guard(m, input) {
  try {
    locks.touch(m.id)
    const name = input.tool_name, ti = input.tool_input || {}
    let why = null
    if (WRITE_TOOLS.has(name)) { const p = ti.file_path || ti.notebook_path; if (p) why = locks.checkPath(m.id, p, input.cwd) }
    else if (name === 'Bash' && ti.command) why = locks.checkBash(m.id, String(ti.command), input.cwd)
    if (!why) return {}
    gtd.recordEvent(m.id, { k: 'note', text: 'Blocked: ' + clip(why, 240) })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
  } catch { return {} }
}

const RULES = (m) => `
# You are a manager: one of Petra's clones

Petra is the main agent of Luke's GTD vault. She gave you one piece of work so that she
stays free to talk to Luke. You are "${m.title}" (id ${m.id}). Other managers may be
working at the same time on related pieces; you all coordinate through Petra.

- Your brief is in the first message. If you need the conversation it came from, call
  mcp__team__read_petra_chat.
- Before you plan, call mcp__team__team_board to see what the other managers are doing,
  and plan so your work fits theirs. Post your plan, and any decision another manager
  should know, with mcp__team__post_update (short).
- If you need something only Petra or Luke can decide, or another manager's output, call
  mcp__team__ask_petra. It waits for the answer. Use it sparingly.
- To tell another manager something directly, mcp__team__message_manager (Petra sees it).
  Call mcp__team__check_messages between big steps; Petra may have passed something on.
- You have all of Claude Code: tools, skills, subagents, the vault and Luke's MCP servers.
  The vault's CLAUDE.md rules apply, except Chat Logging: Petra keeps the chat note, never
  you.
- Finish with a report Petra can relay: one plain sentence on what you did, the notes or
  files you made or changed as vault paths, then anything left open.

## Shared files: draft apart, merge one at a time

Other managers may be changing the same deliverable. Some files are official: the page or
stylesheet everyone's work ends up in (Petra marks them; team_board lists them under FILE
CLAIMS). A write to an official file you do not hold, or to any file another manager has
claimed, is blocked.

1. Design your piece in your own workspace: a .work/${m.id}/ folder beside the official file
   (a dot folder, so Obsidian ignores it), or asset files only you own (an SVG, a CSS
   partial). Build, render and check it there. Never hold a claim while you design.
2. When the piece is ready, mcp__team__claim_file every official file you will change, in
   one call (the page and its css together). It waits in a queue until they are free. If
   it comes back still queued, carry on with your draft: you keep your place, and a
   "[File claim granted]" message comes when it is yours.
3. Once granted, merge: re-read the CURRENT official file (others may have merged since you
   started), apply your change as targeted edits (Edit, never a whole-file Write or copy of
   your draft), run your checks (render, screenshot), and add your change-log line.
4. Then mcp__team__release_file straight away, with a one-line note of what you merged
   ("merged hero drawn word into blueprint.html"). It goes to Petra and the team board and
   lets the next manager in.
- While you hold a claim you cannot queue for more: release, then claim everything at once.
- A claim is released when you go ${Math.round(CLAIM_IDLE_MS / 60000)} minutes without a tool call, when your turn ends
  with no background helpers still running, and if you fail or are stopped. Subagents you start share your claims and the same block.
- If a write is blocked, do not work around it with another tool, a copy and move, or a
  script: claim the file and wait.
`

/* ---------- screen agents (GTD, 7 Nov 2026) ----------
   A screen agent is a manager that works on Luke's screen: it sees the Mac and moves the
   Agentic OS pointer and the real mouse and keyboard through the computer tools (computer.mjs,
   whose hands are the Agentic OS program). Petra or any manager starts one with
   start_screen_agent. Only one works at a time, because there is one mouse; the next waits in
   the queue. It shows on the OS like a manager, in cyan. */
const CLICKY_RULES = (m) => `
# You are a screen agent

You do your brief on Luke's Mac the way a person would, with the computer tools
(mcp__computer__screenshot, click, type_text, press_keys, scroll, drag, move_mouse, open_app,
wait, done_with_computer). The Agentic OS pointer flies to every place you click, with the label
you give, so Luke can watch; give every click and drag a short label ("Upload button").

- Start with mcp__computer__use_app for the app the job is in: its window gets an outline Luke
  can see, and from then on read_window, press_control, set_text, send_keys and type_quiet work
  inside it without his mouse, so he can keep working. Read the window first (it lists the
  controls with numbers), act one step at a time, and read or screenshot again to check before
  the next step. Use the mouse tools (click, drag) only for what the quiet tools cannot do, such
  as dragging onto a canvas, and say in a post_update when you take the mouse. If something did
  not happen, look again and adjust.
- Prepare first with your other tools when that is faster and surer: download files, rename
  them, put them in one folder with Bash or the Google Drive connector, then do only the
  on-screen part with the mouse (for example: open the upload dialog, go to the folder with
  cmd+shift+g, select all, open).
- Never type a password, pay, send, post, publish or delete anything unless the brief says Luke
  asked for exactly that.
- If Luke presses Esc you are stopped: stop, and report what you had done and what is left.
- When finished, call mcp__computer__done_with_computer, then finish with a report Petra can say
  out loud: one sentence on what is now on screen, then anything left open.
`
const CLICKY_COLOR = '#00E5FF'
const clickyBusy = () => [...managers.values()].some((m) => m.clicky && (m.status === 'working' || m.status === 'waiting'))

function cleanEnv() {
  const env = { ...process.env, GTD_JOB: '1', RUBRIC_AGENT_ID: 'gtd-vault' }   // GTD_JOB keeps the chat-log hook quiet
  for (const k of ['GTD_VOICE', 'JARVIS_MODE', 'JARVIS_MODEL', 'JARVIS_EFFORT', 'JARVIS_ALLOWED_ORIGINS', 'JARVIS_BRIDGE_PORT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k]
  /* GTD (21 Oct 2026): the CLI withholds its Artifact tool from SDK sessions
     ("sdk_default_off") unless this is set, so Petra and her managers can publish
     claude.ai artifacts like the plain CLI does */
  env.CLAUDE_CODE_ARTIFACT = '1'
  /* GTD (26 Oct 2026): load the Claude in Chrome browser tools in SDK sessions, like `claude --chrome` */
  env.CLAUDE_CODE_ENABLE_CFC = '1'
  return env
}

const ok = (text) => ({ content: [{ type: 'text', text: String(text) }] })
const CLICKY_TOOL = 'Send a screen agent to do something on Luke\'s screen, the way a person at the Mac would: it sees the screen and moves the mouse and keyboard in any app, and Luke watches the Agentic OS pointer fly to each click. Use it for work that only the screen can do (put images into a FigJam or Figma board, click through a desktop app, fill in a form in an app with no connector). Prepare files first where you can (download, rename, gather in one folder) and say where they are in the brief. Only one screen agent works at a time; others wait their turn.'
const clickyArgs = {
  title: z.string().min(2).describe('A short name Luke will see, like "Mood photos into FigJam".'),
  brief: z.string().min(10).describe('Exactly what should end up on screen, which app and window, where the files are, and anything it must not do.'),
}

/** the tools each manager gets: the team board, Petra, and each other */
function teamServer(selfId) {
  const self = managers.get(selfId)
  return createSdkMcpServer({
    name: 'team', version: '1.0.0',
    tools: [
      ...(self?.clicky ? [] : [tool('start_screen_agent', CLICKY_TOOL, clickyArgs, async ({ title, brief }) => {
        const r = startManager(title, brief, null, self?.tab || null, { clicky: true, by: selfId })
        hooks.notify({ kind: 'update', id: selfId, title: self?.title || selfId, text: `Sent a screen agent (${r.id}): ${title}` })
        return ok(`Started screen agent ${r.id} "${title}"${r.position ? `, queued (${r.position} waiting)` : ''}. Its report comes to Petra; check it with team_board.`)
      })]),
      tool('team_board', 'Every manager Petra is running: title, status, brief and latest updates. Read it before planning so your work fits the others.', {}, async () => {
        const list = listManagers()
        return ok((list.map((x) => `${x.id === selfId ? '(you) ' : ''}${x.id} · ${x.title} · ${x.status}\n  brief: ${clip(x.brief, 500)}${x.updates.length ? '\n  updates:\n' + x.updates.map((u) => `   - ${clip(u.text, 400)}`).join('\n') : ''}${x.result ? '\n  finished: ' + clip(x.result, 600) : ''}`).join('\n\n') || 'No managers.') + '\n\n' + locks.describe())
      }),
      tool('claim_file', 'Claim files before you change them: an official file, several files that change together (a page and its css), or a folder. Waits in a queue until they are free (up to 15 minutes), granted all at once. Draft first in your own .work/<your id>/ folder; claim only when ready to merge.', {
        path: z.union([z.string(), z.array(z.string()).min(1)]).describe('A vault path, or a list of them claimed together. Absolute or relative to the vault.'),
        reason: z.string().min(2).describe('What you will merge, in a few words, like "hero drawn word".'),
        wait: z.boolean().optional().describe('Default true. false returns at once, granted or queued; a queued claim keeps its place.'),
      }, async ({ path, reason, wait }) => {
        const m = managers.get(selfId); if (!m) return ok('Unknown manager.')
        let r = await locks.claim(selfId, path, reason, { wait: false })
        if (r.status === 'queued' && wait !== false) {
          m.status = 'waiting'; gtd.updateInstance(m.id, { label: clip(`waiting for ${r.paths.join(' + ')} behind ${r.behind}`, 160) })
          r = await locks.claim(selfId, path, reason, { timeoutMs: CLAIM_WAIT_MS })
          if (m.status === 'waiting') { m.status = 'working'; gtd.updateInstance(m.id, { label: m.title }) }
        }
        if (r.status === 'granted') return ok(`Granted: you hold ${r.paths.join(' + ')}. Re-read the current file, merge as targeted edits, run your checks, add your change-log line, then release_file with a one-line note. Released by itself after ${Math.round(CLAIM_IDLE_MS / 60000)} min without a tool call.`)
        if (r.status === 'queued') return ok(`Still queued for ${r.paths.join(' + ')} behind ${r.behind} (position ${r.position}). You keep your place: carry on with your draft; a "[File claim granted]" message comes when it is yours, or call claim_file again to wait.`)
        if (r.status === 'cancelled') return ok('Your claim was cancelled (released or stopped).')
        return ok(r.text || 'Could not claim.')
      }),
      tool('release_file', 'Release files you claimed, as soon as your change is merged and checked. The note goes to Petra and the team board.', {
        path: z.union([z.string(), z.array(z.string())]).optional().describe('A path or several; leave out to release everything you hold or have queued.'),
        note: z.string().optional().describe('One line on what you merged, like "merged hero drawn word into blueprint.html".'),
      }, async ({ path, note }) => {
        const r = locks.release(selfId, path ?? 'all', { note: clip(note || '', 200) })
        const all = [...r.freed, ...r.dropped.map((x) => x + ' (was queued)')]
        return ok(all.length ? `Released ${all.join(', ')}.` : 'You held nothing matching that.')
      }),
      tool('post_update', 'Share your plan, a decision or progress with Petra and the other managers. Keep it short.', { text: z.string().min(2) }, async ({ text }) => {
        const m = managers.get(selfId); if (!m) return ok('Unknown manager.')
        const u = { at: Date.now(), text: clip(text, 2000) }
        m.updates.push(u); if (m.updates.length > 40) m.updates.shift()
        gtd.recordEvent(m.id, { k: 'note', text: 'Update: ' + u.text })
        hooks.notify({ kind: 'update', id: m.id, title: m.title, text: u.text })
        return ok('Posted.')
      }),
      tool('ask_petra', 'Ask Petra (and through her, Luke) a question you cannot answer yourself. Waits for the answer, up to 15 minutes.', { question: z.string().min(4) }, async ({ question }) => {
        const m = managers.get(selfId); if (!m) return ok('Unknown manager.')
        const qid = 'q' + (++qseq)
        m.status = 'waiting'; gtd.updateInstance(m.id, { status: 'running', label: 'waiting on Petra: ' + clip(question, 120) })
        const answer = await new Promise((resolve) => {
          questions.set(qid, { id: m.id, text: question, resolve, answered: false, at: Date.now() })
          hooks.notify({ kind: 'question', qid, id: m.id, title: m.title, text: question })
          setTimeout(() => { const q = questions.get(qid); if (q && !q.answered) { q.answered = true; resolve(null); hooks.notify({ kind: 'answered', qid, by: 'timeout', text: '' }) } }, ASK_TIMEOUT_MS)
        })
        m.status = 'working'; gtd.updateInstance(m.id, { label: m.title })
        return ok(answer == null ? 'No answer after 15 minutes. Carry on with your best judgement and say what you assumed.' : answer)
      }),
      tool('message_manager', 'Send a short note to another manager, through Petra (she sees it).', { to: z.string().describe('The other manager\'s id, from team_board.'), text: z.string().min(2) }, async ({ to, text }) => {
        const from = managers.get(selfId), target = managers.get(to)
        if (!target) return ok(`No manager ${to}. See team_board.`)
        deliver(target, `[Message from manager "${from?.title}" (${selfId})] ${text}`)
        hooks.notify({ kind: 'relay', from: from?.title || selfId, to: target.title, text })
        return ok(`Sent to ${target.title}.`)
      }),
      tool('check_messages', 'Messages Petra or other managers have sent you that you have not seen yet.', {}, async () => {
        const m = managers.get(selfId); if (!m) return ok('Unknown manager.')
        const unread = m.inbox.filter((x) => !x.read); unread.forEach((x) => { x.read = true })
        return ok(unread.length ? unread.map((x) => x.text).join('\n\n') : 'Nothing new.')
      }),
      tool('read_petra_chat', 'The recent conversation between Luke and Petra, where your brief came from.', { limit: z.number().int().min(2).max(80).optional() }, async ({ limit }) =>
        ok(hooks.chatTail(limit || 24, selfId).join('\n\n') || 'Nothing yet.')),
    ],
  })
}

/** a message into a manager: read on its next check, and fed to the session if it is idle */
function deliver(m, text) {
  m.inbox.push({ at: Date.now(), text, read: false })
  gtd.recordEvent(m.id, { k: 'prompt', text })
  if (m.s && !m.s.closed) {
    if (m.status === 'done' || m.status === 'failed') {
      m.status = 'working'; m.ended = null
      /* a finished manager drops off SUBAGENTS 3 min after it ends (activitySnapshot prunes
         it), so one woken by a message must be registered again or it works invisibly */
      if (!gtd.hasInstance(m.id)) gtd.registerInstance({ iid: m.id, agent: m.id, name: m.title, color: '#7DA0FF', parent: 'petra', label: clip(text, 160), status: 'running', kind: 'manager' })
      else gtd.updateInstance(m.id, { status: 'running', ended: null })
    }
    m.inbox[m.inbox.length - 1].read = true
    if (m.s.deliver) { const d = m.s.deliver; m.s.deliver = null; d(text) } else m.s.inbox.push(text)
    return
  }
  /* GTD 23 Oct 2026: the session closed (45 min idle, or it crashed). Before this, the message sat
     unread in the inbox and the manager never woke. Now it is queued to resume with the message. */
  if (m.status === 'stopped') return
  if (!m.s) { m.brief += '\n\n' + text; m.inbox[m.inbox.length - 1].read = true; return }   // not started yet: add to its brief
  m.inbox[m.inbox.length - 1].read = true
  m.wake = m.wake ? m.wake + '\n\n' + text : text
  m.status = 'queued'; m.ended = null
  if (!gtd.hasInstance(m.id)) gtd.registerInstance({ iid: m.id, agent: m.id, name: m.title, color: '#7DA0FF', parent: 'petra', label: clip(text, 160), status: 'queued', kind: 'manager' })
  else gtd.updateInstance(m.id, { status: 'queued', ended: null })
  pump()
}

function run(m) {
  m.status = 'working'; m.started = Date.now()
  gtd.updateInstance(m.id, { status: 'running', started: m.started })
  /* GTD 23 Oct 2026: a manager woken after its session closed resumes that session (full
     context) with the waiting message, instead of starting over from the brief */
  const first = m.wake ? m.wake : m.brief
  const resume = m.wake && m.session ? m.session : undefined
  m.wake = null
  const s = { inbox: [first], deliver: null, closed: false }
  m.s = s
  async function* messages() {
    while (!s.closed) {
      const text = s.inbox.shift() ?? (await new Promise((r) => { s.deliver = r }))
      if (s.closed || text == null) return
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    }
  }
  const q = query({
    prompt: messages(),
    options: {
      cwd: gtd.VAULT,
      pathToClaudeCodeExecutable: gtd.CLAUDE_BIN,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: RULES(m) + (m.clicky ? CLICKY_RULES(m) : '') },
      mcpServers: { team: teamServer(m.id), ...(m.clicky ? { computer: computerServer(`screen agent ${m.id}`) } : {}) },
      ...(m.clicky ? { allowedTools: ['mcp__computer'] } : {}),
      permissionMode: 'auto',
      canUseTool: (name, input, opts) => hooks.askPermission({ id: m.id, title: m.title }, name, input, opts),
      hooks: { PreToolUse: [{ hooks: [(input) => guard(m, input)] }] },      // file claims, see guard
      env: cleanEnv(),
      ...(resume ? { resume } : {}),
    },
  })
  m.q = q
  m.bg = new Map(); m.turn = true; m.ending = null      // a fresh CLI process: no background helpers yet (the level is per process)
  ;(async () => {
    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') m.session = msg.session_id
        gtd.trackTask(msg, m.id)
        if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
          m.bg = new Map((msg.tasks || []).filter((x) => HELPER_TASKS.has(x.task_type)).map((x) => [x.task_id, x.description]))
          if (!m.turn && m.ending) { if (m.bg.size) waitOnHelpers(m); else { clearTimeout(m.settle); m.settle = setTimeout(() => { if (!m.turn && m.ending && !m.bg.size) finish(m) }, SETTLE_MS) } }
        }
        /* the CLI starts a turn by itself when a helper reports back: the manager is working again */
        if (msg.type === 'assistant' && !msg.parent_tool_use_id && !m.turn) wakeUp(m)
        if (msg.type === 'assistant') for (const b of msg.message?.content || []) {
          if (b.type === 'tool_use') { gtd.trackToolUse(gtd.ownerOf(msg.parent_tool_use_id, m.id), b); gtd.updateInstance(m.id, { last: gtd.toolLabel(b.name) }) }
        }
        if (msg.type === 'user') for (const b of Array.isArray(msg.message?.content) ? msg.message.content : []) if (b?.type === 'tool_result') gtd.trackToolResult(b)
        if (msg.type === 'assistant' || msg.type === 'user') gtd.recordStream(m.id, msg)
        if (msg.type === 'result') {
          m.turn = false
          m.ending = { ok: msg.subtype === 'success', text: msg.result || '', subtype: msg.subtype }
          if (m.bg.size && m.ending.ok) waitOnHelpers(m)
          else finish(m)
        }
      }
    } catch (err) {
      m.ending = null; clearTimeout(m.settle)
      m.status = 'failed'; m.ended = Date.now(); m.result = String(err?.message || err)
      gtd.updateInstance(m.id, { status: 'failed', ended: m.ended })
      locks.releaseOwner(m.id, 'manager failed')
      hooks.notify({ kind: 'failed', id: m.id, title: m.title, text: clip(m.result, 800) })
    }
    if (m.ending) finish(m)       // the CLI went away while the manager waited on helpers
    s.closed = true
    locks.releaseOwner(m.id, 'manager closed')
    pump()
  })()
}

/* GTD 5 Nov 2026: a manager often starts background helpers (Agent with run_in_background), ends
   its turn to wait, and is woken by the CLI when one reports. Before this it showed done at every
   turn end and vanished from the OS while its helpers were still working. Now it is done only when
   its turn has ended AND no helper is still running (the SDK's background_tasks_changed level,
   m.bg). Until then it stays working on the OS with "waiting on N helpers", keeps its file claims
   (its helpers use them), never idles closed, and Petra gets a one-line update instead of a
   finished report. Background Bash (a preview server) does not count: it can run for ever. */
const HELPER_TASKS = new Set(['local_agent', 'local_workflow', 'remote_agent'])
const SETTLE_MS = 5000       // the last helper's report usually starts a new turn at once; wait for it before calling the manager done

function finish(m) {
  const e = m.ending; m.ending = null; clearTimeout(m.settle)
  if (!e || m.status === 'stopped') return
  m.result = e.text || m.result || ''
  m.status = e.ok ? 'done' : 'failed'
  m.ended = Date.now()
  gtd.updateInstance(m.id, { status: m.status, ended: m.ended, ...(m.waitLabel ? { label: m.title } : {}) })
  m.waitLabel = false
  locks.releaseOwner(m.id, m.status === 'done' ? 'manager finished' : 'manager failed')
  hooks.notify({ kind: m.status === 'done' ? 'finished' : 'failed', id: m.id, title: m.title, text: clip(m.result || e.subtype, 6000) })
  clearTimeout(m.idle)
  m.idle = setTimeout(() => close(m), IDLE_CLOSE_MS)
  pump()
}

/** its turn ended (or a helper came or went) while helpers are still out: it stays working */
function waitOnHelpers(m) {
  clearTimeout(m.settle); clearTimeout(m.idle)
  const names = [...m.bg.values()]
  const label = clip(`waiting on ${names.length} helper${names.length === 1 ? '' : 's'}: ${names.join(', ')}`, 160)
  const first = !m.waitLabel
  m.waitLabel = true
  gtd.updateInstance(m.id, { status: 'running', ended: null, label })
  if (!first) return
  const text = clip(`Still working, ${label}. ${m.ending?.text || ''}`, 400)
  m.updates.push({ at: Date.now(), text }); if (m.updates.length > 40) m.updates.shift()
  gtd.recordEvent(m.id, { k: 'note', text })
  hooks.notify({ kind: 'update', id: m.id, title: m.title, text })
}

/** a new turn began, by a message or by the CLI on a helper's report */
function wakeUp(m) {
  m.turn = true; m.ending = null
  clearTimeout(m.settle); clearTimeout(m.idle)
  if (m.status === 'done' || m.status === 'failed') { m.status = 'working'; m.ended = null }
  if (!gtd.hasInstance(m.id)) gtd.registerInstance({ iid: m.id, agent: m.id, name: m.title, color: '#7DA0FF', parent: 'petra', label: m.title, status: 'running', kind: 'manager' })
  else gtd.updateInstance(m.id, { status: 'running', ended: null, ...(m.waitLabel ? { label: m.title } : {}) })
  m.waitLabel = false
}

function close(m) {
  locks.releaseOwner(m.id, 'manager closed')
  if (!m.s || m.s.closed) return
  m.s.closed = true; m.s.deliver?.(null)
  try { m.q?.interrupt() } catch {}
}

function pump() {
  for (const m of managers.values()) {
    if (running() >= MAX_RUNNING) return
    if (m.status !== 'queued') continue
    if (m.clicky && clickyBusy()) continue           // one mouse: screen agents take turns
    run(m)
  }
}

export function startManager(title, brief, official, tab, opts = {}) {
  if (official?.length) locks.setOfficial(official, 'add')
  const id = 'mgr' + (++seq)
  try { writeFileSync(SEQ_FILE, String(seq)) } catch {}
  const clicky = !!opts.clicky
  const m = { id, title: clip(String(title || (clicky ? 'screen agent' : 'Manager')).trim(), 60), brief: String(brief || '').trim(), status: 'queued',
    created: Date.now(), started: null, ended: null, updates: [], inbox: [], result: null, tab: tab || null,   // tab: the Petra chat that started it
    clicky, by: opts.by || null }                                                                             // by: the manager that started it, if any
  managers.set(id, m)
  gtd.registerInstance({ iid: id, agent: id, name: (clicky ? 'Screen · ' : '') + m.title, color: clicky ? CLICKY_COLOR : '#7DA0FF',
    parent: opts.by || 'petra', label: clip(m.brief, 160), status: 'queued', kind: clicky ? 'screen' : 'manager' })
  gtd.recordEvent(id, { k: 'prompt', text: m.brief })
  hooks.notify({ kind: 'started', id, title: m.title, text: clip(m.brief, 600) })
  pump()
  return { id, position: m.status === 'queued' ? [...managers.values()].filter((x) => x.status === 'queued').length : 0 }
}

/** Petra, or Luke, sends a manager a message */
export function messageManager(id, text, from = 'Petra') {
  const m = managers.get(id)
  if (!m) return false
  deliver(m, `[Message from ${from}] ${text}`)
  return true
}

/** an answer to a manager's ask_petra, from Petra's tool or from Luke in the chat */
export function answerQuestion(qid, text, by = 'Petra') {
  const q = questions.get(qid)
  if (!q || q.answered) return false
  q.answered = true
  q.resolve(`${by}: ${text}`)
  hooks.notify({ kind: 'answered', qid, id: q.id, by, text })
  return true
}

export function stopManager(id) {
  const m = managers.get(id)
  if (!m) return false
  if (m.status === 'queued') { m.status = 'stopped'; gtd.updateInstance(id, { status: 'failed', ended: Date.now() }); return true }
  try { m.q?.interrupt() } catch {}
  close(m)
  m.status = 'stopped'; m.ended = Date.now()
  gtd.updateInstance(id, { status: 'failed', ended: m.ended })
  locks.releaseOwner(id, 'manager stopped')
  for (const [qid, q] of questions) if (q.id === id && !q.answered) { q.answered = true; q.resolve('Stopped.') }
  pump()
  return true
}

/** a new chat starts with a clean team board: finished and stopped managers go */
export function clearFinished(tab) {
  for (const [id, m] of managers) if ((tab == null || m.tab === tab) && (m.status === 'done' || m.status === 'failed' || m.status === 'stopped')) { close(m); managers.delete(id) }
}

/** which of Petra's chats (tabs) a manager reports to */
export const tabOf = (id) => managers.get(id)?.tab || null
/* questions a manager is still waiting on, for the tab colours in chat.mjs */
export const openQuestions = () => [...questions].filter(([, q]) => !q.answered).map(([qid, q]) => ({ qid, id: q.id, at: q.at || 0 }))

/** Petra's side: start managers, see them, talk to them */
export function petraServer(tab) {
  return createSdkMcpServer({
    name: 'petra', version: '1.0.0',
    tools: [
      tool('start_manager', 'Hand a piece of work to a new manager: a clone of you that works on it in the background while you keep talking to Luke. Write a complete brief: the goal, what is already decided, constraints, where things go in the vault, and what to report. It can read this chat and the team board.', {
        title: z.string().min(2).describe('A short name Luke will see, like "Website layout plan".'),
        brief: z.string().min(10),
        official: z.array(z.string()).optional().describe('Files (or folders) several managers will change, like the page they all iterate on. Marked official: each manager drafts apart and merges into them one at a time through claim_file. Added to the list; see set_official.'),
      }, async ({ title, brief, official }) => {
        const r = startManager(title, brief, official, tab)
        return ok(`Started manager ${r.id} "${title}"${r.position ? `, queued (${r.position} waiting)` : ''}.${official?.length ? ' Official: ' + locks.snapshot().official.join(', ') : ''}`)
      }),
      tool('start_screen_agent', CLICKY_TOOL, clickyArgs, async ({ title, brief }) => {
        const r = startManager(title, brief, null, tab, { clicky: true })
        return ok(`Started screen agent ${r.id} "${title}"${r.position ? `, queued (${r.position} waiting)` : ''}. It reports back to you like a manager.`)
      }),
      tool('managers', 'Your managers: status, brief, their latest updates, and finished reports.', {}, async () => {
        const list = listManagers()
        return ok((list.map((x) => `${x.id} · ${x.title} · ${x.status}${x.updates.length ? '\n  latest: ' + clip(x.updates[x.updates.length - 1].text, 400) : ''}${x.result ? '\n  report: ' + clip(x.result, 1500) : ''}`).join('\n\n') || 'No managers yet.') + '\n\n' + locks.describe())
      }),
      tool('message_manager', 'Send a manager information, a decision, or another manager\'s output it needs. A finished manager picks the work back up.', { id: z.string(), text: z.string().min(2) }, async ({ id, text }) =>
        ok(messageManager(id, text) ? `Sent to ${id}.` : `No manager ${id}.`)),
      tool('reply_manager', 'Answer a manager\'s question (the question id is in its message to you, like q3).', { question_id: z.string(), answer: z.string().min(1) }, async ({ question_id, answer }) =>
        ok(answerQuestion(question_id, answer) ? 'Answered.' : 'That question was already answered or has expired.')),
      tool('set_official', 'Mark the files (or folders) managers merge into one at a time: no manager can write them without claiming them first. Kept across bridge restarts.', {
        paths: z.array(z.string()).describe('Vault paths, absolute or relative to the vault.'),
        mode: z.enum(['add', 'remove', 'replace']).optional().describe('Default add.'),
      }, async ({ paths, mode }) => {
        const r = locks.setOfficial(paths, mode || 'add')
        return ok(r.error || (r.official.length ? 'Official now:\n' + r.official.map((p) => '- ' + p).join('\n') : 'No official files now.'))
      }),
      tool('release_claims', 'Free every file a manager holds or is queued for, when one is stuck.', { id: z.string() }, async ({ id }) => {
        const r = locks.releaseOwner(id, 'released by Petra')
        return ok(r.freed.length || r.dropped.length ? `Released ${[...r.freed, ...r.dropped].join(', ')}.` : `${id} held nothing.`)
      }),
      tool('stop_manager', 'Stop a manager.', { id: z.string() }, async ({ id }) => ok(stopManager(id) ? `Stopped ${id}.` : `No manager ${id}.`)),
    ],
  })
}
