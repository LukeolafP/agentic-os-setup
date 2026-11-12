![Rubric Agentic OS](banner.png)

# Rubric Agentic OS

A live mission-control dashboard your agent runs on your own machine. One page at `http://localhost:50000` shows your calendar, inbox triage, routines, any stats you care about, a launcher for your local tools, and a ring of every artifact your agent has ever shipped - each one a clickable ball. A skills deck runs your agent headlessly at the tap of a play button.

Built by Jay E at [RoboNuggets](https://www.skool.com/robonuggets). License: CC BY 4.0 (see LICENSE).

## Quick start

1. Install [Node.js](https://nodejs.org) 18 or newer (the server has zero dependencies).
2. Unzip this folder anywhere you like.
3. Run `node server.js` inside the folder.
4. Open `http://localhost:50000`. A short tour starts on first visit - the info icon in the toolbar replays it.

The OS works immediately. Widgets show a "not wired yet" hint until your agent connects them - that is by design, nothing is broken.

## Let your agent set it up (recommended)

This kit is built to be installed BY your agent, whatever agent you use. Tell it:

> Read the README of this kit, then interview me about my setup - what email, calendar, scheduler, stats and local tools I have - and recommend which widgets to wire first. Then wire them one at a time using the guides.

The guides, one per widget:

| Widget | Guide | What your agent does |
|---|---|---|
| Calendar | [OAUTH.md](OAUTH.md) | One-time Google sign-in, then live events |
| Email | [WIRING.md](WIRING.md) | Inbox triage: partnerships / leads / personal / other |
| Stats | [WIRING.md](WIRING.md) | Feeds ANY numbers you care about (a YouTube recipe is included) |
| Routines | [ROUTINES.md](ROUTINES.md) | Publishes your real schedule to the board |
| Artifacts ring | [RING.md](RING.md) | Teaches your agent to register every build as a ball |
| Skills deck | below | Recommends and wires your first skill cards |
| Look and feel | [REDESIGN.md](REDESIGN.md) | Reskin the whole OS from one token block |

Widgets you do not use: open edit mode (pencil icon) and remove them - the widget library (grid icon) re-adds any of them later.

## The skills deck

Cards in the deck run real headless agent sessions. Tap play, your agent runs that skill, and the result lands on the ring as a formatted report.

- The deck ships empty. Ask your agent to recommend 2-4 of your existing skills that finish cleanly without needing your input mid-run - those make the best cards.
- Cards live in `os-config.json` under `"skills"`. The + ADD SKILL button in the deck header gives your agent a ready prompt.
- The runner is one command template in `os-config.json`. The shipped default uses the `claude` CLI; swap the template for whatever CLI your agent provides. `{skill}`, `{model}` and `{effort}` are filled from the card's dials, and the dial labels themselves (`models` / `efforts`) are yours to rename.
- Set `runner.cwd` to the folder where your agent finds your skills (usually your main workspace).

Two things to know: each play burns real usage on your agent plan, at the model the card is set to. And the default runner template skips permission prompts so runs can finish unattended - remove `--permission-mode bypassPermissions` from the template if you prefer your agent to be prompted.

## Everyday use

- Start it with `node server.js`, or ask your agent to set up an autostart that fits your machine (Task Scheduler, launchd, pm2 - any of them work).
- Port 50000 is the default. Change `"port"` in `os-config.json` if it clashes.
- The ring sorts itself: the orange index ball holds the right side, the newest work sits beside it, and older balls age around the circle. Every ball wears a grey 30-day arc and a day tag so you can read its age at a glance. Hover the orange ball to see every ball's name.
- Only as many balls as fit the circle are shown. Press `/` to search everything - older hidden balls surface while you type.
- Click a ball to open it. **Right-click** a ball for OPEN / REMOVE - removed artifacts move to `artifacts/_trash`, so nothing is ever lost by mis-click.

## Folder map

```
rubric-agentic-os/
  dashboard.html      the OS page
  server.js           the local server (node, zero deps)
  os-config.json      port, skills, runner, dial labels, email keywords
  widgets.html        widget library + build-a-widget prompts
  tools/              google-calendar.js (see OAUTH.md)
  snapshots/          data feeds your agent maintains (stats.json, routines.json ...)
  artifacts/          every HTML here becomes a ball on the ring
  os-runs/            logs of headless skill runs (created on first run)
```

## Second Brain

The micro apps launcher has a Second Brain row. If you run one on port 5211 it links automatically. If you do not have one yet, the row opens the build-it-yourself module in the [RoboNuggets classroom](https://www.skool.com/robonuggets/classroom/7e082e48?md=21b57bd12152486eb6280168c7ea5ac4).

## Credit

Made by Jay E | [RoboNuggets](https://www.skool.com/robonuggets) - the community where this OS was built live. CC BY 4.0: use it, modify it, ship your own version, just keep a credit line.
