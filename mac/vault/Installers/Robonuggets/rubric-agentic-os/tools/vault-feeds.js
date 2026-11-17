/* vault-feeds.js - builds the OS feeds from Luke's Obsidian vault (GTD) and the
   machine's real schedulers, so no widget is ever hand-typed.

     node tools/vault-feeds.js          writes everything below, prints a summary

   Writes (all regenerated on every run, safe to delete):
     snapshots/routines.json   routines board   (launchd jobs + cloud routines)
     snapshots/gtd-crons.json  Rubric Crons tab (same schedule, cron syntax)
     snapshots/stats.json      stats widget     (this month's Instagram analytics notes)
     artifacts/vault-*.html    ring balls       (symlinks to HTML reports in the vault)

   server.js runs this on start and every 10 minutes. Zero dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = path.join(__dirname, '..');
/* the vault is the nearest folder above this kit holding CLAUDE.md and .obsidian,
   so the kit keeps working wherever it is moved inside the vault */
const findVault = () => { let d = HERE; while (d !== path.dirname(d)) { d = path.dirname(d);
  if (fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, '.obsidian'))) return d; } return path.join(HERE, '..', '..'); };
const VAULT = path.resolve(process.env.VAULT_ROOT || findVault());
const SNAP = path.join(HERE, 'snapshots');
const ARTIFACTS = path.join(HERE, 'artifacts');
const LAUNCH_AGENTS = path.join(process.env.HOME || '', 'Library', 'LaunchAgents');
const LAUNCHD_PREFIX = 'com.gettruckdrivers.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* Cloud routines live on claude.ai, so their schedule cannot be read from this
   machine. Each one is tied to the automation note that documents it, and that
   note's `status:` decides whether it shows as enabled (paused -> disabled). */
