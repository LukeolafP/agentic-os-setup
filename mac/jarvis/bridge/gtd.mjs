/**
 * GTD vault mode for the JARVIS bridge (Luke, 15 Oct 2026).
 *
 * Turned on with JARVIS_MODE=gtd. The bridge then stops being a general home
 * assistant and becomes the voice of the GTD Vault agent:
 *
 *   - the session runs from the Obsidian vault, loads its project settings
 *     (CLAUDE.md, hooks, skills, the agents in Agents/ via .claude/agents) on Opus 5.5 at high effort;
 *   - long work is queued to background agents (one headless `claude -p` each),
 *     which report to the Rubric console and drop a report on the OS ring;
 *   - speech is transcribed locally with faster-whisper, over the socket;
 *   - the permission gate lets the voice edit files inside the vault only and
 *     run a short allowlist of commands.
 *
 * The browser half lives in the Rubric Agentic OS (dashboard.html), not in this
 * repo's own React face, which still works unchanged in the default mode.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GTD = process.env.JARVIS_MODE === 'gtd'
export const VAULT = realpathSync(process.env.JARVIS_CWD || join(homedir(), 'Documents/GTD'))
export const WIN = process.platform === 'win32'
export const CLAUDE_BIN = process.env.JARVIS_CLAUDE_BIN || join(homedir(), '.local/bin', WIN ? 'claude.exe' : 'claude')
/* open a file, app or obsidian:// link the way this OS does (the vault's rule: Obsidian, or Chrome for Google links) */
export function openWith(target, app = null) {
  if (WIN) {
    const args = app ? ['/c', 'start', '', app === 'Google Chrome' ? 'chrome' : app, target] : ['/c', 'start', '', target]
    return spawn('cmd', args, { stdio: 'ignore', windowsHide: true, detached: true }).unref()
  }
  return spawn('open', app ? ['-a', app, target] : [target], { stdio: 'ignore', detached: true }).unref()
}

const RUBRIC = process.env.GTD_RUBRIC_URL || 'http://127.0.0.1:5050'
const KIT = join(VAULT, 'Installers/Robonuggets')
const OS_ARTIFACTS = process.env.GTD_OS_ARTIFACTS || join(KIT, 'rubric-agentic-os/artifacts')
const JOB_LOG_DIR = join(homedir(), 'Coding/jarvis/.gtd-jobs')
const JOB_MODEL = process.env.GTD_JOB_MODEL || 'claude-opus-5-5'
const JOB_EFFORT = process.env.GTD_JOB_EFFORT || 'high'
const JOB_CONCURRENCY = Number(process.env.GTD_JOB_CONCURRENCY || 2)
const JOB_TIMEOUT_MS = Number(process.env.GTD_JOB_TIMEOUT_MIN || 30) * 60_000
const PYTHON = process.env.GTD_PYTHON || join(homedir(), '.pyenv/versions/3.13.12/bin/python3')
const HERE = dirname(fileURLToPath(import.meta.url))

/* ------------------------------------------------------------------ voice */

export const VOICE_RULES = `
# Voice mode: you are Petra, the spoken voice of Luke's GTD Vault agent

Your name is Petra. You are the main agent of Luke's vault: the one he talks to, and the
one who hands work to the other agents. Everything you write as text is read aloud to
Luke in your voice through his speakers, and he waits in silence while it plays. Warm,
direct, composed; never "sir".

- Two sentences is the ceiling. The median reply is under twelve words.
- No markdown, lists, tables, file paths, links, code or emoji in spoken text. Say a
  note's name in plain words if you must name it.
- No filler: no "let me", "great", "sure", "one moment". Act, then report.
- Report success plainly ("The draft is queued."), failure as a fact ("I have no
  record of that agent."). Never apologise.
- Speak your reply FIRST, then do any bookkeeping after it (the chat note the Chat
  Logging automation asks for, index lines). Never make Luke wait in silence for
  bookkeeping.
- Bookkeeping is silent. Never say anything about it: no "Logged", "Noted", "Saved" or
  "Updated the chat note". After the bookkeeping tools, write no further text at all.
- When you write the chat note, follow the template in the Chat Logging automation
  exactly: frontmatter with type, date, session, status and topic, a "YYYY-MM-DD - Topic"
  title, and every section (Summary, Thread, Learned about how Luke works, Created and
  changed in the vault, Outside the vault, Open items, Related), plus its Chat Index line.

## Queue the work, keep talking

Anything that takes more than a few seconds (drafting, research, pulling numbers across
tools, filing several notes) goes to a background agent with the gtd tools, and you reply
in one short line that it is queued:

- mcp__gtd__list_agents: the agents that exist and what each is for.
- mcp__gtd__queue_agent: hand a task to one of them, or to "general" when none fits.
  Write the task as a complete brief: the agent cannot hear this conversation.
- mcp__gtd__agent_jobs: what is queued, running and finished, with each result.
- mcp__gtd__cancel_job: stop one.

Quick answers (a fact from the vault, a recall, a short lookup) you handle yourself.
For a stored fact, brain recall is still the first lookup.

## Creating agents

When Luke wants a new agent, use the agent-creator skill. By voice, ask at most the
two or three questions the skill needs, one at a time, briefly, then build it.

## Limits in voice mode

You may edit files inside the vault only. Shell commands are limited to brain recall,
the agent registry tool and a few read-only commands. Nothing is sent, posted or
deleted by voice. If Luke asks for one of those, say it needs the keyboard.
`

