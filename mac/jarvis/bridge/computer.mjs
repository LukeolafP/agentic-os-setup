/* ================================================================
   Petra's hands: the `computer` tools (GTD, 7 Nov 2026)

   The tools a Clicky agent uses to work on Luke's Mac the way a person would: look at the screen,
   then click, type, press keys, scroll and drag in any app (FigJam, Finder, Figma, System
   Settings…). Clicky agents are managers started with start_clicky_agent (managers.mjs), by
   Petra or by another manager. The hands are the Agentic OS program itself (our fork of
   OpenClicky, ~/Coding/agentic-os-app, AgenticOSHands.swift): it listens on 127.0.0.1:8795,
   holds the Screen Recording and Accessibility permissions, and flies its pointer to each spot
   with the agent's label before the real mouse acts, so Luke sees where it is going.

   - One at a time: whoever acts first holds the computer until 90 s after their last action;
     anyone else is told who has it.
   - Esc anywhere stops the holder; its next action fails with
     "stopped" and it has to ask Luke before starting again.
   - Coordinates are in the pixels of the last screenshot of that display; this file turns them
     into screen points.
   - Background hands (10 Nov 2026): use_app names the app to work in; its window gets the program's
     cyan outline, and read_window, press_control, set_text, send_keys and quiet_click work inside
     it through the Accessibility API and events posted to that app, without the real mouse or
     Luke's keyboard focus. The mouse tools stay for drags, canvases and apps with no control list.
   ================================================================ */
import net from 'node:net'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const WIN = process.platform === 'win32'
/* the program that holds the hands: the Mac app, or on Windows the Velopack install of the port */
const APP = WIN ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'AgenticOS/current/Agentic OS.exe') : '/Applications/Agentic OS.app'
const PORT = 8795
const HOLD_MS = 90_000

function call(req, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, '127.0.0.1')
    let buf = ''
    const t = setTimeout(() => { s.destroy(); reject(new Error('Agentic OS did not answer')) }, timeout)
    s.on('connect', () => s.write(JSON.stringify(req) + '\n'))
    s.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl >= 0) { clearTimeout(t); s.end(); try { resolve(JSON.parse(buf.slice(0, nl))) } catch (e) { reject(e) } }
    })
    s.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}
async function hands(req, timeout) {
  try { return await call(req, timeout) }
  catch (e) {
    if (e.code !== 'ECONNREFUSED') throw e
    if (WIN) spawn(APP, [], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
    else spawn('open', ['-g', APP], { stdio: 'ignore', detached: true }).unref()
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300))
      try { return await call(req, timeout) } catch (e2) { if (e2.code !== 'ECONNREFUSED') throw e2 }
    }
    throw new Error('The Agentic OS program is not running and would not start. Ask Luke to open Agentic OS.')
  }
}

/* ------------------------------------------------------------ who has the computer */
let holder = null            // { who, since, last }
let releaseTimer = null
const stopped = new Map()    // who -> when Luke stopped them; they are kept off for 2 minutes
function take(who) {
  const now = Date.now()
  if (now - (stopped.get(who) || 0) < 120_000)
    throw new Error('Luke stopped you using the computer a moment ago. Do not try again: ask him what he wants first.')
  if (holder && holder.who !== who && now - holder.last < HOLD_MS)
    throw new Error(`${holder.who} is using the computer right now. Wait for it to finish, or find a way that does not need the screen.`)
  if (!holder || holder.who !== who) {
    holder = { who, since: now / 1000, last: now }
    void hands({ cmd: 'busy', on: true, who }).catch(() => {})
  }
  holder.last = now
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => { if (holder && Date.now() - holder.last >= HOLD_MS - 50) release() }, HOLD_MS)
  return holder
}
function release() { holder = null; void hands({ cmd: 'busy', on: false }).catch(() => {}) }

/* the last screenshot of each display: how its pixels map to screen points */
const shots = new Map()
function toScreen(display, x, y) {
  const s = shots.get(display)
  if (!s) throw new Error('Take a screenshot first, then use its pixel coordinates.')
  return { x: s.originX + x / s.scale, y: s.originY + y / s.scale }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] })
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true })