const CLOUD_ROUTINES = [
  { id: 'weekly-content-post', name: 'Weekly Content Post', note: 'Memory/Automations/Weekly Content Slack Post.md',
    cron: '0 9 * * 1', tz: 'America/Chicago', t: '09:00', d: 'mon',
    desc: 'Posts the week\'s content schedule to Slack #daily-updates' },
];
/* What each launchd job is, in words. Unknown gettruckdrivers jobs still show, with their label. */
const LAUNCHD_DESC = {
  'ig-vault-sync': 'Transcribes new reels into the vault, refreshes 30 days of analytics, rebuilds the indexes',
  'ig-token-refresh': 'Refreshes the Instagram long-lived token for the API registry',
  'rubric-console': null, 'second-brain': null, 'agentic-os': null,   /* the dashboards themselves: not routines */
};

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function frontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}
const pad = n => String(n).padStart(2, '0');
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* ---------------- schedule: launchd + cloud ---------------- */
function readLaunchd() {
  const jobs = [];
  let files = [];
  try { files = fs.readdirSync(LAUNCH_AGENTS).filter(f => f.startsWith(LAUNCHD_PREFIX) && f.endsWith('.plist')); } catch { }
  for (const f of files) {
    let j;
    try { j = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(LAUNCH_AGENTS, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
    catch { continue; }
    const short = j.Label.slice(LAUNCHD_PREFIX.length);
    if (LAUNCHD_DESC[short] === null) continue;
    const desc = LAUNCHD_DESC[short] || j.Label;
    const name = short.split('-').map(w => w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ');
    const cal = j.StartCalendarInterval;
    if (cal && !Array.isArray(cal)) {
      const h = cal.Hour ?? 0, m = cal.Minute ?? 0;
      const dow = cal.Weekday !== undefined ? String(cal.Weekday) : '*';
      jobs.push({ id: short, name, desc, cron: `${m} ${h} * * ${dow}`, t: `${pad(h)}:${pad(m)}`,
        d: cal.Weekday !== undefined ? DOW[cal.Weekday % 7] : 'daily', est: false });
    } else if (j.StartInterval) {
      /* interval jobs have no fixed slot; estimate the next one from the last log write */
      const log = j.StandardOutPath;
      let last = null;
      try { last = fs.statSync(log).mtime; } catch { }
      const days = Math.round(j.StartInterval / 86400);
      if (last && days === 7) {
        jobs.push({ id: short, name, desc: desc + ` (every ${days} days, slot estimated from the last run)`,
          cron: `${last.getMinutes()} ${last.getHours()} * * ${last.getDay()}`,
          t: `${pad(last.getHours())}:${pad(last.getMinutes())}`, d: DOW[last.getDay()], est: true });
      } else {
        jobs.push({ id: short, name, desc: desc + ` (every ${days || j.StartInterval + 's'} days)`, cron: null, t: null, d: null, est: true });
      }
    }
  }
  return jobs;
}
function readCloud() {
  return CLOUD_ROUTINES.map(r => {
    let status = 'unknown';
    try { status = frontmatter(fs.readFileSync(path.join(VAULT, r.note), 'utf8')).status || 'unknown'; } catch { }
    return { ...r, enabled: status === 'active', status };
  });
}
function buildSchedule() {
  const local = readLaunchd(), cloud = readCloud();
  const now = new Date().toISOString();
  const routines = [];
  for (const j of local) if (j.t) routines.push({ t: j.t, d: j.d, src: 'launchd', n: j.name, desc: j.desc, ...(j.est ? { est: true } : {}) });
  for (const c of cloud) if (c.enabled) routines.push({ t: c.t, d: c.d, src: 'cloud', n: c.name, desc: c.desc + ' (time is Central)' });
  writeJson(path.join(SNAP, 'routines.json'), {
    generated: now,
    sources: [{ key: 'launchd', label: 'THIS MAC' }, { key: 'cloud', label: 'CLAUDE CLOUD' }],
    counts: { launchd: local.length, cloud: cloud.filter(c => c.enabled).length },
    paused: cloud.filter(c => !c.enabled).map(c => `${c.name} (${c.status})`),
    routines,
  });
  const crons = [
    ...local.filter(j => j.cron).map(j => ({ id: j.id, name: j.name + (j.est ? ' (slot estimated)' : ''), cron: j.cron, enabled: true, description: j.desc, agent: j.id === 'ig-vault-sync' ? 'ig-vault-sync' : null })),
    ...cloud.map(c => ({ id: c.id, name: c.name + (c.enabled ? '' : ` (${c.status})`), cron: c.cron, tz: c.tz, enabled: c.enabled, description: c.desc, agent: c.id })),
  ];
  writeJson(path.join(SNAP, 'gtd-crons.json'), { description: 'Generated by tools/vault-feeds.js from launchd and the vault automation notes. Do not hand-edit.', generated: now, crons });
  return { local: local.length, cloud: cloud.length, paused: cloud.filter(c => !c.enabled).length };
}

/* ---------------- stats: this month's posted reels ---------------- */
function buildStats() {
  const now = new Date();
  const month = MONTHS[now.getMonth()], year = now.getFullYear();
  const dir = path.join(VAULT, 'Content', 'Instagram', 'Analytics', String(year), month);
  let notes = [];
  try { notes = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('00 ')); } catch { }
  const days = new Set(), completion = [];
  let reels = 0, measured = '';
  for (const f of notes) {
    const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (fm.type !== 'analytics' || fm.repost === 'yes') continue;
    reels++;
    const up = new Date(fm.uploaded);
    if (!isNaN(up) && up.getMonth() === now.getMonth()) days.add(up.getDate());
    if (fm.completion_pct && !isNaN(+fm.completion_pct)) completion.push(+fm.completion_pct);
    if (fm.measured && fm.measured > measured) measured = fm.measured;
  }
  const index = path.join(dir, `00 ${month} ${year} Analytics Index.md`);
  if (!reels) {
    writeJson(path.join(SNAP, 'stats.json'), { title: 'INSTAGRAM', big: 0, cap: `NO REELS FILED FOR ${month.toUpperCase()} YET<br>the 06:15 sync fills this`, gridLabel: '', publishDays: [] });
    return { reels: 0 };
  }
  const avg = completion.length ? (completion.reduce((a, b) => a + b, 0) / completion.length).toFixed(1) : null;
  const mDate = measured ? new Date(measured + 'T12:00:00') : null;
  const mLabel = mDate ? `${mDate.getDate()} ${MONTHS[mDate.getMonth()].slice(0, 3)}` : 'undated';
  writeJson(path.join(SNAP, 'stats.json'), {
    title: 'INSTAGRAM',
    big: reels,
    cap: `REELS POSTED · ${month.toUpperCase()}<br>${avg ? `avg completion ${avg}%` : 'no completion data'} · measured ${mLabel}`,
    gridLabel: `${days.size} POSTING DAYS IN ${month.toUpperCase()}`,
    publishDays: [...days].sort((a, b) => a - b),
    link: fs.existsSync(index) ? 'obsidian://open?path=' + encodeURIComponent(index) : undefined,
    source: path.relative(VAULT, dir),
  });
  return { reels, days: days.size, measured };
}

/* ---------------- ring: HTML already built into the vault ---------------- */
const RING_SKIP = new Set(['.obsidian', '.trash', 'node_modules', 'skills', 'Robonuggets', '.claude']);
function findVaultHtml() {
  const out = [];
  (function rec(abs) {
    let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (!RING_SKIP.has(e.name) && !e.name.startsWith('.')) rec(path.join(abs, e.name)); }
      else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(path.join(abs, e.name));
    }
  })(VAULT);
  return out;
}
function buildRing() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const want = new Map();
  for (const abs of findVaultHtml()) {
    const rel = path.relative(VAULT, abs);
    const slug = 'vault-' + rel.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.html';
    want.set(slug, abs);
  }
  let added = 0, removed = 0;
  const STUB = '<!-- vault-feeds stub -->';
  const isStub = p => { try { return fs.readFileSync(p, 'utf8').startsWith(STUB); } catch { return false; } };
  /* a dashboard whose folder has serve.py fetches its data from that server, so
     its ball is a stub that opens the dashboard there instead of a bare file */
  const servedAt = abs => {
    const sp = path.join(path.dirname(abs), 'serve.py');
    if (!fs.existsSync(sp)) return null;
    const m = fs.readFileSync(sp, 'utf8').match(/\(\s*["']127\.0\.0\.1["']\s*,\s*(\d+)\s*\)/);
    return m ? `http://127.0.0.1:${m[1]}/${encodeURIComponent(path.basename(abs))}` : null;
  };
  const stubFor = (abs, url) => {
    const title = (fs.readFileSync(abs, 'utf8').slice(0, 3000).match(/<title>([^<]+)<\/title>/i)?.[1] || path.basename(abs)).trim();
    const dir = path.dirname(abs);
    return `${STUB}
<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{background:#050504;color:#e8e2d2;font:15px/1.6 system-ui;padding:48px}a{color:#ff6b1a}code{background:#1c1a16;padding:2px 6px;border-radius:4px}</style>
<h1>${title}</h1>
<p>This dashboard reads its data from its own server. Opening <a href="${url}">${url}</a>…</p>
<p>If nothing loads, start it first: <code>cd "${dir}" &amp;&amp; python3 serve.py</code></p>
<script>fetch(${JSON.stringify(url)},{mode:'no-cors'}).then(()=>location.replace(${JSON.stringify(url)})).catch(()=>{})</script>
`;
  };
  /* drop links and stubs whose vault file is gone; leave anything else alone */
  for (const f of fs.readdirSync(ARTIFACTS)) {
    if (!f.startsWith('vault-')) continue;
    const p = path.join(ARTIFACTS, f);
    const link = fs.lstatSync(p).isSymbolicLink();
    if (!link && !isStub(p)) continue;
    const stale = !want.has(f) || (link ? (servedAt(want.get(f)) || fs.readlinkSync(p) !== want.get(f)) : !servedAt(want.get(f)));
    if (stale) { fs.unlinkSync(p); removed++; }
  }
  for (const [slug, abs] of want) {
    const p = path.join(ARTIFACTS, slug);
    /* respect a right-click REMOVE: anything already sitting in _trash stays removed */
    if (fs.existsSync(path.join(ARTIFACTS, '_trash', slug))) continue;
    const url = servedAt(abs);
    if (url) { const html = stubFor(abs, url); if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== html) { fs.writeFileSync(p, html); added++; } }
    else if (!fs.existsSync(p)) { fs.symlinkSync(abs, p); added++; }
  }
  return { linked: want.size, added, removed };
}

function run() {
  const out = {};
  for (const [k, fn] of [['schedule', buildSchedule], ['stats', buildStats], ['ring', buildRing]]) {
    try { out[k] = fn(); } catch (e) { out[k] = { error: String(e.message || e) }; }
  }
  return out;
}
module.exports = { run, buildRing };
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