/* ------------------------------------------------------------- tool gate */

const VAULT_PREFIX = VAULT + sep
function insideVault(p) {
  if (typeof p !== 'string' || !p) return false
  let abs = resolvePath(VAULT, p)
  // resolve symlinks on the deepest existing ancestor, so ../ tricks and links out are caught
  let probe = abs
  while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe)
  try { abs = realpathSync(probe) + abs.slice(probe.length) } catch { return false }
  return abs === VAULT || abs.startsWith(VAULT_PREFIX)
}

const SAFE_BASH = [
  /^node\s+(\S*\/)?Installers\/Robonuggets\/rubric-second-brain\/brain\.js\s+(recall|ask|store)\b/,
  /^node\s+(\S*\/)?Installers\/Robonuggets\/tools\/agents\.mjs\s+(list|register|show)\b/,
  /^(ls|pwd|date|wc|head|tail|cat|grep|rg|find)\b/,
]
// no chaining, redirection, substitution or backgrounding - one plain command only
const SHELL_META = /[;&|`<>]|\$\(|\n/
const FIND_ACTIONS = /\s-(delete|exec|execdir|ok|fprint|fls)\b/

/**
 * GTD voice gate. Returns true/false, or null to fall through to the stock
 * jarvis decideTool (read verbs allowed, effectful MCP tools behind ALLOW_WRITES).
 */
export function decideGtd(name, input) {
  if (name === 'Skill' || name === 'TodoWrite') return true
  if (name.startsWith('mcp__gtd__')) return true
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    return insideVault(input?.file_path ?? input?.notebook_path)
  }
  if (name === 'Bash') {
    const cmd = String(input?.command ?? '').trim()
    if (!cmd || SHELL_META.test(cmd) || FIND_ACTIONS.test(cmd)) return false
    return SAFE_BASH.some((re) => re.test(cmd))
  }
  return null
}

/* ---------------------------------------------------------------- agents */

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const out = {}
  if (!m) return out
  let key = null
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (kv) {
      key = kv[1]
      const v = kv[2].trim().replace(/^["']|["']$/g, '')
      out[key] = v === '' ? [] : v
    } else if (key && /^\s*-\s+/.test(line) && Array.isArray(out[key])) {
      out[key].push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''))
    }
  }
  return out
}
const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim()).filter(Boolean)

export function listAgents() {
  const dir = join(VAULT, '.claude/agents')   // a link to the vault's Agents/ folder
  const agents = [{ id: 'general', name: 'General', description: 'A plain GTD Vault session, for work no specialist covers.', model: JOB_MODEL, color: '#8a8a8a' }]
  if (!existsSync(dir)) return agents
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const fm = frontmatter(readFileSync(join(dir, f), 'utf8'))
    if (!fm.name) continue   // not an agent: the folder's own index note, 00 Agents Index.md
    const id = fm.name.toString()
    agents.push({
      id,
      name: fm.label || fm.display_name || id.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '),
      description: fm.description || '',
      model: fm.model || JOB_MODEL,
      effort: fm.effort || JOB_EFFORT,
      color: fm.ui_color || fm.color || '#58abf5',
      department: fm.department || '',
      permissions: asList(fm.permissions),
    })
  }
  return agents
}

/* ------------------------------------------------------------------ jobs */

const JOB_RULES = `You are running as a queued background agent for Luke's GTD vault, started by
JARVIS. Nobody is watching and nobody can answer questions: make reasonable calls,
note assumptions, and finish. This run is not a chat, so the Chat Logging automation
does not apply - do not create or update a chat note or the Chat Index. Every other
vault rule does. Your final message is filed as a report on the Agentic OS and may be
read aloud: lead with one plain sentence saying what you did, then list each note you
created or changed as a vault path, then anything left open.`

const jobs = new Map()
const queue = []
let running = 0
const listeners = new Set()
export const onJobEvent = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const publicJob = (j) => ({
  id: j.id, agent: j.agent, agentName: j.agentName, color: j.color, task: j.task,
  status: j.status, created: j.created, started: j.started ?? null, ended: j.ended ?? null,
  last: j.last ?? '', result: j.result ? j.result.slice(0, 1200) : '', report: j.report ?? null, costUsd: j.costUsd ?? null,
})
const emit = (j) => { for (const fn of listeners) { try { fn(publicJob(j)) } catch {} } }
export const allJobs = () => [...jobs.values()].sort((a, b) => b.created - a.created).slice(0, 30).map(publicJob)

async function rubricStatus(agent, status, task) {
  try {
    await fetch(RUBRIC + '/api/agent-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, status, task: String(task).slice(0, 120) }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {}
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function writeReport(j) {
  try {
    mkdirSync(OS_ARTIFACTS, { recursive: true })
    const slug = `agent-${j.agent}-${new Date(j.created).toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${j.id.slice(-4)}`
    const secs = Math.round(((j.ended || Date.now()) - (j.started || j.created)) / 1000)
    const ok = j.status === 'done'
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(j.agentName)} · ${esc(j.task.slice(0, 60))}</title>
<style>body{margin:0;background:#0c0b09;color:#e8e2d2;font:15px/1.65 system-ui,sans-serif}.w{max-width:780px;margin:0 auto;padding:48px 28px}
.k{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#ff6b1a}h1{font-size:26px;margin:8px 0 6px}.t{color:#a9a294;margin-bottom:22px}
.m{display:flex;gap:22px;flex-wrap:wrap;font-size:12px;color:#a9a294;border-top:1px solid #2a2721;border-bottom:1px solid #2a2721;padding:10px 0;margin-bottom:24px}
.m b{display:block;color:#e8e2d2;font-size:13px}pre{white-space:pre-wrap;background:#161512;border-radius:8px;padding:18px;font:13px/1.6 ui-monospace,monospace}</style></head>
<body><div class="w"><div class="k">GTD Vault · queued agent</div><h1>${esc(j.agentName)}</h1><div class="t">${esc(j.task)}</div>
<div class="m"><div>Status<b>${ok ? 'Done' : esc(j.status)}</b></div><div>Model<b>${esc(j.model)}</b></div><div>Took<b>${secs}s</b></div>${j.costUsd != null ? `<div>Cost<b>$${Number(j.costUsd).toFixed(2)}</b></div>` : ''}<div>Finished<b>${esc(new Date(j.ended || Date.now()).toLocaleString())}</b></div></div>
<pre>${esc(j.result || j.error || '(no output)')}</pre></div></body></html>`
    writeFileSync(join(OS_ARTIFACTS, slug + '.html'), html)
    writeFileSync(join(OS_ARTIFACTS, slug + '.json'), JSON.stringify({
      title: `${j.agentName} · ${j.task.slice(0, 40)}`, icon: 'bolt', kind: 'agent', category: 'other',
      created: new Date(j.created).toISOString(), note: `${ok ? 'done' : j.status} · ${secs}s · ${j.task.slice(0, 80)}`,
      svg: ok ? '<circle cx="24" cy="18" r="7"/><path d="M12 40c2-8 7-12 12-12s10 4 12 12"/><path d="M19 18l3 3 6-6"/>' : '<circle cx="24" cy="24" r="15"/><path d="M18 18l12 12M30 18L18 30"/>',
    }, null, 2))
    return '/artifacts/' + slug + '.html'
  } catch (e) {
    console.error('[gtd] report failed', e.message)
    return null
  }
}

