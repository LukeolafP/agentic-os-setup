/**
 * GTD: a real Claude Code terminal for the Agentic OS (20 Oct 2026).
 *
 * One long-lived terminal session on this Mac: a login shell started in the vault
 * that runs `claude` straight away, exactly as if Luke had opened Terminal, typed
 * `cd ~/Documents/GTD` and `claude`. So it is the whole of Claude Code, not a wrapper
 * around the SDK: the vault's CLAUDE.md, ~/.claude settings and permissions, every MCP
 * server, hooks, skills, the agents in Agents/, slash commands, /resume. When claude
 * exits, the shell stays open in the vault.
 *
 * The OS shows it as the CLAUDE CODE tab. The page is served from this bridge
 * (GET /term) and talks over a WebSocket on /term.
 *
 * Who can open it: only that page. The socket accepts exactly this bridge's own origin
 * (http://localhost:8790 or http://127.0.0.1:8790), not the OS origin, so a vault HTML
 * file or an artifact opened inside the OS cannot reach the shell; a non-browser client
 * sends no Origin and is refused too. The page can be framed only by the OS and Obsidian.
 *
 * The session outlives the page: the OS reloads itself after a resize and the tab can be
 * closed, so output is kept (the last 1 MB) and replayed when a page reconnects.
 */
import { createRequire } from 'node:module'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)
const PTY_DIR = join(import.meta.dirname, '..', 'vendor-pty')
let pty = null
try {
  pty = require(join(PTY_DIR, 'node_modules', 'node-pty'))
  // npm drops the execute bit on node-pty's prebuilt helper, and without it every
  // spawn fails with "posix_spawnp failed"
  for (const arch of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']) {        // the terminal tab needs a prebuilt node-pty; none on Windows yet
    const h = join(PTY_DIR, 'node_modules', 'node-pty', 'prebuilds', arch, 'spawn-helper')
    if (existsSync(h) && !(statSync(h).mode & 0o111)) chmodSync(h, 0o755)
  }
} catch (err) {
  console.warn('[term] node-pty is not installed in vendor-pty/ - the Claude Code tab is off:', err.message)
}

export const TERM_OK = !!pty
const SHELL = process.env.SHELL || '/bin/zsh'
const SCROLLBACK = 1024 * 1024
export const OS_ORIGINS = ['http://localhost:50000', 'http://127.0.0.1:50000', 'app://obsidian.md']

let session = null   // { p, buf, alive, started, exitCode }
const clients = new Set()

function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}

function start(cwd, cols = 120, rows = 34) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'GTD-Agentic-OS' }
  // the bridge's own switches must not leak into Luke's session: these make the vault's
  // hooks treat it as Petra (voice) or a queued background job
  for (const k of ['GTD_VOICE', 'GTD_JOB', 'RUBRIC_AGENT_ID', 'JARVIS_MODE', 'JARVIS_MODEL', 'JARVIS_EFFORT',
    'JARVIS_ALLOWED_ORIGINS', 'JARVIS_BRIDGE_PORT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k]
  env.HOME = env.HOME || homedir()
  // a login, interactive shell so PATH and aliases match Terminal; claude first, then the shell
  const p = pty.spawn(SHELL, ['-l', '-i', '-c', 'claude; exec "$SHELL" -l -i'], { name: 'xterm-256color', cols, rows, cwd, env })
  const s = { p, buf: '', alive: true, started: Date.now(), exitCode: null }
  p.onData((d) => {
    s.buf += d
    if (s.buf.length > SCROLLBACK) s.buf = s.buf.slice(-SCROLLBACK)
    if (session === s) broadcast({ t: 'out', d })
  })
  p.onExit(({ exitCode }) => {
    s.alive = false; s.exitCode = exitCode
    if (session === s) broadcast({ t: 'exit', code: exitCode })
  })
  session = s
  return s
}

export function termOriginAllowed(origin, port) {
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`
}

/** a page connected on /term */
export function attachTerm(ws, cwd) {
  if (!pty) { ws.send(JSON.stringify({ t: 'out', d: '\r\nnode-pty is not installed, see bridge/term.mjs\r\n' })); ws.close(); return }
  clients.add(ws)
  if (!session || !session.alive) start(cwd)
  ws.send(JSON.stringify({ t: 'hello', replay: session.buf, alive: session.alive, started: session.started }))
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m.t === 'in' && typeof m.d === 'string') { if (session?.alive) session.p.write(m.d) }
    else if (m.t === 'resize') {
      const cols = Math.max(20, Math.min(500, m.cols | 0)), rows = Math.max(5, Math.min(300, m.rows | 0))
      if (session?.alive) { try { session.p.resize(cols, rows) } catch {} }
    } else if (m.t === 'restart') {
      if (session?.alive) { try { session.p.kill() } catch {} }
      const s = start(cwd, m.cols | 0 || 120, m.rows | 0 || 34)
      broadcast({ t: 'hello', replay: s.buf, alive: true, started: s.started, restarted: true })
    }
  })
  ws.on('close', () => clients.delete(ws))
}

/** the page itself, served from the bridge's origin so only it can open the socket */
export function termPage(port) {
  const csp = [
    "default-src 'none'",
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
    "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'",
    'font-src https://fonts.gstatic.com',
    `connect-src ws://localhost:${port} ws://127.0.0.1:${port}`,
    `frame-ancestors ${OS_ORIGINS.join(' ')}`,
  ].join('; ')
  return { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'cache-control': 'no-store' }, body: TERM_HTML }
}

