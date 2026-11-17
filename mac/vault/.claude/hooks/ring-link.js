#!/usr/bin/env node
/* ring-link.js - PostToolUse hook (GTD, 5 Nov 2026, automation: Ring Auto Filing).
   When a session writes an .html page into the vault (Write, Edit, or a Bash command that
   names an .html file), link it onto the Agentic OS ring straight away with
   vault-feeds.js buildRing(). The OS server's ring watcher (server.js ringWatch, every 30s)
   then sees it unfiled and runs the ring-organizer agent about a minute later, instead of
   waiting for the server's own 10-minute vault scan. Takes about 0.1s, prints nothing,
   never blocks a tool call. Remove the PostToolUse entry in .claude/settings.json to undo. */
'use strict';
const path = require('path');
let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw || '{}'), ti = ev.tool_input || {};
    const target = ti.file_path || ti.notebook_path || '';
    const hit = /\.html?$/i.test(target) || (ev.tool_name === 'Bash' && /\.html?\b/i.test(ti.command || ''));
    if (!hit) return;
    const feeds = path.join(__dirname, '..', '..', 'Installers', 'Robonuggets', 'rubric-agentic-os', 'tools', 'vault-feeds.js');
    require(feeds).buildRing();
  } catch (_) { /* never get in the way of the session */ }
});