function pump() {
  while (running < JOB_CONCURRENCY && queue.length) runJob(queue.shift())
}

function runJob(j) {
  running++
  j.status = 'running'; j.started = Date.now()
  setInstance(j.id, { status: 'running', started: j.started })
  emit(j); rubricStatus(j.agent === 'general' ? 'gtd-vault' : j.agent, 'active', j.task)
  const args = ['-p', j.task, '--output-format', 'stream-json', '--verbose',
    '--model', j.model, '--effort', j.effort,
    // edits inside the working folder are allowed; anything else needs a declared permission
    '--permission-mode', 'acceptEdits', '--setting-sources', 'project',
    '--append-system-prompt', JOB_RULES]
  if (j.agent !== 'general') args.push('--agent', j.agent)
  if (j.permissions.length) args.push('--allowedTools', j.permissions.join(','))
  mkdirSync(JOB_LOG_DIR, { recursive: true })
  const logFile = join(JOB_LOG_DIR, `${j.id}.jsonl`)
  const child = spawn(CLAUDE_BIN, args, {
    cwd: VAULT,
    // GTD_JOB tells the vault's chat-log hook to stay quiet (a job is not a chat);
    // RUBRIC_AGENT_ID makes the status hook report under this agent, not gtd-vault
    env: { ...process.env, GTD_JOB: '1', RUBRIC_AGENT_ID: j.agent === 'general' ? 'gtd-vault' : j.agent },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  j.child = child
  const timer = setTimeout(() => { j.error = `Stopped after ${JOB_TIMEOUT_MS / 60000} minutes.`; child.kill('SIGTERM') }, JOB_TIMEOUT_MS)
  let buf = ''
  child.stdout.on('data', (d) => {
    appendFileSync(logFile, d)
    buf += d
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      let m; try { m = JSON.parse(line) } catch { continue }
      recordStream(j.id, m)
      trackTask(m, j.id)
      if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) {
          if (b.type === 'tool_use') {
            j.last = b.name.replace(/^mcp__/, '').replace(/__/g, ' · '); emit(j)
            trackToolUse(ownerOf(m.parent_tool_use_id, j.id), b)
          }
        }
      }
      if (m.type === 'user') {
        for (const b of m.message?.content ?? []) if (b?.type === 'tool_result') trackToolResult(b)
      }
      if (m.type === 'result') {
        j.result = m.result ?? ''
        j.costUsd = m.total_cost_usd ?? null
        if (m.subtype !== 'success') j.error = `Ended: ${m.subtype}`
      }
    }
  })
  let errTail = ''
  child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000) })
  child.on('close', (code) => {
    clearTimeout(timer)
    running--
    j.ended = Date.now()
    j.status = j.cancelled ? 'cancelled' : (code === 0 && !j.error ? 'done' : 'failed')
    if (j.status === 'failed' && !j.error) j.error = errTail.trim() || `Exited with code ${code}.`
    delete j.child
    setInstance(j.id, { status: j.status === 'done' ? 'done' : 'failed', ended: j.ended })
    j.report = writeReport(j)
    setInstance(j.id, { report: j.report })
    emit(j)
    rubricStatus(j.agent === 'general' ? 'gtd-vault' : j.agent, 'idle', `${j.status}: ${j.task}`)
    pump()
  })
}

