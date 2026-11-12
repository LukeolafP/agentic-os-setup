#!/usr/bin/env node
/* ================================================================
   ring-layout: the OS ring's own folder tree (GTD, 30 Oct 2026)

   The ring around Petra shows folders, not loose files. Where each item sits is decided
   by the Ring Organizer agent (Agents/ring-organizer.md) and kept in ring/layout.json,
   apart from the vault: the ring is organised by what things are for, never by where
   their files live.

     node tools/ring-layout.mjs pending [--all]   items not yet filed (or every item), with context
     node tools/ring-layout.mjs tree              the current tree, with counts
     node tools/ring-layout.mjs apply <file.json> file items, name folders, drop gone items

   A batch for apply:
     { "items":   [ { "file": "<ring file>", "path": ["Top folder", "Sub", "Sub"], "label": "Short name" } ],
       "folders": [ { "path": ["Top folder"], "note": "one line", "order": 1 } ],
       "remove":  [ "<ring file>" ] }
   Paths are 1 to 4 folder names. A file already filed moves to its new path.
   ================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(OS, 'os-config.json'), 'utf8')); } catch { return {}; } })();
const ARTIFACTS = path.resolve(OS, CFG.artifactsDir || 'artifacts');
const LAYOUT = path.join(OS, 'ring', 'layout.json');
const VAULT = path.resolve(OS, '..', '..', '..');

export function readLayout() {
  try { const d = JSON.parse(fs.readFileSync(LAYOUT, 'utf8')); return { folders: d.folders || {}, items: d.items || {}, updated: d.updated || null }; }
  catch { return { folders: {}, items: {}, updated: null }; }
}
function writeLayout(l) {
  fs.mkdirSync(path.dirname(LAYOUT), { recursive: true });
  l.updated = new Date().toISOString();
  const tmp = LAYOUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(l, null, 1));
  fs.renameSync(tmp, LAYOUT);
}

/* every item on the ring, with what an organiser needs to place it */
export function ringItems() {
  if (!fs.existsSync(ARTIFACTS)) return [];
  return fs.readdirSync(ARTIFACTS).filter(f => /\.html?$/i.test(f)).map(f => {
    const full = path.join(ARTIFACTS, f);
    let st; try { st = fs.statSync(full); } catch { return null; }      // a link whose file is gone
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(full.replace(/\.html?$/i, '.json'), 'utf8')); } catch {}
    let source = null;
    try { if (fs.lstatSync(full).isSymbolicLink()) source = path.relative(VAULT, fs.readlinkSync(full)); } catch {}
    let head = '';
    try { head = fs.readFileSync(full, 'utf8').slice(0, 60000); } catch {}
    const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    const title = (meta.title || strip(head.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '') || f.replace(/\.html?$/i, '')).slice(0, 140);
    const headings = [...head.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 5).map(h => h.slice(0, 90));
    return {
      file: f, title, kind: meta.kind || (f.startsWith('agent-') ? 'agent report' : 'page'),
      note: meta.note || '', source: source || (f.startsWith('agent-') ? 'background agent job' : 'ring file'),
      created: (meta.created || st.birthtime.toISOString()).slice(0, 10), modified: st.mtime.toISOString().slice(0, 10), headings,
    };
  }).filter(Boolean);
}

function tree(layout, items) {
  const root = { kids: new Map(), n: 0 };
  const files = new Set(items.map(i => i.file));
  for (const [file, it] of Object.entries(layout.items)) {
    if (!files.has(file)) continue;
    let node = root; root.n++;
    for (const name of it.path) { if (!node.kids.has(name)) node.kids.set(name, { kids: new Map(), n: 0 }); node = node.kids.get(name); node.n++; }
  }
  const out = [];
  (function walk(node, depth, pre) {
    for (const [name, k] of [...node.kids].sort((a, b) => (layout.folders[[...pre, a[0]].join('/')]?.order ?? 99) - (layout.folders[[...pre, b[0]].join('/')]?.order ?? 99) || a[0].localeCompare(b[0]))) {
      out.push('  '.repeat(depth) + name + '  (' + k.n + ')');
      walk(k, depth + 1, [...pre, name]);
    }
  })(root, 0, []);
  return out.join('\n') || '(empty: nothing filed yet)';
}

function apply(batchFile) {
  const batch = JSON.parse(fs.readFileSync(path.resolve(batchFile), 'utf8'));
  const layout = readLayout();
  const known = new Set(ringItems().map(i => i.file));
  const clean = s => String(s || '').replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  let filed = 0, moved = 0, named = 0, removed = 0; const errors = [];
  for (const it of batch.items || []) {
    if (!known.has(it.file)) { errors.push(`not on the ring: ${it.file}`); continue; }
    const p = (Array.isArray(it.path) ? it.path : String(it.path || '').split('/')).map(clean).filter(Boolean);
    if (!p.length || p.length > 4) { errors.push(`${it.file}: path needs 1 to 4 folders`); continue; }
    if (layout.items[it.file]) moved++; else filed++;
    layout.items[it.file] = { path: p, label: clean(it.label) || null, at: new Date().toISOString() };
  }
  for (const f of batch.folders || []) {
    const key = (Array.isArray(f.path) ? f.path : String(f.path || '').split('/')).map(clean).filter(Boolean).join('/');
    if (!key) continue;
    layout.folders[key] = { ...(layout.folders[key] || {}), ...(f.note != null ? { note: String(f.note).slice(0, 160) } : {}), ...(f.order != null ? { order: Number(f.order) } : {}) };
    named++;
  }
  for (const f of batch.remove || []) if (layout.items[f]) { delete layout.items[f]; removed++; }
  /* items whose file left the ring drop out on every apply */
  for (const f of Object.keys(layout.items)) if (!known.has(f)) { delete layout.items[f]; removed++; }
  writeLayout(layout);
  console.log(`filed ${filed}, moved ${moved}, folders noted ${named}, removed ${removed}` + (errors.length ? `\nskipped:\n- ${errors.join('\n- ')}` : ''));
  console.log(`still unfiled: ${[...known].filter(f => !layout.items[f]).length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, arg] = process.argv.slice(2);
  const layout = readLayout();
  if (cmd === 'pending') {
    const items = ringItems().filter(i => arg === '--all' || !layout.items[i.file]);
    console.log(JSON.stringify(items.map(i => (layout.items[i.file] ? { ...i, now: layout.items[i.file].path.join(' / ') } : i)), null, 1));
    console.error(`${items.length} item(s)`);
  } else if (cmd === 'tree') console.log(tree(layout, ringItems()));
  else if (cmd === 'apply' && arg) apply(arg);
  else { console.log('usage: ring-layout.mjs pending [--all] | tree | apply <batch.json>'); process.exit(1); }
}
