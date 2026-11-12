/* _embed.js - lets the Agentic OS host this brain in-page (GTD, 15 Oct 2026).
   Does nothing unless the page is framed by the OS on port 50000.

   The OS opens the brain as a round window over its orb. The window's size is a
   progress value p (0 = small disc over the orb, 1 = full screen), owned by the OS.

     OS -> brain  { type:'rubric-os:portal', p, cx, cy, r0 }   size the camera to the disc
     OS -> brain  { type:'rubric-os:sleep' | 'rubric-os:wake' } stop / resume drawing
     brain -> OS  { type:'rubric-os:wheel', dy }               grow / shrink the window
     brain -> OS  { type:'rubric-os:ready' }
     OS -> brain  { type:'rubric-os:float', on, cx, cy, w, h }  GTD 20 Oct 2026: a floating
                  window beside the chat. The graph fits that box, zooms normally (no
                  window resizing), and a focused agent is flown to the box's centre.

   While p < 1 every scroll or pinch resizes the window instead of zooming the graph,
   and the graph scales with the window so it reads as one zoom. At p = 1 the brain
   zooms normally; zooming out past the full-screen fit hands the scroll back to the
   OS, which starts shrinking the window. */
(function () {
  if (window.parent === window) return;
  const OS = /^http:\/\/(localhost|127\.0\.0\.1):50000$/;
  let host = null;               // the OS origin, learned from its first message
  let portal = null;             // { p, cx, cy, r0 } while hosted
  let float = null;              // { cx, cy, w, h } while it floats beside the chat
  const view = S => float || { cx: S.W / 2, cy: S.H / 2, w: S.W, h: S.H };
  const core = () => window.BrainCore && BrainCore.S;
  const send = msg => { if (host) parent.postMessage(msg, host); };
  const fullK = S => Math.min(S.W, S.H) / 1500;   // the brain's own resetCam fit

  function applyPortal() {
    const S = core();
    if (!S || !portal || !S.W) return;
    const e = portal.p < 1 ? Math.pow(portal.p, 1.8) : 1;   // same curve as the OS window
    const k0 = (portal.r0 * 1.7) / 1500;           // whole graph inside the small disc
    const k1 = fullK(S);
    S.fly = null;
    S.cam.k = k0 + (k1 - k0) * e;
    S.cam.x = portal.cx + (S.W / 2 - portal.cx) * e;
    S.cam.y = portal.cy + (S.H / 2 - portal.cy) * e;
  }

  // files open in the OS window system (as a pop-up) once the OS has spoken to us
  window.__gtdOsOpen = (path) => { if (!host || !path) return false; send({ type: 'rubric-os:open-file', path }); return true }

  addEventListener('message', ev => {
    if (!OS.test(ev.origin) || !ev.data || typeof ev.data.type !== 'string') return;
    host = ev.origin;
    const S = core();
    const d = ev.data;
    if (d.type === 'rubric-os:portal') {
      const wasFull = portal && portal.p >= 1;
      float = null;              // the round window and the floating box never mix
      portal = { p: Math.max(0, Math.min(1, +d.p || 0)), cx: +d.cx, cy: +d.cy, r0: +d.r0 };
      // reaching full screen hands the camera to the user, from the fitted view
      if (portal.p < 1 || !wasFull) applyPortal();
    } else if (d.type === 'rubric-os:float') {
      float = d.on ? { cx: +d.cx, cy: +d.cy, w: +d.w, h: +d.h } : null;
      if (float) {
        portal = null;
        if (S) { S.fly = null; S.cam.k = Math.min(float.w, float.h) * .85 / 1500; S.cam.x = float.cx; S.cam.y = float.cy; }
      }
    } else if (d.type === 'rubric-os:focus') {
      void focusAgent(d).then(() => send({ type: 'rubric-os:focused', agent: d.agent && d.agent.id }))
    } else if (d.type === 'rubric-os:sleep') { if (S) { S.sleeping = true; clearLive(S) } }
    else if (d.type === 'rubric-os:wake') { if (S) S.sleeping = false; }
  });

  /* ------------------------------------------------ focus on a live agent */
  /* The OS sends an agent and the files its copies have touched. Show it as an agent
     node linked to each file, open the folders those files sit in, and fly there.
     Sent again whenever the agent touches more files, so the links grow live. */
  let focused = null
  function clearLive(S) {
    for (const n of S.nodes) if (String(n.id).startsWith('live:')) n._hidden = true
    S.baseLinks = S.baseLinks.filter((l) => !String(l.s).startsWith('live:'))
    S.agentNodes = (S.agentNodes || []).filter((n) => !String(n.id).startsWith('live:'))
    focused = null
  }
  const opened = new Set()
  async function focusAgent(d) {
    const S = core(), B = window.BrainCore
    if (!S || !B || !d.agent) return
    const first = focused !== d.agent.id
    if (first) clearLive(S)
    focused = d.agent.id
    const id = 'live:' + d.agent.id
    let node = S.byId.get(id)
    if (!node) {
      node = { id, type: 'agent', layer: 'A', kind: 'live', access: 'claude', enabledDefault: true, x: 0, y: 0 }
      S.nodes.push(node); S.byId.set(id, node)
    }
    Object.assign(node, {
      _hidden: false, label: d.agent.name, color: d.agent.color,
      desc: (d.copies ? d.copies + (d.copies > 1 ? ' copies working' : ' copy working') + '. ' : '') + (d.tasks || []).join(' · '),
    })
    if (!S.agentNodes.includes(node)) S.agentNodes.push(node)
    // make every file visible: open its folders from the top down, once each
    const files = (d.files || []).map((f) => f.path).filter(Boolean)
    for (const p of files) {
      const segs = p.split('/')
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join('/')
        const dn = S.byId.get(dir)
        if (dn && dn.type === 'dir' && !dn.expanded && !dn._hidden && !opened.has(dir)) { opened.add(dir); await B.expandDir(dir, true) }
      }
    }
    // link to each file, or to its deepest visible folder if the scan has not seen it yet
    const targets = []
    for (const p of files) {
      let t = p
      while (t && !(S.byId.get(t) && !S.byId.get(t)._hidden)) t = t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : ''
      if (t && !targets.includes(t)) targets.push(t)
    }
    S.baseLinks = S.baseLinks.filter((l) => l.s !== id)
    for (const t of targets) S.baseLinks.push({ s: id, t, k: 'sync', w: 2 })
    B.reaggregate()
    // sit the agent beside its files, and fly there
    const place = () => {
      const pts = targets.map((t) => S.byId.get(t)).filter((n) => n && n.x != null)
      if (!pts.length) { node._pin = null; return }
      const cx = pts.reduce((a, n) => a + n.x, 0) / pts.length, cy = pts.reduce((a, n) => a + n.y, 0) / pts.length
      node._pin = { x: cx + 40, y: cy - 40 }; node.x = node._pin.x; node.y = node._pin.y
      if (!first) return
      const xs = pts.map((n) => n.x).concat(node.x), ys = pts.map((n) => n.y).concat(node.y)
      const w = Math.max(160, Math.max(...xs) - Math.min(...xs)), h = Math.max(160, Math.max(...ys) - Math.min(...ys))
      const v = view(S)
      const k = Math.max(0.35, Math.min(2.2, Math.min(v.w / (w * 1.6), v.h / (h * 1.6))))
      const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2
      S.fly = { from: { k: S.cam.k, x: S.cam.x, y: S.cam.y }, to: { k, x: v.cx - mx * k, y: v.cy - my * k }, t: 0, dur: 55 }
    }
    if (first) { B.select(node); setTimeout(place, 700); setTimeout(place, 1600) } else place()
    if (!targets.length && first) B.toast(d.agent.name + ' has not touched any files yet')
  }

  // capture phase: runs before the canvas's own zoom handler
  addEventListener('wheel', e => {
    if (!portal || !host) return;
    const S = core();
    if (!S) return;
    const out = e.deltaY > 0;
    // pinch on a trackpad arrives as a ctrl+wheel with small deltas - scale it up
    const dy = e.ctrlKey ? e.deltaY * 4 : e.deltaY;
    if (portal.p < 1 || (out && S.cam.k <= fullK(S) * 1.001)) {
      e.preventDefault(); e.stopImmediatePropagation();
      send({ type: 'rubric-os:wheel', dy });
    }
  }, { capture: true, passive: false });

  // never let a full-screen zoom-out undershoot the fit: the next scroll shrinks the window
  addEventListener('wheel', () => {
    const S = core();
    if (portal && portal.p >= 1 && S && S.cam.k < fullK(S)) {
      S.cam.k = fullK(S); S.cam.x = S.W / 2; S.cam.y = S.H / 2;
    }
  }, { passive: true });

  addEventListener('resize', applyPortal);
  // tell the host we can be driven; it re-sends the current size on this
  const hello = setInterval(() => {
    if (!core() || !core().W) return;
    clearInterval(hello);
    parent.postMessage({ type: 'rubric-os:ready' }, '*');   // no secrets in it; origin learned on reply
  }, 100);
})();
