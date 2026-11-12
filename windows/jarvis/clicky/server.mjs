#!/usr/bin/env node
/* ================================================================
   Petra behind OpenClicky (GTD, 5 Nov 2026)

   OpenClicky (/Applications/OpenClicky.app, github.com/prasanthsasikumar/openclicky) sends
   every model call to one backend, set by `backendUrl` in ~/.openclicky/shell.json. This is
   that backend, on this Mac, so nothing goes to OpenClicky's servers and everything runs on
   Claude through the Agent SDK (Luke's Claude plan):

     POST /chat              Anthropic Messages, the shape the app sends.
                             The ⌃⌥ question (system prompt "you're openclicky, a friendly…") goes
                             to Petra, in her own "OpenClicky" tab on the Agentic OS through the
                             JARVIS bridge, with the screenshots; she answers with her tools,
                             managers and agents, and the reply streams back for the voice and
                             the pointer. Every other call (pointing refinement, drawings, the
                             app's small helpers) is a one-shot Agent SDK call with no tools.
     POST /tts               Petra's own voice (Voxtral on this Mac, through the bridge). Her
                             sentences are made while she is still writing, so the app's 2.5 s
                             first-piece deadline is met from the cache.
     POST /v1/polish         dictation clean-up, Haiku through the Agent SDK
     POST /v1/chat/completions   the same, in OpenAI's shape
     POST /agent/transcribe  speech to text through the bridge (Parakeet on this Mac)
     GET  /billing/me        "signed in, nothing spent", so the app never shows a limit

   Runs as launchd com.gettruckdrivers.petra-clicky on 127.0.0.1:8793; logs in
   ~/Coding/jarvis/clicky/clicky.log. To go back to OpenClicky's own servers, restore
   ~/.openclicky/shell.before-petra.json over shell.json and restart the app.
   ================================================================ */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { createVoiceAgent, VOICE_STYLE } from './voice-agent.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PETRA_CLICKY_PORT || 8793)
const BRIDGE = process.env.PETRA_CLICKY_BRIDGE || 'ws://localhost:8790'
const ORIGIN = 'http://localhost:50000'
const CLAUDE_BIN = process.env.JARVIS_CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude')
const STATE = path.join(HERE, 'state.json')
const RUN_DIR = path.join(HERE, 'run')
const LOG = path.join(HERE, 'clicky.log')
fs.mkdirSync(RUN_DIR, { recursive: true })

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.join(' ')
  console.log(line)
  try { fs.appendFileSync(LOG, line + '\n') } catch {}
}
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } }
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1))

/* ------------------------------------------------------------ the bridge */
let ws = null, wsReady = null
const listeners = new Set()
function bridge() {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws)
  if (wsReady) return wsReady
  wsReady = new Promise((resolve, reject) => {
    const s = new WebSocket(BRIDGE, { headers: { Origin: ORIGIN } })
    const fail = (e) => { wsReady = null; reject(e) }
    s.once('open', () => { ws = s; wsReady = null; resolve(s) })
    s.once('error', fail)
    s.on('message', (d) => {
      let m; try { m = JSON.parse(d) } catch { return }
      if (m.type === 'chat' && m.ev) noteTabEvent(m.ev)
      for (const fn of listeners) { try { fn(m) } catch {} }
    })
    s.on('close', () => { if (ws === s) ws = null })
  })
  return wsReady
}
async function send(msg) { (await bridge()).send(JSON.stringify(msg)) }
/* the first message matching `test`, or null after `ms` */
function waitFor(test, ms) {
  return new Promise((resolve) => {
    const fn = (m) => { if (test(m)) { listeners.delete(fn); clearTimeout(t); resolve(m) } }
    const t = setTimeout(() => { listeners.delete(fn); resolve(null) }, ms)
    listeners.add(fn)
  })
}

