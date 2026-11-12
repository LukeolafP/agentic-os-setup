# Petra / Agentic OS setup package for Windows

This folder installs Petra and the Agentic OS on a Windows PC. You are Claude Code, opened in
this folder on Luke's PC to set it up. Do the setup below, check it, and report what worked
and what did not. Ask before anything this file does not cover. The Mac sibling of this
package exists; everything here is the Windows way of doing the same thing.

## What it installs

| Part | Where it goes | Port | What it is |
|---|---|---|---|
| Agentic OS | `<vault>\Installers\Robonuggets\rubric-agentic-os` | 50000 | The board: widgets, the agent constellation, Petra's chat panel, windows |
| Second Brain | `<vault>\Installers\Robonuggets\rubric-second-brain` | 5211 | The vault as a map; also `brain.js` (recall and store) |
| Rubric console | `<vault>\Installers\Robonuggets\rubric\templates\scaffold` | 5050 | Agents, flows, skills, schedule, team |
| Petra's bridge (JARVIS) | `~\Coding\jarvis` | 8790 | Petra: voice, the text chat (tabs), managers, the job queue |
| Voice Agent backend | `~\Coding\jarvis\clicky\server.mjs` | 8793 | What the Agentic OS app talks to: routes Ctrl+Alt speech into Petra's chat, speaks back, announces, tours |
| GTD Rubric plugin | `<vault>\.obsidian\plugins\gtd-rubric` | | Shows the OS as a tab inside Obsidian, with the microphone |
| Hooks, skill, agents | `<vault>\.claude\hooks`, `.claude\skills\agent-creator`, `Agents\` | | Chat logging and status hooks (PowerShell), the agent-creator skill, the background agents |
| The app's source | `app\` in this folder | | Built on this PC afterwards, see "The Agentic OS app" below |

The vault is Luke's Obsidian vault, normally `~\Documents\GTD`. On the PC it may be synced
from work (Obsidian Sync), so its notes, `CLAUDE.md` and automations may already be there.
The installer never overwrites notes: it only adds `CLAUDE.md`, the two automations and three
empty indexes if they are missing. Code it replaces is backed up first.

## Setup, step by step

1. **Find the vault.** Ask Luke where it is if `~\Documents\GTD` does not exist. It is the
   folder holding `.obsidian\`. Obsidian must have opened it at least once.
2. **Check the prerequisites** (install what is missing, telling Luke first; open a new
   PowerShell after a winget install so the PATH is fresh):
   - Windows 10 version 2004 or later, or Windows 11. `winget` comes with it.
   - Node 20 or newer: `winget install OpenJS.NodeJS.LTS`
   - Git for Windows (Claude Code uses its bash): `winget install Git.Git`
   - PowerShell 7 (`pwsh`, the hooks run through it): `winget install Microsoft.PowerShell`
   - Claude Code at `~\.local\bin\claude.exe`, logged in: `irm https://claude.ai/install.ps1 | iex`,
     then Luke runs `claude` once and logs in (he has to do the login himself).
   - For voice: Python 3.11 or 3.12 (`winget install Python.Python.3.12`) and
     `winget install Gyan.FFmpeg`. The Microsoft Store's `python.exe` stub does not count.
3. **Make sure nothing else uses the ports** 5050, 5211, 50000, 8790 and 8793:
   `Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5050,5211,50000,8790,8793`.
   If an older copy of these services is running, that is fine: the installer replaces its
   tasks and stops a node started by hand.
4. **Run the installer** from this folder, with the vault path:
   `pwsh -ExecutionPolicy Bypass -File .\install.ps1 -Vault "C:\path\to\vault"` (add `-Yes` once
   Luke has agreed to the paths it prints, or let him answer the prompt). Use `-NoVoice` if he
   does not want the hearing model. If the files are blocked (copied from the internet):
   `Get-ChildItem -Recurse | Unblock-File` first.
5. **Check it:** `.\check.ps1 "C:\path\to\vault"`. Every line should be `[OK]`. Then open
   `http://localhost:50000` in a browser: the board, Petra in the middle of the ring.
6. **In Obsidian** (Luke does this): Settings > Community plugins, Restricted mode off,
   GTD Rubric on (off and on again if Obsidian was open during the install). The orbit icon
   in the left ribbon opens the OS. Click Petra > Type, send a message: it should answer.
7. **Report** to Luke: what is running, what was skipped, and anything from `check.ps1` that
   is not `[OK]`, with the fix. Then offer the app build (below) as the next job.

## Things to know while doing it

- **Paths.** The code in this package has `__VAULT__`, `__HOME__` and `__PWSH__` where this
  PC's paths go; the installer fills them in (with forward slashes, which Node, JSON and
  `pwsh -File` all accept). Never hand-edit a placeholder into a real path in this folder: edit
  the installed copy, or run the installer again.
- **The bridge must live at `~\Coding\jarvis`.** Its code looks there for its job logs and the
  hearing environment. `PETRA_JARVIS_DIR` exists only for dry runs.