export function queueAgent(agentId, task, parent = 'petra') {
  const def = listAgents().find((a) => a.id === agentId)
  if (!def) return { error: `No agent called ${agentId}.` }
  const j = {
    id: 'job' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    agent: def.id, agentName: def.name, color: def.color, task: String(task).trim(),
    model: def.model || JOB_MODEL, effort: def.effort || JOB_EFFORT, permissions: def.permissions || [],
    status: 'queued', created: Date.now(), parent,
  }
  jobs.set(j.id, j)
  addInstance({ iid: j.id, agent: j.agent, parent, label: j.task, status: 'queued' })
  recordEvent(j.id, { k: 'prompt', text: j.task })
  queue.push(j)
  emit(j)
  pump()
  return { job: publicJob(j), position: queue.indexOf(j) + 1 }
}

export function cancelJob(id) {
  const j = jobs.get(id)
  if (!j) return false
  j.cancelled = true
  const qi = queue.indexOf(j)
  if (qi >= 0) { queue.splice(qi, 1); j.status = 'cancelled'; j.ended = Date.now(); emit(j); setInstance(j.id, { status: 'failed', ended: j.ended }); return true }
  j.child?.kill('SIGTERM')
  return true
}

const ok = (text) => ({ content: [{ type: 'text', text }] })

export function gtdServer() {
  return createSdkMcpServer({
    name: 'gtd',
    version: '1.0.0',
    tools: [
      tool('list_agents', 'List the background agents that can be queued, with what each is for. "general" is a plain GTD Vault session for anything no specialist covers.', {}, async () =>
        ok(listAgents().map((a) => `${a.id}: ${a.description}`).join('\n'))),
      tool('queue_agent', 'Queue a task for a background agent. It runs as its own Claude session in the vault, shows on the OS and the Rubric console while it works, and leaves a report on the OS ring. The agent cannot hear this conversation, so write the task as a complete, self-contained brief.', {
        agent: z.string().describe('Agent id from list_agents, or "general".'),
        task: z.string().min(4).describe('The full brief for the agent.'),
      }, async ({ agent, task }) => {
        const r = queueAgent(agent, task)
        if (r.error) return ok(r.error + ' Use list_agents, or "general".')
        return ok(`Queued ${r.job.agentName} as ${r.job.id}${r.position > 0 ? `, number ${r.position} in the queue` : ', starting now'}.`)
      }),
      tool('agent_jobs', 'What the background agents are doing: queued, running, and recently finished jobs with their results.', {}, async () => {
        const list = allJobs()
        if (!list.length) return ok('No jobs yet.')
        return ok(list.slice(0, 10).map((j) => `${j.id} · ${j.agentName} · ${j.status}${j.last && j.status === 'running' ? ` (${j.last})` : ''} · ${j.task.slice(0, 100)}${j.result ? `\n  result: ${j.result.slice(0, 400)}` : ''}`).join('\n'))
      }),
      tool('cancel_job', 'Stop a queued or running background job.', { id: z.string() }, async ({ id }) =>
        ok(cancelJob(id) ? `Cancelled ${id}.` : `No job ${id}.`)),
    ],
  })
}

/* ------------------------------------------------------------ local STT */

let stt = null
let sttSeq = 0
const sttWaiting = new Map()
/* Parakeet on the GPU (stt_mlx.py, ~0.1 s a question) first; faster-whisper on the CPU
   (stt_worker.py, ~1 s) only if Parakeet will not load */