/* ------------------------------------------------------------ Petra's OpenClicky tab */
const busy = new Map()          // tab id -> busy, from the bridge's status and tabs events
function noteTabEvent(ev) {
  if (ev.k === 'status' && ev.tab) busy.set(ev.tab, !!ev.busy)
  if (ev.k === 'tabs' && Array.isArray(ev.tabs)) for (const t of ev.tabs) busy.set(t.id, !!t.busy)
}
async function openTabs() {
  await send({ type: 'chat-tabs' })
  const m = await waitFor((x) => x.type === 'chat-tabs', 5000)
  if (!m) throw new Error('the bridge did not list its tabs')
  for (const t of m.tabs) busy.set(t.id, !!t.busy)
  return m.tabs
}
/* the tab OpenClicky talks in: kept across restarts, made again if Luke closed it */
async function clickyTab() {
  const st = readState()
  const tabs = await openTabs()
  if (st.tab && tabs.some((t) => t.id === st.tab)) return st.tab
  const known = new Set(tabs.map((t) => t.id))
  const made = waitFor((m) => m.type === 'chat' && m.ev?.k === 'tabs' && m.ev.focus && !known.has(m.ev.focus), 5000)
  await send({ type: 'chat-new-tab' })
  const m = await made
  if (!m) throw new Error('the bridge did not make a tab')
  writeState({ ...st, tab: m.ev.focus })
  log('made the OpenClicky tab', m.ev.focus)
  return m.ev.focus
}

/* One turn with Petra. Turns go one at a time; if the tab is still busy (Luke typing there, or
   an earlier turn), the message waits in Petra's inbox and the reply is the turn after it. */
let chain = Promise.resolve()
function petraTurn(opts) {
  const run = chain.then(() => petraTurnNow(opts), () => petraTurnNow(opts))
  chain = run.catch(() => {})
  return run
}
async function petraTurnNow({ text, display, images, onDelta, onTool, onPerm, isGone }) {
  const tab = await clickyTab()
  let skipDone = busy.get(tab) ? 1 : 0          // the turn already running finishes first
  let out = '', ended = false, sawTool = false
  return await new Promise((resolve) => {
    const finish = (r) => { if (ended) return; ended = true; listeners.delete(fn); clearTimeout(cap); resolve({ ...r, text: out, tab }) }
    const cap = setTimeout(() => finish({ ok: false, error: 'timed out' }), 280_000)
    const fn = (m) => {
      if (m.type !== 'chat' || !m.ev || m.ev.tab !== tab) return
      const ev = m.ev
      if (skipDone) { if (ev.k === 'done' || ev.k === 'error') skipDone--; return }
      if (ev.k === 'delta' && ev.text) {
        let piece = ev.text
        if (sawTool && out && !/\s$/.test(out)) piece = ' ' + piece.replace(/^\s+/, '')
        sawTool = false
        out += piece; if (!isGone()) onDelta(piece)
      } else if (ev.k === 'tool') { sawTool = true; onTool?.(ev) }
      else if (ev.k === 'perm') onPerm?.(ev)
      else if (ev.k === 'done') finish({ ok: ev.ok !== false })
      else if (ev.k === 'error') finish({ ok: false, error: ev.text })
    }
    listeners.add(fn)
    send({ type: 'chat-send', tab, text, display, voice: true, images }).catch((e) => finish({ ok: false, error: e.message }))
  })
}

/* ------------------------------------------------------------ what Petra is told */
const ASK_SIGNATURE = /^\s*you're (openclicky|the agentic os voice agent), a friendly always-on companion/i   // the app's main ask, old and new wording
const textOf = (sys) => typeof sys === 'string' ? sys : Array.isArray(sys) ? sys.map((b) => b?.text || '').join('\n\n') : ''

function actionsBlock(tools) {
  if (!tools?.length) return ''
  const lines = [
    'Quick actions: you can do these things on Luke\'s Mac through the Agentic OS Voice Agent.',
    'To do one, write your spoken words first, then put the action on a line of its own:',
    '[ACTION: <action name> <arguments as one JSON object>]',
    'Use at most 2 actions, only the ones listed below, with arguments that match their schema.',
    'Never mention or read out the action line; say in plain words what you are doing. If no action fits, write no action line.',
    'Actions:',
  ]
  for (const t of tools) lines.push(`- ${t.name}: ${t.description || ''} Arguments: ${JSON.stringify(t.input_schema || {})}`)
  return lines.join('\n')
}

