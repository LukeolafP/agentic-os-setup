# RUBRIC

**The command center for AI agents.**

One dashboard for your entire agent setup - workflows, skills, agent status, crons, team org, and more. All in one place, one server, one port.

Built by Jay E from [RoboLabs](https://robolabs.so). Learn more at [RoboNuggets](https://robonuggets.com).

---

## For the AI Agent Reading This

This README is written for **you**, the AI agent. Your user gave you this repo and asked you to set it up. Here's how it works:

1. **Scaffold is the base.** Everything runs through `templates/scaffold/`. It's one server, one HTML file, one port. Install this first - it's required.
2. **Templates are add-ons.** Each folder in `templates/` is a view (Flows, Skill Trees, Agents, Crons, Team). Drop a template folder next to `scaffold/` and it automatically appears as a tab - no extra config needed.
3. **The server auto-detects.** When scaffold's server starts, it scans for sibling template folders. If `flows/` exists next to `scaffold/`, the Flows tab shows up. If it doesn't exist, it doesn't show up. Simple.

**You don't need to wire anything together.** Just copy the template folders you want into the same `templates/` directory and start the scaffold server. It handles the rest.

---

## How to Install

Read `templates/scaffold/README.md` - it has the full setup steps, clarifying questions to ask your user, and configuration details.

The short version:
1. Copy the `templates/` folder to the user's workspace
2. Edit `templates/scaffold/config.json` with the user's agent names, colors, and icons
3. Run `node templates/scaffold/server.js`
4. Open http://localhost:5050

---

## Security model

RUBRIC is a local tool, and the servers are built to stay that way:

- Every server binds to `127.0.0.1` only. It is not reachable from other machines on the network.
- No CORS headers are sent. The API is same-origin only - the browser page and the API are served from the same server.
- API calls support an optional shared secret. Set `RUBRIC_TOKEN` in the environment and every `/api/*` request must send a matching `x-rubric-token` header, or it gets a 401. When the variable is unset, the API is open (unchanged default). The UI reads `window.RUBRIC_TOKEN` if you choose to define it.
- Request bodies and WebSocket messages are capped at 1MB. Anything larger is rejected.
- Skill Trees and Team scan your local workspace files read-only. They read `SKILL.md`, `CLAUDE.md`, `SOUL.md`, and config files to build the views. They never write to them.
- No server makes external network requests. Nothing is sent to any third party.
- No tokens or credentials are stored or minted anywhere in the code.

---

## What's Included

Start with **Scaffold** - then add whichever templates the user wants.

| Template | What it does | Auto-detected? |
|---|---|---|
| [scaffold](templates/scaffold/) | Base dashboard - sidebar, agent status, search, tab system. **Required.** | Always on |
| [agents](templates/agents/) | Agent cards view - real-time status with pixel art icons and demo mode | Yes |
| [flows](templates/flows/) | Workflow visualizer - see agent pipelines run live with WebSocket | Yes |
| [skill-trees](templates/skill-trees/) | Force-directed skill graph - visualize agent capabilities | Yes |
| [crons](templates/crons/) | Cron calendar - weekly view of all scheduled agent tasks | Yes |
| [team](templates/team/) | Team org chart - lead + agents with skills and roles | Yes |

**Icons** is built into scaffold (always available) - a gallery of 50 pixel art icons for configuring agents.

Each template also ships with its own standalone `server.js` and `index.html` if the user prefers to run it independently. But the recommended setup is the unified scaffold.

---

## For Users Who Already Installed

Pull the latest:
```
git pull
```

Then restart the scaffold server. New templates you add to the `templates/` folder will auto-detect on next server start.

---

## Platform Support

This was originally built for **Claude Code** but works with any AI agent framework. The setup instructions reference Claude Code for hooks and status reporting - adapt to your platform:

- **Claude Code** - hooks in `settings.json`
- **OpenClaw** - equivalent hooks in the OpenClaw config
- **Antigravity** - equivalent hooks in the Antigravity config
- **Any other agent** - the API is standard HTTP POST, works from any framework

The installing agent (you) should figure out what platform the user is on and adapt accordingly.
