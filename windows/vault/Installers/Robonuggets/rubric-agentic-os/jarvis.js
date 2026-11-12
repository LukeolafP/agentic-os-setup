/* ================================================================
   Petra in the Agentic OS (GTD, 15 Oct 2026)

   Petra is the main agent: the voice of the GTD Vault agent, wired to the JARVIS
   bridge in GTD mode (~/Coding/jarvis, ws://localhost:8790). This file adds:
     - a wave in the tab pill, left of OS: click to talk, click again to stop.
       It moves with your voice while listening and with Petra's while she speaks.
     - a caption above the pill: what you said, what Petra says, a box to type.
     - the hex field in the middle of the screen warps while Petra talks.
     - a chip per queued agent, left of the pill; click a finished one for its report.
   Speech-to-text runs on this Mac (faster-whisper); Petra's voice is Voxtral (Mistral),
   also on this Mac, streamed and played through Web Audio. constellation.js draws the agents.
   ================================================================ */
(function () {
  'use strict';
  const BRIDGE = 'ws://localhost:8790/';
  const VOICE_PREF = ['Daniel', 'Arthur', 'Oliver', 'Serena', 'Google UK English Male'];
  // 0.7 s of quiet ends your turn (was 1.3 s): long enough for a breath, short enough to feel like talking
  const SILENCE_MS = 700, MAX_TALK_MS = 30000, SPEECH_LEVEL = 0.035;

  /* ------------------------------------------------------------ markup */
  const tabs = document.getElementById('osTabs');
  if (!tabs) return;
  const wave = document.createElement('button');
  wave.id = 'jvWave'; wave.title = 'Talk to Petra';
  wave.innerHTML = '<canvas width="104" height="44"></canvas>';
  const sep = document.createElement('span'); sep.className = 'jvSep';
  /* GTD: the keyboard, beside the wave: Petra's text chat (chat.js) */
  const kbd = document.createElement('button');
  kbd.id = 'jvKbd'; kbd.title = 'Type to Petra (the chat panel)';
  kbd.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5zM6 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM6 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM9 12.2a.8.8 0 0 0 0 1.6h6a.8.8 0 0 0 0-1.6z" fill-rule="evenodd"/></svg>';
  kbd.addEventListener('pointerdown', e => e.stopPropagation());
  kbd.addEventListener('click', () => window.osChat && window.osChat.toggle());
  tabs.prepend(sep); tabs.prepend(kbd); tabs.prepend(wave);
  const wcv = wave.querySelector('canvas'), wcx = wcv.getContext('2d');

  const dock = document.createElement('div');
  dock.id = 'jvDock';
  dock.innerHTML = `<div class="st"><span class="ph">PETRA</span><span class="tool"></span>
      <button type="button" class="exp" title="Continue in the chat panel, by voice">OPEN CHAT ⤢</button></div>
    <div class="you"></div><div class="jv"></div>
    <form><button type="button" class="to" title="Where typed prompts go: Claude Code (the full terminal in the vault) or Petra"></button>
    <input type="text" autocomplete="off">
    <button type="submit">SEND</button></form>`;
  document.body.appendChild(dock);
  const $ph = dock.querySelector('.ph'), $tool = dock.querySelector('.tool');
  const $you = dock.querySelector('.you'), $jv = dock.querySelector('.jv'), $in = dock.querySelector('input');

  const jobsEl = document.createElement('div');
  jobsEl.id = 'jvJobs';
  document.body.appendChild(jobsEl);

  /* the warp: turbulence, faded out toward the edges, displacing the middle */
  const NS = 'http://www.w3.org/2000/svg';
  const mask = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none"><defs>' +
    '<radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".85"/>' +
    '<stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0';
  svg.innerHTML = `<filter id="jvWarp" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence id="jvTurb" type="fractalNoise" baseFrequency="0.010 0.014" numOctaves="2" seed="4" result="noise"/>
      <feImage href="${mask}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="mask"/>
      <feComposite in="noise" in2="mask" operator="arithmetic" k1="1" k2="0" k3="-0.5" k4="0.5" result="field"/>
      <feDisplacementMap id="jvDisp" in="SourceGraphic" in2="field" scale="0" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
  document.body.appendChild(svg);
  const turb = svg.querySelector('#jvTurb'), disp = svg.querySelector('#jvDisp');
  const warpTargets = () => [document.getElementById('hexCv')].filter(Boolean);

  /* ------------------------------------------------------------- state */
  let ws = null, online = false, retry = 800;
  let phase = 'idle';              // idle | listening | transcribing | thinking | speaking
  let micLevel = 0, voiceEnv = 0, warpOn = false;
  let askSeq = 0, currentAsk = null, sttSeq = 0;
  let lastActivity = 0;
  const jobs = new Map();

  function setPhase(p, label) {
    phase = p;
    wave.classList.toggle('listening', p === 'listening');
    $ph.textContent = label || { idle: 'PETRA', listening: 'LISTENING', transcribing: 'HEARING YOU', thinking: 'THINKING', speaking: 'PETRA' }[p];
    if (p !== 'thinking') $tool.textContent = '';
    lastActivity = Date.now();
    showDock(p !== 'idle');
  }
  let dockTimer = null;
  function showDock(on) {
    clearTimeout(dockTimer);
    if (on) { dock.classList.add('show'); return; }
    // linger long enough to read the last line, then tuck away unless typing
    dockTimer = setTimeout(() => { if (phase === 'idle' && document.activeElement !== $in) dock.classList.remove('show'); }, 9000);
  }

  /* ------------------------------------------------------------ socket */
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function connect() {
    try { ws = new WebSocket(BRIDGE); } catch { return later(); }
    ws.onopen = () => { online = true; retry = 800; window.dispatchEvent(new Event('gtd-bridge-open')); wave.classList.add('online'); wave.classList.remove('offline'); wave.title = 'Talk to Petra'; };
    ws.onclose = () => { online = false; wave.classList.remove('online'); wave.classList.add('offline');
      wave.title = 'Petra is offline - the bridge on port 8790 is not running'; if (phase === 'thinking') { setPhase('idle'); $jv.textContent = 'The connection dropped.'; } later(); };
    ws.onerror = () => {};
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  }
  function later() { setTimeout(connect, retry); retry = Math.min(retry * 1.7, 15000); }
  /* GTD 2 Nov 2026: the bridge sends the agent snapshot when the page connects and then only on
     a change. It can land before constellation.js, agent-teams.js and chat.js have loaded, and
     then the ring sat empty (no agents, "TALK OR TYPE") until something changed. Keep the last
     one and hand it out again once every script is in. */
  addEventListener('load', () => { if (window.__gtdActivity) window.dispatchEvent(new CustomEvent('gtd-activity', { detail: window.__gtdActivity })); });

  let spokenBuf = '', replyText = '', flushTimer = null, wroteFile = false;
  // after Petra writes a file, short remarks about the bookkeeping itself are shown, not spoken
  const BOOKKEEPING = /chat note|chat index|index line|\btheme\b|\blogged\b|^\s*(done|noted|saved|updated|filed)\b/i;
  function onMessage(m) {
    if (m.type === 'gtd-state') { (m.jobs || []).forEach(j => jobs.set(j.id, j)); renderJobs(); return; }
    if (m.type === 'gtd-job') { jobs.set(m.job.id, m.job); renderJobs(); return; }
    if (m.type === 'gtd-stt') { onTranscript(m); return; }
    // the text chat and subagent transcripts belong to chat.js
    if (m.type === 'chat' || m.type === 'chat-tabs' || m.type === 'chat-history' || m.type === 'chat-sessions' || m.type === 'chat-session' || m.type === 'gtd-transcript' || m.type === 'gtd-transcript-add') {
      window.dispatchEvent(new CustomEvent('gtd-bridge', { detail: m })); return; }
    if (m.type === 'gtd-tts') { onVoice(m); return; }
    // the live agent graph, for the centre of the OS (constellation.js)
    if (m.type === 'gtd-activity') { window.__gtdActivity = m; window.dispatchEvent(new CustomEvent('gtd-activity', { detail: m })); return; }
    if (m.ask && m.ask !== currentAsk) return;          // tail of an abandoned turn
    if (m.type === 'text') {
      // separate text blocks (before and after a tool call) arrive with no gap between them
      const gap = /[.!?]$/.test(replyText) && /^[A-Z"']/.test(m.delta) ? ' ' : '';
      replyText += gap + m.delta; spokenBuf += gap + m.delta;
      $jv.textContent = replyText.trim();
      flushSentences(false);
      // a sentence that ends a burst of text is spoken after a short pause, not held for more
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { if (/[.!?]["')]?\s*$/.test(spokenBuf)) flushSentences(true); }, 220);
    } else if (m.type === 'tool') {
      // a tool call ends Petra's text block: speak what she has said so far straight away
      clearTimeout(flushTimer); flushSentences(true);
      if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(m.name)) wroteFile = true;
      $tool.textContent = '· ' + String(m.name).replace(/^mcp__/, '').replace(/__/g, ' ').replace(/_/g, ' ').toUpperCase();
      lastActivity = Date.now();
    } else if (m.type === 'done') {
      flushSentences(true);
      if (!replyText.trim() && m.text) { $jv.textContent = m.text; speak(m.text); }
      if (!speaking()) setPhase('idle');
    } else if (m.type === 'error') {
      $jv.textContent = m.message || 'Something failed.'; speak(m.message || ''); setPhase('idle');
    }
  }

  function ask(text) {
    text = text.trim();
    if (!text) return;
    if (!online) { if (sink) { const f = sink; sink = null; return f(null, 'Petra is offline: the bridge is not running.'); } $jv.textContent = 'Petra is offline. The bridge is not running.'; showDock(true); return; }
    audioOut();
    stopSpeaking();
    if (phase === 'thinking' || phase === 'speaking') send({ type: 'interrupt' });
    currentAsk = 'a' + (++askSeq);
    replyText = ''; spokenBuf = ''; wroteFile = false; clearTimeout(flushTimer);
    $you.textContent = text; $jv.textContent = '';
    setPhase('thinking');
    send({ type: 'ask', text, id: currentAsk });
  }

  /* GTD: typed prompts go to Claude Code by default - the real CLI in the vault, in the
     CLAUDE CODE tab - or to Petra. Voice always goes to Petra. */
  const $to = dock.querySelector('.to');
  let typeTo = 'code';
  try { typeTo = localStorage.getItem('jv-type-to') || 'code'; } catch {}
  function showTarget() {
    $to.textContent = typeTo === 'code' ? 'CLAUDE CODE' : 'PETRA';
    $to.classList.toggle('code', typeTo === 'code');
    $in.placeholder = typeTo === 'code' ? 'Prompt Claude Code, in the vault terminal' : 'Type to Petra, or click the wave and talk';
  }
  showTarget();
  $to.addEventListener('click', () => { typeTo = typeTo === 'code' ? 'petra' : 'code'; try { localStorage.setItem('jv-type-to', typeTo); } catch {} showTarget(); $in.focus({ preventScroll: true }); });
  dock.querySelector('form').addEventListener('submit', e => {
    e.preventDefault(); const v = $in.value.trim(); if (!v) return; $in.value = '';
    if (typeTo === 'code' && typeof window.osTermType === 'function') {
      window.osTermType(v); $you.textContent = v; $jv.textContent = 'Sent to Claude Code.'; $in.blur(); showDock(false); return;
    }
    /* typed to Petra: the chat panel, not the voice session */
    if (window.osChat) { $in.blur(); showDock(false); window.osChat.open(); window.osChat.send(v); return; }
    ask(v);
  });
  ['pointerdown', 'keydown'].forEach(t => dock.addEventListener(t, e => e.stopPropagation()));
  $in.addEventListener('focus', () => showDock(true));
  $in.addEventListener('blur', () => showDock(phase !== 'idle'));

  /* ------------------------------------------------------------- speech */
  /* Petra's voice is Voxtral (Mistral, on this Mac's GPU), streamed by the bridge in
     short chunks per sentence and played here back to back through Web Audio, so the
     wave and the warp follow the real signal. Kokoro steps in if Voxtral is down, and the
     Mac's own voice if the bridge is. */
  let actxOut = null, outAnalyser = null, playHead = 0, ttsSeq = 0, voiceGen = 0;
  const ttsJobs = new Map(), ttsOrder = [];
  let liveSources = [];
  const CUSHION = 0.2;             // seconds of buffer when starting from silence (measured worst gap 66 ms)
  function audioOut() {
    if (!actxOut) {
      actxOut = new (window.AudioContext || window.webkitAudioContext)();
      outAnalyser = actxOut.createAnalyser(); outAnalyser.fftSize = 512;
      outAnalyser.connect(actxOut.destination);
    }
    if (actxOut.state === 'suspended') actxOut.resume();
    return actxOut;
  }
  let utterQueue = 0;
  const speaking = () => utterQueue > 0;
  function speak(text) {
    text = text.replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!online) return fallbackSpeak(text);
    const id = 'v' + (++ttsSeq);
    utterQueue++;
    ttsJobs.set(id, { text, chunks: [], next: 0, done: false, error: null, live: 0, closed: false });
    ttsOrder.push(id);
    send({ type: 'gtd-tts', id, text });
  }
  function onVoice(m) {
    const j = ttsJobs.get(m.id);
    if (!j) return;                                     // cancelled
    if (m.audio) j.chunks.push(m.audio);
    if (m.done) { j.done = true; if (m.error && !j.chunks.length) j.error = m.error; }
    pump();
  }
  function closeJob(j) {
    if (j.closed) return; j.closed = true;
    utterQueue = Math.max(0, utterQueue - 1);
    if (!utterQueue && phase === 'speaking') setPhase('idle');
  }
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (ttsOrder.length) {
        const id = ttsOrder[0], j = ttsJobs.get(id), gen = voiceGen;
        if (!j) { ttsOrder.shift(); continue; }
        if (j.error) { ttsOrder.shift(); ttsJobs.delete(id); closeJob(j); fallbackSpeak(j.text); continue; }
        if (j.next < j.chunks.length) { await playChunk(j, j.chunks[j.next++], gen); if (gen !== voiceGen) break; continue; }
        if (j.done) { ttsOrder.shift(); ttsJobs.delete(id); j.finished = true; if (!j.live) closeJob(j); continue; }
        break;                                          // wait for the next chunk
      }
    } finally { pumping = false; }
  }
  async function playChunk(j, b64, gen) {
    try {
      const ctx = audioOut();
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      if (gen !== voiceGen) return;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(outAnalyser);
      // back to back while audio is queued; a small cushion when starting from silence
      const at = playHead > ctx.currentTime + 0.01 ? playHead : ctx.currentTime + CUSHION;
      src.start(at); playHead = at + buf.duration;
      liveSources.push(src); j.live++;
      setTimeout(() => { if (gen === voiceGen && phase !== 'speaking') setPhase('speaking'); }, Math.max(0, (at - ctx.currentTime) * 1000));
      let ended = false;
      const finish = () => {
        if (ended) return; ended = true;
        liveSources = liveSources.filter(x => x !== src);
        j.live--;
        if (j.finished && !j.live) closeJob(j);
      };
      src.onended = finish;
      // safety net: an audio device that stalls must never leave Petra stuck speaking
      setTimeout(finish, Math.max(0, (at - ctx.currentTime + buf.duration) * 1000) + 1500);
    } catch { /* a bad chunk is skipped; the rest still play */ }
  }
  // the Mac's own voice, if the bridge is unavailable
  let voice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^(Ava|Zoe|Allison|Samantha)/.test(v.name) && /en[-_]US/i.test(v.lang)) || vs.find(v => /en[-_]/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function fallbackSpeak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    utterQueue++;
    u.onstart = () => { setPhase('speaking'); voiceEnv = Math.max(voiceEnv, .6); };
    u.onboundary = () => { voiceEnv = Math.min(1, voiceEnv + .55); };
    u.onend = u.onerror = () => { utterQueue = Math.max(0, utterQueue - 1); if (!utterQueue && phase === 'speaking') setPhase('idle'); };
    speechSynthesis.speak(u);
  }
  function stopSpeaking() {
    voiceGen++;
    for (const s of liveSources) { try { s.stop(); } catch {} }
    liveSources = []; ttsOrder.length = 0; ttsJobs.clear();
    if (actxOut) playHead = actxOut.currentTime;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    utterQueue = 0;
  }
  // speak each sentence as soon as it is finished, so Petra starts talking early
  function flushSentences(all) {
    const re = /^([\s\S]*?[.!?])(\s+|$)/;
    let m;
    const say = t => { if (!(wroteFile && BOOKKEEPING.test(t))) speak(t); };
    while ((m = spokenBuf.match(re)) && (m[2] || all)) { say(m[1]); spokenBuf = spokenBuf.slice(m[0].length); }
    if (all && spokenBuf.trim()) { say(spokenBuf); spokenBuf = ''; }
  }

  /* ---------------------------------------------------------------- mic */
  let stream = null, actx = null, analyser = null, rec = null, chunks = [], talkStart = 0, heardAt = 0, heardAny = false;
  async function startListening() {
    if (!online) { $jv.textContent = 'Petra is offline. The bridge is not running.'; showDock(true); return; }
    audioOut();
    stopSpeaking();
    if (phase === 'thinking' || phase === 'speaking') send({ type: 'interrupt' });
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        actx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = actx.createAnalyser(); analyser.fftSize = 1024;
        actx.createMediaStreamSource(stream).connect(analyser);
      }
      if (actx.state === 'suspended') await actx.resume();
    } catch (err) {
      $you.textContent = '';
      $jv.textContent = host
        ? 'Obsidian has no microphone access. Allow it in System Settings, Privacy and Security, Microphone.'
        : 'The microphone is blocked here. Open the OS with the GTD Rubric plugin, or in Chrome, to talk. Or type below.';
      setPhase('idle');
      if (sink) { const f = sink; sink = null; f(null, 'No microphone access'); return; }
      showDock(true);
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = []; heardAny = false; talkStart = heardAt = performance.now();
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = finishListening;
    rec.start(250);
    $you.textContent = ''; $jv.textContent = '';
    setPhase('listening');
  }
  function stopListening() { if (rec && rec.state !== 'inactive') rec.stop(); }
  async function finishListening() {
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    rec = null;
    if (!heardAny || blob.size < 2000) { setPhase('idle'); if (sink) { const f = sink; sink = null; f(null); return; } $jv.textContent = 'I heard nothing.'; showDock(true); return; }
    setPhase('transcribing');
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
    send({ type: 'gtd-stt', id: 's' + (++sttSeq), mime: blob.type, audio: b64 });
  }
  /* GTD: while the chat panel has voice on, what Luke says goes to the chat (chat.js), not
     to the voice session. sink is the chat's handler for one utterance. */
  let sink = null;
  function onTranscript(m) {
    if (sink) {
      const f = sink; sink = null; setPhase('idle');
      f(m.error ? null : (m.text || '').trim() || null, m.error || null); return;
    }
    if (m.error) { setPhase('idle'); $jv.textContent = 'Transcription failed: ' + m.error; showDock(true); return; }
    const text = (m.text || '').trim();
    if (!text) { setPhase('idle'); $jv.textContent = 'I heard nothing.'; showDock(true); return; }
    ask(text);
  }
  dock.querySelector('.exp').addEventListener('click', e => {
    e.stopPropagation();
    const carry = { you: $you.textContent.trim(), petra: $jv.textContent.trim() };
    stopSpeaking(); if (phase === 'listening') { sink = null; chunks = []; heardAny = false; stopListening(); }
    setPhase('idle'); dock.classList.remove('show');
    window.osChat && window.osChat.openFromVoice(carry);
  });

  wave.addEventListener('pointerdown', e => e.stopPropagation());
  wave.addEventListener('click', e => {
    e.stopPropagation();
    audioOut();
    if (phase === 'listening') stopListening();
    else startListening();
  });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (phase === 'listening') { chunks = []; heardAny = false; stopListening(); e.stopImmediatePropagation(); }
    else if (phase === 'speaking' || phase === 'thinking') { stopSpeaking(); send({ type: 'interrupt' }); setPhase('idle'); e.stopImmediatePropagation(); }
  }, true);

  /* --------------------------------------------------------------- jobs */
  function renderJobs() {
    const now = Date.now();
    const list = [...jobs.values()]
      .filter(j => j.status === 'queued' || j.status === 'running' || (j.ended && now - j.ended < 10 * 60 * 1000))
      .sort((a, b) => b.created - a.created).slice(0, 5);
    jobsEl.innerHTML = '';
    for (const j of list) {
      const el = document.createElement('div');
      el.className = 'job ' + j.status;
      const st = j.status === 'running' ? (j.last ? j.last.toUpperCase() : 'WORKING') : j.status === 'queued' ? 'QUEUED' : j.status === 'done' ? 'DONE ✓' : j.status.toUpperCase();
      el.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="tk"></span><span class="x"></span>`;
      el.querySelector('.dot').style.background = j.color || '#7DA0FF';
      el.querySelector('.nm').textContent = j.agentName;
      el.querySelector('.tk').textContent = j.task;
      el.querySelector('.x').textContent = st;
      el.title = j.task + (j.result ? '\n\n' + j.result : '');
      if (j.report) el.onclick = () => window.open(j.report, '_blank');
      jobsEl.appendChild(el);
    }
    placeJobs();
  }
  function placeJobs() {
    const r = tabs.getBoundingClientRect();
    if (innerWidth > 900) { jobsEl.style.right = (innerWidth - r.left + 10) + 'px'; jobsEl.style.maxWidth = Math.max(160, r.left - 26) + 'px'; }
  }
  addEventListener('resize', placeJobs);
  setInterval(renderJobs, 30000);                      // ages finished chips off

  /* -------------------------------------------- wave, warp, one rAF loop */
  const buf = new Float32Array(1024), obuf = new Float32Array(512);
  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    // mic level + simple voice activity detection while listening
    if (phase === 'listening' && analyser) {
      analyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      micLevel += (Math.min(1, rms * 9) - micLevel) * .35;
      if (rms > SPEECH_LEVEL) { heardAny = true; heardAt = now; }
      if ((heardAny && now - heardAt > SILENCE_MS) || now - talkStart > MAX_TALK_MS) stopListening();
    } else micLevel *= .85;
    // Petra's voice: the real signal when Kokoro is playing, word pulses on the fallback
    if (phase === 'speaking' && outAnalyser && liveSources.length) {
      outAnalyser.getFloatTimeDomainData(obuf);
      let s2 = 0; for (let i = 0; i < obuf.length; i++) s2 += obuf[i] * obuf[i];
      voiceEnv += (Math.min(1, Math.sqrt(s2 / obuf.length) * 7) - voiceEnv) * .4;
    } else if (phase === 'speaking') voiceEnv = Math.max(.18 + .12 * Math.sin(t * 9), voiceEnv * .93);
    else voiceEnv *= .9;

    drawWave(t);
    // the warp follows his voice; off entirely when he is quiet
    const amt = voiceEnv;
    if (amt > .02) {
      if (!warpOn) { warpTargets().forEach(el => { el.dataset.jvf = el.style.filter || ''; el.style.filter = 'url(#jvWarp)'; }); warpOn = true; }
      disp.setAttribute('scale', (amt * 46).toFixed(1));
      turb.setAttribute('baseFrequency', `${(0.009 + 0.003 * Math.sin(t * .7)).toFixed(4)} ${(0.013 + 0.004 * Math.cos(t * .5)).toFixed(4)}`);
      turb.setAttribute('seed', String(Math.floor(t * 6) % 50));
    } else if (warpOn) {
      warpTargets().forEach(el => { el.style.filter = el.dataset.jvf || ''; });
      warpOn = false;
    }
    if (phase === 'idle' && Date.now() - lastActivity > 9000 && document.activeElement !== $in) dock.classList.remove('show');
    requestAnimationFrame(frame);
  }
  function drawWave(t) {
    const W = wcv.width, H = wcv.height, mid = H / 2;
    wcx.clearRect(0, 0, W, H);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1A8CF6';
    let amp, speed, col;
    if (phase === 'listening') { amp = .12 + micLevel * .95; speed = 7; col = accent; }
    else if (phase === 'speaking') { amp = .15 + voiceEnv * .85; speed = 9; col = '#F5F8FF'; }
    else if (phase === 'thinking' || phase === 'transcribing') { amp = .18 + .1 * Math.sin(t * 3); speed = 4; col = accent; }
    else { amp = online ? .1 + .04 * Math.sin(t * 1.3) : .04; speed = 1.4; col = online ? 'rgba(214,224,255,.7)' : 'rgba(214,224,255,.35)'; }
    wcx.lineWidth = 2.4; wcx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      wcx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const p = x / W, env = Math.sin(Math.PI * p);           // pinned at both ends
        const y = mid + env * amp * (mid - 3) * Math.sin(p * (9 + k * 3) + t * speed * (1 + k * .3) + k * 1.7);
        x ? wcx.lineTo(x, y) : wcx.moveTo(x, y);
      }
      wcx.strokeStyle = col; wcx.globalAlpha = k === 0 ? 1 : .35;
      wcx.stroke();
    }
    wcx.globalAlpha = 1;
  }

  /* ---------------------------------------- inside Obsidian (GTD Rubric plugin) */
  const host = (location.ancestorOrigins && [...location.ancestorOrigins].find(o => o.startsWith('app://'))) || null;
  if (host) {
    // links are routed by windows.js: they open as OS pop-ups and tabs
    addEventListener('message', e => {
      if (e.source !== parent || e.origin !== host || !e.data) return;
      if (e.data.type === 'rubric-os:tab' && typeof window.goTab === 'function') window.goTab(e.data.tab);
      if (e.data.type === 'rubric-os:talk' && phase !== 'listening') startListening();
    });
  }

  connect();
  requestAnimationFrame(frame);
  requestAnimationFrame(placeJobs);
  // for testing and debugging from the console: __jarvis.pulse() fakes two seconds of speech
  window.__jarvis = { ask, send, get phase() { return phase; }, get online() { return online; }, jobs,
    level: () => ({ phase, env: voiceEnv, mic: micLevel, online }),
    say(text) { audioOut(); speak(String(text || '')); },
    /* for the chat panel's voice: one utterance to fn(text), Petra's voice, and stopping both */
    listen(fn) { audioOut(); sink = fn; if (phase !== 'listening') startListening(); },
    stopListen() { const f = sink; sink = null; if (phase === 'listening') { chunks = []; heardAny = false; stopListening(); } if (f) f(null); },
    stopVoice() { stopSpeaking(); if (phase === 'speaking') setPhase('idle'); },
    get speaking() { return phase === 'speaking'; },   // hear Petra's voice without asking her anything
    toggleTalk() { audioOut(); if (phase === 'listening') stopListening(); else startListening(); },
    pulse() { setPhase('speaking'); const end = performance.now() + 2000;
      (function p() { voiceEnv = Math.max(voiceEnv, .55 + .45 * Math.random()); if (performance.now() < end) setTimeout(p, 120); else setPhase('idle'); })(); } };
})();
