# WIRING.md - email, stats, and how feeds work

This OS reads almost everything from small JSON files in `snapshots/`. Your agent writes those files however suits your setup - on a schedule, after a task, or on demand. If a file is missing, the widget shows a quiet "not wired yet" hint and nothing breaks.

## The pattern (read this first)

1. Your agent produces a JSON file in `snapshots/` in the format below.
2. The server picks it up automatically (feeds are re-read every 1-3 minutes).
3. Keeping it fresh is your agent's job - add one line to its routine or instructions: "after X, update snapshots/Y.json".

---

## Email widget

The email widget triages the last 24h of your inbox: total count, flagged rows that need you, and a lead/member/other mix bar.

It calls the `gws` CLI (a Google Workspace command-line tool) with `gmail users messages list/get`. To wire it:

1. Ask your agent to install a Gmail-capable CLI it can call as `gws`, and authenticate your Google account with it (`gws auth setup` then `gws auth login` on the original tool). This needs a Google Cloud project with the Gmail API enabled - your agent can walk you through both clicks.
2. Restart the server. If `gws` answers, the widget lights up on the next refresh.

No `gws`? Two options:
- Ask your agent to adapt `getEmail()` in `server.js` to whatever email access it has (any CLI or API works - the function just returns rows).
- Or skip it: open edit mode and remove the widget. The library re-adds it any time.

**The four buckets** (partnerships / leads / personal / other) are driven by `os-config.json`: `partnerHints` and `leadHints` are keyword alternations matched against subjects, and `personalFrom` matches the sender's mail domain. Tune them to your world - "sponsor|collab|invoice" means nothing if you are a freelancer; try "quote|brief|proposal". Flagged rows are the partnerships + leads.

**Row clicks** open Gmail in the browser. Using something else? Ask your agent to change the two `mail.google.com` links in `dashboard.html`.

---

## Stats widget

The stats widget shows ANY numbers you care about - subscribers, revenue, clients, workouts logged, words written. Your agent writes `snapshots/stats.json`:

```json
{
  "title": "YOUTUBE",
  "big": 12345,
  "cap": "SUBSCRIBERS<br>1.2M lifetime views",
  "gridLabel": "3 UPLOADS THIS MONTH",
  "publishDays": [2, 9, 16],
  "link": "https://studio.youtube.com"
}
```

- `title` renames the widget header (pick anything: REVENUE, TRAINING, PIPELINE).
- `big` is the headline number, `cap` the two-line label under it (HTML `<br>` allowed).
- `publishDays` (optional) lights those days of the current month in the dots grid - use it for uploads, workouts, posting streaks, anything day-based. `gridLabel` is its caption.
- `link` (optional) makes the grid clickable.

### Recipe: YouTube numbers

Tell your agent: "Get my channel's subscriber count and this month's upload days from the YouTube Data API (free key from Google Cloud console, YouTube Data API v3). Write them to snapshots/stats.json in the WIRING.md format, and refresh it daily." That is the whole job - the widget does the rest.

---

## Keeping feeds fresh

Add one standing line to your agent's instructions file, for example:

> After any task that changes my numbers or schedule, update the matching file in the OS snapshots folder (stats.json, routines.json).

That single habit keeps the whole board honest.
