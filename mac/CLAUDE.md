# Petra / Agentic OS setup package

This folder installs Petra and the Agentic OS on a Mac. You are Claude Code, opened in this
folder on Luke's home computer to set it up. Do the setup below, check it, and report
what worked and what did not. Ask before anything this file does not cover.

## What it installs

| Part | Where it goes | Port | What it is |
|---|---|---|---|
| Agentic OS | `<vault>/Installers/Robonuggets/rubric-agentic-os` | 50000 | The board: widgets, the agent constellation, Petra's chat panel, windows, the CLAUDE CODE tab |
| Second Brain | `<vault>/Installers/Robonuggets/rubric-second-brain` | 5211 | The vault as a map; also `brain.js` (recall and store) |
| Rubric console | `<vault>/Installers/Robonuggets/rubric/templates/scaffold` | 5050 | Agents, flows, skills, schedule, team |
| Petra's bridge (JARVIS) | `~/Coding/jarvis` | 8790 | Petra: voice, the text chat (tabs), managers, the job queue, the terminal |
| GTD Rubric plugin | `<vault>/.obsidian/plugins/gtd-rubric` | | Shows the OS as a tab inside Obsidian, with the microphone |
| Hooks, skill, agents | `<vault>/.claude/hooks`, `.claude/skills/agent-creator`, `Agents/` | | Chat logging and status hooks, the agent-creator skill, the background agents |

The vault is Luke's Obsidian vault, normally `~/Documents/GTD`. On the home Mac it may be
synced from work (Obsidian Sync), so its notes, `CLAUDE.md` and automations may already be
there. The installer never overwrites notes: it only adds `CLAUDE.md`, the two automations
and three empty indexes if they are missing. Code it replaces is backed up first.

## Setup, step by step

1. **Find the vault.** Ask Luke where it is if `~/Documents/GTD` does not exist. It is the
   folder holding `.obsidian/`. Obsidian must have opened it at least once.
2. **Check the prerequisites** (install what is missing, telling Luke first):
   - macOS. Apple Silicon (M1 or later) for the local voice models; Intel works without them.
   - Homebrew (`/opt/homebrew/bin/brew`). If missing, ask Luke to run the install command
     from brew.sh himself: it asks for his password.
   - Node 20 or newer: `brew install node`
   - Claude Code at `~/.local/bin/claude`, logged in: `curl -fsSL https://claude.ai/install.sh | bash`,
     then Luke runs `claude` once and logs in (he has to do the login himself).
   - For voice: Python 3.11 or 3.12 (`brew install python@3.12`) and `brew install ffmpeg`.
3. **Make sure nothing else uses the ports** 5050, 5211, 50000 and 8790:
   `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(5050|5211|50000|8790)\b'`. If an older copy of
   these services is running, that is fine: the installer replaces its launchd jobs.
4. **Run the installer** from this folder, with the vault path:
   `./install.sh --vault "/path/to/vault"` (add `--yes` once Luke has agreed to the paths it
   prints, or let him answer the prompt). Use `--no-voice` if he does not want the voice
   models (about 3 GB, downloaded the first time Petra speaks or listens).
5. **Check it:** `./check.sh "/path/to/vault"`. Every line should be a green tick. Then open
   `http://localhost:50000` in a browser: the board, Petra in the middle of the ring.
6. **In Obsidian** (Luke does this): Settings > Community plugins, Restricted mode off,
   GTD Rubric on (off and on again if Obsidian was open during the install). The orbit icon
   in the left ribbon opens the OS. Click Petra > Type, send a message: it should answer.
7. **Report** to Luke: what is running, what was skipped, and anything from `check.sh` that
   is not a tick, with the fix.

## Things to know while doing it

- **Paths.** The code in this package has `__VAULT__` and `__HOME__` where this Mac's paths
  go; the installer fills them in. Never hand-edit a placeholder into a real path in this
  folder: edit the installed copy, or run the installer again.
- **The bridge must live at `~/Coding/jarvis`.** Its code looks there for its job logs,
  voice environment and node-pty. `PETRA_JARVIS_DIR` exists only for dry runs.
- **Models.** Petra talks on Sonnet 5 at low effort (fast replies); queued agents and
  managers use Opus 5.5 at high effort; her text chat uses whatever model Luke's own
  Claude Code settings choose. These are in the bridge's launchd job
  (`~/Library/LaunchAgents/com.gettruckdrivers.jarvis-bridge.plist`, `JARVIS_MODEL`,
  `GTD_JOB_MODEL`). After editing a plist: `launchctl bootout gui/$UID/<label>` then
  `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/<label>.plist`.
- **MCP servers are not in this package.** Petra gets whatever MCP servers Luke's Claude Code
  has on this Mac (`claude mcp list`). The work Mac also has `api-registry` and `marketing`,
  which hold their own API credentials; they are set up separately, never copied in here.
- **Restarting the bridge ends Petra's live chats and stops running managers.** Before a
  restart, check nothing is mid-work: `find ~/.claude/projects -name "*.jsonl" -mmin -3`.
- **Secrets.** This package has none, and nothing you do should add any. API keys belong in
  each tool's own `.env` or in Claude Code's config, never in the vault or this folder.

## When something does not work

| Symptom | Look at | Usual fix |
|---|---|---|
| A port does not answer | `<vault>/Installers/Robonuggets/.logs/*.log`, `~/Coding/jarvis/.gtd-jobs/bridge.log` | Read the last lines; `launchctl kickstart -k gui/$UID/com.gettruckdrivers.<name>` |
| Petra's chat says the bridge is offline | `bridge.log` | `node -v` is 20+; `cd ~/Coding/jarvis && npm ci --ignore-scripts` |
| CLAUDE CODE tab: "node-pty is not installed" | `~/Coding/jarvis/vendor-pty` | `cd ~/Coding/jarvis/vendor-pty && npm install`, then `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` |
| Petra cannot hear | macOS Settings > Privacy & Security > Microphone: Obsidian on | Re-run `./install.sh` with voice; `brew install ffmpeg` |
| Petra's voice is the plain fallback | `bridge.log` lines about Voxtral | Apple Silicon only; the first use downloads the model, give it a minute |
| Second Brain map is empty | `rubric-second-brain/config/workspace.json` `root` | Must be the vault path; re-run the installer with `--vault` |
| OPEN OUTSIDE opens nothing | `.obsidian/plugins/gtd-rubric/open-log.txt` | Turn the plugin off and on; the OS falls back to Obsidian's own link handling |
| Hooks error on every prompt | `<vault>/.claude/settings.json` | Paths there must point at this vault's `.claude/hooks` |

## Layout of this folder

- `install.sh`, `check.sh`, `uninstall.sh`: install, health check, remove the login services
- `vault/`: everything that goes into the vault, laid out as it will be there
- `vault-seed/`: notes added only if the vault lacks them
- `jarvis/`: Petra's bridge, the JARVIS project without its installed packages
- `requirements-voice-*.txt`: the Python packages for the voice
- `README.md`: the same setup, for Luke
