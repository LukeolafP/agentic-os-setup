/**
 * GTD: file claims for Petra's managers (21 Oct 2026).
 *
 * Several managers can work on pieces of one deliverable at the same time, but an
 * "official" file is changed by one manager at a time. Each manager drafts in its own
 * workspace (<dir>/.work/<mgrId>/, or asset files it owns), then claims the official file,
 * merges its piece in with targeted edits, and releases it for the next one.
 *
 *   claim      a FIFO queue. One claim covers one or several paths (a file, a folder, a
 *              page and its css) and is granted all at once or not at all. A manager that
 *              already holds a claim may not queue for more (hold-and-wait is the only way
 *              to deadlock), so it releases and claims everything together instead.
 *   release    frees a claim, or one path of it, and grants the next claims in line.
 *   auto       a claim with no tool use from its holder for IDLE_MS, or held longer than
 *              MAX_HOLD_MS, is released; managers.mjs also releases on finish, fail, stop.
 *   official   files Petra marks: no manager writes them without holding the claim.
 *              Persisted, so a bridge restart keeps them.
 *   check      the PreToolUse hook asks whether a write to a path, or a Bash command,
 *              is allowed for this manager. Bash detection is best-effort, see bashWrites.
 *
 * No SDK and no gtd.mjs in here, so it can be tested on its own (bridge/locks.test.mjs).
 */
import { realpathSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname, basename, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'

const realpath = realpathSync.native || realpathSync

/** absolute real path; a file that does not exist yet keeps its name under its real parent */
export function normPath(p, base) {
  let s = String(p ?? '').trim()
  if (s.startsWith('file://')) s = decodeURI(s.slice(7))
  s = s.replace(/^~(?=\/|$)/, homedir()).replace(/^\$HOME(?=\/|$)/, homedir()).replace(/^\$\{HOME\}(?=\/|$)/, homedir())
  const abs = resolve(base || process.cwd(), s)
  let head = abs
  const tail = []
  for (;;) {
    try { const r = realpath(head); return tail.length ? join(r, ...tail.reverse()) : r } catch {}
    const up = dirname(head)
    if (up === head) return abs
    tail.push(basename(head)); head = up
  }
}

/** a is b, or a folder that contains b */
export const covers = (a, b) => a === b || b.startsWith(a.endsWith(sep) ? a : a + sep)
const overlaps = (a, b) => covers(a, b) || covers(b, a)
const anyOverlap = (xs, ys) => xs.some((x) => ys.some((y) => overlaps(x, y)))
const isWork = (p) => p.split(sep).includes('.work')          // a manager's draft workspace
const dur = (ms) => ms < 1000 ? Math.round(ms) + ' ms' : ms < 60000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60000) + ' min'