async function screenshot(display = null) {
  if (display == null) {
    const st = await hands({ cmd: 'displays' })
    display = (st.displays || []).find((d) => d.hasCursor)?.index ?? 0
  }
  const r = await hands({ cmd: 'screenshot', display, maxWidth: 1440 }, 30_000)
  if (!r.ok) throw new Error(r.error)
  shots.set(display, { scale: r.scale, originX: r.originX, originY: r.originY, width: r.width, height: r.height })
  const others = (r.displays || []).length > 1 ? ` There are ${r.displays.length} displays; pass display: 0 to ${r.displays.length - 1} to see another.` : ''
  return {
    content: [
      { type: 'image', data: r.image, mimeType: 'image/jpeg' },
      { type: 'text', text: `Display ${display}, ${r.width}x${r.height} pixels. Use these pixel coordinates for click, drag and scroll on this display.${others}` },
    ],
  }
}

/* run one action as `who`, then (by default) look again */
async function act(who, req, { look = true, display = 0, settle = 450 } = {}) {
  const h = take(who)
  const r = await hands({ ...req, since: h.since })
  if (!r.ok) {
    if (/^stopped/.test(r.error || '')) { stopped.set(who, Date.now()); release(); return fail('Luke stopped you (Esc or Stop in the menu bar). Stop using the computer and ask him what he wants before trying again.') }
    return fail(r.error || 'failed')
  }
  if (!look) return text('Done.')
  await new Promise((res) => setTimeout(res, settle))
  return await screenshot(display)
}
const guard = (fn) => async (args) => { try { return await fn(args) } catch (e) { return fail(String(e.message || e)) } }

const QUIET = 'Works in the target app set with use_app, without the real mouse or keyboard: Luke keeps working elsewhere. '
const RULES = 'Use the computer only when Luke asked for something done on his screen, or when nothing else (an MCP connector, the command line, Claude in Chrome for web pages) can do it. Start with use_app, then read_window and the quiet tools (press_control, set_text, send_keys, type_quiet), so Luke keeps his mouse; take a screenshot to check a canvas or a picture, and use the mouse tools (click, drag, type_text) only for what the quiet tools cannot do, such as dragging on a canvas. Check what you did after each step. Never type passwords, pay, send, post or delete anything without Luke saying so in this conversation. If Luke presses Esc you are told; stop and ask him.'

