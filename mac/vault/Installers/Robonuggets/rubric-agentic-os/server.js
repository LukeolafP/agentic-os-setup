/* ============================================================================
   RUBRIC Agentic OS - local server
   Serves the dashboard at http://localhost:50000 and gives every widget a
   real data source. Zero dependencies (node http + child_process + fs only).

   Run:  node server.js        then open http://localhost:50000
   Configure everything in os-config.json (port, skills, runner, feeds).

   APIs
     GET /api/calendar   next events        (tools/google-calendar.js -> snapshot)
     GET /api/email      inbox triage       (gws CLI - see WIRING.md)
     GET /api/stats      any numbers        (snapshots/stats.json - see WIRING.md)
     GET /api/routines   today's schedule   (snapshots/routines.json - ROUTINES.md)
     GET /api/artifacts  the ring's balls   (watches the artifacts folder)
     GET /api/skills     the skills deck    (os-config.json)
     POST /api/open      opens a file or URL on this device
     POST /api/run       runs a skill headlessly via your agent's CLI
     POST /api/artifact-remove   right-click REMOVE -> artifacts/_trash
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, exec, spawn } = require('child_process');

/* everything user-tunable lives in os-config.json next to this file */
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'os-config.json'), 'utf8')); }
catch (_) { console.error('os-config.json missing or invalid - using defaults'); }
const PORT = CFG.port || 50000;
const HERE = __dirname;
const ARTIFACTS = path.resolve(__dirname, CFG.artifactsDir || 'artifacts');
const SNAP = path.join(HERE, 'snapshots');
fs.mkdirSync(ARTIFACTS, { recursive: true });
fs.mkdirSync(SNAP, { recursive: true });

/* ---------- tiny cache so widgets can poll without hammering the APIs ---------- */
const cache = new Map();
function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(producer)
    .then(val => { cache.set(key, { at: Date.now(), val }); return val; })
    .catch(err => {
      if (hit) return { ...hit.val, stale: true, error: String(err.message || err) };
      return { error: String(err.message || err) };
    });
}
const run = (cmd, args, ms = 60000) => new Promise((res, rej) => {
  execFile(cmd, args, { maxBuffer: 12e6, timeout: ms, windowsHide: true, shell: true },
    (err, stdout, stderr) => {
      if (err && !stdout) return rej(new Error((stderr || err.message).slice(0, 300)));
      res(stdout);
    });
});
const jsonFromGws = out => {
  const i = out.indexOf('{');           /* gws prints a keyring line first */
  if (i < 0) throw new Error('no json from gws');
  return JSON.parse(out.slice(i));
};

/* ---------------------------- CALENDAR ----------------------------
   Mirrors the user's own Google Calendar view: tools/google-calendar.js auths
   once (node tools/google-calendar.js auth) and merges every calendar ticked
   in that account's sidebar. Full walkthrough: OAUTH.md. */
const CAL_TOOL = path.join(__dirname, 'tools', 'google-calendar.js');
async function getCalendar() {
  const snapFile = path.join(SNAP, 'calendar.json');
  try {
    const out = await run('node', [CAL_TOOL, 'next']);
    const payload = JSON.parse(out.slice(out.indexOf('{')));
    if (!payload.events) throw new Error('no events field from google-calendar.js');
    fs.writeFileSync(snapFile, JSON.stringify(payload, null, 2));
    return payload;
  } catch (e) {
    /* API not enabled / calendars not shared yet -> serve the snapshot,
       filtered so a stale first event never shows as "next" */
    if (fs.existsSync(snapFile)) {
      const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;  /* GTD: keep the past 2 hours, the calendar widget shows them */
      snap.events = (snap.events || []).filter(ev => new Date(ev.start).getTime() > cutoff);
      return { ...snap, source: snap.source + ' (snapshot)', note: String(e.message).slice(0, 200) };
    }
    return { needsSetup: true, note: String(e.message).slice(0, 200), events: [] };
  }
}

/* ---------------------------- EMAIL ---------------------------- */
/* four buckets for TODAY'S MIX: partnerships - leads - personal - other.
   partnerships = biz-dev pitches; leads = people wanting in (join/pricing/access);
   personal = from a personal mailbox and not the above; other = the rest.
   Tune the words in os-config.json to match YOUR world. */
