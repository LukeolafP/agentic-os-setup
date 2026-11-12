/* ================================================================
   Windows for the Agentic OS (GTD, 15 Oct 2026)

   Beyond the three views (OS, Second Brain, Console), anything can open inside the
   OS: a vault note rendered properly, a PDF, an HTML report, an image, a video, a
   localhost dashboard or a web app. Each one is a window:

     pop-up   a floating window over whatever is showing, with FULL SCREEN, OPEN
              OUTSIDE and close. Things open as a pop-up first.
     tab      full screen, with a chip in the bar at the bottom (right of the main
              pill). Tabs keep running while you look at something else.

   The + at the end of the bar opens the launcher: search the vault, paste a web
   address, or pick an app. Clicking a file in the Second Brain, a report on the
   ring or a finished job chip all open here too.

   API, for the rest of the page and for the viewer:  osOpen({ path | url, title,
   mode: 'popup' | 'full', replace: <window> })
   ================================================================ */
(function () {
  'use strict';
  const inObsidian = (location.ancestorOrigins && [...location.ancestorOrigins].find(o => o.startsWith('app://'))) || null;
  const nativeOpen = window.open.bind(window);
  // the apps come from apps.json on the OS server: Luke's local apps, started on demand
  /* ------------------------------------------------------------ markup */
  const tabsPill = document.getElementById('osTabs');
  const bar = document.createElement('nav'); bar.id = 'winBar';
  bar.innerHTML = '<div class="chips"></div><button class="add" title="Open a file, a web address or an app">+</button>';
  document.body.appendChild(bar);
  const chips = bar.querySelector('.chips');
  const launcher = document.createElement('div'); launcher.id = 'winLaunch';
  launcher.innerHTML = `<input type="text" placeholder="Search the vault, or paste a web address" autocomplete="off">
    <div class="res"></div><div class="lbl">APPS ON THIS MAC</div><div class="apps"></div>`;
  document.body.appendChild(launcher);
  const lin = launcher.querySelector('input'), lres = launcher.querySelector('.res'), lapps = launcher.querySelector('.apps');
  // an app opens through starting.html, which starts its backend and frontend if needed
  // and then hands over to the app itself - the same tab either way
  const appSrc = id => 'starting.html?id=' + encodeURIComponent(id);
  async function loadApps() {
    let apps = [];
    try { apps = (await (await fetch('/api/apps', { cache: 'no-store' })).json()).apps || []; } catch {}
    lapps.innerHTML = '';
    if (!apps.length) { lapps.innerHTML = '<div class="none">No apps in apps.json.</div>'; return; }
    for (const a of apps) {
      const row = document.createElement('div'); row.className = 'app';
      row.innerHTML = `<span class="dot ${a.up ? 'up' : a.starting ? 'wait' : ''}"></span><span class="an"><b></b><small></small></span>${a.up ? '<button class="stop" title="Stop its backend and frontend">STOP</button>' : ''}`;
      row.querySelector('b').textContent = a.name;
      row.querySelector('small').textContent = a.up ? 'Running · ' + a.procs.map(p => ':' + p.port).join(' ') : a.desc || '';
      row.title = a.url;
      row.onclick = e => {
        if (e.target.classList.contains('stop')) {
          e.stopPropagation();
          fetch('/api/apps/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
            .then(() => setTimeout(loadApps, 700));
          return;
        }
        hideLauncher(); osOpen({ url: appSrc(a.id), title: a.name, mode: 'full' });
      };
      lapps.appendChild(row);
    }
  }
  const shade = document.createElement('div'); shade.id = 'winShade'; document.body.appendChild(shade);

  /* ------------------------------------------------------------- state */
  const wins = [];               // { id, title, src, kind, mode, el, frame, loaded }
  let active = null;             // the tab showing full screen, or null
  let seq = 0;
  const STORE = 'os-wins-v1';

  const vaultSrc = p => /\.html?$/i.test(p) ? '/vault/' + p.split('/').map(encodeURIComponent).join('/') : 'viewer.html?path=' + encodeURIComponent(p);
  const titleOf = o => o.title || (o.path ? o.path.split('/').pop().replace(/\.md$/i, '') : (() => { try { return new URL(o.url, location.href).hostname.replace(/^www\./, ''); } catch { return 'Page'; } })());

  function makeWin(o) {
    const w = { id: 'w' + (++seq), title: titleOf(o), path: o.path || null, url: o.url || null,
      src: o.path ? vaultSrc(o.path) : o.url, mode: 'popup', loaded: false };
    const el = document.createElement('div');
    el.className = 'win';
    el.innerHTML = `<div class="wbar"><span class="wt"></span><span class="wsp"></span>
      <button class="wfull" title="Full screen, as a tab">FULL SCREEN</button>
      <button class="wout" title="Open outside the OS">OPEN OUTSIDE</button>
      <button class="wclose" title="Close">✕</button></div><div class="wbody"></div>`;
    el.querySelector('.wt').textContent = w.title;
    el.querySelector('.wfull').onclick = () => toTab(w);
    el.querySelector('.wout').onclick = () => openOutside(w);
    el.querySelector('.wclose').onclick = () => closeWin(w);
    ['pointerdown', 'wheel', 'keydown'].forEach(t => el.addEventListener(t, e => e.stopPropagation(), { passive: true }));
    document.body.appendChild(el);
    w.el = el;
    return w;
  }
  function ensureFrame(w) {
    if (w.frame) return;
    const f = document.createElement('iframe');
    f.setAttribute('allow', 'microphone; camera; autoplay; clipboard-read; clipboard-write; fullscreen; display-capture');
    f.src = w.src;
    w.el.querySelector('.wbody').appendChild(f);
    w.frame = f;
  }

  function osOpen(o) {
    o = o || {};
    if (o.url && !o.path) {
      const u = String(o.url);
      if (/^obsidian:/i.test(u)) return outside(u);
      if (/^(mailto|tel):/i.test(u)) return nativeOpen(u);
      try { o.url = new URL(u, location.href).href; } catch { return; }
      // a vault file addressed by URL opens in the viewer
      const m = o.url.match(/^https?:\/\/(localhost|127\.0\.0\.1):50000\/vault\/(.+)$/);
      if (m) { o.path = decodeURIComponent(m[2]); delete o.url; }
    }
    // navigate an existing window in place (links inside the viewer)
    if (o.replace) {
      const w = wins.find(x => x.frame && x.frame.contentWindow === o.replace);
      if (w) {
        w.path = o.path || null; w.url = o.url || null; w.src = o.path ? vaultSrc(o.path) : o.url;
        w.title = titleOf(o); w.frame.src = w.src; retitle(w); save(); return w;
      }
    }
    const src = o.path ? vaultSrc(o.path) : o.url;
    let w = wins.find(x => x.src === src);
    if (!w) { w = makeWin(o); wins.push(w); }
    if ((o.mode || 'popup') === 'full' || w.mode === 'tab') toTab(w); else toPopup(w);
    return w;
  }
  function retitle(w) {
    w.el.querySelector('.wt').textContent = w.title;
    const c = chips.querySelector(`[data-id="${w.id}"] .ct`); if (c) c.textContent = w.title;
  }
  window.osRetitle = (win, title) => { const w = wins.find(x => x.frame && x.frame.contentWindow === win); if (w && title) { w.title = title; retitle(w); save(); } };

  function toPopup(w) {
    // one pop-up at a time: an earlier one that never became a tab goes away
    for (const x of wins.slice()) if (x !== w && x.mode === 'popup') closeWin(x);
    w.mode = 'popup';
    ensureFrame(w);
    w.el.className = 'win popup show';
    shade.classList.add('show');
    render();
  }
  function toTab(w) {
    w.mode = 'tab';
    ensureFrame(w);
    shade.classList.remove('show');
    activate(w);
    save();
  }
  function activate(w) {
    active = w;
    for (const x of wins) {
      if (x.mode !== 'tab') continue;
      x.el.className = 'win tab' + (x === w ? ' show' : '');
      if (x === w) ensureFrame(x);
    }
    document.body.classList.toggle('wintab', !!w);
    render();
  }
  function closeWin(w) {
    const i = wins.indexOf(w); if (i < 0) return;
    wins.splice(i, 1);
    w.el.remove();
    if (w.mode === 'popup' && !wins.some(x => x.mode === 'popup')) shade.classList.remove('show');
    if (active === w) { const next = wins.filter(x => x.mode === 'tab').pop() || null; next ? activate(next) : activate(null); }
    save(); render();
  }
  function deactivate() {
    for (const x of wins) if (x.mode === 'tab') x.el.className = 'win tab';
    active = null;
    document.body.classList.remove('wintab');
    render();
  }

  /* Inside Obsidian the GTD Rubric plugin opens it (a web page in a Web viewer tab) and says
     so. If it does not answer in time (an older plugin still loaded), the link is handed to
     Obsidian itself: with "Open external links in web viewer" on (it is, in webviewer.json),
     Obsidian opens a web page in a Web viewer tab too. Outside Obsidian it is a browser tab. */
  const waiting = new Map();
  let pluginVersion = null;
  addEventListener('message', e => {
    if (!inObsidian || e.origin !== inObsidian || !e.data) return;
    if (e.data.type === 'rubric-os:pong') { pluginVersion = e.data.version || '?'; return; }
    if (e.data.type !== 'rubric-os:opened') return;
    const w = waiting.get(e.data.id); if (!w) return;
    clearTimeout(w.timer); waiting.delete(e.data.id);
    if (!e.data.ok) nativeOpen(w.url, '_blank');
  });
  if (inObsidian) parent.postMessage({ type: 'rubric-os:ping' }, inObsidian);
  window.osPluginVersion = () => pluginVersion;
  function outside(u) {
    if (!inObsidian) return nativeOpen(u, '_blank');
    const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    parent.postMessage({ type: 'rubric-os:open', url: u, id }, inObsidian);
    if (/^https?:/i.test(u)) waiting.set(id, { url: u, timer: setTimeout(() => { waiting.delete(id); nativeOpen(u, '_blank'); }, 1000) });
  }
  /* files Obsidian itself can show; anything else (an HTML page, say) it cannot open from an
     obsidian:// link, so it opens as a web page: an Obsidian web viewer tab, or a browser tab */
  const OBSIDIAN_OPENS = /\.(md|canvas|base|pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|m4a|ogg|flac|webm|mp4|mov|mkv)$/i;
  function openOutside(w) {
    if (w.path && OBSIDIAN_OPENS.test(w.path)) {
      // a note, canvas, PDF or image opens in Obsidian itself
      const vault = 'GTD';
      outside(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(w.path)}`);
    } else if (w.path) outside(new URL(w.src, location.href).href);
    else outside(w.url);
  }

  /* ---------------------------------------------------------------- bar */
  function render() {
    chips.innerHTML = '';
    for (const w of wins.filter(x => x.mode === 'tab')) {
      const c = document.createElement('div');
      c.className = 'chip' + (w === active ? ' on' : '');
      c.dataset.id = w.id;
      c.innerHTML = `<span class="ic">${w.path ? (/\.pdf$/i.test(w.path) ? 'PDF' : /\.md$/i.test(w.path) ? 'MD' : 'FILE') : /starting\.html/.test(w.src) ? 'APP' : 'WEB'}</span><span class="ct"></span><span class="cx" title="Close">✕</span>`;
      c.querySelector('.ct').textContent = w.title;
      c.title = w.path || w.url || '';
      c.onclick = e => { if (e.target.classList.contains('cx')) { closeWin(w); return; } w === active ? deactivate() : activate(w); };
      chips.appendChild(c);
    }
    bar.classList.toggle('has', chips.children.length > 0);
    // the main pill only shows a view as current when no tab covers it
    if (tabsPill) tabsPill.classList.toggle('covered', !!active);
    placeBar();
  }
  function placeBar() {
    if (!tabsPill) return;
    const r = tabsPill.getBoundingClientRect();
    bar.style.left = (r.right + 10) + 'px';
    bar.style.maxWidth = Math.max(120, innerWidth - r.right - 30) + 'px';
  }
  addEventListener('resize', placeBar);
  // the OS / Second Brain / Console buttons bring their view back over any tab
  if (tabsPill) tabsPill.addEventListener('click', e => { if (e.target.closest('button[data-tab]') && active) deactivate(); }, true);

  /* ----------------------------------------------------------- launcher */
  function showLauncher() {
    const r = bar.querySelector('.add').getBoundingClientRect();
    launcher.style.left = Math.min(innerWidth - 380, Math.max(16, r.left - 300)) + 'px';
    launcher.classList.add('show'); lin.value = ''; lres.innerHTML = ''; setTimeout(() => lin.focus({ preventScroll: true }), 30);
    loadApps();
  }
  function hideLauncher() { launcher.classList.remove('show'); }
  bar.querySelector('.add').onclick = e => { e.stopPropagation(); launcher.classList.contains('show') ? hideLauncher() : showLauncher(); };
  ['pointerdown', 'keydown', 'wheel'].forEach(t => launcher.addEventListener(t, e => e.stopPropagation(), { passive: true }));
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#winLaunch') && !e.target.closest('#winBar')) hideLauncher(); });
  const looksLikeUrl = s => /^(https?:\/\/|localhost|127\.|[\w-]+(\.[\w-]+)+(\/|$))/i.test(s.trim()) && !/\s/.test(s.trim());
  let qt = null;
  lin.addEventListener('input', () => {
    clearTimeout(qt);
    const q = lin.value.trim();
    if (!q) { lres.innerHTML = ''; return; }
    qt = setTimeout(async () => {
      const items = [];
      if (looksLikeUrl(q)) items.push({ label: 'Open ' + q, url: /^https?:/i.test(q) ? q : 'https://' + q });
      try { const r = await fetch('/api/vault-search?q=' + encodeURIComponent(q)); const d = await r.json(); for (const p of d.results || []) items.push({ label: p, path: p }); } catch {}
      lres.innerHTML = '';
      for (const it of items.slice(0, 12)) {
        const b = document.createElement('button');
        b.textContent = it.label;
        b.onclick = () => { hideLauncher(); osOpen(it.path ? { path: it.path } : { url: it.url, mode: 'full' }); };
        lres.appendChild(b);
      }
      if (!items.length) lres.innerHTML = '<div class="none">Nothing in the vault matches.</div>';
    }, 140);
  });
  lin.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = lres.querySelector('button'); if (first) first.click(); }
    if (e.key === 'Escape') hideLauncher();
  });

  /* ------------------------------------------------- keys and messages */
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (launcher.classList.contains('show')) { hideLauncher(); e.stopImmediatePropagation(); return; }
    const pop = wins.find(w => w.mode === 'popup');
    if (pop) { closeWin(pop); e.stopImmediatePropagation(); return; }
    if (active) { deactivate(); e.stopImmediatePropagation(); }
  }, true);
  shade.addEventListener('pointerdown', e => { e.stopPropagation(); const pop = wins.find(w => w.mode === 'popup'); if (pop) closeWin(pop); });
  // the Second Brain asks to open a file (clicked in its map or file view)
  addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (typeof BRAIN_ORIGIN !== 'undefined' && e.origin === BRAIN_ORIGIN && d.type === 'rubric-os:open-file' && typeof d.path === 'string') osOpen({ path: d.path, mode: 'popup' });
  });

  // every link and report anywhere in the OS opens here, as a pop-up first
  window.open = (url, target, features) => {
    if (url == null || url === '') return nativeOpen(url, target, features);
    osOpen({ url: String(url), mode: 'popup' });
    return null;
  };
  window.osOpen = osOpen;
  window.osOutside = outside;

  /* ----------------------------------------------- remember open tabs */
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(wins.filter(w => w.mode === 'tab').map(w => ({ title: w.title, path: w.path, url: w.url })))); } catch {}
  }
  try {
    for (const t of JSON.parse(localStorage.getItem(STORE) || '[]')) {
      const w = makeWin(t); w.mode = 'tab'; w.el.className = 'win tab'; wins.push(w);   // loads when first shown
    }
  } catch {}
  render();
  requestAnimationFrame(placeBar);
  setTimeout(placeBar, 600);

  /* GTD 2 Nov 2026: the board used to lay itself out once and reload after a lasting resize.
     dashboard.html's relayout() now follows the pane live, so nothing reloads here. */
})();