function petraMessage(body) {
  const msgs = body.messages || []
  const last = msgs[msgs.length - 1] || { content: [] }
  const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content || []
  const images = [], labels = []
  let pendingLabel = null, question = ''
  blocks.forEach((b, i) => {
    if (b.type === 'image' && b.source?.type === 'base64') {
      images.push({ type: b.source.media_type, data: b.source.data, name: `screen ${images.length + 1}` })
      labels.push(`Image ${images.length}: ${pendingLabel || 'a screenshot'}`)
      pendingLabel = null
    } else if (b.type === 'text') {
      const nextIsImage = blocks[i + 1]?.type === 'image'
      if (nextIsImage) pendingLabel = b.text
      else question += (question ? '\n' : '') + b.text
    }
  })
  /* the question is always the last text block; the ones before it caption the screenshots */
  const lastText = [...blocks].reverse().find((b) => b.type === 'text')?.text || question
  const said = lastText.split(/\n\n\[/)[0].trim()
  const text = `(Voice Agent) ${question.trim()}

<voice-agent>
Luke said this out loud to the Agentic OS Voice Agent on his Mac, and it is you answering. He is not looking at this chat: he hears your reply in your voice and sees the Agentic OS pointer. ${images.length ? `His screen is attached above (${labels.join('; ')}).` : ''}
For this reply follow the Voice Agent's reply rules below, with these changes:
- You are Petra. Wherever the rules say "the agentic os voice agent" or "openclicky", that is you. You keep every tool, manager and agent you normally have.
- Open with a short first sentence, under ten words, so your voice starts straight away. Say one short line before any tool call ("Let me look."), then call it.
- Something to do on his screen (put photos into FigJam, click through an app, fill something in): send a screen agent with start_screen_agent (prepare the files first, or have a manager do it and send the screen agent itself), and say in one sentence that it is on its way. He will see the Agentic OS pointer working on his screen.
- Real work (building, writing, research, files, anything over a minute): hand it to a manager or agent as you normally would, so it shows on his dashboard and reports back there, and say in one sentence that it has started. Do not do long work yourself in this turn: he is waiting to hear you.
- No markdown, lists, links, file paths or wiki links in what you say. Spoken words only, plus the tags the rules ask for. No ellipses; say numbers as words. Vary your wording from one reply to the next.

The Voice Agent's reply rules:
${textOf(body.system)}
${actionsBlock(body.tools)}
</voice-agent>`
  const shot = blocks.find((b) => b.type === 'image' && b.source?.type === 'base64')
  return { text, display: (said || question.trim()).slice(0, 2000), images, said: said || question.trim(), screenshotBlock: shot ? { type: 'image', source: shot.source } : null }
}

/* [ACTION: name {json}] lines: kept out of the voice, returned as tool calls */
class ActionFilter {
  constructor(on) { this.on = !!on; this.held = '' }
  feed(t) {
    if (!this.on) return t
    this.held += t
    let out = ''
    for (;;) {
      const i = this.held.indexOf('[')
      if (i < 0) { out += this.held; this.held = ''; break }
      out += this.held.slice(0, i); this.held = this.held.slice(i)
      const head = this.held.slice(0, 7).toUpperCase()
      if (!'[ACTION'.startsWith(head) && !head.startsWith('[ACTION')) { out += this.held[0]; this.held = this.held.slice(1); continue }
      if (head.length < 7) break                         // could still become [ACTION
      const end = this.held.indexOf('\n')
      if (end < 0) break                                 // the action line is still arriving
      this.held = this.held.slice(end + 1)
    }
    return out
  }
  finish() { const h = this.held; this.held = ''; return this.on && /^\[ACTION/i.test(h) ? '' : h }
}
function parseActions(text, tools) {
  const names = new Set((tools || []).map((t) => t.name))
  const calls = []
  for (const m of text.matchAll(/\[\s*ACTION\s*:?\s*([A-Za-z_][\w-]*)\s*(\{[\s\S]*?\})\s*\]?/gi)) {
    if (!names.has(m[1]) || calls.length >= 2) continue
    try { const input = JSON.parse(m[2]); if (input && typeof input === 'object') calls.push({ name: m[1], input }) } catch {}
  }
  return calls
}

/* ------------------------------------------------------------ Petra's voice */
const MARKERS = /\[POINT:[^\]]*\]|\[\s*next\s*\]|\[\s*unsure\s*\]|^\s*\[ACTION[^\n]*$/gim
const norm = (s) => String(s).replace(MARKERS, ' ').replace(/[*_#`>|~]/g, '').replace(/\s+/g, ' ').trim()
/* sentences the way the app's SpokenChunker ends them: . ! ? followed by a space, or a new line */
function sentences(text) {
  const out = []
  let rest = String(text)
  for (;;) {
    const m = rest.match(/^([\s\S]*?(?:[.!?](?=\s)|\n))/)
    if (!m) break
    const s = norm(m[1]); if (s) out.push(s)
    rest = rest.slice(m[1].length)
  }
  return { done: out, rest }
}
/* the same ends, keeping the raw text (tags and spacing) that goes to the app */
function rawSentences(text) {
  const parts = []
  let rest = String(text)
  for (;;) {
    const m = rest.match(/^([\s\S]*?(?:[.!?](?=\s)|\n))/)
    if (!m) break
    parts.push(m[1]); rest = rest.slice(m[1].length)
  }
  return { parts, rest }
}
const voiceCache = new Map()     // sentence -> { at, audio: Promise<Buffer|null> }
let ttsSeq = 0
function synth(text) {
  if (va.elevenVoice()) return va.elevenTTS(text).then((a) => a || synthPetra(text))   // an ElevenLabs voice picked in the app's settings (mp3); hers if ElevenLabs fails
  return synthPetra(text)
}
function synthPetra(text) {
  const id = 'pc' + (++ttsSeq) + randomBytes(2).toString('hex')
  return new Promise((resolve) => {
    const chunks = []
    const off = () => { listeners.delete(fn); clearTimeout(t) }
    const t = setTimeout(() => { off(); resolve(null) }, 45_000)
    const fn = (m) => {
      if (m.type !== 'gtd-tts' || m.id !== id) return
      if (m.audio) chunks.push(Buffer.from(m.audio, 'base64'))
      if (m.done) { off(); resolve(m.error || !chunks.length ? null : joinWav(chunks)) }
    }
    listeners.add(fn)
    send({ type: 'gtd-tts', id, text }).catch(() => { off(); resolve(null) })
  })
}
/* the cache is per voice: a sentence made in Petra's voice is not played once an ElevenLabs voice is picked */
const voiceId = () => va.elevenVoice()?.voiceId || 'petra'
function voiceFor(sentence) {
  const now = Date.now()
  for (const [k, v] of voiceCache) if (now - v.at > 10 * 60_000) voiceCache.delete(k)
  const key = voiceId() + '|' + sentence
  let v = voiceCache.get(key)
  if (!v) {
    v = { at: now, audio: synth(sentence) }; voiceCache.set(key, v)
    v.audio.then((a) => { if (!a && voiceCache.get(key) === v) voiceCache.delete(key) })   // a failure is not kept: the next ask tries again
  } else v.at = now                                 // a hit keeps it: the Voice Agent re-warms its phrases every 5 min
  return v.audio
}
const voiceReady = (sentence) => voiceCache.has(voiceId() + '|' + sentence)
/* the worker sends whole small WAV files; one WAV out of their samples */
function joinWav(parts) {
  let fmt = null; const pcm = []
  for (const b of parts) {
    let i = 12
    while (i + 8 <= b.length) {
      const id = b.toString('ascii', i, i + 4), size = b.readUInt32LE(i + 4)
      if (id === 'fmt ' && !fmt) fmt = b.subarray(i + 8, i + 8 + size)
      if (id === 'data') { pcm.push(b.subarray(i + 8, Math.min(b.length, i + 8 + size))); break }
      i += 8 + size + (size % 2)
    }
  }
  if (!fmt) return parts[0]
  const data = Buffer.concat(pcm)
  const head = Buffer.alloc(12 + 8 + fmt.length + 8)
  head.write('RIFF', 0); head.writeUInt32LE(head.length - 8 + data.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(fmt.length, 16); fmt.copy(head, 20)
  head.write('data', 20 + fmt.length); head.writeUInt32LE(data.length, 24 + fmt.length)
  return Buffer.concat([head, data])
}

/* ------------------------------------------------------------ one-shot Agent SDK calls */
function sdkModel(m) {
  m = String(m || '')
  if (/haiku/i.test(m)) return 'claude-haiku-4-5-20251001'
  if (/opus/i.test(m)) return 'claude-opus-5-5'
  return 'claude-sonnet-5'
}
function sdkEnv() {
  const env = { ...process.env }
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_ENABLE_CFC', 'CLAUDE_CODE_ARTIFACT']) delete env[k]
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'
  return env
}
/* the earlier turns as text, then the last user message's own blocks (images and text) */
function oneMessage(messages) {
  const msgs = messages || []
  const last = msgs[msgs.length - 1]
  const lastBlocks = !last ? [] : typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
  const flat = (c) => typeof c === 'string' ? c : (c || []).map((b) => b.type === 'text' ? b.text : b.type === 'image' ? '[an image]' : '').join(' ')
  const earlier = msgs.slice(0, -1).map((m) => `${m.role === 'assistant' ? 'You' : 'User'}: ${flat(m.content)}`).join('\n')
  const blocks = (lastBlocks || []).filter((b) => b.type === 'text' || b.type === 'image').map((b) => b.type === 'image' && b.source?.type === 'url' ? { type: 'text', text: '[an image]' } : b)
  return earlier ? [{ type: 'text', text: 'Earlier in this conversation:\n' + earlier }, ...blocks] : blocks
}
async function sdkCall({ model, system, content, onDelta }) {
  const q = query({
    prompt: (async function* () { yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } })(),
    options: {
      cwd: RUN_DIR, pathToClaudeCodeExecutable: CLAUDE_BIN, model: sdkModel(model), systemPrompt: system || 'Answer briefly.',
      settingSources: [], tools: [], maxTurns: 1, persistSession: false, includePartialMessages: !!onDelta,
      mcpServers: {}, strictMcpConfig: true, thinking: { type: 'disabled' }, env: sdkEnv(),
    },
  })
  let out = '', streamed = ''
  for await (const m of q) {
    if (m.type === 'stream_event' && !m.parent_tool_use_id && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      streamed += m.event.delta.text; onDelta?.(m.event.delta.text)
    }
    if (m.type === 'result') {
      if (m.subtype !== 'success' || m.is_error) throw new Error(m.result || (m.errors || []).join(' ') || m.subtype)
      out = m.result || streamed
    }
  }
  return out
}

/* ------------------------------------------------------------ SSE in Anthropic's shape */
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const ev = (type, data) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`) }
  const id = 'msg_' + randomBytes(8).toString('hex')
  ev('message_start', { message: { id, type: 'message', role: 'assistant', model: 'petra', content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  const ping = setInterval(() => ev('ping', {}), 10_000)
  return {
    text: (t) => t && ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } }),
    end(calls = [], error) {
      clearInterval(ping)
      ev('content_block_stop', { index: 0 })
      calls.forEach((c, i) => {
        ev('content_block_start', { index: i + 1, content_block: { type: 'tool_use', id: 'toolu_' + randomBytes(8).toString('hex'), name: c.name, input: {} } })
        ev('content_block_delta', { index: i + 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } })
        ev('content_block_stop', { index: i + 1 })
      })
      if (error) ev('error', { error: { type: 'api_error', message: error } })
      ev('message_delta', { delta: { stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })
      ev('message_stop', {})
      res.end()
    },
    stop() { clearInterval(ping) },
  }
}
const message = (text, model) => ({ id: 'msg_' + randomBytes(8).toString('hex'), type: 'message', role: 'assistant', model: model || 'petra',
  content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } })

/* ------------------------------------------------------------ routes */
async function body(req, max = 40 * 1024 * 1024) {
  const chunks = []; let n = 0
  for await (const c of req) { n += c.length; if (n > max) throw new Error('too large'); chunks.push(c) }
  return Buffer.concat(chunks)
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

async function chat(req, res) {
  const b = JSON.parse((await body(req)).toString('utf8') || '{}')
  const sys = textOf(b.system)
  if (ASK_SIGNATURE.test(sys) && b.stream) return va.ask(b, req, res, petraMessage(b))   // the Voice Agent routes it (voice-agent.mjs)
  const t0 = Date.now()
  const content = oneMessage(b.messages)
  if (b.stream) {
    const out = sse(res)
    try { await sdkCall({ model: b.model, system: sys, content, onDelta: out.text }); out.end() }
    catch (e) { log('chat (one-shot) failed:', e.message); out.end([], e.message) }
  } else {
    try { const text = await sdkCall({ model: b.model, system: sys, content }); json(res, 200, message(text, b.model)) }
    catch (e) { log('chat (one-shot) failed:', e.message); json(res, 502, { type: 'error', error: { type: 'api_error', message: e.message } }) }
  }
  log(`chat one-shot ${sdkModel(b.model)} ${Date.now() - t0} ms`)
}

async function askPetra(b, req, res) {
  const t0 = Date.now()
  const { text, display, images } = petraMessage(b)
  const out = sse(res)
  let gone = false
  res.on('close', () => { gone = true; out.stop() })
  const filter = new ActionFilter(b.tools?.length)
  let pending = '', first = 0
  /* Each finished sentence starts on Petra's voice at once, and its text goes to the app only
     when that audio is ready (or after 25 s), so when the app asks /tts for a piece it is already
     made: the app's 2.5 s first-piece deadline is always met and the Mac voice never takes over. */
  const release = []
  let releasing = Promise.resolve()
  const send = (raw) => {
    const key = norm(raw)
    const ready = key ? Promise.race([voiceFor(key), new Promise((r) => setTimeout(r, 25000))]) : Promise.resolve()
    release.push(raw)
    releasing = releasing.then(() => ready).then(() => { out.text(release.shift()) })
  }
  const speakAhead = (t) => {
    pending += t
    const { parts, rest } = rawSentences(pending); pending = rest
    for (const raw of parts) send(raw)
  }
  const flushSpeech = async () => { if (pending) { const raw = pending; pending = ''; send(raw) } await releasing }
  const told = { perm: false }
  let saidSomething = false, handedOver = false
  /* when she starts using the computer (Petra Computer), the spoken reply ends there and she keeps
     working: OpenClicky is not kept waiting for the whole task */
  let handOver = null
  const handedOff = new Promise((res) => { handOver = res })
  const turn = petraTurn({
    text, display, images, isGone: () => gone || handedOver,
    onDelta: (t) => { if (!first) first = Date.now() - t0; const safe = filter.feed(t); if (safe.trim()) saidSomething = true; speakAhead(safe) },
    onPerm: () => { if (told.perm || gone) return; told.perm = true; speakAhead(' I need your OK on the dashboard for that.\n') },
    onTool: (ev) => { if (/computer/i.test(`${ev.name || ''} ${ev.raw || ''}`) && !handedOver) { handedOver = true; handOver() } },
  }).catch((e) => ({ ok: false, error: e.message, text: '' }))
  const r = await Promise.race([turn, handedOff.then(() => null)])
  if (r === null) {
    const tail = filter.finish(); if (tail) speakAhead(tail)
    if (!saidSomething) speakAhead("On it, I'm doing that on your screen now.\n")
    await flushSpeech()
    out.end([])
    log(`ask: Petra started using the computer after ${Date.now() - t0} ms; she carries on in her tab`)
    void turn.then((x) => log(`ask: computer task finished after ${Date.now() - t0} ms, ok ${x.ok}`))
    return
  }
  if (gone) { log(`ask: OpenClicky stopped listening after ${Date.now() - t0} ms; Petra finished in her tab`); return }
  const tail = filter.finish(); if (tail) speakAhead(tail)
  if (!r.ok && !r.text.trim()) {
    speakAhead(r.error === 'timed out' ? "That's taking me a while. I'll keep going on the dashboard.\n" : "I couldn't get that through to Petra just now.\n")
    log('ask failed:', r.error || 'no reply')
  }
  await flushSpeech()
  const calls = parseActions(r.text, b.tools)
  out.end(calls)
  log(`ask: ${images.length} screen(s), first words ${first} ms, done ${Date.now() - t0} ms, ${r.text.length} chars, actions ${calls.map((c) => c.name).join(',') || 'none'}`)
}

async function tts(req, res) {
  const b = JSON.parse((await body(req, 1024 * 1024)).toString('utf8') || '{}')
  const t0 = Date.now()
  const { done, rest } = sentences(String(b.text || '') + '\n')
  const parts = [...done, ...(norm(rest) ? [norm(rest)] : [])]
  if (!parts.length) return json(res, 400, { error: 'no text' })
  const hits = parts.filter(voiceReady).length
  const audio = await Promise.all(parts.map(voiceFor))
  if (audio.some((a) => !a)) { log('tts failed for', JSON.stringify(b.text).slice(0, 80)); return json(res, 503, { error: 'voice unavailable' }) }
  const mp3 = audio[0].toString('ascii', 0, 4) !== 'RIFF'                 // ElevenLabs pieces concatenate as one mp3 stream
  const wav = audio.length === 1 ? audio[0] : mp3 ? Buffer.concat(audio) : joinWav(audio)
  res.writeHead(200, { 'Content-Type': mp3 ? 'audio/mpeg' : 'audio/wav', 'Content-Length': wav.length }); res.end(wav)
  log(`tts ${parts.length} sentence(s), ${hits} made ahead, ${Date.now() - t0} ms`)
}

async function polish(req, res, openaiShape) {
  const b = JSON.parse((await body(req, 2 * 1024 * 1024)).toString('utf8') || '{}')
  let system = b.system || '', text = b.text || ''
  if (openaiShape) {
    system = (b.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    text = (b.messages || []).filter((m) => m.role !== 'system').map((m) => typeof m.content === 'string' ? m.content : (m.content || []).map((x) => x.text || '').join(' ')).join('\n\n')
  }
  try {
    const out = await sdkCall({ model: 'haiku', system, content: [{ type: 'text', text }] })
    if (openaiShape) json(res, 200, { id: 'chatcmpl-' + randomBytes(6).toString('hex'), object: 'chat.completion', model: 'claude-haiku', choices: [{ index: 0, message: { role: 'assistant', content: out }, finish_reason: 'stop' }] })
    else json(res, 200, { text: out })
  } catch (e) { log('polish failed:', e.message); json(res, 503, { error: e.message }) }
}

async function transcribe(req, res) {
  const b = JSON.parse((await body(req)).toString('utf8') || '{}')
  if (typeof b.audio !== 'string') return json(res, 400, { error: 'no audio' })
  const id = 'pcs' + randomBytes(4).toString('hex')
  const got = waitFor((m) => m.type === 'gtd-stt' && m.id === id, 60_000)
  await send({ type: 'gtd-stt', id, audio: b.audio, mime: b.mime || 'audio/wav' })
  const m = await got
  if (!m || m.error) return json(res, 503, { error: m?.error || 'transcription timed out' })
  json(res, 200, { text: m.text || '' })
}

function billing(res) {
  const now = new Date()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  json(res, 200, { byok: false, spentMonthUsd: 0, monthlyLimitUsd: 1000, spentTodayUsd: 0, dailyLimitUsd: 1000,
    ttsCharsMonth: 0, ttsCharsLimit: 100000000, monthEnd, dayEnd, budgetExhausted: false, blocked: false, plan: 'grant', onPlan: true })
}

/* the Voice Agent in front of Petra's chats: routing, announcements, tours, voices, dictation clean-up */
const va = createVoiceAgent({ send, waitFor, listeners, sdkCall, voiceFor, log, json, body, sse, askPetra, norm, sentences, petraTab: () => readState().tab || null })

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
  try {
    if (req.method === 'HEAD' || (req.method === 'GET' && (url === '/' || url === '/health'))) return json(res, 200, { ok: true, petra: true })
    if (req.method === 'POST' && url === '/chat') return await chat(req, res)
    if (req.method === 'POST' && url === '/tts') return await tts(req, res)
    if (req.method === 'POST' && url === '/v1/polish') return await polish(req, res, false)
    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) return await polish(req, res, true)
    if (req.method === 'POST' && url === '/agent/transcribe') return await transcribe(req, res)
    if (req.method === 'GET' && url === '/billing/me') return billing(res)
    if (await va.routes(req, res, url)) return                              // /events, /voices, /v1/freeflow, /voice/say
    log('not handled:', req.method, url)
    json(res, url.startsWith('/agent/realtime') || url === '/transcribe-token' ? 503 : 404, { error: 'not on Petra\'s local backend' })
  } catch (e) {
    log('error on', url, e.message)
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end()
  }
})
server.listen(PORT, '127.0.0.1', () => {
  log(`Petra's OpenClicky backend on http://127.0.0.1:${PORT}`)
  bridge().then(() => { log('bridge connected'); void synth('Ready.') }).catch((e) => log('bridge not reachable yet:', e.message))
})
