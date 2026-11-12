/* ================================================================
   Ring folders (GTD, 30 Oct 2026)

   The ring around Petra shows one ball per folder, not one per file. Where each file
   sits comes from ring/layout.json, which the Ring Organizer agent writes, organised by
   what the work is for and not by the vault's folders (server.js, tools/ring-layout.mjs,
   Agents/ring-organizer.md). Files it has not filed yet sit in Unsorted.

   Hover a folder ball and it opens out of the ring into a tree: its folders and files in a
   column beside it, joined by branches. Hover a folder in the tree and its own column opens
   beside that, and so on down to the versions. Click a file to open it. Click the ball to
   keep the tree open; Esc or a click elsewhere closes it.

   dashboard.html calls osRingTree.build() from syncArtifactBalls and hands every folder
   ball to osRingTree.attach(); the rest lives here.
   ================================================================ */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const FOLDER_SVG = '<path d="M7 14h12l4 5h18v19H7z"/><path d="M7 19h34"/>';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getDate() + ' ' + d.toLocaleString('en-AU', { month: 'short' }); };

  /* ------------------------------------------------------------ the tree */
  function build(list, ring) {
    const folders = (ring && ring.folders) || {};
    const mk = (name, path) => ({ name, path, key: path.join('/'), kids: new Map(), items: [], latest: 0, count: 0,
      meta: folders[path.join('/')] || {} });
    const top = new Map();
    for (const a of list) {
      const p = a.place && a.place.path && a.place.path.length ? a.place.path : ['Unsorted'];
      const t = new Date(a.modified || a.created).getTime() || 0;
      if (!top.has(p[0])) top.set(p[0], mk(p[0], [p[0]]));
      let node = top.get(p[0]);
      const bump = n => { n.count++; if (t > n.latest) { n.latest = t; n.newest = a; } };
      bump(node);
      for (let i = 1; i < p.length; i++) {
        if (!node.kids.has(p[i])) node.kids.set(p[i], mk(p[i], p.slice(0, i + 1)));
        node = node.kids.get(p[i]); bump(node);
      }
      node.items.push(a);
    }
    for (const n of top.values()) if (n.name === 'Unsorted') n.unsorted = true;
    return [...top.values()].sort((a, b) => (a.unsorted - b.unsorted) || ((a.meta.order ?? 99) - (b.meta.order ?? 99)) || (b.latest - a.latest));
  }
  /* a folder's rows: its folders (in order, then newest first), then its files, newest first */
  function rows(node) {
    const kids = [...node.kids.values()].sort((a, b) => ((a.meta.order ?? 99) - (b.meta.order ?? 99)) || (b.latest - a.latest));
    const items = node.items.slice().sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return [...kids.map(k => ({ folder: k })), ...items.map(a => ({ item: a }))];
  }
  const words = node => [node.name, node.meta.note || '', ...node.items.map(a => [a.title, a.place && a.place.label, a.note].join(' ')),
    ...[...node.kids.values()].map(words)].join(' ').toLowerCase();

  /* ------------------------------------------------------------ the view */
  const host = document.createElement('div'); host.id = 'ringTree';
  const svg = document.createElementNS(NS, 'svg'); svg.classList.add('rt-lines');
  host.appendChild(svg); document.body.appendChild(host);
  let ball = null, open = [], cols = [], pinned = false, closeT = null, dir = 1, query = '';

  function itemRow(a) {
    const label = (a.place && a.place.label) || a.title;
    const g = a.svg || (typeof ART_GLYPH !== 'undefined' && (ART_GLYPH[a.icon] || ART_GLYPH.doc)) || '';
    const q = query && [a.title, label, a.note].join(' ').toLowerCase().includes(query);
    return `<button class="rt-row rt-file${q ? ' hit' : ''}" data-file="${esc(a.file)}" title="${esc(a.title)}">
      <svg viewBox="0 0 48 48">${g}</svg><span class="rt-name">${esc(label)}</span><span class="rt-date">${esc(day(a.modified || a.created))}</span></button>`;
  }
  function folderRow(f, on) {
    const q = query && words(f).includes(query);
    return `<button class="rt-row rt-folder${on ? ' on' : ''}${q ? ' hit' : ''}" data-key="${esc(f.key)}">
      <svg viewBox="0 0 48 48">${FOLDER_SVG}</svg><span class="rt-name">${esc(f.name)}</span><span class="rt-n">${f.count}</span><i>›</i></button>`;
  }
  function render() {
    host.querySelectorAll('.rt-col').forEach(c => c.remove());
    cols = [];
    if (!ball || !open.length) { host.classList.remove('show'); svg.innerHTML = ''; return; }
    host.classList.add('show');
    const r = ball.el.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    /* grow toward the middle of the screen, where there is room */
    dir = bx > innerWidth / 2 ? -1 : 1;
    let edge = dir > 0 ? r.right + 26 : r.left - 26, anchorY = by;
    open.forEach((node, k) => {
      const col = document.createElement('div');
      col.className = 'rt-col'; col.dataset.level = k;
      const next = open[k + 1];
      col.innerHTML = `<div class="rt-head"><b>${esc(node.name)}</b>${node.meta.note ? `<small>${esc(node.meta.note)}</small>` : ''}${node.unsorted ? `<small>${window.__ringOrganizing ? 'The Ring Organizer is filing these now…' : 'Waiting for the Ring Organizer to file these.'}</small>` : ''}</div>
        <div class="rt-list">${rows(node).map(x => x.folder ? folderRow(x.folder, next === x.folder) : itemRow(x.item)).join('')}</div>`;
      host.appendChild(col);
      const w = col.offsetWidth, h = col.offsetHeight;
      let left = dir > 0 ? edge : edge - w;
      left = Math.max(8, Math.min(innerWidth - w - 8, left));
      const top = Math.max(8, Math.min(innerHeight - h - 8, anchorY - Math.min(h / 2, 46)));
      col.style.left = left + 'px'; col.style.top = top + 'px';
      requestAnimationFrame(() => col.classList.add('in'));
      cols.push({ col, node, anchor: k === 0 ? { x: dir > 0 ? r.right : r.left, y: by } : null });
      if (next) {
        const on = col.querySelector('.rt-folder.on'), orr = on.getBoundingClientRect();
        anchorY = orr.top + orr.height / 2;
        edge = dir > 0 ? left + w + 34 : left - 34;
      }
      col.querySelector('.rt-list').addEventListener('scroll', lines, { passive: true });
    });
    lines(); setTimeout(lines, 230);   /* again once the columns have finished growing in */
  }
  /* branches: from the ball (or the open folder's row) to every row of the next column */
  function lines() {
    svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight);
    let out = '';
    cols.forEach((c, k) => {
      let from = c.anchor;
      if (!from) {
        const prev = cols[k - 1] && cols[k - 1].col.querySelector('.rt-folder.on');
        if (!prev) return;
        const pr = prev.getBoundingClientRect();
        from = { x: dir > 0 ? pr.right : pr.left, y: pr.top + pr.height / 2 };
      }
      const list = c.col.querySelector('.rt-list').getBoundingClientRect();
      const heads = c.col.querySelector('.rt-head').getBoundingClientRect();
      const tx = dir > 0 ? heads.left : heads.right;
      /* the trunk to the column, then a twig to each row in view */
      const ty = heads.top + heads.height / 2;
      const mx = (from.x + tx) / 2;
      out += `<path class="trunk" d="M${from.x},${from.y} C${mx},${from.y} ${mx},${ty} ${tx},${ty}"/>`;
      const sx = dir > 0 ? heads.left - 9 : heads.right + 9;
      c.col.querySelectorAll('.rt-row').forEach(row => {
        const rr = row.getBoundingClientRect();
        const y = rr.top + rr.height / 2;
        if (y < list.top || y > list.bottom) return;
        out += `<path class="twig" d="M${sx},${ty} L${sx},${y} L${dir > 0 ? rr.left : rr.right},${y}"/>`;
      });
    });
    svg.innerHTML = out;
  }

  function show(b, node) {
    clearTimeout(closeT);
    if (ball !== b) { ball = b; open = [node]; pinned = false; render(); }
  }
  function close() { clearTimeout(closeT); ball = null; open = []; pinned = false; render(); }
  function later() { clearTimeout(closeT); if (!pinned) closeT = setTimeout(close, 380); }

  host.addEventListener('mouseover', e => {
    clearTimeout(closeT);
    const row = e.target.closest('.rt-folder'); if (!row) return;
    const level = +row.closest('.rt-col').dataset.level;
    const node = open[level] && open[level].kids.get(row.querySelector('.rt-name').textContent);
    if (node && open[level + 1] !== node) { open = open.slice(0, level + 1).concat(node); render(); }
  });
  host.addEventListener('mouseleave', later);
  host.addEventListener('pointerdown', e => e.stopPropagation());
  host.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  host.addEventListener('click', e => {
    const f = e.target.closest('.rt-file'); if (!f) return;
    const a = findItem(f.dataset.file); if (!a) return;
    close();
    window.open((typeof API !== 'undefined' ? API : '') + a.url, '_blank');
  });
  function findItem(file) {
    let hit = null;
    (function walk(n) { for (const a of n.items) if (a.file === file) hit = a; n.kids.forEach(walk); })(open[0] || { items: [], kids: new Map() });
    return hit;
  }
  document.addEventListener('pointerdown', e => { if (ball && !e.target.closest('#ringTree') && !(ball.el.contains(e.target))) close(); }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && ball) close(); });
  addEventListener('resize', () => { if (ball) render(); });

  window.osRingTree = {
    build, words, FOLDER_SVG,
    /* wire a folder ball: hover opens its tree, leaving closes it */
    attach(b) {
      b.el.addEventListener('mouseenter', () => { if (!b.drag && !document.body.classList.contains('dragging')) show(b, b.folder); });
      b.el.addEventListener('mouseleave', later);
    },
    /* a click keeps it open (or closes a kept one) */
    toggle(b) {
      if (ball === b && pinned) return close();
      show(b, b.folder); pinned = true;
    },
    close,
    search(q) { query = String(q || '').trim().toLowerCase(); if (ball) render(); },
    isOpen: () => !!ball,
  };
  /* the ring's first pull can land before this file has loaded: rebuild it as folders now */
  if (typeof pullArtifacts === 'function' && typeof balls !== 'undefined' && balls.some(b => b.artifact)) { window.__ringSig = null; pullArtifacts().catch(() => {}); }
})();