export function computerServer(who) {
  const xy = { x: z.number().describe('x in the last screenshot\'s pixels'), y: z.number().describe('y in the last screenshot\'s pixels'), display: z.number().int().min(0).optional(),
    label: z.string().max(40).optional().describe('What you are pointing at, 1 to 4 words ("Upload button"): shown in the pointer\'s bubble on Luke\'s screen.') }
  return createSdkMcpServer({
    name: 'computer',
    version: '1.0.0',
    tools: [
      tool('screenshot', `See Luke's screen now. ${RULES}`, { display: z.number().int().min(0).optional().describe('Which display; leave out for the one with the mouse.') },
        guard(async ({ display }) => { take(who); return await screenshot(display ?? null) })),
      tool('click', 'Click at a point in the last screenshot (left by default; double or triple click with count). Returns a new screenshot.', {
        ...xy, button: z.enum(['left', 'right']).optional(), count: z.number().int().min(1).max(3).optional(),
      }, guard(async ({ x, y, display = 0, button, count, label }) => act(who, { cmd: 'click', ...toScreen(display, x, y), button: button || 'left', count: count || 1, label }, { display }))),
      tool('type_text', 'Type text where the cursor is, as if on the keyboard. A new line presses Return. Returns a new screenshot.', {
        text: z.string().min(1).max(5000), display: z.number().int().min(0).optional(),
      }, guard(async ({ text: t, display = 0 }) => act(who, { cmd: 'type', text: t }, { display, settle: 300 }))),
      tool('press_keys', 'Press a key or shortcut: "return", "esc", "tab", "cmd+v", "cmd+shift+k", "down". Several, one after another, separated by spaces: "cmd+a cmd+c". Returns a new screenshot.', {
        keys: z.string().min(1), display: z.number().int().min(0).optional(),
      }, guard(async ({ keys, display = 0 }) => act(who, { cmd: 'key', keys }, { display }))),
      tool('scroll', 'Scroll at a point: dy positive scrolls down, negative up (in lines, 3 to 10 is typical); dx scrolls sideways. Returns a new screenshot.', {
        ...xy, dy: z.number().int().optional(), dx: z.number().int().optional(),
      }, guard(async ({ x, y, display = 0, dy = 5, dx = 0 }) => act(who, { cmd: 'scroll', ...toScreen(display, x, y), dy: -dy, dx: -dx }, { display }))),
      tool('drag', 'Press at one point, drag to another and let go (move things, select an area, drop files). Both points in the last screenshot\'s pixels. Returns a new screenshot.', {
        from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number(), display: z.number().int().min(0).optional(),
        label: z.string().max(40).optional(),
      }, guard(async ({ from_x, from_y, to_x, to_y, display = 0, label }) => {
        const a = toScreen(display, from_x, from_y), b = toScreen(display, to_x, to_y)
        return act(who, { cmd: 'drag', x: a.x, y: a.y, toX: b.x, toY: b.y, label }, { display, settle: 600 })
      })),
      tool('move_mouse', 'Move the pointer without clicking (to show a hover menu or tooltip). Returns a new screenshot.', xy,
        guard(async ({ x, y, display = 0, label }) => act(who, { cmd: 'move', ...toScreen(display, x, y), label }, { display }))),
      tool('open_app', 'Open or bring forward a Mac app by name ("Figma", "Finder", "Google Chrome"), optionally with a file or folder. Returns a new screenshot.', {
        name: z.string().min(1), path: z.string().optional(),
      }, guard(async ({ name, path }) => {
        take(who)
        await new Promise((res, rej) => {
          const p = WIN ? spawn('cmd', ['/c', 'start', '', name, ...(path ? [path] : [])], { stdio: 'ignore', windowsHide: true })
            : spawn('open', ['-a', name, ...(path ? [path] : [])], { stdio: 'ignore' })
          p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`Could not open ${name}.`))))
          p.on('error', rej)
        })
        await new Promise((res) => setTimeout(res, 1500))
        return await screenshot(null)
      })),
      tool('wait', 'Wait for something to load, then look again.', { seconds: z.number().min(0.2).max(30), display: z.number().int().min(0).optional() },
        guard(async ({ seconds, display }) => { take(who); await new Promise((res) => setTimeout(res, seconds * 1000)); return await screenshot(display ?? null) })),
      tool('done_with_computer', 'Say you have finished using the computer, so Luke (or another manager) has it back straight away.', {},
        guard(async () => { if (holder?.who === who) release(); return text('Released.') })),
      /* ---- background hands: inside one app window, no real mouse ---- */
      tool('use_app', 'Start working in an app, in the background: its window gets an outline Luke can see, and read_window, press_control, set_text, send_keys and quiet_click then work inside it without taking his mouse. Opens the app if it is not running. Do this first, before any other tool, whenever the job is in one app.', {
        app: z.string().min(1).describe('The app name as in the Dock ("Figma", "Finder", "Google Chrome").'), window: z.string().optional().describe('Part of the window title, when the app has several windows.'),
      }, guard(async ({ app, window }) => {
        take(who)
        const r = await hands({ cmd: 'target', app, window }, 15_000)
        if (!r.ok) return fail(r.error || 'could not target the app')
        return text(`Working in ${r.app}${r.window ? `, window "${r.window}"` : ''} (${Math.round(r.frame?.w || 0)}x${Math.round(r.frame?.h || 0)} at ${Math.round(r.frame?.x || 0)},${Math.round(r.frame?.y || 0)}). Call read_window to see its controls.`)
      })),
      tool('read_window', `${QUIET}Lists the controls in the app window: buttons, fields, lists, menus, text, each with a number, a title, its value and where it is. Far faster than a screenshot; use it first, and screenshot only to check a canvas or picture.`, {
        max: z.number().int().min(20).max(600).optional(),
      }, guard(async ({ max }) => {
        take(who)
        const r = await hands({ cmd: 'window_tree', maxItems: max || 300 }, 20_000)
        if (!r.ok) return fail(r.error || 'could not read the window')
        const lines = (r.items || []).map((it) => `${it.i}: ${it.role}${it.title ? ` "${it.title}"` : ''}${it.value ? ` = "${String(it.value).slice(0, 80)}"` : ''}${it.enabled === false ? ' (disabled)' : ''}${it.focused ? ' (focused)' : ''}${it.frame ? ` @${Math.round(it.frame.x + it.frame.w / 2)},${Math.round(it.frame.y + it.frame.h / 2)}` : ''}${it.actions?.length ? ` [${it.actions.join(',')}]` : ''}`)
        return text(lines.length ? `${lines.length} controls (number: kind "title" = value @centre [actions]):\n${lines.join('\n')}` : 'The window shows no controls to the accessibility tree; use screenshot and the mouse tools.')
      })),
      tool('press_control', `${QUIET}Presses a control by its number from read_window (a button, link, menu item, checkbox, tab, row). Then reads the window again.`, {
        i: z.number().int().min(0),
      }, guard(async ({ i }) => { take(who); const r = await hands({ cmd: 'press', i }, 15_000); return r.ok ? text(`Pressed ${i}.`) : fail(r.error || 'press failed') })),
      tool('set_text', `${QUIET}Puts text into a field by its number from read_window (replaces what is there).`, {
        i: z.number().int().min(0), value: z.string().max(20000),
      }, guard(async ({ i, value }) => { take(who); const r = await hands({ cmd: 'set_value', i, value }, 15_000); return r.ok ? text(`Set ${i} to "${String(r.value ?? value).slice(0, 120)}".`) : fail(r.error || 'set failed') })),
      tool('send_keys', `${QUIET}Sends a key or shortcut to the app ("cmd+v", "return", "cmd+shift+g", "down"; several separated by spaces). Use type_quiet for text.`, {
        keys: z.string().min(1),
      }, guard(async ({ keys }) => { take(who); const r = await hands({ cmd: 'keys_to_app', keys }, 15_000); return r.ok ? text(`Sent ${keys}.`) : fail(r.error || 'keys failed') })),
      tool('type_quiet', `${QUIET}Types text into the app where its own cursor is (focus a field first with press_control or set_text).`, {
        text: z.string().min(1).max(5000),
      }, guard(async ({ text: t }) => { take(who); const r = await hands({ cmd: 'type_to_app', text: t }, 30_000); return r.ok ? text('Typed.') : fail(r.error || 'typing failed') })),
      tool('quiet_click', `${QUIET}Clicks at a point in the last screenshot, delivered to the app only, without moving the real mouse. For controls that read_window does not list (a canvas, a custom widget). Not every app accepts it; if nothing happens, use click.`, {
        x: z.number(), y: z.number(), display: z.number().int().min(0).optional(), button: z.enum(['left', 'right']).optional(), count: z.number().int().min(1).max(3).optional(), label: z.string().max(40).optional(),
      }, guard(async ({ x, y, display = 0, button, count, label }) => {
        take(who)
        const r = await hands({ cmd: 'click_to_app', ...toScreen(display, x, y), button: button || 'left', count: count || 1, label }, 15_000)
        if (!r.ok) return fail(r.error || 'click failed')
        await new Promise((res) => setTimeout(res, 450))
        return await screenshot(display)
      })),
    ],
  })
}

/* for the OS and checks: is it installed and allowed */
export async function computerStatus() {
  try { const r = await hands({ cmd: 'status' }, 5000); return { running: true, screen: !!r.screen, accessibility: !!r.accessibility, busy: r.busy || '' } }
  catch (e) { return { running: false, error: String(e.message || e) } }
}
export const computerHolder = () => holder?.who || null
