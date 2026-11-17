#!/usr/bin/env node
/* session-load.js - the session start load, shared by Mac (session-load.sh) and Windows
   (session-load.ps1). GTD, 17 Nov 2026, chat [[2026-11-16 - Token Burn Audit]].
   Prints a one-line trigger for every active automation in Memory/Automations/ and the newest
   12 chats from Memory/Chats/00 Chat Index.md, plus the Brand Asset Feedback check. Nothing
   else from the vault loads. Keep the output under about 9,000 characters: Claude Code cuts
   larger hook output to a 2 KB preview, which is how sessions lost the automations before. */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const VAULT = path.resolve(__dirname, '..', '..');
const clip = (t, n) => (t.length <= n ? t : t.slice(0, n).trimEnd() + '…');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/), d = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) { const v = line.slice(i + 1).trim(); if (v) d[line.slice(0, i).trim()] = v; } }
  return d;
}
try { process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('error', () => {}); } catch (_) {}
const out = [];
const autosDir = path.join(VAULT, 'Memory', 'Automations');
const active = [], inactive = [];
let files = [];
try { files = fs.readdirSync(autosDir).filter((f) => f.endsWith('.md')).sort(); } catch (_) {}
for (const f of files) {
  const name = f.slice(0, -3), d = frontmatter(read(path.join(autosDir, f)));
  if ((d.status || 'active') === 'active' && (d.type || 'automation') === 'automation') active.push(`- [[${name}]] — ${clip(d.trigger || 'see note', 260)}`);
  else inactive.push(`${name} (${d.status || '?'})`);
}
out.push('=== AUTOMATIONS: standing instructions in Memory/Automations/ ===');
out.push('Watch for each trigger below. When one fires, Read that note in full first, then follow');
out.push('its action steps exactly. Read a note only when its trigger fires, once per session.');
out.push('[[Chat Logging]] fires on the first prompt of every session, so read it then.');
out.push(...active);
if (inactive.length) out.push('Not active, ignore unless asked: ' + inactive.join('; ') + '.');

const seen = new Set(), chats = [];
for (const l of read(path.join(VAULT, 'Memory', 'Chats', '00 Chat Index.md')).split(/\r?\n/)) {
  const m = l.match(/^- \[\[(\d{4}-\d\d-\d\d - [^\]|]+)[^\]]*\]\]\s*—\s*(.*)/);
  if (m && !seen.has(m[1])) { seen.add(m[1]); chats.push([m[1], m[2]]); }
}
chats.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
out.push('', `=== RECENT CHATS: newest ${Math.min(12, chats.length)} of ${chats.length} ===`);
for (const [n, t] of chats.slice(0, 12)) out.push(`- [[${n}]] — ${clip(t, 170)}`);
out.push('Older chats: Memory/Chats/00 Chat Index.md, grouped by theme. For "which chat was');
out.push('that", run brain.js recall first, then grep that index. Do not read it in full.');

/* Brand Asset Feedback: brand-agent files changed since an agent made them. Prints nothing when all match. */
const sync = path.join(VAULT, 'Brand', 'tools', 'brand-sync.mjs');
if (fs.existsSync(sync)) {
  try {
    const r = spawnSync(process.execPath, [sync, 'check', '--quiet'], { encoding: 'utf8', timeout: 15000 });
    const changed = String(r.stdout || '').trim();
    if (changed) out.push('', '=== ' + changed.slice(0, 1500));
  } catch (_) {}
}
out.push('', 'That is the whole session load. Do not scan, list or read the rest of the vault.');
out.push('To find something: brain.js recall or grep first, then 00 Master Index.md, then follow it down.');
process.stdout.write(out.join('\n') + '\n');
process.exit(0);