export function createLocks({
  root,                                   // the vault: claims must be inside it
  store = null,                           // JSON file the official list is kept in
  idleMs = 15 * 60 * 1000,
  maxHoldMs = 60 * 60 * 1000,
  sweepMs = 30 * 1000,
  now = () => Date.now(),
  onEvent = () => {},
} = {}) {
  root = normPath(root || process.cwd())
  const held = new Map()                  // cid -> { cid, owner, paths, reason, grantedAt, touched }
  const queue = []                        // pending claims, oldest first: { cid, owner, paths, reason, queuedAt, waiters: [] }
  let official = new Set()
  let cseq = 0

  const rel = (p) => { const r = relative(root, p); return r && !r.startsWith('..') ? r : p }
  const short = (paths) => paths.map((p) => basename(p)).join(' + ')
  const heldBy = (owner) => [...held.values()].filter((c) => c.owner === owner)
  const pendingOf = (owner) => queue.find((c) => c.owner === owner)
  const ownerCovers = (owner, p) => heldBy(owner).some((c) => c.paths.some((x) => covers(x, p)))

  function load() {
    if (!store) return
    try { official = new Set((JSON.parse(readFileSync(store, 'utf8')).official || []).map((p) => normPath(p, root))) } catch {}
  }
  function save() {
    if (!store) return
    try { mkdirSync(dirname(store), { recursive: true }); writeFileSync(store, JSON.stringify({ savedAt: new Date(now()).toISOString(), official: [...official] }, null, 1)) } catch {}
  }
  load()

  function normList(paths, base) {
    const list = [...new Set((Array.isArray(paths) ? paths : [paths]).filter((x) => String(x ?? '').trim()).map((p) => normPath(p, base || root)))]
    for (const p of list) {
      if (!covers(root, p)) return { error: `${p} is outside the vault (${root}).` }
      if (p === root) return { error: 'Claim the files or folder you will change, not the whole vault.' }
    }
    // a folder in the list already covers anything under it
    return { paths: list.filter((p) => !list.some((q) => q !== p && covers(q, p))).sort() }
  }

  /** who stands between this claim and the file: other holders, and anyone queued earlier */
  function blockers(c, upTo = queue.length) {
    const out = []
    for (const h of held.values()) if (h.owner !== c.owner && anyOverlap(h.paths, c.paths)) out.push({ owner: h.owner, held: true, paths: h.paths })
    for (let i = 0; i < upTo; i++) {
      const q = queue[i]
      if (q === c) break
      if (q.owner !== c.owner && anyOverlap(q.paths, c.paths)) out.push({ owner: q.owner, held: false, paths: q.paths })
    }
    return out
  }
  const behindText = (bs) => [...new Set(bs.map((b) => b.owner + (b.held ? ' (holding)' : ' (queued)')))].join(', ')

  function grant(c, waited) {
    const g = { cid: c.cid, owner: c.owner, paths: c.paths, reason: c.reason, grantedAt: now(), touched: now() }
    held.set(g.cid, g)
    if (waited) onEvent({ kind: 'granted', owner: c.owner, paths: c.paths.map(rel), reason: c.reason, waitedMs: now() - c.queuedAt, listening: c.waiters.length > 0,
      text: `${c.owner} got ${short(c.paths)} after ${dur(now() - c.queuedAt)} in the queue` })
    return g
  }

  /** grant every queued claim that is now free, oldest first */
  function pump() {
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]
      if (blockers(c, i).length) continue
      queue.splice(i--, 1)
      grant(c, true)
      for (const w of c.waiters.splice(0)) w({ status: 'granted', paths: c.paths.map(rel) })
    }
  }

  /**
   * Claim one or several paths together. Resolves { status: 'granted' | 'queued' | 'error', ... }.
   * With wait, blocks until granted or timeoutMs; a timed-out claim keeps its place in the
   * queue, and the grant arrives later as a 'granted' event with listening false.
   */
  function claim(owner, paths, reason = '', { wait = true, timeoutMs = 15 * 60 * 1000, base } = {}) {
    const n = normList(paths, base)
    if (n.error) return Promise.resolve({ status: 'error', text: n.error })
    if (!n.paths.length) return Promise.resolve({ status: 'error', text: 'No path given.' })
    let want = n.paths.filter((p) => !ownerCovers(owner, p))
    if (!want.length) { touch(owner); return Promise.resolve({ status: 'granted', paths: n.paths.map(rel), already: true }) }

    let c = pendingOf(owner)
    if (c) {
      // already queued: fold the new paths into the same place in line
      c.paths = [...new Set([...c.paths, ...want])].sort()
      if (reason && !c.reason.includes(reason)) c.reason = c.reason ? c.reason + '; ' + reason : reason
    } else {
      c = { cid: 'c' + (++cseq), owner, paths: want, reason: String(reason || '').slice(0, 200), queuedAt: now(), waiters: [] }
      const bs = blockers(c)
      if (!bs.length) {
        const g = grant(c, false)
        return Promise.resolve({ status: 'granted', paths: g.paths.map(rel) })
      }
      if (heldBy(owner).length) {
        return Promise.resolve({ status: 'error', text: `You hold ${short(heldBy(owner).flatMap((h) => h.paths))} and ${short(want)} is taken by ${behindText(bs)}. Waiting while holding can deadlock: release_file what you hold, then claim everything you need in one claim_file.` })
      }
      queue.push(c)
      onEvent({ kind: 'queued', owner, paths: c.paths.map(rel), reason: c.reason, behind: [...new Set(bs.map((b) => b.owner))], text: `${owner} is waiting for ${short(c.paths)} behind ${behindText(bs)}` })
    }
    const status = () => ({ status: 'queued', paths: c.paths.map(rel), position: queue.indexOf(c) + 1, behind: behindText(blockers(c)) })
    if (!wait) return Promise.resolve(status())
    return new Promise((res) => {
      let done = false
      const w = (r) => { if (!done) { done = true; clearTimeout(t); res(r) } }
      c.waiters.push(w)
      const t = setTimeout(() => { const i = c.waiters.indexOf(w); if (i >= 0) c.waiters.splice(i, 1); if (queue.includes(c)) w(status()) }, timeoutMs)
    })
  }

  /**
   * Release paths this owner holds (or has queued). No paths, or 'all', releases everything.
   * A path inside a claimed folder releases that folder claim. Returns the released paths.
   */
  function release(owner, paths = 'all', { note = '', why = '', base } = {}) {
    const all = paths == null || paths === 'all' || (Array.isArray(paths) && (!paths.length || paths.includes('all')))
    const targets = all ? null : normList(paths, base).paths || []
    const freed = [], dropped = []
    for (const [cid, h] of held) {
      if (h.owner !== owner) continue
      const go = all ? h.paths : h.paths.filter((p) => targets.some((t) => overlaps(p, t)))
      if (!go.length) continue
      h.paths = h.paths.filter((p) => !go.includes(p)); freed.push(...go)
      if (!h.paths.length) held.delete(cid)
    }
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i]
      if (q.owner !== owner) continue
      const go = all ? q.paths : q.paths.filter((p) => targets.some((t) => overlaps(p, t)))
      q.paths = q.paths.filter((p) => !go.includes(p)); dropped.push(...go)
      if (!q.paths.length) { queue.splice(i--, 1); for (const w of q.waiters.splice(0)) w({ status: 'cancelled', paths: [] }) }
    }
    if (freed.length) {
      const text = why ? `${owner}'s claim on ${short(freed)} was released: ${why}`
        : note ? `${owner} ${note.replace(/^\s*(I|we)\s+/i, '')}`.slice(0, 240) + ` (released ${short(freed)})`
        : `${owner} released ${short(freed)}`
      onEvent({ kind: why ? 'auto-released' : 'released', owner, paths: freed.map(rel), note, why, text })
    }
    pump()
    return { freed: freed.map(rel), dropped: dropped.map(rel) }
  }

  const releaseOwner = (owner, why) => release(owner, 'all', { why })

  /** any tool use from the owner counts as activity on its claims */
  function touch(owner) { for (const h of heldBy(owner)) h.touched = now() }

  function sweep() {
    const t = now()
    for (const h of [...held.values()]) {
      if (!held.has(h.cid)) continue
      if (t - h.touched > idleMs) release(h.owner, h.paths, { why: `no activity for ${dur(idleMs)}` })
      else if (t - h.grantedAt > maxHoldMs) release(h.owner, h.paths, { why: `held over ${dur(maxHoldMs)}` })
    }
  }
  const timer = sweepMs ? setInterval(sweep, sweepMs) : null
  timer?.unref?.()

  /** may this owner write p? null when yes, else the reason */
  function checkPath(owner, p, base) {
    const abs = normPath(p, base || root)
    if (isWork(abs) && !anyOverlap([abs], [...held.values()].filter((h) => h.owner !== owner).flatMap((h) => h.paths))) return null
    for (const h of held.values()) {
      if (h.owner === owner) continue
      const hit = h.paths.find((x) => overlaps(x, abs))
      if (hit) return `${rel(hit)} is claimed by ${h.owner}${h.reason ? ` (${h.reason})` : ''}. Keep working on your draft in your own workspace, then mcp__team__claim_file it; it waits until ${h.owner} releases.`
    }
    for (const o of official) {
      if (!overlaps(o, abs)) continue
      const need = covers(o, abs) ? abs : o
      if (!ownerCovers(owner, need)) return `${rel(o)} is an official file. Draft in your workspace (${rel(join(dirname(o), '.work', owner))}/), then mcp__team__claim_file "${rel(o)}" and merge your change while you hold it.`
    }
    return null
  }

  /** the Bash side of the hook: every path the command looks like it writes */
  function checkBash(owner, cmd, cwd) {
    const { paths, script, code } = bashWrites(cmd, cwd || root)
    const text = cmd + '\n' + (code || '')
    for (const p of paths) { const r = checkPath(owner, p); if (r) return r }
    if (script) {
      // a script that writes through a variable: block if it names a protected file at all
      const protectedPaths = [...[...held.values()].filter((h) => h.owner !== owner).flatMap((h) => h.paths), ...[...official].filter((o) => !ownerCovers(owner, o))]
      for (const p of protectedPaths) {
        if (text.includes(p) || text.includes(rel(p)) || new RegExp(`(^|[^\\w.-])${basename(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.-])`).test(text)) {
          const r = checkPath(owner, p)
          if (r) return r + ' (This script writes files and names it; if it only reads it, write the output somewhere else by a literal path.)'
        }
      }
    }
    return null
  }

  function setOfficial(paths, mode = 'add') {
    const n = normList(paths || [])
    if (n.error) return { error: n.error }
    if (mode === 'replace') official = new Set(n.paths)
    else if (mode === 'remove') for (const p of n.paths) official.delete(p)
    else for (const p of n.paths) official.add(p)
    save()
    return { official: [...official].map(rel) }
  }

  function snapshot() {
    const t = now()
    return {
      held: [...held.values()].map((h) => ({ owner: h.owner, paths: h.paths.map(rel), reason: h.reason, heldSec: Math.round((t - h.grantedAt) / 1000), idleSec: Math.round((t - h.touched) / 1000) })),
      queue: queue.map((q, i) => ({ owner: q.owner, paths: q.paths.map(rel), reason: q.reason, waitSec: Math.round((t - q.queuedAt) / 1000), behind: behindText(blockers(q, i)), waiting: q.waiters.length > 0 })),
      official: [...official].map(rel),
    }
  }

  /** a few lines for team_board and Petra's managers tool */
  function describe() {
    const s = snapshot()
    const lines = []
    for (const h of s.held) lines.push(`  held: ${h.owner} has ${h.paths.join(' + ')}${h.reason ? ` (${h.reason})` : ''}, held ${dur(h.heldSec * 1000)}, idle ${dur(h.idleSec * 1000)}`)
    for (const q of s.queue) lines.push(`  queued: ${q.owner} for ${q.paths.join(' + ')}${q.reason ? ` (${q.reason})` : ''}, behind ${q.behind || 'nobody'}${q.waiting ? '' : ' (not waiting on the call; will be told when granted)'}`)
    lines.push(s.official.length ? `  official: ${s.official.join(', ')}` : '  official: none')
    return 'FILE CLAIMS\n' + lines.join('\n')
  }

  const stop = () => { if (timer) clearInterval(timer) }

  return { claim, release, releaseOwner, touch, sweep, checkPath, checkBash, setOfficial, snapshot, describe, stop, root, rel,
    isOfficial: (p) => [...official].some((o) => overlaps(o, normPath(p, root))) }
}

