/**
 * Google Calendar reader for the Agentic OS calendar widget.
 * Signs in once with YOUR Google account, then mirrors your own calendar
 * view: every calendar ticked in your Google Calendar sidebar, merged.
 * Full setup walkthrough: OAUTH.md in the OS folder.
 *
 * Needs the googleapis package once:  npm install googleapis  (in the OS folder)
 *
 * Usage:
 *   node tools/google-calendar.js auth   - one-time OAuth flow (opens browser)
 *   node tools/google-calendar.js next   - JSON to stdout: upcoming events
 */

import { google } from 'googleapis';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* CREDS_PATH - your OAuth client file (see OAUTH.md step 1) */
const CREDS_PATH = join(__dirname, '..', '.google-creds.json');
const TOKEN_PATH = join(__dirname, '..', '.google-calendar-token.json');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
/* must match the redirect URI registered on your OAuth client (OAUTH.md step 1.4) */
const REDIRECT_PORT = 3847;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function loadCreds() {
  if (!existsSync(CREDS_PATH)) {
    console.error(`Missing credentials file: ${CREDS_PATH} - see OAUTH.md`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
}

function getOAuth2Client() {
  const creds = loadCreds();
  return new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);
}

function loadToken(oauth2Client) {
  if (!existsSync(TOKEN_PATH)) return false;
  oauth2Client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf8')));
  return true;
}

async function auth() {
  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpening browser for authorization - pick the account whose calendar you use\n');
  console.log(authUrl);
  const opener = process.platform === 'win32' ? `start "" "${authUrl}"`
    : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (req.url.startsWith('/oauth2callback')) {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        const code = url.searchParams.get('code');
        if (code) {
          const { tokens } = await oauth2Client.getToken(code);
          writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          oauth2Client.setCredentials(tokens);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Google Calendar authorized! You can close this tab.</h1>');
          console.log('\nAuthorization successful! Token saved.');
          server.close();
          resolve(oauth2Client);
        } else {
          res.writeHead(400);
          res.end('No code received');
        }
      }
    });
    server.listen(REDIRECT_PORT);
  });
}

function getClientOrDie() {
  const oauth2Client = getOAuth2Client();
  if (!loadToken(oauth2Client)) {
    console.error('Not authorized yet. Run: node tools/google-calendar.js auth');
    process.exit(1);
  }
  return oauth2Client;
}

/* Mirror the account's own view: every calendar ticked in the sidebar
   (selected:true), merged and sorted. No hardcoded calendar list - tick or
   untick in Google Calendar and the widget follows. */
async function next() {
  const cal = google.calendar({ version: 'v3', auth: getClientOrDie() });
  const { data: list } = await cal.calendarList.list({ maxResults: 50 });
  const picked = (list.items || []).filter(c => c.selected);
  /* GTD: from 2 hours back, so the OS calendar can show what just happened as well as what is next */
  const timeMin = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const results = await Promise.all(picked.map(c =>
    cal.events.list({ calendarId: c.id, timeMin, singleEvents: true,
                      orderBy: 'startTime', maxResults: 10 })
      .then(r => (r.data.items || []).map(e => ({
        title: e.summary || '(no title)',
        start: e.start?.dateTime || e.start?.date,
        allDay: !e.start?.dateTime,
        end: e.end?.dateTime || e.end?.date,
        cal: c.summaryOverride || c.summary,
        link: e.htmlLink,
        meet: e.conferenceData?.entryPoints?.[0]?.uri || e.hangoutLink || null,
      })))
      .catch(() => [])));
  const events = results.flat()
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 8);
  console.log(JSON.stringify({
    source: 'google-calendar',
    fetched: new Date().toISOString(),
    calendars: picked.map(c => c.summaryOverride || c.summary),
    events,
  }));
}

const cmd = process.argv[2];
if (cmd === 'auth') auth();
else if (cmd === 'next') next().catch(e => { console.error(e.message); process.exit(1); });
else console.log('Usage: node tools/google-calendar.js auth | next');