let sttMlxFailed = process.env.GTD_STT_ENGINE === 'whisper'
function sttWorker() {
  if (stt && !stt.killed) return stt
  const mlx = !sttMlxFailed && process.platform === 'darwin' && process.arch === 'arm64'   // Parakeet on MLX is Apple Silicon only
  stt = mlx
    ? spawn(join(homedir(), 'Coding/jarvis/.tts-venv/bin/python'), [join(HERE, 'stt_mlx.py')], { stdio: ['pipe', 'pipe', 'ignore'] })
    : spawn(PYTHON, [join(HERE, 'stt_worker.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const me = stt
  let buf = ''
  stt.stdout.on('data', (d) => {
    buf += d
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      let m; try { m = JSON.parse(line) } catch { continue }
      if ('ready' in m) {
        if (m.ready) console.log(`[gtd] speech-to-text ready (${mlx ? 'Parakeet, GPU' : 'faster-whisper'} ${m.model})`)
        else if (mlx) { console.error('[gtd] Parakeet failed to load, using faster-whisper:', m.error); sttMlxFailed = true }
        continue
      }
      const w = sttWaiting.get(m.id)
      if (w) { sttWaiting.delete(m.id); w(m) }
    }
  })
  me.on('exit', () => { if (stt === me) stt = null; for (const [, w] of sttWaiting) w({ error: 'speech worker stopped' }); sttWaiting.clear() })
  return stt
}
export const warmStt = () => { if (GTD) sttWorker() }

/** base64 audio from the browser -> text, transcribed on this machine */
export function transcribe(b64, mime) {
  return new Promise((resolve) => {
    const ext = /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'webm'
    const file = join(tmpdir(), `gtd-stt-${Date.now()}-${++sttSeq}.${ext}`)
    try { writeFileSync(file, Buffer.from(b64, 'base64')) } catch (e) { return resolve({ error: e.message }) }
    const id = 's' + sttSeq
    const done = (m) => { try { unlinkSync(file) } catch {} ; resolve(m) }
    const t = setTimeout(() => { sttWaiting.delete(id); done({ error: 'transcription timed out' }) }, 45_000)
    sttWaiting.set(id, (m) => { clearTimeout(t); done(m) })
    sttWorker().stdin.write(JSON.stringify({ id, path: file }) + '\n')
  })
}

/* ---------------------------------------------------- session continuity */

/* One conversation survives a page reload: a new socket within this window
   resumes the last session, so the chat note and the context carry on. */
const RESUME_MS = Number(process.env.GTD_RESUME_MIN || 180) * 60_000
let lastSession = { id: null, at: 0 }
export const rememberSession = (id) => { if (id) lastSession = { id, at: Date.now() } }
export const touchSession = () => { if (lastSession.id) lastSession.at = Date.now() }
export const resumableSession = () => (lastSession.id && Date.now() - lastSession.at < RESUME_MS ? lastSession.id : undefined)


/* -------------------------------------------------------------- activity */
/* Who is working, who called them, and which files each has touched. Petra is
   the voice session; every queued job and every Agent-tool call (by Petra or by a
   job) is an instance with a parent, so the OS can draw agents calling agents. */

const instances = new Map()
const FILE_TOOLS = { Read: 'read', Grep: 'read', Glob: 'read', NotebookRead: 'read', Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit' }
const RANK = { read: 1, edit: 2, write: 3 }
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const BUILTIN_NAMES = { 'general-purpose': 'General', Explore: 'Explorer', Plan: 'Planner', 'claude-code-guide': 'Guide', 'statusline-setup': 'Setup' }
let agentCache = { at: 0, list: [] }
function agentMeta(id) {
  if (Date.now() - agentCache.at > 10_000) agentCache = { at: Date.now(), list: listAgents() }
  const a = agentCache.list.find((x) => x.id === id)
  if (a) return { name: a.name, color: a.color, department: a.department || '' }
  return { name: BUILTIN_NAMES[id] || String(id).split(/[-_]/).map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' '), color: '#8FA6DF', department: '' }
}
const activityListeners = new Set()
export const onActivity = (fn) => (activityListeners.add(fn), () => activityListeners.delete(fn))
let petraStatus = 'idle'
let flushTimer = null
export function activitySnapshot() {
  const now = Date.now()
  /* GTD 22 Oct 2026: Luke wants every manager and agent visible, so finished ones are no
     longer pruned after 3 min; only plain subagents older than 12 h are dropped */
  for (const [k, v] of instances) if (v.ended && v.kind !== 'manager' && now - v.ended > 12 * 3600_000) instances.delete(k)
  /* a copy still open whose caller is gone or finished can never hear back: close it */
  for (const v of instances.values()) {
    if (!OPEN(v) || v.iid === 'petra' || !v.parent || v.parent === 'petra') continue
    const p = instances.get(v.parent)
    if (!p || (p.ended && now - p.ended > 60_000)) { v.status = 'done'; v.ended = now; endChildren(v.iid, 'done', now) }
  }
  return {
    petra: { status: petraStatus, files: (instances.get('petra')?.files || []).slice(-40) },
    instances: [...instances.values()].filter((i) => i.iid !== 'petra'),
    agents: listAgents().filter((a) => a.id !== 'general').map((a) => ({ id: a.id, name: a.name, color: a.color, department: a.department })),
  }
}
function flush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const snap = activitySnapshot()
    for (const fn of activityListeners) { try { fn(snap) } catch {} }
  }, 120)
}
function addInstance({ iid, agent, parent, label, status }) {
  const meta = agentMeta(agent)
  instances.set(iid, { iid, agent, name: meta.name, color: meta.color, department: meta.department, parent: parent || 'petra',
    label: String(label || '').slice(0, 160), status: status || 'running', created: Date.now(), started: status === 'running' ? Date.now() : null, ended: null, files: [], report: null })
  flush()
}
function setInstance(iid, patch) {
  const i = instances.get(iid); if (!i) return
  Object.assign(i, patch)
  if (patch.ended) endChildren(iid, patch.status === 'failed' ? 'failed' : 'done', patch.ended)
  flush()
}
/* GTD 2 Nov 2026: a job or manager that ends takes its subagents with it. A subagent whose
   result never came back (its job was stopped or crashed) stayed "running" for good and kept
   orbiting Petra; an Alpha Carrier Page Builder copy did for three days. */