/* ------------------------------------------------------------ Bash write detection */
/**
 * Best-effort: the paths a shell command writes, resolved against cwd (a leading or
 * chained `cd <dir>` moves it). Covers redirects (> >> &> 2> >|), tee, sed -i / perl -i,
 * cp / mv / install / ln / rsync / ditto destinations (and mv sources), rm / unlink /
 * touch / truncate / shred, dd of=, curl -o, wget -O, and recurses into sh/bash/zsh -c.
 * python / node / perl / ruby / osascript code (inline or a heredoc) is scanned for
 * open(x, 'w'|'a'|'x'|'+'), write_text/bytes, writeFile(Sync), appendFile(Sync),
 * copyFile, rename, shutil copy/move, os.remove/replace/rename with a literal path; when
 * it writes through a variable instead, { script: true } tells checkBash to block on any
 * protected file the code names. Misses: find -exec / -delete, xargs, git checkout or
 * restore, paths built from variables in plain shell, eval, and programs that write files
 * themselves (a build script, a converter with its own output flag).
 */
export function bashWrites(cmd, cwd) {
  const out = new Set(), codes = []
  let script = false
  const { text, bodies } = stripHeredocs(String(cmd || ''))
  let dir = cwd
  const add = (p) => {
    if (!p || !p.trim() || /^&\d*-?$/.test(p) || p.startsWith('/dev/') || p === '-' || /^\$\(|^`/.test(p)) return
    out.add(normPath(p, dir))
  }
  const SCRIPTERS = new Set(['python', 'python3', 'python2', 'node', 'perl', 'ruby', 'osascript', 'deno', 'bun', 'php'])
  for (const seg of segments(text)) {
    const words = []
    for (let i = 0; i < seg.length; i++) {
      const t = seg[i]
      if (t.redir === 'out') { add(seg[i + 1]?.w); i++; continue }
      if (t.redir === 'in') { i++; continue }
      words.push(t.w)
    }
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
    while (words.length && ['sudo', 'command', 'env', 'nohup', 'time', 'exec', 'nice', 'caffeinate'].includes(words[0])) words.shift()
    if (!words.length) continue
    const name = basename(words[0]), args = words.slice(1)
    const plain = args.filter((a) => !a.startsWith('-'))
    if (name === 'cd') { if (plain[0]) dir = normPath(plain[0], dir); continue }
    if (['sh', 'bash', 'zsh'].includes(name)) {
      const ci = args.indexOf('-c')
      if (ci >= 0 && args[ci + 1]) { const r = bashWrites(args[ci + 1], dir); r.paths.forEach((p) => out.add(p)); script ||= r.script; if (r.code) codes.push(r.code) }
      continue
    }
    if (name === 'tee') plain.forEach(add)
    else if (name === 'sed' || name === 'gsed' || (name === 'perl' && args.some((a) => /^-\w*i/.test(a)))) {
      if (name !== 'perl' && !args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) continue
      // files are the non-flag args, minus the script (the first one unless -e/-f gave it)
      const files = []
      let scriptGiven = false
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '-i' && name !== 'perl' && args[i + 1] === '') { i++; continue }        // BSD sed -i ''
        if (a === '-e' || a === '-f' || a === '--expression' || a === '--file') { scriptGiven = true; i++; continue }
        if (/^-\w*e$/.test(a) && name === 'perl') { scriptGiven = true; i++; continue }
        if (a.startsWith('-')) continue
        files.push(a)
      }
      ;(scriptGiven ? files : files.slice(1)).forEach(add)
      if (name === 'perl') script = true
    }
    else if (['cp', 'install', 'ln', 'rsync', 'ditto', 'gcp', 'mv'].includes(name) && plain.length >= 2) {
      // into an existing folder, the file written is folder/<source name>
      const dest = plain[plain.length - 1], srcs = plain.slice(0, -1)
      let isDir = false
      try { isDir = statSync(normPath(dest, dir)).isDirectory() } catch {}
      if (isDir && !dest.endsWith('/.')) srcs.forEach((x) => add(join(dest, basename(x.replace(/\/+$/, ''))))); else add(dest)
      if (name === 'mv') srcs.forEach(add)                               // moving a file away removes it
    }
    else if (['rm', 'unlink', 'touch', 'truncate', 'shred', 'rmdir'].includes(name)) plain.forEach(add)
    else if (name === 'dd') args.filter((a) => a.startsWith('of=')).forEach((a) => add(a.slice(3)))
    else if (name === 'curl' || name === 'wget') {
      for (let i = 0; i < args.length; i++) if (['-o', '--output', '-O', '--output-document'].includes(args[i]) && args[i + 1] && !(name === 'curl' && args[i] === '-O')) add(args[i + 1])
    }
    if (SCRIPTERS.has(name.replace(/[\d.]+$/, '')) || SCRIPTERS.has(name)) {
      let code = [args.join(' '), ...bodies].join('\n')
      const file = plain.find((a) => /\.(py|m?js|cjs|ts|rb|pl|php)$/.test(a))
      if (file) try { const f = normPath(file, dir); if (statSync(f).size < 400000) code += '\n' + readFileSync(f, 'utf8') } catch {}
      const lits = scriptWrites(code)
      lits.paths.forEach(add)
      if (lits.writes) { script = true; codes.push(code) }
    }
  }
  return { paths: [...out], script, code: codes.join('\n') }
}

/** literal paths a python/node/ruby snippet writes; writes = it writes something at all */
function scriptWrites(code) {
  const S = `(['"\`])([^'"\`\\n]+)\\1`
  const pats = [
    new RegExp(`open\\(\\s*${S}\\s*,\\s*(?:mode\\s*=\\s*)?['"][^'"]*[wax+]`, 'g'),
    new RegExp(`Path\\(\\s*${S}\\s*\\)\\s*\\.\\s*(?:write_text|write_bytes|unlink|rename|replace|touch)`, 'g'),
    new RegExp(`(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|rmSync|unlinkSync|unlink|truncateSync|os\\.remove|os\\.unlink|File\\.write|IO\\.write)\\(\\s*${S}`, 'g'),
    new RegExp(`(?:copyFileSync|copyFile|renameSync|rename|cpSync|shutil\\.copy\\w*|shutil\\.move|os\\.replace|os\\.rename)\\(\\s*[^,]+,\\s*${S}`, 'g'),
  ]
  const paths = new Set()
  for (const re of pats) for (const m of code.matchAll(re)) if (m[2]) paths.add(m[2])
  const writes = /open\([^)]*['"][^'"]*[wax+][^'"]*['"]|write_text|write_bytes|writeFile|appendFile|createWriteStream|copyFile|renameSync|shutil\.(copy|move)|os\.(remove|replace|rename|unlink)|File\.write|IO\.write|\.write\(|unlinkSync|rmSync/.test(code)
  return { paths: [...paths], writes }
}

/** heredoc bodies out of the shell text, so python inside one is not read as shell */
function stripHeredocs(cmd) {
  const bodies = []
  let text = cmd
  const re = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g
  let m
  while ((m = re.exec(text))) {
    const eol = text.indexOf('\n', m.index)
    if (eol < 0) break
    const end = new RegExp(`\\n[\\t ]*${m[2]}[\\t ]*(?=\\n|$)`).exec(text.slice(eol))
    const stop = end ? eol + end.index + end[0].length : text.length
    bodies.push(text.slice(eol + 1, end ? eol + end.index : text.length))
    text = text.slice(0, m.index) + text.slice(m.index + m[0].length, eol) + '\n' + text.slice(stop)
    re.lastIndex = m.index
  }
  return { text, bodies }
}

/** a small shell tokenizer: segments split on ; && || | & and newlines, quotes kept together */
function segments(text) {
  const segs = [[]]
  let w = null, i = 0
  const seg = () => segs[segs.length - 1]
  const flush = () => { if (w != null) { seg().push({ w }); w = null } }
  const brk = () => { flush(); if (seg().length) segs.push([]) }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) { if (text[i + 1] !== '\n') w = (w ?? '') + text[i + 1]; i += 2; continue }
    if (ch === "'") { const j = text.indexOf("'", i + 1); w = (w ?? '') + text.slice(i + 1, j < 0 ? text.length : j); i = j < 0 ? text.length : j + 1; continue }
    if (ch === '"') {
      let j = i + 1, s = ''
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\' && j + 1 < text.length) { s += text[j + 1]; j += 2 } else s += text[j++] }
      w = (w ?? '') + s; i = j + 1; continue
    }
    if (ch === '#' && w == null) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue }
    if (ch === ' ' || ch === '\t') { flush(); i++; continue }
    if (ch === '\n' || ch === ';' || ch === '(' || ch === ')') { brk(); i++; continue }
    if (ch === '|' || ch === '&') {
      if (ch === '&' && text[i + 1] === '>') { flush(); seg().push({ redir: 'out' }); i += text[i + 2] === '>' ? 3 : 2; continue }
      brk(); i += text[i + 1] === ch ? 2 : 1; continue
    }
    if (ch === '>') {
      if (w != null && /^\d$/.test(w)) w = null; else flush()       // 2> and friends
      seg().push({ redir: 'out' })
      i += text[i + 1] === '>' || text[i + 1] === '|' ? 2 : 1
      if (text[i] === '&') { let j = i + 1; while (/[\d-]/.test(text[j] || '')) j++; seg().push({ w: text.slice(i, j) }); i = j }
      continue
    }
    if (ch === '<') {
      flush()
      if (text[i + 1] === '(') { i++; continue }                         // <(process substitution)
      seg().push({ redir: 'in' }); i += text[i + 1] === '<' ? (text[i + 2] === '<' ? 3 : 2) : 1; continue
    }
    w = (w ?? '') + ch; i++
  }
  flush()
  return segs.filter((s) => s.length)
}
