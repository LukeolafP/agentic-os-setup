# RING.md - make every build land on the ring

The center ring is the OS's memory: every HTML file in the `artifacts/` folder becomes a ball - a bookmark you can reopen, search (`/`), and browse forever. The habit that makes it magic: your agent registers everything it builds, automatically.

## The snippet (copy-paste into your agent's instructions file)

Add this to the file your agent reads at the start of every session (its instructions or memory file), adjusting the one path:

```
### Register finished HTML on my OS ring
Every time you finish an HTML page for me (report, dashboard, one-pager, demo):
1. Copy the file to <path-to-your-os>/artifacts/<short-slug>.html
2. Write <short-slug>.json next to it:
   { "title": "Short Human Title", "icon": "doc", "kind": "report",
     "created": "<iso timestamp>", "note": "one line on what it is",
     "svg": "<circle cx='24' cy='24' r='14'/>" }
3. The svg is 1-4 stroke paths on a 48x48 viewBox, no fill or stroke attributes,
   and should depict THAT artifact so I can find it at a glance.
4. Tell me: "added to the OS ring as <title>".
Icon fallback categories: dash, deck, report, mail, video, chart, visual, bolt, doc.
```

During install, your agent can add this for you - say yes when it offers.

## Notes

- The ring scans the folder live - a new file is a new ball on the next refresh, no restart.
- **Right-click any ball** for OPEN (new tab) / REMOVE. Remove is reversible: the artifact and its sidecar move to `artifacts/_trash` - drag them back out to restore the ball.
- The circle only shows as many balls as physically fit; older ones hide automatically. Press `/` and matching hidden balls surface on an inner ring while you search.
- Every ball carries a grey 30-day depleting arc and a day tag (nothing on the day it was made). Newest sits at the right, beside the orange index ball.
- The `artifacts/` location is `artifactsDir` in `os-config.json`. Point it anywhere (an absolute path works) if you want the ring to watch an existing folder.
- Skill-deck run reports register themselves automatically.
- Three sample balls ship with the kit so you can feel the interaction - delete their files in `artifacts/` any time.