const OPEN = (i) => i.status === 'running' || i.status === 'queued'
function endChildren(iid, status, at) {
  for (const c of instances.values()) if (c.parent === iid && OPEN(c)) { c.status = status; c.ended = at; endChildren(c.iid, status, at) }
}
/* for agents that are not in Agents/ (Petra's managers): name and colour given directly */
export function registerInstance({ iid, agent, name, color, parent, label, status, kind }) {
  instances.set(iid, { iid, agent, name, color: color || '#7DA0FF', department: '', parent: parent || 'petra', kind: kind || '',
    label: String(label || '').slice(0, 160), status: status || 'running', created: Date.now(), started: status === 'running' ? Date.now() : null, ended: null, files: [], report: null })
  flush()
}
export const updateInstance = (iid, patch) => setInstance(iid, patch)
export const hasInstance = (iid) => instances.has(iid)
if (!instances.has('petra')) instances.set('petra', { iid: 'petra', agent: 'petra', files: [] })

/** which instance a stream message belongs to: a subagent's own id, or the session's root */
export function ownerOf(parentToolUseId, root) {
  return parentToolUseId && instances.has(parentToolUseId) ? parentToolUseId : root
}
function vaultRel(p) {
  if (typeof p !== 'string' || !p) return null
  const abs = resolvePath(VAULT, p)
  if (!(abs === VAULT || abs.startsWith(VAULT_PREFIX))) return null
  return abs.slice(VAULT_PREFIX.length) || '.'
}
export function trackToolUse(owner, block) {
  const input = block.input || {}
  if (AGENT_TOOLS.has(block.name)) {
    addInstance({ iid: block.id, agent: input.subagent_type || 'general-purpose', parent: owner, label: input.description || input.prompt || '', status: 'running' })
    const inst = instances.get(block.id)
    inst.root = instances.get(owner)?.root || owner
    if (input.run_in_background) inst.bg = true
    return
  }
  const op = FILE_TOOLS[block.name]
  if (!op) return
  const rel = vaultRel(input.file_path || input.notebook_path || input.path)
  if (!rel || rel.startsWith('.claude/') || rel === '.') return
  const inst = instances.get(owner)
  if (!inst) return
  const hit = inst.files.find((f) => f.path === rel)
  if (hit) { if (RANK[op] > RANK[hit.op]) hit.op = op; hit.at = Date.now() }
  else { inst.files.push({ path: rel, op, at: Date.now() }); if (inst.files.length > 80) inst.files.shift() }
  flush()
}
export function trackToolResult(block) {
  const inst = instances.get(block.tool_use_id)
  if (!inst || inst.ended) return
  if (inst.bg && !block.is_error) return          // "Async agent launched": it has only started, see trackTask
  setInstance(block.tool_use_id, { status: block.is_error ? 'failed' : 'done', ended: Date.now() })
}
/* GTD 5 Nov 2026: background helpers. An Agent call with run_in_background answers at once
   ("Async agent launched"), so its copy was marked done the moment it started and never showed
   on the OS. It now stays running until the SDK says it settled: task_notification (an edge,
   keyed by the Agent call's tool_use_id), or its task missing from background_tasks_changed
   (the level, per session) when that bookend never comes. `root` is the session the stream
   belongs to (a manager id, a job id, or 'petra'), so one session's level never closes another's. */