const PARTNER_HINTS = new RegExp(CFG.partnerHints || 'sponsor|collab|partner|brand|affiliate|deal|invoice|pitch|opportunit', 'i');
const LEAD_HINTS = new RegExp(CFG.leadHints || 'join|member|sign\\s?up|subscri|pricing|enroll|course|coaching|access|billing|refund', 'i');
const PERSONAL_FROM = new RegExp(CFG.personalFrom || '@(gmail|googlemail|yahoo|outlook|hotmail|icloud|proton)\\.', 'i');
async function getEmail() {
  const list = jsonFromGws(await run('gws', ['gmail', 'users', 'messages', 'list',
    '--params', '"{\\"userId\\":\\"me\\",\\"q\\":\\"newer_than:1d -category:promotions\\",\\"maxResults\\":40}"']));
  const ids = (list.messages || []).slice(0, 18).map(m => m.id);
  const rows = [];
  for (const id of ids) {
    try {
      const m = jsonFromGws(await run('gws', ['gmail', 'users', 'messages', 'get', '--params',
        `"{\\"userId\\":\\"me\\",\\"id\\":\\"${id}\\",\\"format\\":\\"metadata\\"}"`], 25000));
      const h = {};
      (m.payload?.headers || []).forEach(x => h[x.name.toLowerCase()] = x.value);
      const subject = h.subject || '(no subject)';
      const rawFrom = h.from || '';
      const from = rawFrom.replace(/<.*/, '').replace(/"/g, '').trim();
      const unread = (m.labelIds || []).includes('UNREAD');
      const kind = PARTNER_HINTS.test(subject) ? 'partnerships'
        : LEAD_HINTS.test(subject) ? 'leads'
        : PERSONAL_FROM.test(rawFrom) ? 'personal' : 'other';
      rows.push({ id, subject, from, unread, kind,
        ts: +(m.internalDate || 0), snippet: (m.snippet || '').slice(0, 90) });
    } catch (_) { /* one bad message shouldn't kill the widget */ }
  }
  const flagged = rows.filter(r => r.kind === 'partnerships' || r.kind === 'leads').slice(0, 6);
  return {
    fetched: new Date().toISOString(),
    total: list.resultSizeEstimate || rows.length,
    unread: rows.filter(r => r.unread).length,
    flagged,
    mix: {
      partnerships: rows.filter(r => r.kind === 'partnerships').length,
      leads: rows.filter(r => r.kind === 'leads').length,
      personal: rows.filter(r => r.kind === 'personal').length,
      other: rows.filter(r => r.kind === 'other').length
    }
  };
}

/* ---------------------------- STATS ----------------------------
   The stats widget shows ANY numbers you care about. Your agent writes
   snapshots/stats.json - format and a YouTube recipe in WIRING.md. */
function getStats() {
  const f = path.join(SNAP, 'stats.json');
  if (!fs.existsSync(f)) return { needsSetup: true };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { return { error: 'stats.json: ' + String(e.message) }; }
}

/* ---------------------------- ROUTINES ---------------------------- */
async function getRoutines() {
  /* your agent maintains this feed - format in ROUTINES.md */
  const f = path.join(SNAP, 'routines.json');
  if (!fs.existsSync(f)) return { needsSetup: true, sources: [], routines: [], counts: {} };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { return { error: 'routines.json: ' + String(e.message), sources: [], routines: [] }; }
}

/* ---------------------------- ARTIFACTS (the balls) ---------------------------- */
/* Every .html in output/artifacts/ becomes a ball on the ring. A sidecar
   <name>.json may set {title, icon, kind}; otherwise we infer them. */
const ICON_RULES = [
  [/deck|slide|present/i,        'deck'],
  [/report|audit|analysis/i,     'report'],
  [/dash|board|monitor/i,        'dash'],
  [/brief|inbox|email|digest/i,  'mail'],
  [/lesson|script|video|thumb/i, 'video'],
  [/chart|graph|metric|mrr/i,    'chart'],
  [/wheel|orb|visual|design/i,   'visual'],
  [/prompt|skill|agent/i,        'bolt']
];
function inferIcon(name) {
  for (const [re, ic] of ICON_RULES) if (re.test(name)) return ic;
  return 'doc';
}
/* Four spark categories (Jay, 2026-08-05) - each ball's inner embers take the
   orb's own domain colours: writing, website frontends, infographics and
   explanations, everything else. Sidecar "category" overrides the guess. */
const CAT_RULES = [
  [/post|newsletter|writ|script|hook|draft|announce|description|skool|aoc|blurb|copy/i, 'writing'],
  [/landing|site|page|dashboard|app|demo|gsap|web|frontend|ui|widget|lab|library|game/i, 'frontend'],
  [/infographic|explain|report|guide|map|slide|deck|digest|packag|progress|workshop|kickoff|snapshot|papers|rates|concept/i, 'infographic']
];
function inferCategory(name) {
  for (const [re, cat] of CAT_RULES) if (re.test(name)) return cat;
  return 'other';
}
function getArtifacts() {
  if (!fs.existsSync(ARTIFACTS)) return { artifacts: [] };
  const layout = readRingLayout();
  const files = fs.readdirSync(ARTIFACTS).filter(f => /\.html?$/i.test(f));
  const artifacts = files.map(f => {
    const full = path.join(ARTIFACTS, f);
    const st = fs.statSync(full);
    let meta = {};
    const side = full.replace(/\.html?$/i, '.json');
    if (fs.existsSync(side)) { try { meta = JSON.parse(fs.readFileSync(side, 'utf8')); } catch (_) {} }
    let title = meta.title;
    if (!title) {
      const head = fs.readFileSync(full, 'utf8').slice(0, 2000);
      title = (head.match(/<title>([^<]+)<\/title>/i)?.[1] || f.replace(/\.html?$/i, '')).trim();
    }
    return {
      file: f, title,
      icon: meta.icon || inferIcon(f + ' ' + title),
      kind: meta.kind || 'artifact',
      note: meta.note || '',        /* the ball popup shows this as its summary */
      svg: meta.svg || '',          /* bespoke 48x48 glyph for THIS artifact's ball */
      category: meta.category || inferCategory(f + ' ' + title + ' ' + (meta.kind || '')),
      created: meta.created || st.birthtime.toISOString(),
      modified: st.mtime.toISOString(),
      url: '/artifacts/' + encodeURIComponent(f),
      place: layout.items[f] || null    /* its folder on the ring, from the Ring Organizer */
    };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return { fetched: new Date().toISOString(), count: artifacts.length, artifacts,
    ring: { folders: layout.folders, updated: layout.updated, organizing: organizer.running, lastRun: organizer.ended } };
}

/* ---------------------------- RING FOLDERS (GTD, 30 Oct 2026) ----------------------------
   The ring shows folders, not loose files. ring/layout.json says where each item sits, in a
   tree that is the ring's own and not the vault's; the Ring Organizer agent
   (Agents/ring-organizer.md, through tools/ring-layout.mjs) writes it. Items not in the
   layout show in an Unsorted folder. Once one has waited a minute the server runs the agent:
   one run at a time, at least three minutes apart, and after three failures in a row it waits
   half an hour. POST /api/ring-organize runs it now ({ all: true } re-sorts everything). */
const RING_LAYOUT = path.join(HERE, 'ring', 'layout.json');
const VAULT_ROOT = path.resolve(HERE, '..', '..', '..');
const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(require('os').homedir(), '.local', 'bin', 'claude');
const ORGANIZER = path.join(VAULT_ROOT, 'Agents', 'ring-organizer.md');
function readRingLayout() {
  try { const d = JSON.parse(fs.readFileSync(RING_LAYOUT, 'utf8')); return { folders: d.folders || {}, items: d.items || {}, updated: d.updated || null }; }
  catch (_) { return { folders: {}, items: {}, updated: null }; }
}
const organizer = { running: false, started: null, ended: null, code: null, fails: 0, result: '', seen: new Map() };
function agentDef(file) {
  const src = fs.readFileSync(file, 'utf8'), fm = (src.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const one = k => (fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const perms = (fm.split(/^permissions:\s*$/m)[1] || '').split('\n').map(l => l.match(/^\s+-\s+(.+)$/)?.[1]).filter(Boolean);
  return { model: one('model') || 'claude-sonnet-5', effort: one('effort') || 'medium', perms };
}
function organizeRing(all) {
  if (organizer.running || !fs.existsSync(ORGANIZER)) return false;
  const def = agentDef(ORGANIZER);
  const brief = all
    ? 'Re-sort the whole Agentic OS ring: run ring-layout.mjs pending --all and give every item the best place in the ring tree, renaming or merging folders where that reads better.'
    : 'New items are on the Agentic OS ring and not yet in its folders. File every pending item (ring-layout.mjs pending) into the ring tree, reusing the existing folders.';
  const args = ['-p', brief, '--model', def.model, '--effort', def.effort,
    '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--agent', 'ring-organizer'];
  if (def.perms.length) args.push('--allowedTools', def.perms.join(','));
  const logFile = path.join(RUNDIR, 'ring-organizer-' + Date.now() + '.log');
  const log = fs.createWriteStream(logFile);
  log.write('$ claude ' + args.map(a => JSON.stringify(a)).join(' ') + '\n\n');
  organizer.running = true; organizer.started = Date.now(); organizer.result = '';
  console.log('[ring] organizer started' + (all ? ' (re-sort)' : ''));
  let child;
  try {
    child = spawn(CLAUDE_BIN, args, { cwd: VAULT_ROOT, windowsHide: true,
      env: { ...process.env, GTD_JOB: '1', RUBRIC_AGENT_ID: 'ring-organizer' }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { organizer.running = false; organizer.fails++; log.end('SPAWN ERROR: ' + e.message); return false; }
  const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000);
  child.stdout.on('data', d => { if (organizer.result.length < 20000) organizer.result += d; log.write(d); });
  child.stderr.pipe(log, { end: false });
  child.on('error', err => { log.write('\nSPAWN ERROR: ' + err.message + '\n'); });
  child.on('close', code => {
    clearTimeout(timer); log.end();
    organizer.running = false; organizer.ended = Date.now(); organizer.code = code;
    organizer.fails = code === 0 ? 0 : organizer.fails + 1;
    console.log('[ring] organizer finished, exit ' + code + ': ' + organizer.result.trim().split('\n')[0].slice(0, 200));
  });
  return true;
}
function ringWatch() {
  if (organizer.running) return;
  const layout = readRingLayout();
  let files = [];
  try { files = fs.readdirSync(ARTIFACTS).filter(f => /\.html?$/i.test(f) && fs.existsSync(path.join(ARTIFACTS, f))); } catch (_) { return; }
  const pending = files.filter(f => !layout.items[f]);
  for (const f of [...organizer.seen.keys()]) if (!pending.includes(f)) organizer.seen.delete(f);
  for (const f of pending) if (!organizer.seen.has(f)) organizer.seen.set(f, Date.now());
  if (!pending.length) return;
  const waited = Math.max(...pending.map(f => Date.now() - organizer.seen.get(f)));
  const gap = organizer.fails >= 3 ? 30 * 60e3 : 3 * 60e3;
  if (waited >= 60e3 && (!organizer.ended || Date.now() - organizer.ended >= gap)) organizeRing(false);
}

/* ---------------------------- SKILLS ---------------------------- */
const SKILLS = CFG.skills || [];   /* the deck cards - edit os-config.json */
const RUNLOG = path.join(SNAP, 'runs.json');
function readRuns() {
  try { return JSON.parse(fs.readFileSync(RUNLOG, 'utf8')); } catch (_) { return []; }
}
function recordRun(id, meta) {
  const runs = readRuns();
  runs.unshift({ id, at: new Date().toISOString(), ...meta });
  fs.writeFileSync(RUNLOG, JSON.stringify(runs.slice(0, 200), null, 2));
  return runs[0];
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

/* ------------------------- REAL HEADLESS RUNS -------------------------
   A deck click spawns an actual Claude Code session: claude -p "/skill"
   with the model + effort dials from the card. Output streams to a log in
   output/os-runs/; when the process exits, the run report becomes a ball
   on the ring with the transcript tail inside. */
const RUNDIR = path.join(__dirname, 'os-runs');
fs.mkdirSync(RUNDIR, { recursive: true });
const JOBS = new Map();
/* no run timeout and no same-skill lock - Jay, 2026-08-11: "not needed even for me" */

function startJob({ id, model, effort }) {
  const jobId = id + '-' + Date.now();
  const logFile = path.join(RUNDIR, jobId + '.log');
  const log = fs.createWriteStream(logFile);
  /* the runner is one command template in os-config.json - point it at
     whatever CLI your agent ships. {skill} {model} {effort} get filled in. */
  const tpl = (CFG.runner && CFG.runner.command) ||
    'claude -p "/{skill}" --model {model} --effort {effort} --permission-mode bypassPermissions';
  const cmdline = tpl.split('{skill}').join(id)
    .split('{model}').join(String(model || '').toLowerCase())
    .split('{effort}').join(String(effort || '').toLowerCase());
  const cwd = (CFG.runner && CFG.runner.cwd) ? path.resolve(CFG.runner.cwd) : __dirname;
  log.write('$ ' + cmdline + '\n\n');
  const child = spawn(cmdline, { cwd, shell: true, windowsHide: true });
  /* stdout is the skill's actual result (claude -p prints only the final text) -
     buffer it for the report, and mirror everything into the log. stderr is
     harness noise (config warnings etc.) and goes to the log only. */
  let result = '';
  child.stdout.on('data', d => { if (result.length < 300000) result += d; log.write(d); });
  child.stderr.pipe(log, { end: false });
  const job = { jobId, id, model, effort, logFile, status: 'running',
                started: Date.now(), ended: null, code: null, report: null };
  JOBS.set(jobId, job);
  child.on('error', err => {           /* runner CLI not on PATH etc. */
    log.end('\nSPAWN ERROR: ' + err.message + '\n');
    job.status = 'failed'; job.ended = Date.now(); job.code = -1;
  });
  child.on('close', code => {
    log.end();
    job.status = code === 0 ? 'done' : 'failed';
    job.ended = Date.now(); job.code = code; job.result = result.trim();
    const seconds = Math.round((job.ended - job.started) / 1000);
    try {
      const report = writeRunReport(job, seconds);
      job.report = report.file;
      recordRun(id, { model, effort, seconds, real: true, exit: code, report: report.file });
    } catch (e) { console.error('run report failed:', e.message); }
  });
  return job;
}

function logTail(file, bytes = 4000) {
  try {
    const { size } = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (_) { return ''; }
}

/* Render the skill's markdown-ish result as clean HTML (house rule:
   run reports must show the result formatted for easy reading, never a raw
   terminal dump). Covers what skill output actually uses: headings, bold,
   inline code, fences, bullets, numbered lists, tables. */
function mdToHtml(src) {
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  const lines = src.split(/\r?\n/);
  let list = null, fence = null;
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (fence !== null) {
      if (/^```/.test(ln)) { out.push('<pre class="code">' + esc(fence.join('\n')) + '</pre>'); fence = null; }
      else fence.push(ln);
      continue;
    }
    if (/^```/.test(ln)) { closeList(); fence = []; continue; }
    if (/^\|.*\|\s*$/.test(ln)) {                       /* table block */
      closeList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i]))        /* skip |---| separators */
          rows.push(lines[i].replace(/^\||\|\s*$/g, '').split('|').map(c => inline(c.trim())));
        i++;
      }
      i--;
      out.push('<table>' + rows.map((r, ri) =>
        '<tr>' + r.map(c => ri === 0 ? '<th>' + c + '</th>' : '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>');
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>` + inline(h[2]) + `</h${h[1].length + 1}>`); continue; }
    const b = ln.match(/^\s*[-*]\s+(.*)/);
    if (b) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(b[1]) + '</li>'); continue; }
    const n = ln.match(/^\s*\d+[.)]\s+(.*)/);
    if (n) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(n[1]) + '</li>'); continue; }
    closeList();
    if (ln.trim()) out.push('<p>' + inline(ln) + '</p>');
  }
  if (fence) out.push('<pre class="code">' + esc(fence.join('\n')) + '</pre>');
  closeList();
  return out.join('\n');
}

function writeRunReport(job, seconds) {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
  const slug = `${job.id}-${stamp}`;
  const when = now.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  const ok = job.status === 'done';
  const body = (job.result && job.result.trim())
    ? mdToHtml(job.result)
    : '<pre class="code">' + (esc(logTail(job.logFile, 6000)) || '(no output captured)') + '</pre>';
  const html = `<meta charset="utf-8">
<title>/${esc(job.id)} run</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' fill='%23f2efe8'/><circle cx='24' cy='24' r='11' fill='none' stroke='%23ff6b1a' stroke-width='4'/></svg>">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700&display=swap');
  :root { --paper:#f2efe8; --ink:#1c1a16; --accent:#ff6b1a; --line:#d6d0c2; --mute:#8d8775; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:400 15px/1.55 Outfit,system-ui,sans-serif; padding:56px 32px; }
  .wrap { max-width:760px; margin:0 auto; }
  .rule { border-top:2px solid var(--ink); padding-top:10px; margin-bottom:26px; }
  .kick { font-size:10px; letter-spacing:3.4px; text-transform:uppercase; color:var(--mute); }
  h1 { font-size:30px; font-weight:700; letter-spacing:-.6px; margin:6px 0 6px; }
  h1 span { color:var(--accent); }
  .lede { color:#55504a; margin:0 0 22px; }
  .meta { display:flex; gap:26px; flex-wrap:wrap; margin-bottom:30px; }
  .meta div { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:var(--mute); }
  .meta b { display:block; font-size:19px; letter-spacing:0; text-transform:none;
            color:var(--ink); font-variant-numeric:tabular-nums; }
  .result { border-top:1px solid var(--line); padding-top:22px; }
  .result h2 { font-size:21px; letter-spacing:-.3px; margin:26px 0 8px; }
  .result h3 { font-size:17px; letter-spacing:-.2px; margin:22px 0 6px; }
  .result h4, .result h5 { font-size:14px; margin:18px 0 5px; }
  .result p { margin:0 0 12px; }
  .result ul, .result ol { margin:0 0 14px; padding-left:22px; }
  .result li { margin:3px 0; }
  .result strong { font-weight:700; }
  .result code { background:#e6e1d3; border-radius:4px; padding:1px 6px;
                 font:400 12.5px/1 Consolas,monospace; }
  .result a { color:var(--accent); }
  .result table { width:100%; border-collapse:collapse; margin:0 0 16px;
                  font-variant-numeric:tabular-nums; }
  .result th { text-align:left; font-size:10px; letter-spacing:2px; text-transform:uppercase;
               color:var(--mute); font-weight:500; padding:0 10px 8px 0; border-bottom:1px solid var(--line); }
  .result td { padding:9px 10px 9px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  pre.code { background:#1c1a16; color:#e8e2d2; border-radius:8px; padding:18px 20px;
             font:400 12.5px/1.6 Consolas,monospace; overflow-x:auto; white-space:pre-wrap; }
  footer { margin-top:34px; font-size:11px; letter-spacing:2px;
           text-transform:uppercase; color:var(--mute); }
</style>
<div class="wrap">
  <div class="rule">
    <div class="kick">Rubric Agentic OS · Headless skill run</div>
    <h1>/<span>${esc(job.id)}</span></h1>
    <p class="lede">${ok ? 'What the run came back with:' : 'Run FAILED (exit ' + esc(String(job.code)) + '). Last output below.'}</p>
  </div>
  <div class="meta">
    <div>Model<b>${esc(job.model || '-')}</b></div>
    <div>Effort<b>${esc(job.effort || '-')}</b></div>
    <div>Duration<b>${esc(String(seconds))}s</b></div>
    <div>Exit<b>${esc(String(job.code))}</b></div>
    <div>Finished<b>${esc(when)}</b></div>
  </div>
  <div class="result">
${body}
  </div>
  <div style="margin-top:34px">
    <div class="kick" style="margin-bottom:8px">Full terminal output</div>
    <pre class="code">${esc(logTail(job.logFile, 200000)) || '(empty log)'}</pre>
  </div>
  <footer>Ran headlessly from the skills deck · full log: output/os-runs/${esc(path.basename(job.logFile))}</footer>
</div>`;
  fs.writeFileSync(path.join(ARTIFACTS, slug + '.html'), html);
  fs.writeFileSync(path.join(ARTIFACTS, slug + '.json'), JSON.stringify({
    title: `/${job.id} · ${now.toLocaleString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`,
    icon: 'bolt', kind: 'run',
    svg: ok ? '<path d="M26 8L14 27h8l-2 13 12-19h-8l2-13z"/>'
            : '<circle cx="24" cy="24" r="15"/><path d="M18 18l12 12M30 18L18 30"/>',
    created: now.toISOString(),
    note: `headless · ${job.model || '?'} · ${job.effort || '?'} · ${seconds}s · exit ${job.code}`
  }, null, 2));
  return { file: slug + '.html', url: '/artifacts/' + slug + '.html' };
}

/* ---------------------------- HTTP ---------------------------- */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  /* GTD: vault files for the viewer and tabs */
  '.htm':'text/html', '.md':'text/markdown; charset=utf-8', '.txt':'text/plain; charset=utf-8',
  '.csv':'text/csv; charset=utf-8', '.pdf':'application/pdf', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.mp4':'video/mp4', '.mov':'video/quicktime', '.webm':'video/webm',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.canvas':'application/json',
  /* GTD: the brand fonts in assets/brand */
  '.ttf':'font/ttf', '.otf':'font/otf', '.woff':'font/woff', '.woff2':'font/woff2' };

/* ---------------------------- LOCAL APPS (GTD) ----------------------------
   Luke's own local apps (apps.json), started on demand and opened as OS tabs.
     GET  /api/apps          every app, and whether each of its processes is up
     POST /api/apps/start    { id }  start whatever is not already listening
     POST /api/apps/stop     { id }  stop whatever is listening on its ports
   Only commands listed in apps.json can run. Processes are detached, so they keep
   running if this server restarts; their output goes to .app-logs/. */
const net = require('net');
const APP_LOGS = path.join(HERE, '.app-logs');
function loadApps() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(HERE, 'apps.json'), 'utf8')).apps || [];
    const home = process.env.HOME || '';
    const fix = s => String(s).replace(/^~(?=\/|$)/, home).replace('{vault}', VAULT);
    return raw.map(a => ({ ...a, procs: (a.procs || []).map(p => ({ ...p, cwd: fix(p.cwd), cmd: p.cmd.map((c, i) => i === 0 ? fix(c) : c) })) }));
  } catch (e) { console.error('apps.json', e.message); return []; }
}
/* a dev server on "localhost" may listen on IPv6 only (Vite on macOS binds ::1), so both count */
const portOn = (port, host) => new Promise(res => {
  const sock = net.connect({ port, host });
  const done = v => { sock.destroy(); res(v); };
  sock.setTimeout(400, () => done(false));
  sock.once('connect', () => done(true)).once('error', () => done(false));
});
const portUp = async port => (await portOn(port, '127.0.0.1')) || (await portOn(port, '::1'));
const appStarting = new Map();   // id -> started at
async function appStatus() {
  const apps = loadApps();
  return Promise.all(apps.map(async a => {
    const procs = await Promise.all(a.procs.map(async p => ({ name: p.name, port: p.port, up: await portUp(p.port) })));
    const up = procs.every(p => p.up);
    if (up) appStarting.delete(a.id);
    return { id: a.id, name: a.name, desc: a.desc, url: a.url, procs, up,
      starting: !up && appStarting.has(a.id) && Date.now() - appStarting.get(a.id) < 120000 };
  }));
}
async function startApp(id) {
  const a = loadApps().find(x => x.id === id);
  if (!a) throw new Error('unknown app');
  fs.mkdirSync(APP_LOGS, { recursive: true });
  const started = [];
  for (const p of a.procs) {
    if (await portUp(p.port)) continue;
    if (!fs.existsSync(p.cwd)) throw new Error(`${a.name}: folder not found (${p.cwd})`);
    const log = fs.openSync(path.join(APP_LOGS, `${a.id}-${p.name}.log`), 'a');
    const child = spawn(p.cmd[0], p.cmd.slice(1), {
      cwd: p.cwd, detached: true, stdio: ['ignore', log, log],
      /* PORT is the app's own port: launchd gives this server PORT=50000, and an app that
         reads PORT (Next.js does) would otherwise try to take the OS's port */
      env: { ...process.env, PORT: String(p.port),
        PATH: ['/opt/homebrew/bin', path.join(process.env.HOME || '', '.local/bin'), '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(':') },
    });
    child.on('error', e => fs.appendFileSync(path.join(APP_LOGS, `${a.id}-${p.name}.log`), `\n[os] could not start: ${e.message}\n`));
    child.unref();
    started.push(p.name);
  }
  appStarting.set(a.id, Date.now());
  return { started };
}
async function stopApp(id) {
  const a = loadApps().find(x => x.id === id);
  if (!a) throw new Error('unknown app');
  const stopped = [];
  for (const p of a.procs) {
    const pids = await new Promise(r => execFile('/usr/sbin/lsof', ['-ti', `tcp:${p.port}`, '-sTCP:LISTEN'], (e, out) => r(String(out || '').split(/\s+/).filter(Boolean))));
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM'); stopped.push(`${p.name}:${pid}`); } catch {} }
  }
  appStarting.delete(a.id);
  return { stopped };
}
const readJson = req => new Promise(res => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });

/* ---------------------------- VAULT FILES (GTD) ----------------------------
   Read-only access to the Obsidian vault for the viewer and the OS tabs:
     GET /vault/<path>            the file itself
     GET /api/vault-find?name=    resolve a [[wiki link]] to a path, the Obsidian way
     GET /api/vault-search?q=     filename search for the launcher
   Dot folders (.obsidian, .claude, .connectors) and secret-looking files are never served. */
const VAULT = (() => {
  if (process.env.VAULT_ROOT) return path.resolve(process.env.VAULT_ROOT);
  let d = HERE;
  while (d !== path.dirname(d)) { d = path.dirname(d); if (fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, '.obsidian'))) return d; }
  return path.resolve(HERE, '..', '..');
})();
const VAULT_SKIP = new Set(['node_modules', 'rubric', 'rubric-second-brain', 'rubric-agentic-os']);
const SECRETISH = /(^|\/)\.env|\.pem$|\.key$|secret|credential|token\.json$/i;
function vaultPath(rel) {
  if (!rel) return null;
  let clean; try { clean = decodeURIComponent(rel); } catch { return null; }
  if (clean.split('/').some(seg => seg.startsWith('.') || seg === '') || SECRETISH.test(clean)) return null;
  const abs = path.resolve(VAULT, clean);
  if (!abs.startsWith(VAULT + path.sep)) return null;
  try { if (!fs.realpathSync(abs).startsWith(VAULT + path.sep)) return null; } catch { return null; }
  return abs;
}
let vaultIndex = { at: 0, files: [] };
function vaultFiles() {
  if (Date.now() - vaultIndex.at < 30000) return vaultIndex.files;
  const out = [];
  (function rec(dir, rel) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || VAULT_SKIP.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) rec(path.join(dir, e.name), r);
      else if (e.isFile() && !SECRETISH.test(r)) out.push(r);
    }
  })(VAULT, '');
  vaultIndex = { at: Date.now(), files: out };
  return out;
}
function vaultFind(name, from) {
  const want = String(name || '').split('#')[0].split('|')[0].trim().replace(/\\$/, '');
  if (!want) return null;
  const files = vaultFiles();
  const lower = want.toLowerCase();
  const exact = files.find(f => f.toLowerCase() === lower || f.toLowerCase() === lower + '.md');
  if (exact) return exact;
  const base = lower.split('/').pop();
  const hits = files.filter(f => { const b = f.toLowerCase().split('/').pop(); return b === base || b === base + '.md'; })
    .filter(f => !lower.includes('/') || f.toLowerCase().endsWith(lower) || f.toLowerCase().endsWith(lower + '.md'));
  if (!hits.length) return null;
  if (hits.length === 1 || !from) return hits[0];
  const fd = String(from).split('/').slice(0, -1);
  const score = f => { const p = f.split('/'); let n = 0; while (n < fd.length && p[n] === fd[n]) n++; return n; };
  return hits.sort((a, b) => score(b) - score(a))[0];
}
function vaultSearch(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  const words = s.split(/\s+/);
  return vaultFiles()
    .map(f => { const l = f.toLowerCase(), b = l.split('/').pop();
      if (!words.every(w => l.includes(w))) return null;
      return { path: f, score: (b.startsWith(s) ? 50 : 0) + (b.includes(s) ? 30 : 0) + (f.endsWith('.md') ? 5 : 0) - f.split('/').length }; })
    .filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 30).map(x => x.path);
}
function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
const sendJson = (res, obj, code = 200) => {
  /* GTD: no Access-Control-Allow-Origin. The dashboard is served from this same
     origin, and a wildcard let any website in the browser read and drive the API. */
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const safeJoin = (base, rel) => {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(path.normalize(base)) ? p : null;
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p2 = u.pathname;
  /* GTD: a POST must be application/json from this origin. Browsers can't send that
     cross-site without a CORS preflight, which this server never approves. */
  if (req.method === 'POST' && (!/^application\/json/i.test(req.headers['content-type'] || '')
      || (req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin)))) {
    return sendJson(res, { error: 'POST needs application/json from this origin' }, 403);
  }
  try {
    if (p2 === '/api/calendar')  return sendJson(res, await cached('cal', 120000, getCalendar));
    if (p2 === '/api/email')     return sendJson(res, await cached('mail', 180000, getEmail));
    if (p2 === '/api/stats')     return sendJson(res, await cached('stats', 60000, getStats));
    if (p2 === '/api/routines')  return sendJson(res, await cached('rt', 60000, getRoutines));
    if (p2 === '/api/artifacts') return sendJson(res, getArtifacts());   /* always fresh - it's a dir scan */
    if (p2 === '/api/ring-organize' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      let all = false; try { all = !!JSON.parse(body || '{}').all; } catch (_) {}
      return sendJson(res, { ok: organizeRing(all), running: organizer.running });
    }
    if (p2 === '/api/skills')    return sendJson(res, {
      skills: SKILLS, models: CFG.models, modelColors: CFG.modelColors,
      efforts: CFG.efforts, runs: readRuns().slice(0, 20) });
    if (p2 === '/api/health')    return sendJson(res, { ok: true, port: PORT, time: new Date().toISOString() });

    if (p2 === '/api/open' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      return req.on('end', () => {
        try {
          const { target } = JSON.parse(body || '{}');
          if (!target) return sendJson(res, { error: 'no target' }, 400);
          console.log('  open outside', new Date().toISOString(), target);   /* GTD: so a link that went nowhere can be traced */
          const t = /^(https?|obsidian):\/\//i.test(target) ? target : path.resolve(target);
          /* GTD: argument array, never a shell string - the old `open "${t}"` let a
             crafted target run any command on this Mac */
          if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', t], { windowsHide: true });
          else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [t]);
          sendJson(res, { opened: target });
        } catch (e) { sendJson(res, { error: String(e.message) }, 400); }
      });
    }
    if (p2 === '/api/artifact-remove' && req.method === 'POST') {
      /* GTD: the shipped server listed this route but never had it. Moves the ball's
         html and sidecar into artifacts/_trash; a vault- link is only the link, the
         vault file itself is never touched, and vault-feeds leaves trashed ones out. */
      let body = '';
      req.on('data', c => body += c);
      return req.on('end', () => {
        try {
          const { file } = JSON.parse(body || '{}');
          if (!file || file !== path.basename(file) || !/\.html?$/i.test(file)) return sendJson(res, { error: 'bad file' }, 400);
          const trash = path.join(ARTIFACTS, '_trash');
          fs.mkdirSync(trash, { recursive: true });
          for (const f of [file, file.replace(/\.html?$/i, '.json')]) {
            const from = path.join(ARTIFACTS, f);
            try { fs.lstatSync(from); } catch { continue; }
            fs.renameSync(from, path.join(trash, f));
          }
          sendJson(res, { ok: true });
        } catch (e) { sendJson(res, { error: String(e.message) }, 400); }
      });
    }
    if (p2 === '/api/run' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      return req.on('end', () => {
        const { id, model, effort } = JSON.parse(body || '{}');
        if (!SKILLS.find(s => s.id === id)) return sendJson(res, { error: 'unknown skill' }, 400);
        const job = startJob({ id, model, effort });
        sendJson(res, { job: job.jobId });
      });
    }
    if (p2 === '/api/run-status') {
      const job = JOBS.get(u.searchParams.get('job'));
      if (!job) return sendJson(res, { error: 'unknown job' }, 404);
      return sendJson(res, {
        status: job.status, code: job.code, report: job.report,
        elapsed: Math.round(((job.ended || Date.now()) - job.started) / 1000),
        tail: logTail(job.logFile, 700).split('\n').slice(-6).join('\n')
      });
    }

    /* ---- vault files (GTD) ---- */
    if (p2 === '/api/vault-find') {
      const f = vaultFind(u.searchParams.get('name'), u.searchParams.get('from'));
      return sendJson(res, f ? { path: f } : { error: 'not found' }, f ? 200 : 404);
    }
    if (p2 === '/api/vault-search') return sendJson(res, { results: vaultSearch(u.searchParams.get('q')) });
    if (p2 === '/api/apps' && req.method === 'GET') return sendJson(res, { apps: await appStatus() });
    if (p2 === '/api/apps/log') {
      const a = loadApps().find(x => x.id === u.searchParams.get('id'));
      if (!a) return sendJson(res, { error: 'unknown app' }, 404);
      const tails = a.procs.map(pr => { let t = ''; try { t = fs.readFileSync(path.join(APP_LOGS, `${a.id}-${pr.name}.log`), 'utf8').slice(-2500); } catch {} return { name: pr.name, tail: t }; });
      return sendJson(res, { logs: tails });
    }
    if ((p2 === '/api/apps/start' || p2 === '/api/apps/stop') && req.method === 'POST') {
      const { id } = await readJson(req);
      try { return sendJson(res, p2.endsWith('start') ? await startApp(String(id)) : await stopApp(String(id))); }
      catch (e) { return sendJson(res, { error: String(e.message || e) }, 400); }
    }
    if (p2.startsWith('/vault/')) {
      const f = vaultPath(p2.slice('/vault/'.length));
      return f ? serveFile(res, f) : sendJson(res, { error: 'not allowed' }, 403);
    }

    /* ---- static ---- */
    if (p2 === '/' || p2 === '/index.html')
      return serveFile(res, path.join(HERE, 'dashboard.html'));
    if (p2 === '/widgets')
      return serveFile(res, path.join(HERE, 'widgets.html'));
    if (p2.startsWith('/artifacts/')) {
      const f = safeJoin(ARTIFACTS, p2.slice('/artifacts/'.length));
      if (!f) return sendJson(res, { error: 'bad path' }, 400);
      /* GTD: a vault- ball is a symlink into the vault. Served from the flat artifacts
         folder, its relative CSS, JS, fonts and images resolve to /artifacts/ and 404, so
         send the browser to the file's real place under /vault/, where they resolve. */
      try {
        if (fs.lstatSync(f).isSymbolicLink()) {
          const real = fs.realpathSync(f);
          if (real.startsWith(VAULT + path.sep)) {
            const rel = path.relative(VAULT, real).split(path.sep).map(encodeURIComponent).join('/');
            res.writeHead(302, { Location: '/vault/' + rel + (u.search || '') + (u.hash || ''), 'Cache-Control': 'no-store' });
            return res.end();
          }
        }
      } catch {}
      return serveFile(res, f);
    }
    const local = safeJoin(HERE, p2);
    if (local) return serveFile(res, local);
    sendJson(res, { error: 'not found' }, 404);
  } catch (e) {
    sendJson(res, { error: String(e.message || e) }, 500);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`RUBRIC Agentic OS  ->  http://localhost:${PORT}`);
  console.log(`artifacts (balls)  ->  ${ARTIFACTS}`);
  /* warm the slow sources so the first page load already has data
     (a wired inbox walks ~18 fetches and takes ~20s cold) */
  /* GTD: rebuild stats, routines, crons and the ring from the vault, now and every 10 min */
  const feeds = () => { try { const r = require('./tools/vault-feeds.js').run(); console.log('  vault feeds', JSON.stringify(r)); cache.delete('stats'); cache.delete('rt'); } catch (e) { console.error('  vault feeds failed', e.message); } };
  feeds(); setInterval(feeds, 10 * 60 * 1000);
  setInterval(ringWatch, 30 * 1000); setTimeout(ringWatch, 5000);
  cached('cal', 120000, getCalendar).then(() => console.log('  calendar ready'));
  cached('mail', 180000, getEmail).then(d => console.log('  email ready', d.total ?? d.error ?? ''));
  /* keep them warm in the background so a refresh is never a cold wait */
  setInterval(() => cached('mail', 1, getEmail), 170000);
  setInterval(() => cached('cal', 1, getCalendar), 110000);
});
