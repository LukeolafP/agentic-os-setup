/**
 * GTD: standalone test for locks.mjs (21 Oct 2026). No SDK, no bridge: `node bridge/locks.test.mjs`.
 * Three managers on overlapping files in a throwaway vault: one claim times out and keeps its
 * place, one holder goes idle and is auto-released, and the PreToolUse checks are exercised.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocks, bashWrites } from './locks.mjs'

const vault = mkdtempSync(join(tmpdir(), 'gtd-locks-'))
const final = join(vault, 'Content/Website/Blueprint/Final')
mkdirSync(join(final, 'assets'), { recursive: true })
mkdirSync(join(final, '.work/mgrB'), { recursive: true })
for (const f of ['blueprint.html', 'assets/direction-b.css', 'assets/hero.svg', '.work/mgrB/blueprint.html']) writeFileSync(join(final, f), 'x')
writeFileSync(join(final, '.work/mgrB/merge.py'), "p = 'blueprint.html'\nopen(p, 'w').write(open('.work/mgrB/blueprint.html').read())\n")
const store = join(vault, '.official.json')

const t0 = Date.now()
const ms = () => String(Date.now() - t0).padStart(4) + 'ms'
const events = []
const L = createLocks({ root: vault, store, idleMs: 400, maxHoldMs: 5000, sweepMs: 50, onEvent: (e) => { events.push(e); console.log(`${ms()}  event ${e.kind.padEnd(13)} ${e.text}`) } })
const sleep = (n) => new Promise((r) => setTimeout(r, n))
let failures = 0
const check = (label, cond, extra = '') => { if (!cond) failures++; console.log(`${ms()}  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`) }
const F = 'Content/Website/Blueprint/Final'

console.log(`vault ${vault}\n`)
console.log('-- official files')
const off = L.setOfficial([`${F}/blueprint.html`, `${F}/assets/direction-b.css`])
check('two files marked official', off.official.length === 2, off.official.join(', '))

console.log('\n-- claims')
const a = await L.claim('mgrA', [`${F}/blueprint.html`, `${F}/assets/direction-b.css`], 'hero grid')
check('mgrA claims blueprint.html + direction-b.css together, granted at once', a.status === 'granted')
const bPromise = L.claim('mgrB', `${F}/blueprint.html`, 'nav links', { timeoutMs: 200 })
const cPromise = L.claim('mgrC', `${F}/assets`, 'truck svg + css', { timeoutMs: 5000 })
const b = await bPromise
check('mgrB times out after 200 ms, still queued behind mgrA', b.status === 'queued' && /mgrA/.test(b.behind), JSON.stringify(b))

console.log('\n-- enforcement while mgrA holds')
const deny = (r) => (r ? 'DENY: ' + r.slice(0, 90) + '…' : 'allow')
const cases = [
  ['mgrB Edit blueprint.html (held by mgrA)', L.checkPath('mgrB', `${F}/blueprint.html`), true],
  ['mgrA Edit blueprint.html (its own claim)', L.checkPath('mgrA', `${F}/blueprint.html`), false],
  ['mgrB Write its draft in .work/mgrB/', L.checkPath('mgrB', `${F}/.work/mgrB/blueprint.html`), false],
  ['mgrB Write assets/hero.svg (unclaimed, not official)', L.checkPath('mgrB', `${F}/assets/hero.svg`), false],
  ['mgrB Bash: sed -i \'\' on blueprint.html (cd first)', L.checkBash('mgrB', `cd "${final}" && sed -i '' 's/a/b/' blueprint.html`, vault), true],
  ['mgrB Bash: cat blueprint.html > /tmp/copy (read only)', L.checkBash('mgrB', `cat ${F}/blueprint.html > /tmp/copy.html`, vault), false],
  ['mgrB Bash: cp draft onto blueprint.html', L.checkBash('mgrB', `cp ${F}/.work/mgrB/blueprint.html ${F}/blueprint.html`, vault), true],
  ['mgrB Bash: cp hero.svg into Final/assets/ (folder dest)', L.checkBash('mgrB', `cp /tmp/hero2.svg ${F}/assets/`, vault), false],
  ['mgrB Bash: python open(...,"w") literal', L.checkBash('mgrB', `python3 -c "open('${F}/blueprint.html','w').write('x')"`, vault), true],
  ['mgrB Bash: python heredoc, writes via variable', L.checkBash('mgrB', `python3 - <<'EOF'\np = "${final}/blueprint.html"\nwith open(p, "w") as f:\n    f.write("x")\nEOF`, vault), true],
  ['mgrB Bash: python3 .work/mgrB/merge.py (script file)', L.checkBash('mgrB', 'python3 .work/mgrB/merge.py', final), true],
  ['mgrB Bash: echo >> notes.md 2>/dev/null (unprotected)', L.checkBash('mgrB', `echo hi >> ${F}/notes.md 2>/dev/null`, vault), false],
  ['mgrB Bash: rm -rf Final/assets (folder holding a claimed file)', L.checkBash('mgrB', `rm -rf ${F}/assets`, vault), true],
]
for (const [label, r, wantDeny] of cases) check(label, !!r === wantDeny, deny(r))

console.log('\n-- board while queued\n' + L.describe())

console.log('\n-- mgrA merges and releases')
L.release('mgrA', 'all', { note: 'merged hero grid into blueprint.html' })
const c = await cPromise
check('mgrC (still waiting on the call) granted Final/assets', c.status === 'granted', JSON.stringify(c))
const late = events.find((e) => e.kind === 'granted' && e.owner === 'mgrB')
check('mgrB (timed out earlier) granted later, flagged listening=false so it gets told', late && late.listening === false)
check('mgrB may now edit blueprint.html', L.checkPath('mgrB', `${F}/blueprint.html`) === null)
check('mgrA may not edit blueprint.html any more (official, unclaimed by it)', !!L.checkPath('mgrA', `${F}/blueprint.html`))

console.log('\n-- hold-and-wait is refused')
const hw = await L.claim('mgrB', `${F}/assets/direction-b.css`, 'also the css')
check('mgrB holds blueprint.html, asks for css held by mgrC: refused, not queued', hw.status === 'error', hw.text?.slice(0, 110) + '…')

console.log('\n-- idle auto-release (idle limit 400 ms for the test)')
const keepC = setInterval(() => L.touch('mgrC'), 100)                       // mgrC keeps using tools; mgrB goes quiet
await sleep(700)
const auto = events.find((e) => e.kind === 'auto-released' && e.owner === 'mgrB')
check('mgrB auto-released after going idle', !!auto, auto?.text)
check('mgrC kept its claim while active', L.snapshot().held.some((h) => h.owner === 'mgrC'))
clearInterval(keepC)

console.log('\n-- manager finishes')
L.releaseOwner('mgrC', 'manager finished')
check('mgrC released on finish', !L.snapshot().held.length && !L.snapshot().queue.length)

console.log('\n-- persistence')
const L2 = createLocks({ root: vault, store, sweepMs: 0 })
check('official list reloads from disk after a restart', L2.snapshot().official.length === 2, L2.snapshot().official.join(', '))

console.log('\n-- bashWrites coverage samples')
for (const cmd of [`echo a > x.html`, `printf a | tee -a y.css`, `sed -i.bak -e s/a/b/ z.html`, `perl -pi -e 's/a/b/' w.html`, `mv old.html new.html`,
  `curl -s -o dl.svg https://x`, `dd if=/dev/zero of=blob bs=1 count=1`, `bash -c "cat a > b.html"`, `node -e "require('fs').writeFileSync('n.html','x')"`,
  `grep -n hero blueprint.html | head`, `find . -name '*.html' -exec rm {} \\;`])
  console.log(`  ${cmd.padEnd(58)} -> ${JSON.stringify(bashWrites(cmd, '/v').paths.map((p) => p.replace('/v/', '')))}`)

L.stop(); L2.stop()
rmSync(vault, { recursive: true, force: true })
console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'}`)
process.exit(failures ? 1 : 0)
