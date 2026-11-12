/* Petra's chat for the Agentic OS (GTD, 20 Oct 2026).

   Click Petra and choose Type, or the keyboard beside the wave. The board makes room
   (dashboard.html: osSetChat) and this panel opens: a full Claude Code session in the
   vault, run by the JARVIS bridge (~/Coding/jarvis/bridge/chat.mjs), shared by every OS
   page and kept across reloads.

   - Messages stream in; tool calls show as rows you can open; permission prompts,
     Claude's questions and plan approval are buttons. Slash commands and skills work:
     type / for the list. The mode chip cycles auto, ask, accept edits and plan.
   - SUBAGENTS lists every agent working: subagents this chat started, Petra's voice
     subagents, and queued background jobs. Click one and its own chat replaces this
     one, with the Second Brain floating beside it on that agent and its files.
     FULL SCREEN and SPLIT (29 Oct 2026): ⤢ in the header makes the chat cover the whole
     screen. There, drag a tab into the chat to open it beside the others: up to four chats
     side by side, each with its own column; the message box (with /, photos and voice) sits
     in the column you click. Dragging a tab out of the side panel onto the board opens full
     screen with both. Shrinking shows the first column's chat; full screen again brings the
     same columns back.
     TEAMS (29 Oct 2026): an agent team's copies fold into one chip for its lead
     ("BP · Creative Director") with a count of the members working; hovering, tapping or
     focusing it lists the members and their status (agent-teams.js), and clicking a
     member opens its own chat.
   - TABS (22 Oct 2026): several chats with Petra at once. Each tab is its own Claude Code
     session in the bridge, with its own messages, mode and prompts; they all keep working
     while hidden. + opens a tab, ✕ closes one (its chat stays in history), and history
     opens any past chat in a tab. A dot on a tab means Petra is working there; a ring
     means something new arrived while you were looking at another tab.
   Talks over Petra's socket (jarvis.js): chat-* messages out, 'gtd-bridge' events in. */
