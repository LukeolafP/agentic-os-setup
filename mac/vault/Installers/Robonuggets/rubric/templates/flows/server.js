import 'dotenv/config';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5050;
const RUBRIC_TOKEN = process.env.RUBRIC_TOKEN || '';
const MAX_BODY = 1_000_000;

// Live workflow run state (for late-joining browsers)
let wfRunState = null;

// Read a request body with a hard size cap. Sends 413 and returns without
// calling cb if the body exceeds MAX_BODY bytes.
function readBody(req, res, cb) {
  let body = '';
  let done = false;
  req.on('data', chunk => {
    if (done) return;
    body += chunk;
    if (body.length > MAX_BODY) {
      done = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
    }
  });
  req.on('end', () => { if (!done) cb(body); });
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function wfBroadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Optional shared-secret gate for API calls (unset = open, unchanged behavior)
  if (RUBRIC_TOKEN && pathname.startsWith('/api/') && req.headers['x-rubric-token'] !== RUBRIC_TOKEN) {
    sendJSON(res, { error: 'Unauthorized' }, 401);
    return;
  }

  try {
    // --- API routes ---

    // GET /api/workflows
    if (pathname === '/api/workflows' && req.method === 'GET') {
      try {
        const data = JSON.parse(readFileSync(join(__dirname, 'data', 'workflows.json'), 'utf8'));
        sendJSON(res, data);
      } catch (e) { sendJSON(res, []); }
      return;
    }

    // PUT /api/workflows/:id
    if (pathname.startsWith('/api/workflows/') && req.method === 'PUT') {
      const id = pathname.replace('/api/workflows/', '');
      readBody(req, res, (body) => {
        try {
          const filePath = join(__dirname, 'data', 'workflows.json');
          const workflows = JSON.parse(readFileSync(filePath, 'utf8'));
          const idx = workflows.findIndex(w => w.id === id);
          const updated = JSON.parse(body);
          if (idx >= 0) workflows[idx] = updated;
          else workflows.push(updated);
          writeFileSync(filePath, JSON.stringify(workflows, null, 2));
          sendJSON(res, updated);
        } catch (e) { sendJSON(res, { error: e.message }, 500); }
      });
      return;
    }

    // GET /api/skill-content?path=...
    if (pathname === '/api/skill-content' && req.method === 'GET') {
      const skillPath = url.searchParams.get('path');
      if (!skillPath || !skillPath.endsWith('.md')) {
        sendJSON(res, { error: 'Invalid skill path' }, 400);
        return;
      }
      // Path traversal protection
      if (skillPath.includes('..')) {
        sendJSON(res, { error: 'Invalid path' }, 400);
        return;
      }
      const resolved = resolve(join(__dirname, skillPath));
      const base = resolve(__dirname);
      if (!resolved.startsWith(base)) {
        sendJSON(res, { error: 'Invalid path' }, 400);
        return;
      }
      try {
        const content = readFileSync(resolved, 'utf8');
        sendJSON(res, { content });
      } catch (e) {
        sendJSON(res, { error: 'File not found' }, 404);
      }
      return;
    }

    // POST /api/workflow-events (for agents to send events via HTTP)
    if (pathname === '/api/workflow-events' && req.method === 'POST') {
      readBody(req, res, (body) => {
        try {
          const evt = JSON.parse(body);
          switch (evt.event) {
            case 'workflow:start':
              wfRunState = { workflowId: evt.workflowId, status: 'running', currentStep: -1, litSteps: [], actions: [], startedAt: Date.now() };
              wfBroadcast({ type: 'workflow:start', workflowId: evt.workflowId });
              break;
            case 'step:start':
              if (wfRunState) { wfRunState.currentStep = evt.stepIndex; wfRunState.actions = []; }
              wfBroadcast({ type: 'step:start', stepIndex: evt.stepIndex, skillId: evt.skillId });
              break;
            case 'step:action':
              if (wfRunState) wfRunState.actions.push(evt.text);
              wfBroadcast({ type: 'step:action', stepIndex: evt.stepIndex, text: evt.text });
              break;
            case 'step:complete':
              if (wfRunState) wfRunState.litSteps.push(evt.stepIndex);
              wfBroadcast({ type: 'step:complete', stepIndex: evt.stepIndex });
              break;
            case 'step:warn':
              wfBroadcast({ type: 'step:warn', stepIndex: evt.stepIndex, text: evt.text || 'Warning' });
              break;
            case 'step:error':
              if (wfRunState) { wfRunState.errorSteps = wfRunState.errorSteps || []; wfRunState.errorSteps.push(evt.stepIndex); }
              wfBroadcast({ type: 'step:error', stepIndex: evt.stepIndex, text: evt.text || 'Step failed' });
              break;
            case 'workflow:complete':
              if (wfRunState) wfRunState.status = 'done';
              wfBroadcast({ type: 'workflow:complete', workflowId: evt.workflowId });
              break;
            case 'workflow:reset':
              wfRunState = null;
              wfBroadcast({ type: 'workflow:reset' });
              break;
          }
          sendJSON(res, { ok: true });
        } catch (e) { sendJSON(res, { error: e.message }, 400); }
      });
      return;
    }

    // GET /api/workflow-state
    if (pathname === '/api/workflow-state' && req.method === 'GET') {
      sendJSON(res, wfRunState || { status: 'idle' });
      return;
    }

    // --- Static file serving ---
    let filePath = join(__dirname, pathname === '/' ? 'index.html' : pathname);
    filePath = normalize(filePath);

    // Ensure we don't serve files outside our directory
    if (!filePath.startsWith(resolve(__dirname))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);

  } catch (e) {
    console.error('Request error:', e);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

// WebSocket server on the same HTTP server
const wss = new WebSocketServer({ server, maxPayload: 1_000_000 });
wss.on('connection', (ws) => {
  // Send current state on connect (catch-up for late joiners)
  if (wfRunState) {
    ws.send(JSON.stringify({ type: 'state:sync', state: wfRunState }));
  }
  // Also accept WS messages from agents directly
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      // Forward as broadcast event (same handling as HTTP POST)
      switch (msg.type) {
        case 'workflow:start':
          wfRunState = { workflowId: msg.workflowId, status: 'running', currentStep: -1, litSteps: [], actions: [], startedAt: Date.now() };
          wfBroadcast({ type: 'workflow:start', workflowId: msg.workflowId });
          break;
        case 'step:start':
          if (wfRunState) { wfRunState.currentStep = msg.stepIndex; wfRunState.actions = []; }
          wfBroadcast({ type: 'step:start', stepIndex: msg.stepIndex });
          break;
        case 'step:action':
          if (wfRunState) wfRunState.actions.push(msg.text);
          wfBroadcast({ type: 'step:action', text: msg.text });
          break;
        case 'step:complete':
          if (wfRunState) wfRunState.litSteps.push(msg.stepIndex);
          wfBroadcast({ type: 'step:complete', stepIndex: msg.stepIndex });
          break;
        case 'step:warn':
          wfBroadcast({ type: 'step:warn', stepIndex: msg.stepIndex, text: msg.text || 'Warning' });
          break;
        case 'step:error':
          if (wfRunState) { wfRunState.errorSteps = wfRunState.errorSteps || []; wfRunState.errorSteps.push(msg.stepIndex); }
          wfBroadcast({ type: 'step:error', stepIndex: msg.stepIndex, text: msg.text || 'Step failed' });
          break;
        case 'workflow:complete':
          if (wfRunState) wfRunState.status = 'done';
          wfBroadcast({ type: 'workflow:complete', workflowId: msg.workflowId });
          break;
        case 'workflow:reset':
          wfRunState = null;
          wfBroadcast({ type: 'workflow:reset' });
          break;
      }
    } catch (e) { /* ignore malformed messages */ }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Rubric Flows running at http://127.0.0.1:${PORT}`);
});