const taskOwner = new Map()   // SDK task_id -> instance iid
export function trackTask(msg, root) {
  if (msg?.type !== 'system') return
  if (msg.subtype === 'task_started' && msg.tool_use_id && instances.has(msg.tool_use_id)) {
    instances.get(msg.tool_use_id).task = msg.task_id; taskOwner.set(msg.task_id, msg.tool_use_id)
  } else if (msg.subtype === 'task_updated' && msg.patch?.is_backgrounded) {
    const inst = instances.get(taskOwner.get(msg.task_id)); if (inst) inst.bg = true     // a foreground helper sent to the background
  } else if (msg.subtype === 'task_notification') {
    const iid = msg.tool_use_id || taskOwner.get(msg.task_id), inst = instances.get(iid)
    taskOwner.delete(msg.task_id)
    if (inst && OPEN(inst)) setInstance(iid, { status: msg.status === 'completed' ? 'done' : 'failed', ended: Date.now() })
  } else if (msg.subtype === 'background_tasks_changed') {
    const live = new Set((msg.tasks || []).map((x) => x.task_id))
    setTimeout(() => {      // the level comes just before the bookend; give the notification first say on done or failed
      for (const inst of instances.values()) if (inst.bg && inst.task && inst.root === root && OPEN(inst) && !live.has(inst.task)) setInstance(inst.iid, { status: 'done', ended: Date.now() })
    }, 2000)
  }
}
export function setPetra(status) { if (petraStatus !== status) { petraStatus = status; flush() } }

/* ----------------------------------------------------------- transcripts */
/* What each subagent is doing, for the OS chat (20 Oct 2026): click a subagent and its
   own conversation opens beside the Second Brain. Every instance above (an Agent-tool
   call, a queued job) keeps its last 400 events: its brief, its text, each tool call with
   a one-line summary, and each result. Jobs that ran before a bridge restart are read
   back from their stream-json log in .gtd-jobs/. */
const transcripts = new Map()
const trListeners = new Set()
export const onTranscript = (fn) => (trListeners.add(fn), () => trListeners.delete(fn))
const clip = (v, n) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t }
const relOrAbs = (p) => (typeof p === 'string' ? (vaultRel(p) || p) : '')
export function toolSummary(name, input = {}) {
  const n = String(name || '')
  if (n === 'Read' || n === 'Write' || n === 'Edit' || n === 'MultiEdit' || n === 'NotebookEdit') return relOrAbs(input.file_path || input.notebook_path)
  if (n === 'Bash') return clip(input.description || input.command, 160)
  if (n === 'Grep') return clip(`${input.pattern ?? ''}${input.path ? '  in ' + relOrAbs(input.path) : ''}`, 160)
  if (n === 'Glob') return clip(input.pattern, 160)
  if (n === 'Agent' || n === 'Task') return clip(`${input.subagent_type || 'general-purpose'}: ${input.description || input.prompt || ''}`, 160)
  if (n === 'WebFetch') return clip(input.url, 160)
  if (n === 'WebSearch') return clip(input.query, 160)
  if (n === 'Skill') return clip(input.skill || input.name, 120)
  if (n === 'TodoWrite') return (input.todos || []).map((t) => (t.status === 'completed' ? '✓ ' : t.status === 'in_progress' ? '▸ ' : '· ') + (t.content || '')).join('\n').slice(0, 600)
  const first = Object.values(input).find((v) => typeof v === 'string')
  return clip(first || '', 140)
}
export const toolLabel = (name) => String(name || '').replace(/^mcp__/, '').replace(/__/g, ' · ')
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : x?.type === 'image' ? '[image]' : '')).join('\n') : '')
function pushEvent(store, iid, ev) {
  let a = store.get(iid)
  if (!a) { a = []; store.set(iid, a); if (store.size > 200) store.delete(store.keys().next().value) }
  a.push(ev); if (a.length > 400) a.splice(0, a.length - 400)
}
export function recordEvent(iid, ev) {
  ev.at = ev.at || Date.now()
  pushEvent(transcripts, iid, ev)
  for (const fn of trListeners) { try { fn(iid, ev) } catch {} }
}
/** one stream message (SDK or CLI stream-json), filed under whichever instance sent it */
function eventsOf(m) {
  const out = []
  const content = m.message?.content
  if (m.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) out.push({ k: 'text', text: clip(b.text, 8000) })
      else if (b.type === 'tool_use') out.push({ k: 'tool', id: b.id, name: toolLabel(b.name), summary: toolSummary(b.name, b.input) })
    }
  } else if (m.type === 'user') {
    if (typeof content === 'string') out.push({ k: 'prompt', text: clip(content, 4000) })
    else if (Array.isArray(content)) for (const b of content) {
      if (b?.type === 'tool_result') out.push({ k: 'result', id: b.tool_use_id, ok: b.is_error !== true, preview: clip(resultText(b.content), 700) })
      else if (b?.type === 'text' && b.text?.trim()) out.push({ k: 'prompt', text: clip(b.text, 4000) })
    }
  }
  return out
}
/** record a stream message. onlySub: skip the session's own top level (the chat keeps that itself) */
export function recordStream(root, m, onlySub = false) {
  if (onlySub && !m.parent_tool_use_id) return
  const owner = ownerOf(m.parent_tool_use_id, root)
  if (onlySub && owner === root) return
  for (const ev of eventsOf(m)) recordEvent(owner, ev)
}
export function getTranscript(iid) {
  if (transcripts.has(iid)) return transcripts.get(iid)
  const f = join(JOB_LOG_DIR, `${String(iid).replace(/[^\w.-]/g, '')}.jsonl`)
  if (!existsSync(f)) return []
  const tmp = new Map()
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.parent_tool_use_id) continue          // its subagents have their own entries
    for (const ev of eventsOf(m)) pushEvent(tmp, iid, ev)
  }
  return tmp.get(iid) || []
}

