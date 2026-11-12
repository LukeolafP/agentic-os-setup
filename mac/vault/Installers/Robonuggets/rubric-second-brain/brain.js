/* brain.js - the fast storage/retrieval path for the second brain.
   Zero deps. Used directly by agents (one command instead of a grep-and-read
   expedition) and by bench/bench.js to prove the speedup.

   node brain.js recall "what price is the community locked at"
   node brain.js store "fact text" --type feedback --name my-slug [--why "..."] [--how "..."] [--desc "index one-liner"] [--sandbox]

   recall: index-first. Reads the hub indexes (MEMORY.md, or the vault's recallIndexes), scores pointers,
   opens ONLY the best file(s), prints the relevant slice. Reports bytes + ms.
   store: writes a convention-correct memory file + appends the index line in
   one step. No exploration reads. Reports bytes + ms.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const WS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'workspace.json'), 'utf8')); } catch { return {}; } })();
const ROOT = path.resolve(__dirname, WS.root || '..');
// Obsidian vault mode: facts are written to their own folder (factsDir) with a
// `00 ... Index.md` index, and recall starts from the vault's index chain
// (recallIndexes) instead of one MEMORY.md. Without these keys it behaves as shipped.
const MEM = path.join(ROOT, ...(WS.factsDir || WS.memoryDir || 'shared/memory').split('/'));
const MEM_INDEX = WS.memoryIndex || 'MEMORY.md';
const HUBS = (WS.recallIndexes || [path.relative(ROOT, path.join(MEM, MEM_INDEX))]).map(r => path.join(ROOT, ...r.split('/')));
const MASTER = WS.masterIndex ? path.join(ROOT, ...WS.masterIndex.split('/')) : null;
const SANDBOX = path.join(__dirname, '.cache', 'sandbox-memory');
const EXCLUDE = new Set(['node_modules', '.git', '.cache', '.obsidian', '.trash', ...(WS.excludeDirs || [])]);

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'what', 'whats', 'which', 'who', 'when', 'where', 'how', 'do', 'does', 'did', 'i', 'my', 'we', 'our', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or', 'with', 'about', 'it', 'this', 'that', 'you', 'your', 'me', 'jay', 'jays', 'luke', 'lukes', 'one', 'thing', 'things', 'current', 'new', 'best', 'main', 'use', 'get', 'set']);

function words(s, keepStop) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s]+/)
    .filter(w => w.length > 2 && (keepStop || !STOP.has(w)));
}

// Root docs own certain question domains - the one piece of routing knowledge
// the CLI encodes (same thing CLAUDE.md's Map teaches an agent once).
// which root doc owns which topic - filled per workspace during setup (Step 1)
const ROOT_DOC_HINTS = WS.routing || {
  'CLAUDE.md': ['goal', 'goals', 'rule', 'rules', 'workspace', 'folder', 'folders', 'map'],
};

// ---------- vault file map (names only, no content reads) ----------
let _vault = null;
function vaultFiles() {
  if (_vault) return _vault;
  const rels = [];
  (function rec(abs, rel) {
    let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (!EXCLUDE.has(e.name)) rec(path.join(abs, e.name), rel ? rel + '/' + e.name : e.name); }
      else if (e.isFile() && e.name.endsWith('.md')) rels.push(rel ? rel + '/' + e.name : e.name);
    }
  })(ROOT, '');
  const base = new Map(), byPath = new Set(rels.map(r => r.toLowerCase()));
  for (const r of rels) {
    const k = path.posix.basename(r, '.md').toLowerCase();
    if (!base.has(k)) base.set(k, []);
    base.get(k).push(r);
  }
  _vault = { rels, base, byPath, exact: new Map(rels.map(r => [r.toLowerCase(), r])) };
  return _vault;
}
function closest(fromRel, cands) {
  if (cands.length === 1) return cands[0];
  const a = (fromRel || '').split('/');
  let best = cands[0], bs = -1;
  for (const c of cands) { const b = c.split('/'); let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; if (n > bs) { bs = n; best = c; } }
  return best;
}
// resolve a [[wiki link]] target or a relative .md link the way Obsidian does
function resolveLink(target, fromRel) {
  const v = vaultFiles();
  let t = target.replace(/\\$/, '').split('#')[0].trim();
  if (!t) return null;
  if (/^[a-z]+:\/\//i.test(t)) return null;
  try { t = decodeURIComponent(t); } catch { }
  t = t.replace(/\.md$/i, '');
  if (t.includes('/')) {
    const direct = v.exact.get((t + '.md').toLowerCase());
    if (direct) return direct;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel || ''), t + '.md'));
    if (v.exact.has(rel.toLowerCase())) return v.exact.get(rel.toLowerCase());
    t = path.posix.basename(t);
  }
  const hits = v.base.get(t.toLowerCase());
  return hits ? closest(fromRel, hits) : null;
}
// every link in a line, in order: [[Target|alias]], [[Target\|alias]], [text](file.md)
function linksIn(line) {
  const out = [];
  const re = /\[\[([^\]|#\\]+)(?:#[^\]|\\]*)?(?:\\?\|[^\]]*)?\]\]|\[[^\]]*\]\(([^)\s]+\.md)\)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] || m[2]);
  return out;
}

// ---------- recall ----------
function recall(query, opts) {
  opts = opts || {};
  const t0 = performance.now();
  let bytes = 0;
  const read = p => { const s = fs.readFileSync(p, 'utf8'); bytes += Buffer.byteLength(s); return s; };
  const qw = words(query);
  const toAbs = rel => path.join(ROOT, ...rel.split('/'));

  // Every candidate is a "unit": one index line, one filename, or one routed root doc.
  // Scoring is weighted by rarity (a word that appears in few units, like `learn`,
  // decides more than one in many, like `keyword`), and plurals match their singular.
  const stem = w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w;
  const qs = [...new Set(qw.map(stem))];
  const units = []; // {file, kind, ws:Set, line, base}

  // 1) index hop: the vault's own indexes are the hubs (Master Index routes,
  //    Chat Index lists every chat, Facts Index lists every stored fact).
  //    Each line's first resolvable link is the file it points at.
  const factsHub = path.join(MEM, MEM_INDEX);
  for (const hub of HUBS) {
    if (!fs.existsSync(hub)) continue;
    const hubRel = path.relative(ROOT, hub).split(path.sep).join('/');
    for (const line of read(hub).split('\n')) {
      const links = linksIn(line);
      if (!links.length) continue;
      const target = links.map(l => resolveLink(l, hubRel)).find(Boolean);
      if (!target) continue;
      // score the line's own words, not the link target: [[Target|alias]] keeps the alias,
      // [[Target]] drops out. The target's name is scored by the filename sweep, and
      // counting it here too would score every chat twice for its own title.
      const text = line.replace(/\[\[([^\]|\\]+)(?:\\?\|([^\]]*))?\]\]/g, (m, t, alias) => ' ' + (alias || '') + ' ');
      // the facts index is the curated store, so its pointers win ties against chats and notes
      units.push({ file: toAbs(target), kind: 'hub', ws: new Set(words(text).map(stem)), line: line.trim().slice(0, 240), base: 3, bonus: hub === factsHub ? 2 : 0 });
    }
  }
  // 2) filename sweep across the whole vault (names only - no content reads)
  for (const rel of vaultFiles().rels) {
    units.push({ file: toAbs(rel), kind: 'name', ws: new Set(words(path.posix.basename(rel, '.md')).map(stem)), line: '(filename match) ' + rel, base: 4, bonus: 0 });
  }
  const N = units.length;
  const idf = {};
  for (const w of qs) {
    let df = 0;
    for (const u of units) if (u.ws.has(w)) df++;
    idf[w] = Math.log(1 + N / (1 + df));
  }
  // per note, each query word counts ONCE, at its strongest match across that note's
  // index lines and filename: a note wins by covering more of the question, not by
  // repeating one word in two places
  const best = new Map(); // file -> {per: {word: score}, bonus, root, line, lineScore}
  for (const u of units) {
    const per = {};
    let total = 0;
    for (const w of qs) {
      let sc = 0;
      if (u.ws.has(w)) sc = u.base * idf[w];
      else if (w.length > 3) for (const x of u.ws) { if (x.length > 3 && (x.startsWith(w) || w.startsWith(x))) { sc = idf[w] * 0.5; break; } }
      if (sc) { per[w] = sc; total += sc; }
    }
    if (!total) continue;
    const cur = best.get(u.file) || { file: u.file, per: {}, bonus: 0, root: 0, line: '', lineScore: -1 };
    for (const [w, sc] of Object.entries(per)) cur.per[w] = Math.max(cur.per[w] || 0, sc);
    cur.bonus = Math.max(cur.bonus, u.bonus);
    if (u.kind === 'hub' ? total + 1000 > cur.lineScore : !cur.line) { if (u.kind === 'hub') cur.lineScore = total + 1000; cur.line = u.line; }
    best.set(u.file, cur);
  }
  // 3) root docs own certain question domains (routing map in workspace.json)
  for (const [f, hints] of Object.entries(ROOT_DOC_HINTS)) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    let score = 0;
    for (const w of qw) if (hints.includes(w)) score += 4;
    if (score <= 0) continue;
    const cur = best.get(p) || { file: p, per: {}, bonus: 0, root: 0, line: '(root doc) ' + f };
    cur.root = score; best.set(p, cur);
  }
  const top = [...best.values()]
    .map(c => ({ file: c.file, score: +(Object.values(c.per).reduce((x, y) => x + y, 0) + c.bonus + c.root).toFixed(1), line: c.line }))
    .sort((a, b) => b.score - a.score).slice(0, opts.k || 3);

  const qrawAll = words(query, true);
  const sliceOf = (body) => {
    const lines = body.split('\n');
    let hStart = -1, hBest = 0;
    lines.forEach((line, i) => {
      if (!/^#{2,4}\s/.test(line)) return;
      const hw = words(line, true);
      const s = qrawAll.filter(w => hw.includes(w)).length;
      if (s > hBest) { hBest = s; hStart = i; }
    });
    if (hStart >= 0 && hBest >= 1) return lines.slice(hStart, Math.min(lines.length, hStart + 26)).join('\n');
    let bestI = 0, bestS = -1;
    lines.forEach((line, i) => {
      const lw = line.toLowerCase();
      let s = 0;
      for (const w of qw) if (lw.includes(w)) s++;
      if (s > bestS) { bestS = s; bestI = i; }
    });
    const lo = Math.max(0, bestI - 10), hi = Math.min(lines.length, bestI + 16);
    return lines.slice(lo, hi).join('\n');
  };
  const hits = [];
  let found = false;
  for (const t of top) {
    if (!fs.existsSync(t.file)) continue;
    if (found) break;
    const body = read(t.file);
    if (opts.answerRe && opts.answerRe.test(body)) found = true;
    hits.push({ file: path.relative(ROOT, t.file).split(path.sep).join('/'), score: t.score, pointer: t.line, slice: sliceOf(body) });
  }
  // 4) one pointer hop: if the best slice links another note, open that too -
  //    the evidence should hold the fact, not just the address of the fact
  if (hits.length && opts.hop !== false && !found) {
    for (const cand of linksIn(hits[0].slice)) {
      const rel = resolveLink(cand, hits[0].file);
      if (!rel || /(^|\/)00 [^/]*Index\.md$/.test(rel) && rel === hits[0].file) continue;
      const hp = toAbs(rel);
      if (hits.some(h => h.file === rel)) continue;
      const body = read(hp);
      if (opts.answerRe && opts.answerRe.test(body)) found = true;
      const qraw = words(query, true);
      const blines = body.split('\n');
      let start = 0, bestH = 0;
      for (let i = 0; i < blines.length; i++) {
        const hm = blines[i].match(/^(#{2,4})\s/);
        if (!hm) continue;
        const hw = words(blines[i], true);
        const s2 = qraw.filter(w => hw.includes(w)).length;
        if (s2 > bestH && s2 >= 1) { bestH = s2; start = Math.max(0, i - 1); }
      }
      const head = blines.slice(start, start + 45).join('\n').slice(0, 3500);
      hits.push({ file: rel, score: 0, pointer: '(followed from ' + hits[0].file + ')', slice: head });
      break;
    }
  }
  return { hits, bytes, ms: +(performance.now() - t0).toFixed(2), found };
}

// ---------- store ----------
// Writes one fact as an Obsidian note in factsDir and files its line in the
// facts index, in the vault's own conventions: Title Case filename, YAML
// frontmatter, [[wiki link]] index line, index linked up to the Master Index.
const TYPES = ['user', 'feedback', 'project', 'reference'];
function newIndex(today) {
  return `---
type: index
indexes: ${path.relative(ROOT, MEM).split(path.sep).join('/')}
updated: ${today}
maintained: by brain.js store, and by hand
---

# ${MEM_INDEX.replace(/\.md$/, '')}

Up: [[${MASTER ? path.basename(MASTER, '.md') : 'CLAUDE'}]]

One durable fact per note, saved with \`node Installers/Robonuggets/rubric-second-brain/brain.js store\`.
One line each, newest first within its section. \`brain.js recall\` reads this index first.

## User

## Feedback

## Project

## Reference

## Related
- [[${MASTER ? path.basename(MASTER, '.md') : 'CLAUDE'}]] — the routing table for the whole vault
`;
}
function store(fact, opts) {
  opts = opts || {};
  const t0 = performance.now();
  const type = TYPES.includes(opts.type) ? opts.type : 'project';
  const slug = (opts.name || words(fact).slice(0, 4).join('-') || 'note').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const dir = opts.sandbox ? SANDBOX : MEM;
  fs.mkdirSync(dir, { recursive: true });
  let fname = title + '.md';
  for (let n = 2; fs.existsSync(path.join(dir, fname)); n++) fname = `${title} (${n}).md`;
  const noteName = fname.replace(/\.md$/, '');
  const file = path.join(dir, fname);
  const today = new Date().toISOString().slice(0, 10);
  // redact token-shaped strings so secrets never land in an always-loaded index line
  const safeFact = fact.replace(/\b(github_pat_|ghp_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_\-]{10,}/g, '$1<redacted - full value in memory body>');
  // --desc gives the index its one-liner; otherwise the fact's opening is clipped to fit
  const desc = (opts.desc || (safeFact.length > 110 ? safeFact.slice(0, 107) + '...' : safeFact)).replace(/\n/g, ' ');
  const indexName = MEM_INDEX.replace(/\.md$/, '');
  const body = `---
type: fact
fact: ${type}
name: ${slug}
description: ${JSON.stringify(desc)}
created: ${today}
source: brain store
---

# ${noteName}

${fact}
${opts.why ? `\n**Why:** ${opts.why}\n` : ''}${opts.how ? `\n**How to apply:** ${opts.how}\n` : ''}
## Related
- [[${indexName}]] — every stored fact
`;
  fs.writeFileSync(file, body);
  const entry = `- [[${noteName}]] — ${desc}\n`;

  const index = path.join(dir, MEM_INDEX);
  const created = !fs.existsSync(index);
  if (created) fs.writeFileSync(index, opts.sandbox ? '# Sandbox Memory Index\n\n## User\n\n## Feedback\n\n## Project\n\n## Reference\n' : newIndex(today));
  let txt = fs.readFileSync(index, 'utf8');
  const heading = new RegExp('^## ' + type.charAt(0).toUpperCase() + type.slice(1) + '\\b.*$', 'm');
  const m = txt.match(heading) || txt.match(/^## New \/ Unsorted\b.*$/m);
  if (m) {
    let at = txt.indexOf('\n', txt.indexOf(m[0])) + 1;
    if (txt[at] === '\n') at += 1;
    // first line of an empty section: keep a blank line before the next heading
    txt = txt.slice(0, at) + entry + (txt[at] === '#' ? '\n' : '') + txt.slice(at);
  } else {
    txt = txt.trimEnd() + '\n\n## New / Unsorted (filed by brain store - sort into a section when touched)\n\n' + entry;
  }
  txt = txt.replace(/^updated: .*$/m, 'updated: ' + today);
  fs.writeFileSync(index, txt);

  // a new index gets a row in the Master Index in the same step, or nothing finds it
  let masterRow = null;
  if (created && !opts.sandbox && MASTER && fs.existsSync(MASTER)) {
    let mt = fs.readFileSync(MASTER, 'utf8');
    if (!mt.includes('[[' + indexName)) {
      const sec = mt.indexOf('## Where to go');
      const lines = mt.slice(sec).split('\n');
      let last = -1;
      for (let i = 0; i < lines.length; i++) { if (lines[i].startsWith('|')) last = i; else if (last >= 0 && lines[i].trim() === '') break; }
      if (last >= 0) {
        masterRow = `| A durable fact about how Luke works or what was decided, one per note | [[${indexName}]] | saved by \`brain.js store\`; \`brain.js recall\` reads it first |`;
        lines.splice(last + 1, 0, masterRow);
        mt = mt.slice(0, sec) + lines.join('\n');
        mt = mt.replace(/^updated: .*$/m, 'updated: ' + today);
        fs.writeFileSync(MASTER, mt);
      }
    }
  }
  _vault = null;
  const bytes = Buffer.byteLength(body) + Buffer.byteLength(entry);
  return { file: path.relative(ROOT, file), indexLine: entry.trim(), indexCreated: created, masterRow, bytes, ms: +(performance.now() - t0).toFixed(2) };
}

// builds the one-turn prompt (question + recall evidence). NO LLM here -
// the caller pastes it into their own session, so nothing bills as API usage.
function buildAsk(question, k, recallQuery) {
  const r = recall(recallQuery || question, { k: k || 1 });
  const evidence = r.hits.map(h => `=== ${h.file}\n${h.slice}`).join('\n\n').slice(0, 9000);
  const prompt = `${question}\n\nEvidence pulled by the workspace brain (brain.js recall):\n${evidence}\n\nAnswer from this evidence only: quote the key line, name the source file. One short answer, no preamble.`;
  return { prompt, recallBytes: r.bytes, recallMs: r.ms, hits: r.hits.map(h => h.file) };
}

// cross-platform clipboard: Windows clip / macOS pbcopy / Linux xclip-or-xsel
function copyToClipboard(text) {
  const { spawnSync } = require('child_process');
  const tries = process.platform === 'win32' ? [['clip', []]]
    : process.platform === 'darwin' ? [['pbcopy', []]]
      : [['xclip', ['-selection', 'clipboard']], ['xsel', ['-ib']]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { input: text });
    if (r.status === 0) return r;
  }
  return { status: 1 };
}

module.exports = { recall, store, buildAsk, ROOT, MEM, SANDBOX };

// ---------- CLI ----------
if (require.main === module) {
  const [, , cmd, ...rest] = process.argv;
  const args = [], flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
    else args.push(rest[i]);
  }
  if (cmd === 'recall') {
    const r = recall(args.join(' '), { k: Number(flags.k) || 3 });
    for (const h of r.hits) {
      console.log(`\n=== ${h.file}  (score ${h.score})`);
      console.log(h.slice);
    }
    console.log(`\n[brain] ${r.hits.length} hits · ${r.bytes.toLocaleString()} bytes read · ${r.ms}ms`);
  } else if (cmd === 'store') {
    const r = store(args.join(' '), flags);
    console.log(`[brain] stored -> ${r.file}`);
    console.log(`[brain] index += ${r.indexLine}`);
    if (r.indexCreated) console.log('[brain] facts index created' + (r.masterRow ? ' and added to the Master Index' : ''));
    console.log(`[brain] ${r.bytes.toLocaleString()} bytes written · ${r.ms}ms · zero exploration reads`);
  } else if (cmd === 'ask') {
    // ZERO-LLM by design (Jay): builds the one-turn prompt and copies it to
    // the clipboard - paste it into your own Claude session. brain.js never
    // invokes claude itself, so nothing can bill as API usage.
    const { prompt, recallBytes, recallMs, hits } = buildAsk(args.join(' '), Number(flags.k) || 1);
    const cp = copyToClipboard(prompt);
    console.log(prompt);
    console.log(`\n[brain] one-turn prompt built from ${hits.join(', ') || 'no hits'} · ${recallBytes.toLocaleString()} bytes read in ${recallMs}ms · 0 tokens${cp.status === 0 ? ' · COPIED TO CLIPBOARD' : ''}`);
    console.log('[brain] paste it into your Claude session for the one-turn answer.');
  } else {
    console.log('usage: node brain.js recall "question" [--k 3] | node brain.js store "fact" [--type feedback|project|user|reference] [--name slug] [--why "..."] [--how "..."] [--desc "index one-liner"] [--sandbox] | node brain.js ask "question" (builds + copies the one-turn prompt, no LLM)');
  }
}