const TERM_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Claude Code · GTD vault</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
<style>
  /* GTD brand: Deep Navy ground, Ice text, Electric Blue cursor and selection */
  html, body { margin:0; height:100%; background:#0F1C45; overflow:hidden; }
  #bar { position:fixed; top:0; left:0; right:0; height:40px; display:flex; align-items:center; gap:10px; padding:0 14px;
    background:linear-gradient(180deg,#1E357A,#182A5B); border-bottom:1px solid rgba(125,160,255,.18);
    font:600 10.5px/1 -apple-system, system-ui, sans-serif; letter-spacing:.22em; color:#7DA0FF; text-transform:uppercase; }
  #bar b { color:#FEFEFE; font-family:Georgia, serif; letter-spacing:.06em; font-size:13px; }
  #bar .sp { flex:1; }
  #st { color:#8FA6DF; letter-spacing:.14em; }
  #st.on::before { content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:#7DA0FF; margin-right:7px; vertical-align:1px; }
  #bar button { font:600 9.5px -apple-system, system-ui, sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#F5F8FF;
    background:rgba(255,255,255,.06); border:1px solid rgba(125,160,255,.28); border-radius:999px; padding:6px 12px; cursor:pointer; }
  #bar button:hover { background:linear-gradient(180deg,#3F78FF,#3164F5); border-color:transparent; }
  #t { position:fixed; top:40px; left:0; right:0; bottom:0; padding:8px 4px 4px 12px; }
  .xterm .xterm-viewport { background:#0F1C45 !important; }
</style></head>
<body>
<div id="bar"><b>Claude Code</b><span>~/Documents/GTD</span><span class="sp"></span><span id="st">connecting</span>
  <button id="nw" title="End this session and start a fresh claude">New session</button></div>
<div id="t"></div>
<script>
(function () {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", Menlo, monospace', fontSize: 13, lineHeight: 1.18, cursorBlink: true,
    allowProposedApi: true, scrollback: 20000, macOptionIsMeta: true,
    theme: { background: '#0F1C45', foreground: '#F5F8FF', cursor: '#7DA0FF', cursorAccent: '#0F1C45',
      selectionBackground: 'rgba(49,100,245,.45)', black: '#0E1A3A', blue: '#3164F5', brightBlue: '#7DA0FF',
      cyan: '#1A8CF6', brightCyan: '#9DB8FF', white: '#DCE5FF', brightWhite: '#FFFFFF' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri, '_blank')));
  term.open(document.getElementById('t'));
  const st = document.getElementById('st');
  let ws = null, queue = [], wait = 500;
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); else queue.push(m); };
  const size = () => { try { fit.fit(); } catch (e) {} send({ t: 'resize', cols: term.cols, rows: term.rows }); };
  function connect() {
    ws = new WebSocket('ws://' + location.host + '/term');
    ws.onopen = () => { wait = 500; st.textContent = 'live'; st.className = 'on'; size(); queue.splice(0).forEach(send); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'hello') { term.reset(); if (m.replay) term.write(m.replay); size(); }
      else if (m.t === 'out') term.write(m.d);
      else if (m.t === 'exit') { st.textContent = 'ended'; st.className = ''; term.write('\r\n[session ended - press New session]\r\n'); }
    };
    ws.onclose = () => { st.textContent = 'reconnecting'; st.className = ''; setTimeout(connect, wait = Math.min(wait * 2, 8000)); };
  }
  term.onData((d) => send({ t: 'in', d }));
  new ResizeObserver(() => size()).observe(document.getElementById('t'));
  document.getElementById('nw').onclick = () => { send({ t: 'restart', cols: term.cols, rows: term.rows }); term.focus(); };
  /* the OS types a prompt in for him: { type: 'gtd-term:type', text, submit } from the OS page only */
  const OK = ${JSON.stringify(OS_ORIGINS)};
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !OK.includes(e.origin)) return;
    const d = e.data || {};
    if (d.type === 'gtd-term:type' && typeof d.text === 'string') {
      /* bracketed paste, so a multi-line prompt arrives as one message, then Enter */
      send({ t: 'in', d: '\x1b[200~' + d.text + '\x1b[201~' });
      if (d.submit !== false) setTimeout(() => send({ t: 'in', d: '\r' }), 60);
      term.focus();
    } else if (d.type === 'gtd-term:focus') term.focus();
  });
  connect();
  term.focus();
})();
</script></body></html>`