/* ------------------------------------------------------------------- TTS */
/* Petra's voice. Voxtral TTS (Mistral 4B, MLX 4-bit, voice preset GTD_TTS_VOICE) runs in
   its own Python worker on this Mac's GPU and streams each sentence back in short chunks,
   so she starts speaking about a second after a sentence is written. If Voxtral is not
   available, Kokoro (af_heart) takes over with whole sentences. Both send the same
   messages: chunks of WAV, then done. */
const TTS_ENGINE = process.env.GTD_TTS_ENGINE || (process.platform === 'darwin' && process.arch === 'arm64' ? 'voxtral' : 'kokoro')   // Voxtral is Apple Silicon only
const VOX_VOICE = process.env.GTD_TTS_VOICE || 'casual_female'
const KOKORO_VOICE = 'af_heart'
const TTS_PY = join(homedir(), 'Coding/jarvis/.tts-venv/bin/python')
let ttsChain = Promise.resolve()

let vox = null, voxReady = null, voxDead = false
const voxWaiting = new Map()
function voxtral() {
  if (voxDead) return Promise.reject(new Error('Voxtral unavailable'))
  if (voxReady) return voxReady
  voxReady = new Promise((resolve, reject) => {
    vox = spawn(TTS_PY, [join(HERE, 'tts_worker.py')], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    vox.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        let m; try { m = JSON.parse(line) } catch { continue }
        if ('ready' in m) {
          if (m.ready) { console.log(`[gtd] Petra's voice ready (Voxtral ${VOX_VOICE})`); resolve(vox) }
          else { voxDead = true; reject(new Error(m.error || 'Voxtral failed to load')) }
          continue
        }
        const w = voxWaiting.get(m.id)
        if (w) w(m)
      }
    })
    vox.stderr.on('data', () => {})   // mlx and Hugging Face progress noise
    vox.on('exit', (code) => {
      console.error(`[gtd] Voxtral worker exited (${code}); Kokoro takes over until the bridge restarts`)
      voxDead = true; vox = null
      for (const [, w] of voxWaiting) w({ error: 'voice worker stopped' })
      voxWaiting.clear()
      reject(new Error('Voxtral worker exited'))
    })
  })
  voxReady.catch((e) => console.error('[gtd]', e.message))
  return voxReady
}
let voxSeq = 0
async function speakVoxtral(text, onChunk) {
  const w = await voxtral()
  const id = 'v' + (++voxSeq)
  return new Promise((resolve) => {
    const t = setTimeout(() => { voxWaiting.delete(id); resolve({ error: 'voice timed out' }) }, 60_000)
    voxWaiting.set(id, (m) => {
      if (m.audio) { onChunk(m.audio); return }
      clearTimeout(t); voxWaiting.delete(id)
      resolve(m.error ? { error: m.error } : {})
    })
    w.stdin.write(JSON.stringify({ id, text, voice: VOX_VOICE }) + '\n')
  })
}

let ttsModel = null
async function kokoro() {
  if (!ttsModel) {
    ttsModel = (async () => {
      const { KokoroTTS } = await import('kokoro-js')
      const m = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
      console.log(`[gtd] fallback voice ready (Kokoro ${KOKORO_VOICE})`)
      return m
    })().catch((e) => { ttsModel = null; throw e })
  }
  return ttsModel
}
async function speakKokoro(text, onChunk) {
  const m = await kokoro()
  const out = await m.generate(text, { voice: KOKORO_VOICE, speed: 1.0 })
  onChunk(Buffer.from(out.toWav()).toString('base64'))
  return {}
}

export const warmTts = () => {
  if (!GTD) return
  if (TTS_ENGINE === 'voxtral') voxtral().catch(() => kokoro().catch(() => {}))
  else kokoro().catch((e) => console.error('[gtd] voice failed to load', e.message))
}
/** one sentence -> audio chunks via onChunk(base64 wav), in order; resolves when finished */
export function synthesize(text, onChunk) {
  const clean = String(text).replace(/[*_#`>|~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600)
  const job = ttsChain.then(async () => {
    if (!clean) return {}
    if (TTS_ENGINE === 'voxtral' && !voxDead) {
      let sent = 0
      const r = await speakVoxtral(clean, (a) => { sent++; onChunk(a) }).catch((e) => ({ error: e.message }))
      if (!r.error || sent) return r
    }
    return speakKokoro(clean, onChunk)
  })
  ttsChain = job.catch(() => {})
  return job.catch((e) => ({ error: String(e.message || e) }))
}
