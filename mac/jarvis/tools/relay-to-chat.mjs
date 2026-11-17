// Post a message into an Agentic OS chat tab as a user turn.
// Usage: node relay-to-chat.mjs <session-id-or-tab-title-substring> "text"
import WebSocket from '__HOME__/Coding/jarvis/node_modules/ws/wrapper.mjs'
const [match, text] = process.argv.slice(2)
if (!match || !text) { console.log('usage: relay-to-chat.mjs <session id or title> "text"'); process.exit(2) }
const ws = new WebSocket('ws://localhost:8790', { headers: { Origin: 'http://localhost:50000' } })
ws.on('open', () => ws.send(JSON.stringify({ type: 'chat-tabs' })))
ws.on('message', (m) => {
  const d = JSON.parse(m); if (d.type !== 'chat-tabs') return
  const t = d.tabs.find(t => JSON.stringify(t).includes(match))
  if (!t) { console.log('no tab matches', match); for (const x of d.tabs) console.log(' ', JSON.stringify(x).slice(0, 160)); process.exit(1) }
  const tab = t.id ?? t.tab ?? t.key
  ws.send(JSON.stringify({ type: 'chat-send', tab, text }))
  console.log('sent to tab', tab, (t.title ?? '').slice(0, 80)); setTimeout(() => process.exit(0), 500)
})
ws.on('error', e => { console.log('err', e.message); process.exit(1) })
setTimeout(() => { console.log('timeout'); process.exit(1) }, 5000)