- **Models.** Petra talks on Sonnet 5 at low effort (fast replies); queued agents and managers
  use Opus 5.5 at high effort; her text chat uses whatever model Luke's own Claude Code
  settings choose. These are environment lines in the service wrappers
  (`<vault>\Installers\Robonuggets\.tasks\jarvis-bridge.cmd`: `JARVIS_MODEL`, `GTD_JOB_MODEL`),
  because a Scheduled Task cannot set environment variables itself. After editing a wrapper:
  `Stop-ScheduledTask -TaskName "Petra bridge"; Start-ScheduledTask -TaskName "Petra bridge"`.
- **Services.** `Get-ScheduledTask -TaskName "Petra*"` lists them with their state. Each runs
  `wscript.exe run-hidden.vbs <service>.cmd` so no console window shows, restarts after a
  crash, and is limited to the logged-in user. `start.ps1` / `stop.ps1` in
  `Installers\Robonuggets` start and stop them by hand.
- **Voice.** Voxtral and Parakeet are Apple Silicon only. On Windows the bridge speaks with
  Kokoro (`GTD_TTS_ENGINE=kokoro`, in the bridge's packages) and hears with faster-whisper
  through `GTD_PYTHON` (the `.stt-venv`). The Voice Agent in the app speaks with ElevenLabs,
  key in the app's Settings, never in this package.
- **No CLAUDE CODE tab.** node-pty is not installed on Windows (the build in `vendor-pty` is
  Mac-only), so the board's terminal tab stays off. Claude Code runs in its own window.
- **MCP servers are not in this package.** Petra gets whatever MCP servers Luke's Claude Code
  has on this PC (`claude mcp list`). The work Mac also has `api-registry` and `marketing`,
  which hold their own API credentials; they are set up separately, never copied in here.
- **Restarting the bridge ends Petra's live chats and stops running managers.** Before a
  restart, check nothing is mid-work:
  `Get-ChildItem ~\.claude\projects -Recurse -Filter *.jsonl | Where-Object LastWriteTime -gt (Get-Date).AddMinutes(-3)`.
- **Secrets.** This package has none, and nothing you do should add any. API keys belong in
  each tool's own `.env`, in the app's Settings, or in Claude Code's config, never in the vault
  or this folder. `~\.openclicky\shell.json` and `~\.claude.json` are never copied.

## The Agentic OS app

The app (the Voice Agent: Ctrl+Alt to talk, Ctrl+Win to dictate, the pointer, screen agents)
is built on this PC from `app\`, after the installer has run and `check.ps1` is clean. Do it as
a separate Claude Code session opened in `app\`, following `app\AGENTIC-OS-WINDOWS-BRIEF.md`
(then `app\PORTING.md`). It needs the .NET 8 SDK (`winget install Microsoft.DotNet.SDK.8`)
and, for the Setup.exe, Velopack's `vpk` (`dotnet tool install -g vpk`). `app\mac-reference\`
is the Mac app's Swift source, the behaviour to port. Until the app is built, Ctrl+Alt voice is
not available; typing to Petra in Obsidian is.

## When something does not work

| Symptom | Look at | Usual fix |
|---|---|---|
| A port does not answer | `<vault>\Installers\Robonuggets\.logs\*.log`, `~\Coding\jarvis\.gtd-jobs\bridge.log` | Read the last lines; `Start-ScheduledTask -TaskName "Petra <name>"`, or run the `.cmd` in `.tasks\` in a terminal to see the error |
| A task shows Ready but nothing listens | Task Scheduler > the task > History | Run the wrapper by hand: `& "<vault>\Installers\Robonuggets\.tasks\jarvis-bridge.cmd"` |
| Petra's chat says the bridge is offline | `bridge.log` | `node -v` is 20+; `cd ~\Coding\jarvis; npm ci --ignore-scripts` |
| Hooks error on every prompt | `<vault>\.claude\settings.json` | Paths there must point at this vault's `.claude\hooks\*.ps1` through `pwsh` (or `powershell`); `pwsh` must be on the PATH |
| Petra cannot hear in the dashboard | Settings > Privacy & security > Microphone: Obsidian on | Re-run `install.ps1` with voice; ffmpeg on the PATH |
| Petra's voice is silent | `bridge.log` lines about kokoro | The first use downloads the Kokoro model; give it a minute |
| Second Brain map is empty | `rubric-second-brain\config\workspace.json` `root` | Must be the vault path; re-run the installer with `-Vault` |
| OPEN OUTSIDE opens nothing | `.obsidian\plugins\gtd-rubric\open-log.txt` | Turn the plugin off and on; the OS falls back to Obsidian's own link handling |
| `install.ps1` will not run | Execution policy | `pwsh -ExecutionPolicy Bypass -File .\install.ps1`, or `Unblock-File` on the folder |
| Ctrl+Alt does nothing | The app is not built yet | See "The Agentic OS app" |

## Layout of this folder

- `install.ps1`, `check.ps1`, `uninstall.ps1`: install, health check, remove the logon tasks
- `vault\`: everything that goes into the vault, laid out as it will be there (`.sh` and `.ps1` side by side)
- `vault-seed\`: notes added only if the vault lacks them
- `jarvis\`: Petra's bridge and the Voice Agent backend, the JARVIS project without its installed packages
- `app\`: the Windows app's source, `app\mac-reference\` and the brief
- `requirements-voice-whisper.txt`: the Python packages for the hearing
- `README.md`: the same setup, for Luke
