# OAUTH.md - wire the calendar widget

The calendar widget mirrors your own Google Calendar view: every calendar you have TICKED in the Google Calendar sidebar shows up, merged, soonest first. Tick or untick in Google Calendar and the OS follows.

It works through `tools/google-calendar.js`, which signs in once with your Google account and then pulls events locally. Nothing leaves your machine.

## What your agent needs to do (once, ~10 minutes)

Paste this section to your agent and let it drive.

### 1. Create a Google OAuth client (one-time, free)

1. Go to https://console.cloud.google.com and create a project (any name).
2. APIs and Services > Enable APIs > enable **Google Calendar API**.
3. APIs and Services > OAuth consent screen > External > fill the two required fields > add yourself as a test user.
4. APIs and Services > Credentials > Create credentials > **OAuth client ID** > type **Web application** > add `http://localhost:3847/oauth2callback` under Authorized redirect URIs.
5. Copy the client ID and client secret into a file named `.google-creds.json` next to `server.js`:

```json
{ "client_id": "xxxxxxxx.apps.googleusercontent.com", "client_secret": "xxxxxxxx" }
```

6. Open `tools/google-calendar.js` and set `CREDS_PATH` to that file (the line is marked). The tool also needs the `googleapis` package once: `npm install googleapis` in the OS folder.

### 2. Sign in

```
node tools/google-calendar.js auth
```

A browser opens - pick the Google account whose calendar view you actually use, click Allow. A token file is saved next to the OS and the flow never runs again.

### 3. Check it

```
node tools/google-calendar.js next
```

You should see your real events as JSON. From now on the server pulls live every 2 minutes. Done.

## Troubleshooting

- **"API has not been used in project..."** - the Calendar API switch from step 1.2 is off, or still propagating. Click the link in the error, enable, wait a minute.
- **"Access blocked - app not verified"** - click Advanced > continue. It is your own app; verification is only needed for public apps.
- **Widget still empty** - the widget shows the next event across your ticked calendars only. Untick noisy calendars (Holidays, Birthdays) in Google Calendar to focus it.

## Not on Google Calendar?

Ask your agent to write `snapshots/calendar.json` directly from whatever calendar it CAN read:

```json
{ "source": "my-calendar", "fetched": "2026-01-01T00:00:00Z",
  "events": [ { "title": "Team call", "start": "2026-01-02T14:00:00+10:00", "allDay": false, "link": null, "meet": null } ] }
```

The widget treats that file exactly like a live pull.
