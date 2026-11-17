#!/usr/bin/env node
/* media-guard.js - PreToolUse hook (GTD, 17 Nov 2026, chat [[2026-11-16 - Token Burn Audit]]).
   Screenshots and photos stay in the context of whatever session takes them and are re-read
   on every later step. So pictures are only handled inside short-lived subagents:
   1. Claude in Chrome tools are refused in a main session (Petra, a manager, a keyboard
      session). Chrome work goes to the chrome-operator subagent, which reports in text.
   2. In Petra's chats (the bridge sets GTD_PETRA=1), reading an image file is refused. Photos
      go to the image-viewer subagent, or to a manager or agent as file paths.
   Subagent calls carry agent_id and are always allowed; so are queued agent jobs (GTD_JOB=1).
   Prints nothing and allows the call in every other case, and never fails a tool call on its
   own error. To undo, remove the PreToolUse entry for it in .claude/settings.json. */
'use strict';
let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(raw || '{}'); } catch (_) { return; }
  if (ev.agent_id || process.env.GTD_JOB === '1') return;
  const name = ev.tool_name || '', input = ev.tool_input || {};
  let reason = null;
  if (name.startsWith('mcp__claude-in-chrome__')) {
    reason = 'Chrome work runs in the chrome-operator subagent, so its screenshots never stay in this session. ' +
      'Call the Agent tool with subagent_type "chrome-operator" and a brief for one small batch: the site and tab id if one is open, ' +
      'the exact change or what to read, how to confirm it, and whether it may press Publish or Save. ' +
      'For a long job, send one call per page, form or setting, carrying the tab id and progress forward from each report.';
  } else if (name === 'Read' && process.env.GTD_PETRA === '1' &&
             /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(String(input.file_path || ''))) {
    reason = 'Images are not opened in Petra\'s chat, so they do not stay in it. ' +
      'Call the Agent tool with subagent_type "image-viewer", the image paths and your question, and use its text answer. ' +
      'If a manager or agent needs the image, pass it the path in the brief instead.';
  }
  if (!reason) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
});
