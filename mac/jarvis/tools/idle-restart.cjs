/* restart the JARVIS bridge once nothing on it is live: no Petra tab replying and no agent or
   manager queued or running, seen idle on two checks a minute apart and once more right before.
   Keyboard Claude Code sessions are not on the bridge, so they don't count. Gives up after 12 h. */
const { execSync } = require('child_process');
const WebSocket = require('__HOME__/Coding/jarvis/node_modules/ws');
const bridgeIdle = () => new Promise(res => {
  const ws = new WebSocket('ws://localhost:8790', { headers: { Origin: 'http://localhost:50000' } });
  let act = null, tabs = null; const done = v => { try { ws.close(); } catch {} res(v); };
  const t = setTimeout(() => done(false), 8000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'chat-tabs' })));
  ws.on('message', d => { let m; try { m = JSON.parse(d); } catch { return; }
    if (m.type === 'gtd-activity') act = m; if (m.type === 'chat-tabs') tabs = m.tabs;
    if (act && tabs) { clearTimeout(t); done(!tabs.some(x => x.busy) && !act.instances.some(i => i.status === 'running' || i.status === 'queued')); } });
  ws.on('error', () => done(false));
});
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const end = Date.now() + 12 * 3600e3;
  let streak = 0;
  while (Date.now() < end) {
    streak = (await bridgeIdle()) ? streak + 1 : 0;
    if (streak >= 2) {
      await wait(3000);
      if (await bridgeIdle()) {
        execSync(`launchctl kickstart -k gui/${process.getuid()}/com.gettruckdrivers.jarvis-bridge`);
        console.log(new Date().toISOString(), 'bridge restarted while idle'); return;
      }
      streak = 0;
    }
    await wait(60e3);
  }
  console.log(new Date().toISOString(), 'gave up after 12 hours: never idle');
})();
