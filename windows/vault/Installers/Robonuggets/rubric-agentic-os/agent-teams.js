/* Agent teams for the Agentic OS (GTD, 29 Oct 2026).

   Luke: the brand agents get a lead. Every Blueprint agent sits under the BP Creative
   Director and every Alpha Carrier agent under the AC Creative Director; the lead is one
   entry, and hovering it shows the rest of the team.

   Team fields live in each agent's frontmatter in Agents/<id>.md:
     team: blueprint | alpha-carrier    the team it belongs to
     team_role: lead | member           (role: lead|member also works; role usually holds
                                        the Team-tab line, so only those two words count)
     lead: <director id>                a member's lead
   The bridge's activity snapshot carries only id, name, colour and department, so this
   reads the fields itself from /vault/Agents/<id>.md (server.js serves the vault) and
   uses them from the snapshot instead whenever the bridge starts sending them.
   Agents with no team are untouched.

   window.osTeams:
     info(id)            {team, teamRole, lead, label, description, color} or null
     leadOf(id)          the lead id of a member, or null
     isFolded(id)        a member whose lead exists: shown inside the lead, not on its own
     members(leadId)     the lead's members, as agents
     display(agent)      "BP · Creative Director" for a lead, else the agent's own name
     color(agent)        the team's brand colour for a lead, else the agent's colour
     statusOf(id, inst)  'working' | 'queued' | 'idle', from the live instances
     openPop(leadId, rect, opts) / closePop() / popOpen()   the member popover
   constellation.js (the ring) and chat.js (the MANAGERS & AGENTS chips) use it. */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* a team's short mark and brand accent on the navy OS: Blueprint's Bright Blue (its
     accent on navy) and Alpha Carrier's classic red. team_color in a lead's frontmatter
     overrides it. */
  const TEAMS = {
    'blueprint': { abbr: 'BP', name: 'Blueprint', color: '#1A8CF6' },
    'alpha-carrier': { abbr: 'AC', name: 'Alpha Carrier', color: '#E10600' },
  };
  const teamMeta = t => TEAMS[t] || { abbr: String(t).split(/[-_\s]+/).map(w => w[0] || '').join('').toUpperCase(), name: String(t).split(/[-_]/).map(w => w && w[0].toUpperCase() + w.slice(1)).join(' '), color: '' };

  function frontmatter(text) {
    const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const out = {};
    if (!m) return out;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  }
  const norm = v => String(v || '').trim().toLowerCase();
  const teamRole = fm => {
    const r = norm(fm.team_role || fm.teamRole);
    if (r === 'lead' || r === 'member') return r;
    const r2 = norm(fm.role);
    return r2 === 'lead' || r2 === 'member' ? r2 : '';
  };
  const firstSentence = s => { const t = String(s || '').trim(); const m = t.match(/^(.+?[.!?])(\s|$)/); return m ? m[1] : t; };

  /* ------------------------------------------------------------ data */
  const cache = new Map();       // id -> info (null when the agent has no team)
  const fetched = new Map();     // id -> time of the last fetch
  let agents = [];               // the snapshot's agents
  let instances = [];            // the snapshot's live copies
  const REFETCH = 60_000;

  function fromSnapshot(a) {
    if (!a || !(a.team || a.lead || a.team_role || a.teamRole)) return null;
    return { team: norm(a.team), teamRole: teamRole(a), lead: norm(a.lead), label: a.name, description: a.description || '', color: a.color, teamColor: a.team_color || a.teamColor || '' };
  }
  async function load(id) {
    fetched.set(id, Date.now());
    try {
      const r = await fetch('/vault/Agents/' + encodeURIComponent(id) + '.md', { cache: 'no-store' });
      if (!r.ok) return;
      const fm = frontmatter(await r.text());
      const info = fm.team || fm.lead || teamRole(fm) ? {
        team: norm(fm.team), teamRole: teamRole(fm), lead: norm(fm.lead), label: fm.label || '',
        description: fm.description || '', color: fm.ui_color || '', teamColor: fm.team_color || '',
      } : null;
      const before = JSON.stringify(cache.get(id) ?? null);
      cache.set(id, info);
      if (JSON.stringify(info) !== before) changed();
    } catch {}
  }
  let changeTimer = null;
  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { dispatchEvent(new CustomEvent('os-teams')); if (pop.lead) renderPop(); }, 60);
  }
  addEventListener('gtd-activity', e => {
    const d = e.detail || {};
    agents = d.agents || agents;
    instances = d.instances || instances;
    const now = Date.now();
    for (const a of agents) {
      const s = fromSnapshot(a);
      if (s) { cache.set(a.id, s); continue; }
      if (!fetched.has(a.id) || now - fetched.get(a.id) > REFETCH) load(a.id);
    }
    if (pop.lead) renderPop();
  });

  const agentOf = id => agents.find(a => a.id === id);
  function info(id) { return cache.get(id) || null; }
  /* a team's lead: the agent marked lead, else the id members name as lead */
  function leadOfTeam(team) {
    if (!team) return null;
    const lead = agents.find(a => { const i = info(a.id); return i && i.team === team && i.teamRole === 'lead'; });
    if (lead) return lead.id;
    const named = agents.map(a => info(a.id)).find(i => i && i.team === team && i.lead && agentOf(i.lead));
    return named ? named.lead : null;
  }
  function leadOf(id) {
    const i = info(id);
    if (!i || i.teamRole === 'lead') return null;
    if (i.lead && agentOf(i.lead) && i.lead !== id) return i.lead;
    const l = leadOfTeam(i.team);
    return l && l !== id ? l : null;
  }
  const isLead = id => agents.some(a => a.id !== id && leadOf(a.id) === id);
  const isFolded = id => !!leadOf(id);
  const members = leadId => agents.filter(a => a.id !== leadId && leadOf(a.id) === leadId);
  function teamKeyOf(id) { const i = info(id); return i && i.team ? i.team : (isLead(id) ? id : ''); }
  function display(a) {
    if (!a || !isLead(a.id)) return a ? a.name : '';
    const t = teamMeta(teamKeyOf(a.id));
    let n = String(info(a.id)?.label || a.name || '');
    // "Blueprint Creative Director" -> "Creative Director"; "BP Creative Director" too
    for (const p of [t.name, t.abbr]) if (p && n.toLowerCase().startsWith(p.toLowerCase() + ' ')) n = n.slice(p.length + 1);
    n = n.replace(/^[-–·:\s]+/, '');
    return `${t.abbr} · ${n}`;
  }
  function color(a) {
    if (!a) return '#7DA0FF';
    if (!isLead(a.id)) return a.color || '#7DA0FF';
    return info(a.id)?.teamColor || teamMeta(teamKeyOf(a.id)).color || a.color || '#7DA0FF';
  }
  function statusOf(id, inst) {
    const mine = (inst || instances).filter(i => i.agent === id);
    if (mine.some(i => i.status === 'running')) return 'working';
    if (mine.some(i => i.status === 'queued')) return 'queued';
    return 'idle';
  }
  /* how many of a lead's team (the lead too) are working or queued */
  function activity(leadId, inst) {
    const ids = [leadId, ...members(leadId).map(m => m.id)];
    let working = 0, queued = 0;
    for (const id of ids) { const s = statusOf(id, inst); if (s === 'working') working++; else if (s === 'queued') queued++; }
    return { working, queued };
  }

  /* ------------------------------------------------------------ popover */
  const el = document.createElement('div');
  el.id = 'agTeamPop';
  el.setAttribute('role', 'dialog');
  document.body.appendChild(el);
  const pop = { lead: null, rect: null, opts: {}, hideT: null };
  /* focus going back to the anchor after a close must not open the popover again */
  let returning = false;
  const giveBack = el2 => { if (!el2 || !el2.focus) return; returning = true; try { el2.focus({ preventScroll: true }); } finally { returning = false; } };

  /* inside its team a member needs no team name: "Blueprint Page Builder" -> "Page Builder" */
  function shortName(a, team) {
    const t = teamMeta(team), n = String(a.name || a.id);
    for (const p of [t.name, t.abbr]) if (p && n.toLowerCase().startsWith(p.toLowerCase() + ' ')) return n.slice(p.length + 1);
    return n;
  }
  function rowHtml(a, k) {
    const st = statusOf(a.id);
    const team = teamKeyOf(pop.lead);
    const n = instances.filter(i => i.agent === a.id && (i.status === 'running' || i.status === 'queued')).length;
    const desc = firstSentence(info(a.id)?.description || a.description || '');
    return `<div class="tp-row ${st}" data-id="${esc(a.id)}">
      <button class="tp-open" data-i="${k}" title="Open ${esc(a.name)}"><i></i>
        <span class="tp-t"><b>${esc(shortName(a, team))}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</span>
        <em class="tp-st">${st === 'working' ? (n > 1 ? n + ' working' : 'working') : st}</em></button>
      <button class="tp-call" title="Ask Petra to queue ${esc(a.name)}">CALL</button></div>`;
  }
  function renderPop() {
    const lead = agentOf(pop.lead);
    if (!lead) return closePop();
    const ms = members(pop.lead);
    const act = activity(pop.lead);
    const c = color(lead);
    el.style.setProperty('--team', c);
    el.innerHTML = `<div class="tp-h"><i></i><b>${esc(display(lead))}</b><span>${ms.length} agent${ms.length === 1 ? '' : 's'}${act.working ? ` · ${act.working} working` : ''}${act.queued ? ` · ${act.queued} queued` : ''}</span></div>`
      + `<div class="tp-list">${[lead, ...ms].map(rowHtml).join('')}</div>`;
    el.querySelector('.tp-row').classList.add('lead');
    place();
  }
  function place() {
    const r = pop.rect; if (!r) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 10, pad = 12;
    let x = r.left + r.width / 2 - w / 2;
    let y = pop.opts.above ? r.top - h - gap : r.bottom + gap;
    if (y + h > innerHeight - pad) y = r.top - h - gap;
    if (y < pad) y = Math.min(innerHeight - h - pad, r.bottom + gap);
    x = Math.max(pad, Math.min(innerWidth - w - pad, x));
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(Math.max(pad, y)) + 'px';
  }
  /* rect: the anchor's DOMRect (or {left,top,width,height}). opts.onOpen(agent) runs when a
     member is clicked, opts.keyboard focuses the first row, opts.pinned keeps it open
     until a click elsewhere or Escape. */
  function openPop(leadId, rect, opts = {}) {
    clearTimeout(pop.hideT);
    const same = pop.lead === leadId && el.classList.contains('show');
    pop.lead = leadId; pop.opts = { ...(same ? pop.opts : {}), ...opts };
    pop.rect = { left: rect.left, top: rect.top, width: rect.width || 0, height: rect.height || 0, bottom: rect.top + (rect.height || 0) };
    renderPop();
    el.classList.add('show');
    if (opts.keyboard) el.querySelector('.tp-open')?.focus({ preventScroll: true });
  }
  function closePop() {
    clearTimeout(pop.hideT);
    if (!pop.lead) return;
    const back = pop.opts.returnFocus;
    const had = el.contains(document.activeElement);
    pop.lead = null; pop.opts = {};
    el.classList.remove('show');
    if (had) giveBack(back);
  }
  /* hover hand-off: leaving the anchor gives the pointer a moment to reach the popover */
  function hoverOut() { if (pop.opts.pinned) return; clearTimeout(pop.hideT); pop.hideT = setTimeout(closePop, 220); }
  function hoverIn() { clearTimeout(pop.hideT); }
  el.addEventListener('pointerenter', hoverIn);
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hoverOut(); });
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', e => {
    const row = e.target.closest('.tp-row'); if (!row) return;
    const a = agentOf(row.dataset.id); if (!a) return;
    const opts = pop.opts;
    if (e.target.closest('.tp-call')) { closePop(); call(a); return; }
    closePop();
    if (opts.onOpen) opts.onOpen(a); else openAgent(a);
  });
  el.addEventListener('keydown', e => {
    const btns = [...el.querySelectorAll('button')];
    const k = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const back = pop.opts.returnFocus; closePop(); giveBack(back); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...el.querySelectorAll('.tp-open')];
      const r = rows.indexOf(document.activeElement.closest('.tp-row')?.querySelector('.tp-open'));
      rows[(r + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    } else if (e.key === 'Tab' && k >= 0 && ((!e.shiftKey && k === btns.length - 1) || (e.shiftKey && k === 0))) {
      // leave the popover the way you came in
      e.preventDefault(); const back = pop.opts.returnFocus; closePop(); giveBack(back);
    }
  });
  addEventListener('pointerdown', e => { if (pop.lead && !el.contains(e.target) && !(pop.opts.anchor && pop.opts.anchor.contains && pop.opts.anchor.contains(e.target))) closePop(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && pop.lead) { const back = pop.opts.returnFocus; const on = back && document.activeElement === back; closePop(); if (on) giveBack(back); } });
  addEventListener('resize', () => { if (pop.lead) closePop(); });

  /* a member's default action, as clicking it on the ring: its live chat if it is working
     and the chat is open, else the Second Brain on that agent */
  function openAgent(a) {
    const live = instances.filter(i => i.agent === a.id).sort((x, y) => ((y.status === 'running') - (x.status === 'running')) || (y.created - x.created))[0];
    if (live && window.osChat && window.osChat.isOpen()) return window.osChat.openSub(live.iid);
    if (window.osChat && window.osChat.isOpen() && window.osBrainFloat) return window.osBrainFloat(a.id, a.name);
    if (window.__constellation) window.__constellation.openFocus(a.id);
  }
  /* call it directly: Petra's chat opens with the request typed in, ready to finish and send */
  function call(a) {
    const text = `Queue ${a.name} (${a.id}): `;
    if (window.osChat && window.osChat.draft) window.osChat.draft(text);
    else if (window.osChat) { window.osChat.open(); }
  }

  /* CALL from the Rubric console (the CONSOLE tab's frame on :5050) arrives as a message */
  addEventListener('message', e => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):5050$/.test(e.origin) || !e.data || e.data.type !== 'rubric-console:call-agent') return;
    const id = String(e.data.id || '');
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return;
    const nm = typeof e.data.name === 'string' ? e.data.name.replace(/[^\w ·&'-]/g, '').slice(0, 60) : '';
    const a = agentOf(id) || { id, name: nm || id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') };
    if (window.goTab) window.goTab('os');
    call(a);
  });

  window.osTeams = {
    info, leadOf, isLead, isFolded, members, display, color, statusOf, activity,
    openPop, closePop, hoverIn, hoverOut, openAgent, call,
    popOpen: () => pop.lead, returning: () => returning, pinned: () => !!(pop.lead && pop.opts.pinned), teamOf: teamKeyOf, teamMeta,
  };
})();