(function () {
  const J = () => window.__jarvis;
  const send = m => J() && J().send(m);
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* [[wiki links]] become links that open the note in an OS pop-up */
  const wikify = t => String(t || '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g,
    (_, target, label) => `<a class="wl" data-wl="${esc(target.trim())}">${esc((label || target).trim())}</a>`);
  const md = t => { try { return window.DOMPurify ? DOMPurify.sanitize(marked.parse(wikify(t))) : esc(t).replace(/\n/g, '<br>'); } catch { return esc(t); } };
  const MODES = ['auto', 'default', 'acceptEdits', 'plan'];
  const MODE_LABEL = { auto: 'AUTO', default: 'ASK', acceptEdits: 'ACCEPT EDITS', plan: 'PLAN' };

  /* ------------------------------------------------------------ markup */
  const pane = document.createElement('section');
  pane.id = 'chatPane';
  pane.innerHTML = `
    <header class="ch-head">
      <div class="ch-main">
        <span class="ch-av"></span>
        <div class="ch-t"><b>PETRA</b><small class="ch-sub">Claude Code · connecting</small></div>
        <span class="ch-sp"></span>
        <button class="ch-mode" title="Permission mode, like shift+tab in the terminal">AUTO</button>
        <button class="ch-ic ch-voice" data-a="voice" title="Voice on/off: talk to Petra here and hear her answers"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-7 0V6A3.5 3.5 0 0 1 12 2.5z"/><path d="M5.5 11a1 1 0 0 1 1 1 5.5 5.5 0 0 0 11 0 1 1 0 1 1 2 0 7.5 7.5 0 0 1-6.5 7.43V21a1 1 0 1 1-2 0v-1.57A7.5 7.5 0 0 1 4.5 12a1 1 0 0 1 1-1z"/></svg></button>
        <button class="ch-ic" data-a="term" title="Open the Claude Code terminal"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm2.3 5.3a1 1 0 0 0 0 1.4l2.3 2.3-2.3 2.3a1 1 0 1 0 1.4 1.4l3-3a1 1 0 0 0 0-1.4l-3-3a1 1 0 0 0-1.4 0zM13 14a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2z" fill-rule="evenodd"/></svg></button>
        <button class="ch-ic" data-a="history" title="Chat history: every chat with Petra"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 1-9.4 13.4 1.2 1.2 0 1 1 2.3-.8A7.6 7.6 0 1 0 6.6 6.6L8 8H3.5a.5.5 0 0 1-.5-.5V3l1.9 1.9A9.96 9.96 0 0 1 12 2zm0 4.5a1.2 1.2 0 0 1 1.2 1.2v3.8l2.7 2a1.2 1.2 0 1 1-1.4 1.9l-3.2-2.4a1.2 1.2 0 0 1-.5-1V7.7A1.2 1.2 0 0 1 12 6.5z"/></svg></button>
        <button class="ch-ic" data-a="new" title="New chat tab"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a1.2 1.2 0 0 1 1.2 1.2v5.6h5.6a1.2 1.2 0 0 1 0 2.4h-5.6v5.6a1.2 1.2 0 0 1-2.4 0v-5.6H5.2a1.2 1.2 0 0 1 0-2.4h5.6V5.2A1.2 1.2 0 0 1 12 4z"/></svg></button>
        <button class="ch-ic ch-full" data-a="full" title="Full screen: chats side by side (drag tabs in)"><svg class="i-grow" viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h5a1 1 0 1 1 0 2H6.4l4.3 4.3a1 1 0 1 1-1.4 1.4L5 6.4V9a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm16 0a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V6.4l-4.3 4.3a1 1 0 1 1-1.4-1.4L17.6 5H15a1 1 0 1 1 0-2zM4 21a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v2.6l4.3-4.3a1 1 0 1 1 1.4 1.4L6.4 19H9a1 1 0 1 1 0 2zm16 0h-5a1 1 0 1 1 0-2h2.6l-4.3-4.3a1 1 0 1 1 1.4-1.4l4.3 4.3V15a1 1 0 1 1 2 0v5a1 1 0 0 1-1 1z"/></svg><svg class="i-shrink" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 1 1 0-2h2.6L2.3 3.7a1 1 0 0 1 1.4-1.4L8 6.6V4a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v2.6l4.3-4.3a1 1 0 1 1 1.4 1.4L17.4 8H20a1 1 0 1 1 0 2h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 14h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-2.6l-4.3 4.3a1 1 0 1 1-1.4-1.4L6.6 16H4a1 1 0 1 1 0-2zm11 0h5a1 1 0 1 1 0 2h-2.6l4.3 4.3a1 1 0 1 1-1.4 1.4L16 17.4V20a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1z"/></svg></button>
        <button class="ch-ic" data-a="close" title="Close the chat">✕</button>
      </div>
      <div class="ch-subhead">
        <button class="ch-back">← PETRA</button>
        <span class="ch-dot"></span><b class="ch-agent"></b><span class="ch-state"></span>
        <span class="ch-task"></span>
      </div>
    </header>
    <nav class="ch-tabs"><div class="ct-list"></div><button class="ct-new" title="New chat tab">+</button></nav>
    <div class="ch-subs"><span class="ch-lbl">SUBAGENTS</span><div class="ch-chips"></div></div>
    <div class="ch-bodies" aria-live="polite"></div>
    <div class="ch-subbody"></div>
    <div class="ch-subfoot"><textarea rows="1" placeholder="Message this manager"></textarea><button class="ch-subsend">SEND</button><button class="ch-substop" title="Stop this manager">STOP</button></div>
    <footer class="ch-foot">
      <div class="ch-palette"></div>
      <div class="ch-atts"></div>
      <div class="ch-row">
        <textarea rows="1" placeholder="Message Petra · / for commands"></textarea>
        <button class="ch-send" title="Send (Enter)">SEND</button>
      </div>
      <div class="ch-hint"><span class="ch-vstate"></span>Full Claude Code in ~/Documents/GTD · shift+enter for a new line</div>
    </footer>
    <div class="ch-drop"><div><b>DROP PHOTOS</b><span>for Petra</span></div></div>
    <div class="ch-hist">
      <div class="hh"><b>CHAT HISTORY</b><span class="ch-sp"></span><button class="ch-ic hx" title="Close">✕</button></div>
      <input class="hs" type="search" placeholder="Search your chats with Petra" autocomplete="off">
      <div class="hl"></div>
      <div class="hv"><div class="hvh"><button class="hb">← ALL CHATS</button><b class="ht"></b><button class="hc" title="Opens it in a new tab">OPEN IN A TAB</button></div><div class="hvb"></div></div>
    </div>`;
  document.body.appendChild(pane);
  const bodies = $('.ch-bodies', pane), tabList = $('.ct-list', pane); const subBody = $('.ch-subbody', pane), input = $('.ch-foot textarea', pane);
  const chips = $('.ch-chips', pane), palette = $('.ch-palette', pane), sendBtn = $('.ch-send', pane);
  ['pointerdown', 'keydown', 'wheel'].forEach(t => pane.addEventListener(t, e => e.stopPropagation()));
  pane.addEventListener('click', async e => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.classList.contains('wl')) {
      try {
        const d = await (await fetch('/api/vault-find?name=' + encodeURIComponent(a.dataset.wl))).json();
        if (d.path && window.osOpen) return window.osOpen({ path: d.path, title: a.dataset.wl, mode: 'popup' });
      } catch {}
      return;
    }
    if (a.href) window.open(a.href, '_blank');
  });

  /* ------------------------------------------------------------ layout */
  let open = false;
  let full = false, split = [], dragTab = null, peekId = null;     /* full screen and its columns (see below) */
  function place() {
    if (full) return;                                         /* full screen owns its size */
    const L = window.osLayout && window.osLayout();
    const r = L && L.dock && L.dock.chat;
    if (!r) return;
    Object.assign(pane.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    document.body.style.setProperty('--chatw', (innerWidth - r.x) + 'px');   /* the board drop zone stops at the chat */
  }
  addEventListener('os-layout', place);
  function setOpen(on) {
    if (on === open) return;
    open = on;
    if (!on) { closeSub(); if (full) setFull(false); }
    window.osSetChat && window.osSetChat(on);
    place();
    if (on) setTimeout(markSeen, 0);
    pane.classList.toggle('show', on);
    document.getElementById('jvKbd')?.classList.toggle('on', on);
    if (on) { askHistory(); setTimeout(() => input.focus({ preventScroll: true }), 120); try { if (localStorage.getItem('os-chat-voice') === '1') setVoice(true); } catch {} }
    else if (voiceOn) { J() && J().stopListen(); J() && J().stopVoice(); pane.classList.remove('voice'); voiceOn = false; setVState(''); }
  }

  /* ------------------------------------------------------------ state */
  /* every open tab: its own messages (body), streaming bubble, tool rows, permission cards,
     busy state, model info and mode. cur is the one on screen. */
  let commands = [];
  const T = new Map();
  let cur = null, order = [];
  function makeTab(id) {
    let t = T.get(id);
    if (t) return t;
    const body = document.createElement('div'); body.className = 'ch-body'; body.dataset.tab = id;
    bodies.appendChild(body);
    t = { id, body, live: null, liveText: '', liveTimer: null, tools: new Map(), perms: new Map(), busy: false, info: {}, mode: 'auto', loaded: false, title: 'New chat', unread: false };
    T.set(id, t); clearAll(t);
    return t;
  }
  function dropTab(id) { const t = T.get(id); if (!t) return; clearTimeout(t.liveTimer); t.body.remove(); T.delete(id); }
  const busy = () => !!(cur && cur.busy);

  function scrollDown(el = cur && cur.body, force) {
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (near || force) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }
  /* Petra can always take another message: SEND whenever there is text, STOP only when
     the box is empty and she is working */
  function syncSend() {
    const stop = busy() && !input.value.trim() && !atts.length;
    sendBtn.textContent = stop ? 'STOP' : 'SEND';
    sendBtn.classList.toggle('stop', stop);
  }
  function setBusy(t, b) {
    const was = t.busy; t.busy = b;
    if (t === cur) { syncSend(); pane.classList.toggle('busy', b); }
    renderTabs();
    if (was && !b && voiceTab === t) voiceAfterTurn();
  }
  function setInfo(t, i) {
    t.info = { ...t.info, ...i };
    if (i.permissionMode) t.mode = i.permissionMode;
    if (t === cur) showHead();
  }
  function showHead() {
    if (!cur) return;
    $('.ch-mode', pane).textContent = MODE_LABEL[cur.mode] || cur.mode.toUpperCase();
    $('.ch-mode', pane).dataset.m = cur.mode;
    const model = String(cur.info.model || '').replace(/^claude-/, '').replace(/\[1m\]/, ' 1M').replace(/-(\d)-(\d)/, ' $1.$2');
    $('.ch-sub', pane).textContent = ['Claude Code', model || null, cur.info.resumed ? 'resumed' : null].filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------ rendering */
  function add(cls, html, into = cur && cur.body) {
    const d = document.createElement('div');
    d.className = 'm ' + cls; d.innerHTML = html;
    into.appendChild(d);
    return d;
  }
  function flushLive(t) {
    clearTimeout(t.liveTimer); t.liveTimer = null;
    if (t.live) t.live.innerHTML = md(t.liveText);
  }
  function toolRow(ev, into) {
    const row = add('tool' + (ev.sub ? ' sub' : ''), `
      <div class="tr"><i></i><b>${esc(ev.name)}</b><span>${esc(ev.summary)}</span>${ev.sub ? '<button class="watch">WATCH</button>' : ''}</div>
      <div class="td"><pre class="in">${esc(ev.input || '')}</pre><pre class="out"></pre></div>`, into);
    row.querySelector('.tr').addEventListener('click', e => {
      if (e.target.closest('.watch')) return openSub(ev.id);
      row.classList.toggle('open');
    });
    return row;
  }
  function resultInto(row, ev) {
    if (!row) return;
    row.classList.add(ev.ok ? 'ok' : 'bad');
    const out = row.querySelector('.out');
    if (out) out.textContent = ev.preview || (ev.ok ? 'done' : 'failed');
  }
  function permCard(t, ev) {
    const c = add('perm', '', t.body);
    const head = ev.plan != null ? 'Ready to code? Here is the plan'
      : ev.questions ? 'Petra has a question'
      : (ev.title || `Allow ${ev.tool}?`);
    let inner = `<div class="ph">${esc(head)}</div>`;
    if (ev.plan != null) inner += `<div class="plan">${md(ev.plan)}</div>`;
    else if (ev.questions) inner += ev.questions.map((q, qi) => `<div class="q" data-q="${qi}"><div class="qt">${esc(q.question)}</div>
        <div class="qo">${(q.options || []).map((o, oi) => `<button data-o="${oi}" title="${esc(o.description || '')}">${esc(o.label)}</button>`).join('')}</div></div>`).join('');
    else inner += `${ev.summary ? `<pre class="ps">${esc(ev.summary)}</pre>` : ''}${ev.description ? `<div class="pd">${esc(ev.description)}</div>` : ''}${ev.reason ? `<div class="pd">${esc(ev.reason)}</div>` : ''}`;
    if (!ev.questions) inner += `<div class="pb">
        <button class="yes">${ev.plan != null ? 'APPROVE PLAN' : 'ALLOW'}</button>
        ${ev.canAlways && ev.plan == null ? '<button class="always">ALWAYS ALLOW</button>' : ''}
        <button class="no">${ev.plan != null ? 'KEEP PLANNING' : 'DENY'}</button></div>`;
    inner += '<div class="pdone"></div>';
    c.innerHTML = inner;
    const reply = m => send({ type: 'chat-perm', id: ev.id, ...m });
    c.querySelector('.yes')?.addEventListener('click', () => reply({ allow: true }));
    c.querySelector('.always')?.addEventListener('click', () => reply({ allow: true, always: true }));
    c.querySelector('.no')?.addEventListener('click', () => reply({ allow: false }));
    if (ev.questions) {
      const answers = {};
      c.querySelectorAll('.q').forEach(qd => qd.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const q = ev.questions[+qd.dataset.q];
        qd.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        answers[q.question] = q.options[+b.dataset.o].label;
        if (Object.keys(answers).length === ev.questions.length) reply({ allow: true, answers });
      }));
    }
    if (ev.stale) permDone(t, { id: ev.id, outcome: 'expired' }, c);
    t.perms.set(ev.id, c);
    return c;
  }
  function permDone(t, ev, card = t.perms.get(ev.id)) {
    if (!card) return;
    card.classList.add('done');
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const words = { allowed: 'Allowed', always: 'Allowed, and remembered', answered: 'Answered', denied: 'Declined', cancelled: 'Cancelled', expired: 'Expired: the session restarted' };
    card.querySelector('.pdone').textContent = words[ev.outcome] || ev.outcome;
  }
  function render(t, ev, replay) {
    const B = t.body, here = t === cur || (full && split.includes(t.id));
    const mark = () => { if (!here && !replay) { t.unread = true; renderTabs(); } };
    switch (ev.k) {
      case 'user':
        flushLive(t); t.live = null;
        add('user' + (ev.voice ? ' voice' : ''), (ev.thumbs && ev.thumbs.length ? `<div class="ub-imgs">${ev.thumbs.map(x => `<img src="${esc(x)}" alt="">`).join('')}</div>` : '')
          + esc(ev.text).replace(/\n/g, '<br>'), B);
        scrollDown(B, true); break;
      case 'delta':
        if (!t.live) { t.live = add('asst live', '', B); t.liveText = ''; }
        t.liveText += ev.text;
        if (!replay && voiceTab === t) speakDelta(ev.text);
        if (!t.liveTimer) t.liveTimer = setTimeout(() => flushLive(t), 70);
        scrollDown(B); break;
      case 'thinking':
        if (!t.live) { t.live = add('asst live', '', B); t.liveText = ''; }
        break;
      case 'text':
        if (!replay && voiceTab === t) speakFinal(ev.text);
        if (t.live) { clearTimeout(t.liveTimer); t.liveTimer = null; t.live.innerHTML = md(ev.text); t.live.classList.remove('live'); t.live = null; }
        else add('asst', md(ev.text), B);
        mark(); scrollDown(B); break;
      case 'tool':
        if (t.live && !t.liveText) { t.live.remove(); }
        flushLive(t); if (t.live) t.live.classList.remove('live'); t.live = null;
        t.tools.set(ev.id, toolRow(ev, B)); scrollDown(B); break;
      case 'result': resultInto(t.tools.get(ev.id), ev); break;
      case 'perm': flushLive(t); permCard(t, ev); mark(); scrollDown(B, true); break;
      case 'perm-done': permDone(t, ev); break;
      case 'done':
        if (t.live) { if (!t.liveText) t.live.remove(); else { flushLive(t); t.live.classList.remove('live'); } t.live = null; }
        add('meta', `${ev.ok ? '' : esc(ev.subtype || 'stopped') + ' · '}${ev.ms ? (ev.ms / 1000).toFixed(1) + 's' : ''}${ev.cost ? ' · $' + ev.cost.toFixed(2) : ''}`, B);
        if (!replay) setBusy(t, false);
        scrollDown(B); break;
      case 'error': add('err', esc(ev.text), B); if (!replay) setBusy(t, false); mark(); scrollDown(B); break;
      case 'note': add(/^\[Manager/.test(ev.text) ? 'mline' : 'meta', esc(ev.text), B); break;
      case 'info': setInfo(t, ev); break;
      case 'status': setBusy(t, !!ev.busy); break;
      case 'reset': clearAll(t); setInfo(t, { model: t.info.model, resumed: false }); break;
      case 'mgr': mgrCard(t, ev); mark(); scrollDown(B); break;
      case 'carry': add('carry', `<div class="bl">FROM VOICE</div>${ev.you ? `<div><b>You:</b> ${esc(ev.you)}</div>` : ''}${ev.petra ? `<div><b>Petra:</b> ${esc(ev.petra)}</div>` : ''}`, B); break;
    }
  }
  function clearAll(t) {
    t.body.innerHTML = ''; t.tools.clear(); t.perms.clear(); t.live = null; t.liveText = '';
    add('hello', `<b>Petra</b> · the whole of Claude Code, in your vault. Ask anything, run a skill with <code>/</code>, or hand work to an agent. Open more tabs with <b>+</b> to work on several things at once.`, t.body);
  }

  /* ------------------------------------------------------------ tabs */
  function renderTabs() {
    tabList.innerHTML = order.map(id => {
      const t = T.get(id); if (!t) return '';
      return `<div class="ct${t === cur ? ' on' : ''}${t.busy ? ' busy' : ''}${t.unread ? ' unread' : ''}${t.state ? ' st-' + t.state : ''}${full && split.length > 1 && split.includes(id) ? ' inpane' : ''}" data-id="${esc(id)}" draggable="true">
        <i></i><span>${esc(t.title)}</span><button class="ct-x" data-x="${esc(id)}" title="Close this tab (the chat stays in history)">✕</button></div>`;
    }).join('');
    pane.classList.toggle('manyTabs', order.length > 1);
    refreshPaneHeads();
    if (peekId && !document.body.classList.contains('ctdrag')) { const c = tabList.querySelector(`.ct[data-id="${CSS.escape(peekId)}"]`); peekId = null; c ? showPeek(c) : hidePeek(); }
    /* bring the shown tab into view by scrolling the tab row only: scrollIntoView would also
       scroll the OS page and Obsidian's pane around it, which pushed the whole board up */
    const on = tabList.querySelector('.ct.on');
    if (on) {
      const l = on.offsetLeft - tabList.offsetLeft, r = l + on.offsetWidth;
      if (l < tabList.scrollLeft) tabList.scrollLeft = l - 4;
      else if (r > tabList.scrollLeft + tabList.clientWidth) tabList.scrollLeft = r - tabList.clientWidth + 4;
    }
  }
  function showTab(id) {
    const t = T.get(id) || makeTab(id);
    if (sub) closeSub();
    cur = t; t.unread = false;
    try { localStorage.setItem('os-chat-tab', id); if (full && split.includes(id)) localStorage.setItem('os-chat-split-focus', id); } catch {}
    layoutPanes();
    showHead(); syncSend(); pane.classList.toggle('busy', t.busy);
    markSeen();
    renderTabs();
    if (!t.loaded) { t.body.innerHTML = '<div class="m meta">Loading…</div>'; send({ type: 'chat-history', tab: id }); }
    else scrollDown(t.body, true);
  }
  /* the bridge's list of open tabs: add new ones, drop closed ones, go to `focus` */
  function syncTabs(list, focus) {
    order = list.map(x => x.id);
    split = split.filter(id => order.includes(id));
    if (focus && full && split.length && !split.includes(focus) && !T.get(focus)) { if (split.length < MAX_PANES()) split.push(focus); else if (cur) split[Math.max(0, split.indexOf(cur.id))] = focus; }
    saveSplit();
    for (const x of list) { const t = makeTab(x.id); t.title = x.title || 'New chat'; t.busy = !!x.busy; t.state = x.state || ''; }
    for (const id of [...T.keys()]) if (!order.includes(id)) dropTab(id);
    let want = focus && T.get(focus) ? focus : cur && T.get(cur.id) ? cur.id : null;
    if (!want) { try { const saved = localStorage.getItem('os-chat-tab'); if (saved && T.get(saved)) want = saved; } catch {} }
    if (!want) want = order[0];
    if (want && (!cur || cur.id !== want || !T.get(cur.id))) showTab(want); else renderTabs();
    markSeen();
  }
  /* a tab on screen has been seen: its green "finished, not looked at" clears (bridge chatSeen) */
  function onScreen(t) { return open && !sub && document.visibilityState === 'visible' && (t === cur || (full && split.length > 1 && split.includes(t.id))); }
  function markSeen() { for (const t of T.values()) if (t.state === 'done' && onScreen(t)) { t.state = ''; send({ type: 'chat-seen', tab: t.id }); } }
  document.addEventListener('visibilitychange', () => { markSeen(); renderTabs(); });
  const onTabClick = e => {
    hidePeek();
    const x = e.target.closest('.ct-x');
    if (x) {
      e.stopPropagation();
      const t = T.get(x.dataset.x);
      if (t && t.busy && !confirm('Petra is still working in this tab. Close it and stop her? The chat stays in history.')) return;
      send({ type: 'chat-close-tab', tab: x.dataset.x }); return;
    }
    const c = e.target.closest('.ct'); if (!c) return;
    if (full && split.length > 1 && !split.includes(c.dataset.id) && cur) { split[split.indexOf(cur.id)] = c.dataset.id; saveSplit(); }
    showTab(c.dataset.id);
  };
  const onTabAux = e => { const c = e.target.closest('.ct'); if (c && e.button === 1) { hidePeek(); send({ type: 'chat-close-tab', tab: c.dataset.id }); } };
  tabList.addEventListener('click', onTabClick);
  tabList.addEventListener('auxclick', onTabAux);

  /* hovering a tab whose title is cut off shows its whole title at once, in a pop-up just
     under the tab bar: the tabs stay in view and the row can still be scrolled under it */
  const peek = document.createElement('div'); peek.className = 'ct-peek'; pane.appendChild(peek);
  let peekX = 0, peekY = 0;
  function hidePeek() { peekId = null; peek.classList.remove('show'); }
  function showPeek(c) {
    const s = c.querySelector('span');
    if (!s || s.scrollWidth <= s.clientWidth + 1) return hidePeek();
    peekId = c.dataset.id;
    peek.textContent = T.get(peekId)?.title || s.textContent;
    const pr = pane.getBoundingClientRect(), r = c.getBoundingClientRect(), bar = $('.ch-tabs', pane).getBoundingClientRect();
    peek.style.top = (bar.bottom - pr.top + 6) + 'px'; peek.style.left = '0px'; peek.classList.add('show');
    const right = Math.min(pr.width, innerWidth - pr.left) - 12;
    const left = Math.max(8, Math.min(r.left - pr.left, right - peek.offsetWidth));
    peek.style.left = left + 'px';
    peek.style.setProperty('--nx', Math.max(14, Math.min(peek.offsetWidth - 14, r.left - pr.left - left + Math.min(r.width / 2, 40))) + 'px');
  }
  const peekAt = () => { const el = document.elementFromPoint(peekX, peekY), c = el?.closest?.('.ct'); c && tabList.contains(c) ? showPeek(c) : hidePeek(); };
  tabList.addEventListener('mouseover', e => { if (document.body.classList.contains('ctdrag')) return; peekX = e.clientX; peekY = e.clientY; const c = e.target.closest('.ct'); if (c) showPeek(c); });
  tabList.addEventListener('mousemove', e => { peekX = e.clientX; peekY = e.clientY; }, { passive: true });
  tabList.addEventListener('mouseleave', hidePeek);
  tabList.addEventListener('scroll', () => { if (tabList.matches(':hover')) requestAnimationFrame(peekAt); }, { passive: true });
  tabList.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tabList.scrollWidth > tabList.clientWidth) { e.preventDefault(); tabList.scrollLeft += e.deltaY; } }, { passive: false });
  addEventListener('resize', hidePeek);
  $('.ct-new', pane).addEventListener('click', () => send({ type: 'chat-new-tab' }));

  /* ------------------------------------------------------------ full screen and split */
  try { split = JSON.parse(localStorage.getItem('os-chat-split') || '[]'); } catch {}
  const MAX_PANES = () => Math.max(1, Math.min(4, Math.floor(innerWidth / 330)));
  const foot = $('.ch-foot', pane);
  const saveSplit = () => { try { localStorage.setItem('os-chat-split', JSON.stringify(split)); if (cur && full) localStorage.setItem('os-chat-split-focus', cur.id); } catch {} };
  const paneEls = new Map();      // tab id -> its column
  function paneFor(id) {
    let el = paneEls.get(id);
    if (el) return el;
    el = document.createElement('div'); el.className = 'cpane'; el.dataset.tab = id;
    el.innerHTML = `<div class="cp-head"><i></i><span></span><button class="cp-x" title="Close this column (the tab stays open)">✕</button></div>`;
    el.addEventListener('pointerdown', () => { if (cur && cur.id !== id) showTab(id); });
    el.querySelector('.cp-x').addEventListener('click', e => { e.stopPropagation(); removePane(id); });
    paneEls.set(id, el);
    return el;
  }
  function refreshPaneHeads() {
    for (const [id, el] of paneEls) {
      const t = T.get(id); if (!t) continue;
      el.querySelector('span').textContent = t.title;
      el.classList.toggle('busy', t.busy); el.classList.toggle('focus', t === cur);
    }
  }
  /* one column per tab in `split` while in full screen; otherwise the shown tab alone */
  function layoutPanes() {
    const ids = full ? split.filter(id => T.has(id)) : [];
    const many = ids.length > 1;
    bodies.classList.toggle('split', many);
    pane.classList.toggle('splitting', many);
    for (const [id, el] of paneEls) if (!many || !ids.includes(id)) { const t = T.get(id); if (t) bodies.appendChild(t.body); el.remove(); paneEls.delete(id); }
    if (!many) {
      for (const x of T.values()) x.body.classList.toggle('on', x === cur);
      if (foot.parentElement !== pane) pane.insertBefore(foot, $('.ch-drop', pane));
    } else {
      /* move columns only when the order changed: moving one mid-click swallows the click */
      const now = [...bodies.querySelectorAll(':scope > .cpane')].map(x => x.dataset.tab);
      const reorder = now.join() !== ids.join();
      ids.forEach(id => {
        const t = T.get(id), el = paneFor(id);
        if (reorder || !el.parentElement) bodies.appendChild(el);   /* in split order */
        if (t.body.parentElement !== el) el.insertBefore(t.body, el.querySelector('.cp-foot-slot') || null);
        t.body.classList.add('on');
        if (!t.loaded) { t.body.innerHTML = '<div class="m meta">Loading…</div>'; send({ type: 'chat-history', tab: id }); }
      });
      for (const x of T.values()) if (!ids.includes(x.id)) x.body.classList.remove('on');
      const fp = cur && paneEls.get(cur.id);
      if (fp && foot.parentElement !== fp) fp.appendChild(foot);
      refreshPaneHeads();
    }
    addZone.classList.toggle('room', full && ids.length < MAX_PANES());
  }
  function removePane(id) {
    split = split.filter(x => x !== id);
    if (cur && cur.id === id) { saveSplit(); return showTab(split[0] || id); }
    saveSplit(); layoutPanes(); renderTabs();
  }
  function setFull(on) {
    if (on === full) return;
    if (on && sub) closeSub();
    full = on;
    document.body.classList.toggle('chatfull', on);
    pane.classList.toggle('full', on);
    try { localStorage.setItem('os-chat-full', on ? '1' : '0'); } catch {}
    if (on) {
      if (!open) setOpen(true);
      pane.style.left = pane.style.top = '0px'; pane.style.width = '100vw'; pane.style.height = '100vh';
      split = split.filter(id => T.has(id));
      if (!split.length && cur) split = [cur.id];
      let f = null; try { f = localStorage.getItem('os-chat-split-focus'); } catch {}
      const focusId = f && split.includes(f) ? f : split[0];
      saveSplit();
      if (focusId) showTab(focusId); else layoutPanes();
    } else {
      place();
      const first = split.find(id => T.has(id));
      layoutPanes();
      if (first) showTab(first);
    }
    renderTabs();
  }
  /* full screen fills the window whatever its size */
  addEventListener('resize', () => { if (full) { layoutPanes(); } });

  /* drag a tab: in full screen onto a column (it takes that column) or the + zone (a new
     column); from the side panel onto the board, which opens full screen with both */
  const addZone = document.createElement('div');
  addZone.className = 'cp-add'; addZone.innerHTML = '<div><b>+</b><span>DROP A TAB HERE<br>TO OPEN IT BESIDE</span></div>';
  bodies.appendChild(addZone);
  const boardDrop = document.createElement('div');
  boardDrop.id = 'chatSplitDrop'; boardDrop.innerHTML = '<div><b>OPEN SIDE BY SIDE</b><span>Drop here for full screen with both chats</span></div>';
  document.body.appendChild(boardDrop);
  const isTabDrag = e => [...(e.dataTransfer?.types || [])].includes('text/x-petra-tab');
  const onTabDragStart = e => {
    const c = e.target.closest('.ct'); if (!c) return;
    dragTab = c.dataset.id;
    e.dataTransfer.setData('text/x-petra-tab', dragTab); e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => document.body.classList.add('ctdrag'));
  };
  const onTabDragEnd = () => { dragTab = null; hidePeek(); document.body.classList.remove('ctdrag'); document.querySelectorAll('.dropover').forEach(x => x.classList.remove('dropover')); };
  tabList.addEventListener('dragstart', e => { hidePeek(); onTabDragStart(e); });
  tabList.addEventListener('dragend', onTabDragEnd);
  function placeTab(id, at) {          // at: a tab id whose column it takes, or null for a new column
    if (!full) {
      const base = cur && cur.id !== id ? [cur.id, id] : [id];
      split = base; setFull(true); return showTab(id);
    }
    if (!split.length && cur) split = [cur.id];
    const from = split.indexOf(id);
    if (at) {
      const to = split.indexOf(at);
      if (to < 0) return;
      if (from >= 0) { split[from] = at; split[to] = id; } else split[to] = id;   /* swap, or take it over */
    } else if (from < 0) {
      if (split.length >= MAX_PANES()) split[split.length - 1] = id; else split.push(id);
    }
    saveSplit(); showTab(id);
  }
  for (const [el, at] of [[addZone, null], [boardDrop, null]]) {
    el.addEventListener('dragover', e => { if (!isTabDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('dropover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dropover'));
    el.addEventListener('drop', e => { if (!isTabDrag(e)) return; e.preventDefault(); el.classList.remove('dropover'); placeTab(e.dataTransfer.getData('text/x-petra-tab') || dragTab, at); });
  }
  bodies.addEventListener('dragover', e => {
    if (!isTabDrag(e)) return;
    const col = e.target.closest('.cpane');
    if (!full) { e.preventDefault(); return; }         /* a tab dropped on the side panel: open it there */
    if (!col && !e.target.closest('.cp-add')) { e.preventDefault(); return; }
    if (col) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.cpane.dropover').forEach(x => x !== col && x.classList.remove('dropover')); col.classList.add('dropover'); }
  });
  bodies.addEventListener('dragleave', e => { const col = e.target.closest('.cpane'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('dropover'); });
  bodies.addEventListener('drop', e => {
    if (!isTabDrag(e) || e.target.closest('.cp-add')) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/x-petra-tab') || dragTab;
    const col = e.target.closest('.cpane');
    document.querySelectorAll('.dropover').forEach(x => x.classList.remove('dropover'));
    if (!full) return showTab(id);
    if (col) placeTab(id, col.dataset.tab); else placeTab(id, null);
  });

  function askHistory() { send({ type: 'chat-tabs' }); }
  addEventListener('gtd-bridge-open', () => { for (const t of T.values()) t.loaded = false; if (open) askHistory(); });
  addEventListener('gtd-bridge', e => {
    const m = e.detail;
    if (m.type === 'chat-tabs') syncTabs(m.tabs || []);
    else if (m.type === 'chat-history') {
      if (m.tabs) { order = m.tabs.map(x => x.id); for (const x of m.tabs) { const tt = makeTab(x.id); tt.title = x.title || 'New chat'; } }
      if (!m.tab) return;
      const t = makeTab(m.tab);
      clearAll(t);
      (m.log || []).forEach(ev => render(t, ev, true));
      setInfo(t, m.info || {}); if (m.commands && m.commands.length) commands = m.commands;
      t.loaded = true; setBusy(t, !!m.busy);
      if (t === cur && carryCard) render(t, carryCard);   /* what was said by voice, shown until the next message */
      if (t === cur) scrollDown(t.body, true);
      renderTabs();
    } else if (m.type === 'chat') {
      const ev = m.ev;
      if (ev.k === 'tabs') return syncTabs(ev.tabs || [], ev.focus);
      if (ev.k === 'commands') { commands = ev.list || []; return; }
      const t = ev.tab && T.get(ev.tab); if (!t || !t.loaded) return;   // its history reply will include it
      render(t, ev, false);
    } else if (m.type === 'gtd-transcript' && sub && m.iid === sub.iid) {
      subBody.innerHTML = ''; subTools.clear();
      (m.events || []).forEach(ev => renderSub(ev));
      scrollDown(subBody, true);
    } else if (m.type === 'gtd-transcript-add' && sub && m.iid === sub.iid) {
      renderSub(m.ev); scrollDown(subBody);
    }
  });

  /* ------------------------------------------------------------ managers */
  /* Petra's clones. Their start, questions, relays and reports show here as cards; a
     question can be answered by Luke straight from its card. */
  const mgrQs = new Map();
  function mgrCard(t, ev) {
    if (ev.kind === 'update') { add('mline', `<b>${esc(ev.title)}</b> · ${esc(ev.text)}`, t.body); return; }
    if (ev.kind === 'relay') { add('mline', `<b>${esc(ev.from)}</b> → <b>${esc(ev.to)}</b> · ${esc(ev.text)}`, t.body); return; }
    if (ev.kind === 'answered') {
      const c = mgrQs.get(ev.qid); if (!c) return;
      c.classList.add('done'); c.querySelectorAll('textarea,button').forEach(x => { x.disabled = true; });
      c.querySelector('.ans').textContent = ev.by === 'timeout' ? 'No answer in time; it carried on.' : `${ev.by}: ${ev.text}`;
      return;
    }
    const words = { started: 'MANAGER STARTED', question: 'MANAGER ASKS', finished: 'MANAGER FINISHED', failed: 'MANAGER FAILED' };
    const c = add('mgr ' + ev.kind, `<div class="mh"><span class="mk">${words[ev.kind] || 'MANAGER'}</span><b>${esc(ev.title)}</b>
        <button class="watch" data-id="${esc(ev.id)}">WATCH</button></div>
      <div class="mt">${ev.kind === 'finished' ? md(ev.text) : esc(ev.text)}</div>
      ${ev.kind === 'question' ? `<div class="qa"><textarea rows="1" placeholder="Answer it yourself, or leave it to Petra"></textarea><button class="go">ANSWER</button></div><div class="ans"></div>` : ''}`, t.body);
    c.querySelector('.watch').addEventListener('click', () => openSub(ev.id));
    if (ev.kind === 'finished' || ev.kind === 'started') c.querySelector('.mt').addEventListener('click', () => c.classList.toggle('open'));
    if (ev.kind === 'question') {
      mgrQs.set(ev.qid, c);
      const ta = c.querySelector('textarea');
      ta.addEventListener('input', () => autosize(ta));
      const go = () => { const v = ta.value.trim(); if (v) send({ type: 'mgr-reply', qid: ev.qid, text: v }); };
      c.querySelector('.go').addEventListener('click', go);
      ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    }
  }

  function withCarry(t) {
    if (!pendingCarry) return t;
    const c = pendingCarry; pendingCarry = null;
    return `(Just before this, by voice in the small caption: Luke said "${c.you}"${c.petra ? ` and you answered "${c.petra}"` : ''}. Carry on from there.)\n\n` + t;
  }

  /* ------------------------------------------------------------ voice */
  /* Voice on: talk to Petra here and hear her. Each utterance goes to this chat (marked so
     she leads with a spoken sentence or two); her reply is read aloud up to the first
     list, table or code, or four sentences, and the full answer stays on screen. When she
     has finished speaking the microphone opens again; say nothing and it closes until the
     next click. The little card's OPEN CHAT brings a voice conversation here. */
  let voiceOn = false, voiceTurn = false, spoken = '', spokenCount = 0, speechCut = false, listening = false, voiceTab = null;
  const vstate = $('.ch-vstate', pane);
  function setVState(t) { vstate.textContent = t ? t + ' · ' : ''; pane.classList.toggle('vlisten', t === 'LISTENING'); }
  function setVoice(on) {
    voiceOn = on;
    try { localStorage.setItem('os-chat-voice', on ? '1' : '0'); } catch {}
    pane.classList.toggle('voice', on);
    if (!on) { J() && J().stopListen(); J() && J().stopVoice(); listening = false; setVState(''); return; }
    if (!busy()) listenNow();
  }
  function listenNow() {
    if (!voiceOn || !J()) return;
    listening = true; setVState('LISTENING');
    J().listen((text, err) => {
      listening = false;
      if (!voiceOn) return setVState('');
      if (err) { setVState(String(err).toUpperCase()); return; }
      if (!text) { setVState('TAP THE MIC TO TALK'); return; }
      setVState('THINKING');
      voiceTurn = true; spoken = ''; spokenCount = 0; speechCut = false; voiceTab = cur;
      carryCard = null;
      send({ type: 'chat-send', tab: cur.id, text: withCarry('(Voice) ' + text), display: text, voice: true, images: takeAtts() });
    });
  }
  const plain = t => String(t).replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim();
  function speakDelta(t) {
    if (!voiceOn || !voiceTurn || speechCut) return;
    spoken += t;
    if (/\n\s*([-*|]|\d+\.|```)/.test(spoken)) { flushSpeech(true); speechCut = true; return; }
    let m;
    while (!speechCut && (m = spoken.match(/^([\s\S]*?[.!?])(\s+)/))) {
      const sent = plain(m[1]); spoken = spoken.slice(m[0].length);
      if (sent) { J().say(sent); setVState('SPEAKING'); if (++spokenCount >= 4) speechCut = true; }
    }
  }
  function flushSpeech(cutAtStructure) {
    const head = cutAtStructure ? spoken.split(/\n\s*([-*|]|\d+\.|```)/)[0] : spoken;
    const t = plain(head); spoken = '';
    if (t && spokenCount < 4) { J().say(t); spokenCount++; setVState('SPEAKING'); }
  }
  function speakFinal() { if (voiceOn && voiceTurn && !speechCut) { flushSpeech(false); speechCut = true; } }
  function voiceAfterTurn() {
    if (!voiceTurn) return;
    voiceTurn = false;
    if (!voiceOn) return;
    /* wait for her to stop talking, then listen again */
    const t0 = Date.now();
    (function wait() {
      if (!voiceOn || (voiceTab && voiceTab.busy)) return;
      if (J() && J().speaking && Date.now() - t0 < 120000) return setTimeout(wait, 250);
      setTimeout(listenNow, 350);
    })();
  }

  /* ------------------------------------------------------------ history */
  /* Every chat with Petra, newest first: open one to read it, CONTINUE THIS CHAT to pick it
     back up (Claude Code resumes that session, so Petra remembers it). The bridge keeps
     each chat as shown here, and rebuilds older ones from Claude Code's own transcripts. */
  const hist = $('.ch-hist', pane), histList = $('.hl', hist), histView = $('.hv', hist), histBody = $('.hvb', hist), histSearch = $('.hs', hist);
  let sessions = [], viewing = null;
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago'
      : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  function openHistory() {
    hist.classList.add('show'); hist.classList.remove('viewing'); viewing = null;
    histList.innerHTML = '<div class="m meta">Loading your chats…</div>';
    send({ type: 'chat-sessions' });
    setTimeout(() => histSearch.focus({ preventScroll: true }), 60);
  }
  function closeHistory() { hist.classList.remove('show', 'viewing'); viewing = null; histBody.innerHTML = ''; }
  function renderSessions() {
    const q = histSearch.value.trim().toLowerCase();
    const list = sessions.filter(x => !q || (x.title + ' ' + x.preview).toLowerCase().includes(q));
    histList.innerHTML = list.length ? list.map(x => `<button class="hi${x.current ? ' cur' : ''}" data-id="${esc(x.id)}">
        <b>${esc(x.title)}</b>${x.current ? '<em>OPEN</em>' : ''}
        <span>${esc(x.preview)}</span><i>${esc(ago(x.updated))} · ${x.count} message${x.count === 1 ? '' : 's'}</i></button>`).join('')
      : `<div class="m meta">${sessions.length ? 'No chat matches that.' : 'No chats yet.'}</div>`;
  }
  histSearch.addEventListener('input', renderSessions);
  histList.addEventListener('click', e => {
    const b = e.target.closest('.hi'); if (!b) return;
    const x = sessions.find(s2 => s2.id === b.dataset.id); if (!x) return;
    if (x.current && x.tab) { closeHistory(); return showTab(x.tab); }
    viewing = x;
    $('.ht', hist).textContent = x.title;
    hist.classList.add('viewing');
    histBody.innerHTML = '<div class="m meta">Loading…</div>';
    send({ type: 'chat-session-get', id: x.id });
  });
  $('.hb', hist).addEventListener('click', () => { hist.classList.remove('viewing'); viewing = null; });
  $('.hx', hist).addEventListener('click', closeHistory);
  $('.hc', hist).addEventListener('click', () => { if (!viewing) return; send({ type: 'chat-open-session', id: viewing.id }); closeHistory(); input.focus({ preventScroll: true }); });
  hist.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); viewing ? $('.hb', hist).click() : closeHistory(); } });
  /* draw a past chat with the same renderer, into the history view, read only */
  function renderInto(el, events) {
    const t = { id: 'view', body: el, live: null, liveText: '', liveTimer: null, tools: new Map(), perms: new Map(), busy: false, info: {}, mode: 'auto', loaded: true };
    el.innerHTML = '';
    for (const ev of events) if (!['delta', 'thinking', 'status', 'info', 'commands', 'reset', 'reload', 'tabs'].includes(ev.k)) render(t, ev, true);
    if (t.live) { flushLive(t); t.live.classList.remove('live'); }
    if (!events.length) el.innerHTML = '<div class="m meta">Nothing to show for this chat.</div>';
  }
  addEventListener('gtd-bridge', e => {
    const m = e.detail;
    if (m.type === 'chat-sessions') { sessions = m.list || []; renderSessions(); }
    else if (m.type === 'chat-session' && viewing && m.id === viewing.id) { renderInto(histBody, m.log || []); histBody.scrollTop = histBody.scrollHeight; }
  });

  /* ------------------------------------------------------------ photos */
  /* Paste one or more photos, or drag them onto the chat. Each is scaled so its long side
     is at most 2000 px (what Claude reads best) and kept under 4.5 MB, shown as a
     thumbnail you can remove, and sent with the next message. The bridge also saves them
     to .gtd-jobs/chat-images/ so managers and subagents can open them. */
  const MAX_ATTS = 20, MAX_SIDE = 2000, MAX_BYTES = 4.5 * 1024 * 1024;
  const OK_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  let atts = [];
  const attsEl = $('.ch-atts', pane);
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const toBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));
  async function prepare(file) {
    const bmp = await createImageBitmap(file);
    const long = Math.max(bmp.width, bmp.height);
    let blob = file, type = file.type;
    if (!OK_TYPES.includes(type) || long > MAX_SIDE || file.size > MAX_BYTES) {
      const k = Math.min(1, MAX_SIDE / long);
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      blob = await toBlob(cv, type, .9);
      if (blob.size > MAX_BYTES) { type = 'image/jpeg'; blob = await toBlob(cv, type, .82); }
    }
    const tk = Math.min(1, 180 / long);
    const tc = document.createElement('canvas'); tc.width = Math.max(1, Math.round(bmp.width * tk)); tc.height = Math.max(1, Math.round(bmp.height * tk));
    tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height);
    const thumb = tc.toDataURL('image/jpeg', .72);
    return { type, data: await b64(blob), thumb, name: file.name || 'pasted image' };
  }
  async function addFiles(list) {
    const files = [...list].filter(f => f && /^image\//.test(f.type));
    if (!files.length) return false;
    const room = MAX_ATTS - atts.length;
    if (room <= 0) { flashAtts(`Up to ${MAX_ATTS} photos per message`); return true; }
    attsEl.classList.add('busy');
    for (const f of files.slice(0, room)) {
      try { atts.push(await prepare(f)); } catch { flashAtts(`Could not read ${f.name || 'that image'}`); }
      renderAtts();
    }
    if (files.length > room) flashAtts(`Only the first ${room} added: ${MAX_ATTS} per message`);
    attsEl.classList.remove('busy');
    input.focus({ preventScroll: true }); syncSend();
    return true;
  }
  function renderAtts() {
    attsEl.innerHTML = atts.map((a, i) => `<span class="att"><img src="${a.thumb}" alt=""><button data-i="${i}" title="Remove">✕</button></span>`).join('')
      + (atts.length ? `<em>${atts.length} photo${atts.length > 1 ? 's' : ''}</em>` : '');
    pane.classList.toggle('hasAtts', atts.length > 0);
  }
  function flashAtts(t) { const n = document.createElement('div'); n.className = 'att-note'; n.textContent = t; attsEl.after(n); setTimeout(() => n.remove(), 3500); }
  function takeAtts() { const out = atts.map(a => ({ type: a.type, data: a.data, thumb: a.thumb, name: a.name })); atts = []; renderAtts(); return out; }
  attsEl.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; atts.splice(+b.dataset.i, 1); renderAtts(); syncSend(); });
  input.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;             // plain text pastes as usual
    e.preventDefault(); addFiles(files);
  });
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  pane.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; pane.classList.add('dropping'); });
  pane.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  pane.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; pane.classList.remove('dropping'); } });
  pane.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; pane.classList.remove('dropping');
    if (sub) closeSub();
    if (!(await addFiles(e.dataTransfer.files))) flashAtts('Only photos can be added here');
  });

  /* ------------------------------------------------------------ input */
  /* the box grows with the message, up to 8 lines; only past that does it scroll */
  const MAX_LINES = 8;
  function autosize(el = input) {
    const cs = getComputedStyle(el), line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = Math.round(line * MAX_LINES + pad);
    el.style.height = 'auto';
    const want = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = Math.min(max, want) + 'px';
    el.style.overflowY = want > max ? 'auto' : 'hidden';
    syncSend();
  }
  function submit() {
    const v = input.value.trim();
    if (!v && !atts.length) return;
    if (!J() || !J().online) { add('err', 'The bridge is offline (port 8790), so Petra cannot answer.'); return; }
    if (!cur) return;
    input.value = ''; autosize(); hidePalette();
    carryCard = null;
    const images = takeAtts();
    send({ type: 'chat-send', tab: cur.id, text: withCarry(v), display: v, images });
  }
  sendBtn.addEventListener('click', () => busy() && !input.value.trim() && !atts.length ? send({ type: 'chat-stop', tab: cur.id }) : submit());
  let palIdx = 0, palList = [];
  function showPalette() {
    const v = input.value;
    if (!v.startsWith('/') || /\s/.test(v)) return hidePalette();
    if (!commands.length) { palette.innerHTML = '<div class="ph2">LOADING COMMANDS…</div>'; palette.classList.add('show'); if (cur) send({ type: 'chat-history', tab: cur.id }); return; }
    const q = v.slice(1).toLowerCase();
    palList = commands.filter(c => !q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
    if (!palList.length) return hidePalette();
    palIdx = Math.min(palIdx, palList.length - 1);
    palette.innerHTML = `<div class="ph2">${palList.length} COMMAND${palList.length === 1 ? '' : 'S'}${q ? '' : ' · built-in, yours and your skills'} · ↑↓ TAB</div>` + palList.map((c, i) => `<div class="pi${i === palIdx ? ' on' : ''}" data-i="${i}"><b>/${esc(c.name)}</b> ${c.hint ? `<i>${esc(c.hint)}</i>` : ''}<span>${esc(c.description || '')}</span></div>`).join('');
    palette.classList.add('show');
    const on = palette.querySelector('.pi.on');      /* scroll the list only, never the page */
    if (on) {
      const t = on.offsetTop, b = t + on.offsetHeight;
      if (t < palette.scrollTop + 28) palette.scrollTop = t - 28;
      else if (b > palette.scrollTop + palette.clientHeight) palette.scrollTop = b - palette.clientHeight + 6;
    }
  }
  function hidePalette() { palette.classList.remove('show'); palList = []; palIdx = 0; }
  function pickPalette(i) { const c = palList[i]; if (!c) return; input.value = '/' + c.name + ' '; hidePalette(); input.focus({ preventScroll: true }); autosize(); }
  palette.addEventListener('mousedown', e => { const d = e.target.closest('.pi'); if (d) { e.preventDefault(); pickPalette(+d.dataset.i); } });
  input.addEventListener('input', () => { autosize(); showPalette(); });
  autosize();
  input.addEventListener('keydown', e => {
    if (palList.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); palIdx = (palIdx + (e.key === 'ArrowDown' ? 1 : -1) + palList.length) % palList.length; showPalette(); return; }
    if (palList.length && e.key === 'Tab') { e.preventDefault(); pickPalette(palIdx); return; }
    if (e.key === 'Escape') { if (palList.length) hidePalette(); else if (busy()) send({ type: 'chat-stop', tab: cur.id }); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (palList.length && input.value.trim() === '/' + (palList[palIdx]?.name || '')) { hidePalette(); } submit(); }
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey) { e.preventDefault(); cycleMode(); }
  });
  /* ctrl+tab / ctrl+shift+tab step through the tabs */
  pane.addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.key === 'Tab') || order.length < 2 || !cur) return;
    e.preventDefault();
    const i = order.indexOf(cur.id);
    showTab(order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length]);
  });
  function cycleMode() { if (!cur) return; const m = MODES[(MODES.indexOf(cur.mode) + 1) % MODES.length]; send({ type: 'chat-mode', tab: cur.id, mode: m }); setInfo(cur, { permissionMode: m }); }
  $('.ch-mode', pane).addEventListener('click', cycleMode);
  $('.ch-main', pane).addEventListener('click', e => {
    const b = e.target.closest('.ch-ic'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') setOpen(false);
    else if (a === 'history') openHistory();
    else if (a === 'new') send({ type: 'chat-new-tab' });
    else if (a === 'term') window.goTab && window.goTab('term');
    else if (a === 'full') setFull(!full);
    else if (a === 'voice') setVoice(!voiceOn);
  });

  /* ------------------------------------------------------------ subagents */
  let activity = { instances: [] };
  const fmtAge = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0'); };
  function renderChips() {
    const list = (activity.instances || []).slice();   /* GTD 22 Oct 2026: show every manager and agent, finished ones too */
    list.sort((a, b) => ((b.status === 'running') - (a.status === 'running')) || (b.created - a.created));
    pane.classList.toggle('hasSubs', list.length > 0);
    $('.ch-lbl', pane).textContent = `MANAGERS & AGENTS · ${list.filter(i => i.status === 'running').length} WORKING · ${list.filter(i => i.status === 'queued').length} QUEUED · ${list.filter(i => i.status === 'done' || i.status === 'failed').length} DONE`;
    // a team's copies sit in one chip for its lead, where the first of them would have been
    const T = window.osTeams, items = [], teams = new Map();
    for (const i of list) {
      const lead = T && (T.leadOf(i.agent) || (T.isLead(i.agent) ? i.agent : null));
      if (!lead) { items.push(i); continue; }
      if (!teams.has(lead)) { teams.set(lead, []); items.push({ lead }); }
      teams.get(lead).push(i);
    }
    const had = document.activeElement && chips.contains(document.activeElement) ? document.activeElement.dataset : null;
    chips.innerHTML = items.map(i => i.lead ? teamChip(i.lead, teams.get(i.lead)) : `<button class="chip2 ${esc(i.status)}${sub && sub.iid === i.iid ? ' sel' : ''}" data-iid="${esc(i.iid)}" title="${esc(i.label || '')}">
        <i style="background:${esc(i.color || '#7DA0FF')}"></i><b>${esc(i.name)}</b>${i.label && i.label !== i.name ? `<span>${esc(i.label.slice(0, 46))}</span>` : ''}
        <em>${i.status === 'running' ? fmtAge(Date.now() - (i.started || i.created)) : i.status === 'queued' ? 'queued' : i.status === 'done' ? '✓' : '✕'}</em></button>`).join('');
    // the strip redraws every second: keep keyboard focus on the same chip
    if (had) chips.querySelector(had.lead ? `[data-lead="${CSS.escape(had.lead)}"]` : `[data-iid="${CSS.escape(had.iid || '')}"]`)?.focus({ preventScroll: true });
    if (sub) updateSubHead();
  }
  function teamChip(lead, insts) {
    const T = window.osTeams;
    const a = (activity.agents || []).find(x => x.id === lead) || { id: lead, name: lead };
    const working = insts.filter(i => i.status === 'running'), queued = insts.filter(i => i.status === 'queued');
    const st = working.length ? 'running' : queued.length ? 'queued' : insts.some(i => i.status === 'done') ? 'done' : 'failed';
    const now = working[0] || queued[0];
    const sel = sub && insts.some(i => i.iid === sub.iid);
    return `<button class="chip2 team ${st}${sel ? ' sel' : ''}" data-lead="${esc(lead)}" style="--team:${esc(T.color(a))}" aria-haspopup="dialog" aria-expanded="${T.popOpen() === lead}"
        title="${esc(T.display(a))}: ${working.length} working${queued.length ? `, ${queued.length} queued` : ''}">
        <i></i><b>${esc(T.display(a))}</b>${now ? `<span>${esc(now.name)}${now.label ? ' · ' + esc(now.label.slice(0, 30)) : ''}</span>` : ''}
        ${working.length ? `<em class="tc">${working.length}</em>` : queued.length ? `<em class="tc q">${queued.length}</em>` : `<em>${st === 'failed' ? '✕' : '✓'}</em>`}</button>`;
  }
  /* a team chip: its members in the popover; a member opens its newest copy's chat */
  function openTeam(b, opts = {}) {
    const T = window.osTeams; if (!T) return;
    T.openPop(b.dataset.lead, b.getBoundingClientRect(), { anchor: chips, returnFocus: b, ...opts, onOpen: m => {
      const live = (activity.instances || []).filter(i => i.agent === m.id).sort((x, y) => ((y.status === 'running') - (x.status === 'running')) || (y.created - x.created))[0];
      if (live) openSub(live.iid); else T.openAgent(m);
    } });
  }
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip2'); if (!b) return;
    if (b.dataset.lead) { const T = window.osTeams; if (T.popOpen() === b.dataset.lead && T.pinned()) T.closePop(); else openTeam(b, { pinned: true }); return; }
    window.osTeams && window.osTeams.closePop();
    openSub(b.dataset.iid);
  });
  chips.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || !window.osTeams) return;
    const b = e.target.closest('.chip2.team');
    if (!b) return window.osTeams.hoverOut();
    if (window.osTeams.popOpen() === b.dataset.lead) window.osTeams.hoverIn(); else openTeam(b);
  });
  chips.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && window.osTeams) window.osTeams.hoverOut(); });
  chips.addEventListener('focusin', e => { const b = e.target.closest('.chip2.team'); if (b && window.osTeams && !window.osTeams.returning() && window.osTeams.popOpen() !== b.dataset.lead) openTeam(b); });
  chips.addEventListener('focusout', () => setTimeout(() => {
    const T = window.osTeams, p = document.getElementById('agTeamPop');
    if (T && T.popOpen() && !T.pinned() && !chips.contains(document.activeElement) && !(p && p.contains(document.activeElement))) T.closePop();
  }, 0));
  // the pane keeps its clicks and keys to itself, so close a pinned team here
  pane.addEventListener('pointerdown', e => { if (window.osTeams && window.osTeams.popOpen() && !chips.contains(e.target)) window.osTeams.closePop(); }, true);
  chips.addEventListener('keydown', e => {
    if (e.key === 'Escape' && window.osTeams && window.osTeams.popOpen()) { window.osTeams.closePop(); return; }
    const b = e.target.closest('.chip2.team');
    if (b && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTeam(b, { keyboard: true, pinned: true }); }
  });
  addEventListener('os-teams', () => renderChips());
  addEventListener('gtd-activity', e => { activity = e.detail || activity; renderChips(); });
  setInterval(() => { if (open) renderChips(); }, 1000);

  let sub = null;
  const subTools = new Map();
  const instOf = iid => (activity.instances || []).find(i => i.iid === iid);
  function updateSubHead() {
    const i = instOf(sub.iid) || sub.inst || {};
    $('.ch-dot', pane).style.background = i.color || '#7DA0FF';
    $('.ch-agent', pane).textContent = i.name || 'Subagent';
    $('.ch-state', pane).textContent = i.status === 'running' ? 'WORKING · ' + fmtAge(Date.now() - (i.started || i.created)) : (i.status || '').toUpperCase();
    $('.ch-task', pane).textContent = i.label || '';
  }
  function openSub(iid) {
    if (full) setFull(false);           /* its floating Second Brain sits on the board */
    if (!open) setOpen(true);
    const inst = instOf(iid);
    sub = { iid, inst };
    pane.classList.add('sub'); document.body.classList.add('chatsub');
    pane.classList.toggle('submgr', /^mgr\d+$/.test(iid));
    subBody.innerHTML = '<div class="m meta">Loading what it has done so far…</div>'; subTools.clear();
    updateSubHead(); renderChips();
    send({ type: 'gtd-transcript-get', iid });
    if (window.osBrainFloat) window.osBrainFloat(inst ? inst.agent : iid, inst ? inst.name : 'Subagent');
  }
  function closeSub() {
    if (!sub) return;
    sub = null; pane.classList.remove('sub'); document.body.classList.remove('chatsub');
    window.osBrainFloat && window.osBrainFloat(null);
    renderChips();
  }
  $('.ch-back', pane).addEventListener('click', closeSub);
  document.querySelector('#brainFloatRim button')?.addEventListener('click', closeSub);
  function renderSub(ev) {
    if (subBody.firstChild && subBody.firstChild.classList?.contains('meta') && subBody.children.length === 1) subBody.innerHTML = '';
    if (ev.k === 'prompt') add('brief', `<div class="bl">BRIEF</div>${md(ev.text)}`, subBody);
    else if (ev.k === 'text') add('asst', md(ev.text), subBody);
    else if (ev.k === 'tool') subTools.set(ev.id, toolRow({ ...ev, sub: /^(Agent|Task)/.test(ev.name) }, subBody));
    else if (ev.k === 'result') resultInto(subTools.get(ev.id), ev);
    else if (ev.k === 'note') add('mline', esc(ev.text), subBody);
  }
  const subIn = $('.ch-subfoot textarea', pane);
  subIn.addEventListener('input', () => autosize(subIn));
  const subSend = () => { const v = subIn.value.trim(); if (!v || !sub) return; send({ type: 'mgr-message', id: sub.iid, text: v }); subIn.value = ''; autosize(subIn); };
  $('.ch-subsend', pane).addEventListener('click', subSend);
  subIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); subSend(); } });
  $('.ch-substop', pane).addEventListener('click', () => { if (sub && confirm('Stop this manager?')) send({ type: 'mgr-stop', id: sub.iid }); });

  /* ------------------------------------------------------------ API */
  window.osChat = {
    full: on => setFull(on == null ? !full : !!on), isFull: () => full,
    open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!open),
    isOpen: () => open, focus: () => { setOpen(true); input.focus({ preventScroll: true }); },
    send: text => { setOpen(true); input.value = text; submit(); },
    /* type a message for Luke to finish and send (a team member's CALL) */
    draft: text => { if (sub) closeSub(); setOpen(true); input.value = text; autosize(input); input.focus({ preventScroll: true }); input.setSelectionRange(text.length, text.length); },
    openSub, closeSub,
    newTab: () => { setOpen(true); send({ type: 'chat-new-tab' }); },
    /* the little voice card's OPEN CHAT: bring what was just said, and keep talking here */
    openFromVoice(carry) {
      setOpen(true);
      if (carry && (carry.you || carry.petra)) { carryCard = { k: 'carry', you: carry.you, petra: carry.petra }; if (cur && cur.loaded) render(cur, carryCard); }
      if (carry && carry.you) pendingCarry = carry;
      setVoice(true);
    },
  };
  let pendingCarry = null, carryCard = null;
  // the layout survives a reload, so the chat does too
  try { if (localStorage.getItem('os-chat-on') === '1') { open = false; setTimeout(() => setOpen(true), 0); } } catch {}
  /* full screen comes back after a reload, once the tabs are known */
  try {
    if (localStorage.getItem('os-chat-full') === '1') {
      const wait = setInterval(() => { if (open && T.size && cur) { clearInterval(wait); setFull(true); } }, 200);
      setTimeout(() => clearInterval(wait), 15000);
    }
  } catch {}
  addEventListener('keydown', e => { if (e.key === 'Escape' && sub && !pane.contains(document.activeElement)) closeSub(); });
})();
