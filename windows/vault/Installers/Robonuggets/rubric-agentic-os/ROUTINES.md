# ROUTINES.md - wire the routines board

The routines board shows today's automated schedule: which routine fires when, from which source, with a live countdown to the next one. Fired rows dim, the next one glows.

## The feed

Your agent maintains `snapshots/routines.json` (a starter copy ships as `snapshots/routines.sample.json` - rename it to see the board working):

```json
{
  "generated": "2026-01-01T07:00:00Z",
  "sources": [
    { "key": "desktop", "label": "DESKTOP AGENT" },
    { "key": "server",  "label": "HOME SERVER" }
  ],
  "counts": { "desktop": 4, "server": 9 },
  "routines": [
    { "t": "07:00", "d": "daily",       "src": "desktop", "n": "morning digest",  "desc": "summarize inbox + calendar into one note" },
    { "t": "18:30", "d": "mon,wed,fri", "src": "server",  "n": "backup sweep",    "desc": "sync workspace to the NAS" },
    { "t": "21:00", "d": "dom:1",       "src": "server",  "n": "monthly report",  "desc": "fires on the 1st of the month" }
  ]
}
```

- `sources` - any names you like, any number of them. First one gets the accent color. The board's legend and row labels come from here.
- `t` - 24h fire time. `d` - `daily`, day names (`mon,thu`), or `dom:N` for a day of the month.
- `counts` - total routines per source, shown in the legend.
- `est: true` on a routine marks its time as estimated (shows in the hover tip).

## Where the data comes from

Whatever scheduler you have, the recipe is the same - ask your agent to export its schedule into the feed and refresh it daily:

- **Agent app schedulers** (scheduled tasks in a desktop agent): "list my scheduled tasks and write them to snapshots/routines.json in the ROUTINES.md format, refresh after any change".
- **cron on a server or VPS**: "read my crontab and translate each line into a routines.json row".
- **OS schedulers** (Task Scheduler, launchd): same sentence, different source.
- **Several at once**: one source entry each - that is exactly what `sources` is for.

## No scheduler yet?

Then this board is your nudge. Recurring agent routines are the single highest-leverage automation habit: a morning digest, an evening log, a weekly report - each is one sentence to your agent ("every day at 7am, do X"). Start with one. The board makes it visible, and visible routines survive.

Until then the widget shows a quiet onboarding hint. Remove it via edit mode if you prefer - the library re-adds it later.
