#!/usr/bin/env node
/* agents.mjs - the agent registry behind the Agent Creator skill.

   An agent is one file: <vault>/Agents/<id>.md (Claude Code reads it as .claude/agents/, a link), a Claude Code subagent
   definition. That one file is what JARVIS queues (claude -p --agent <id>) and
   what a keyboard session can hand work to. This tool copies it onto the
   dashboards so it shows up there too:

     node Installers/Robonuggets/tools/agents.mjs list
     node Installers/Robonuggets/tools/agents.mjs show <id>
     node Installers/Robonuggets/tools/agents.mjs register <id>     add or update everywhere
     node Installers/Robonuggets/tools/agents.mjs remove <id>       take it off the dashboards

   register writes the Rubric console sidebar (scaffold), the Agents tab and the
   Team tab. The OS reads the agent files itself through the JARVIS bridge.
   Zero dependencies. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(HERE, '..')
const VAULT = (() => { let d = KIT; while (d !== path.dirname(d)) { d = path.dirname(d); if (fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, '.obsidian'))) return d } throw new Error('vault not found above ' + KIT) })()
const AGENTS_DIR = path.join(VAULT, '.claude', 'agents')
const T = path.join(KIT, 'rubric', 'templates')
const FILES = {
  scaffold: path.join(T, 'scaffold', 'config.json'),
  agents: path.join(T, 'agents', 'config.json'),
  team: path.join(T, 'team', 'config.json'),
}
// the pixel icons the Rubric sidebar can actually draw (its server resolves only these 15)
const ICONS = ['Robo', 'Crown', 'Sentinel', 'Fortress', 'Phantom', 'Spark', 'Apex', 'Drift', 'Halo', 'Orb', 'Rune', 'Nova', 'Sage', 'Warden', 'Echo']

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const out = {}
  if (!m) return out
  let key = null
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (kv) { key = kv[1]; const v = kv[2].trim().replace(/^["']|["']$/g, ''); out[key] = v === '' ? [] : v }
    else if (key && /^\s*-\s+/.test(line) && Array.isArray(out[key])) out[key].push(line.replace(/^\s*-\s+/, '').trim())
  }
  return out
}
const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => s.trim()).filter(Boolean)
const titleOf = id => id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

function readAgent(id) {
  const f = path.join(AGENTS_DIR, id + '.md')
  if (!fs.existsSync(f)) throw new Error(`no agent file ${path.relative(VAULT, f)}`)
  const fm = frontmatter(fs.readFileSync(f, 'utf8'))
  if (!fm.name || fm.name !== id) throw new Error(`${id}.md: frontmatter name must be "${id}"`)
  if (!fm.description) throw new Error(`${id}.md: description is required`)
  const icon = ICONS.includes(fm.icon) ? fm.icon : 'Robo'
  const color = /^#[0-9a-f]{6}$/i.test(fm.ui_color || '') ? fm.ui_color : '#58abf5'
  return {
    id, file: f, name: fm.label || titleOf(id), description: fm.description,
    role: fm.role || fm.department || 'Agent', department: fm.department || '',
    color, icon, model: fm.model || 'claude-opus-5-5', effort: fm.effort || 'high',
    skills: list(fm.tags).length ? list(fm.tags) : [fm.department || 'Agent'],
    permissions: list(fm.permissions),
    ...teamOf(fm),
  }
}
/* agent teams (29 Oct 2026): team, team_role lead|member and a member's lead, copied onto
   the dashboards so the console can group a team under its lead. Absent = no team (an
   undefined key drops out of the JSON, so a re-register clears an old team). */
function teamOf(fm) {
  const r = String(fm.team_role || '').toLowerCase()
  return { team: fm.team || undefined, teamRole: r === 'lead' || r === 'member' ? r : undefined, lead: fm.lead || undefined }
}
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const save = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n')
function upsert(arr, item) { const i = arr.findIndex(a => a.id === item.id); if (i >= 0) arr[i] = { ...arr[i], ...item }; else arr.push(item); return i < 0 }

function register(id) {
  const a = readAgent(id)
  const tm = { team: a.team, teamRole: a.teamRole, lead: a.lead }
  const s = load(FILES.scaffold); const added = upsert(s.agents, { id, name: a.name, color: a.color, icon: a.icon, ...tm }); save(FILES.scaffold, s)
  const g = load(FILES.agents); upsert(g.agents, { id, name: a.name, role: a.description.slice(0, 140), color: a.color, icon: a.icon, ...tm }); save(FILES.agents, g)
  const t = load(FILES.team); upsert(t.agents, { id, name: a.name, role: `${a.role} · ${a.model.replace('claude-', '')} ${a.effort}`, description: a.description, skills: a.skills, icon: a.icon, color: a.color, ...tm }); save(FILES.team, t)
  console.log(`${added ? 'registered' : 'updated'} ${a.name} (${id}) on the Rubric console sidebar, Agents tab and Team tab.`)
  console.log('The OS and JARVIS read .claude/agents directly - it can be queued now.')
}
function remove(id) {
  for (const f of Object.values(FILES)) { const d = load(f); d.agents = (d.agents || []).filter(a => a.id !== id); save(f, d) }
  console.log(`removed ${id} from the dashboards. Its file .claude/agents/${id}.md is untouched.`)
}
function ls() {
  if (!fs.existsSync(AGENTS_DIR)) return console.log('no agents yet (.claude/agents does not exist)')
  const reg = new Set(load(FILES.scaffold).agents.map(a => a.id))
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md') && !f.startsWith('00 '))   /* skip the folder index */
  if (!files.length) return console.log('no agents yet')
  for (const f of files) {
    const id = f.replace(/\.md$/, '')
    try { const a = readAgent(id); console.log(`${id}\t${reg.has(id) ? 'on dashboards' : 'NOT registered'}\t${a.department || '-'}\t${a.description.slice(0, 90)}`) }
    catch (e) { console.log(`${id}\tINVALID\t${e.message}`) }
  }
}

const [cmd, id] = process.argv.slice(2)
const okId = id && /^[a-z0-9][a-z0-9-]{1,40}$/.test(id)
try {
  if (cmd === 'list') ls()
  else if (cmd === 'show' && okId) console.log(JSON.stringify(readAgent(id), null, 2))
  else if (cmd === 'register' && okId) register(id)
  else if (cmd === 'remove' && okId) remove(id)
  else { console.log('usage: agents.mjs list | show <id> | register <id> | remove <id>   (id: lowercase-with-dashes)'); process.exitCode = 1 }
} catch (e) { console.error('error: ' + e.message); process.exitCode = 1 }
