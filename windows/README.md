# Petra and the Agentic OS, on a Windows PC

Everything to run Petra and the Agentic OS on a Windows PC, the sibling of the Mac package
from the setup at work: the OS (board, agent constellation, Petra's chat with tabs, managers,
photos, history, voice), the Second Brain, the Rubric console, the GTD Rubric Obsidian plugin,
the vault hooks, the agent-creator skill, the agents, and the source of the Agentic OS app for
Windows, to be built on the PC.

Windows 10 version 2004 or later, or Windows 11.

## The quick way

1. Copy this folder to the PC (OneDrive, a USB stick, or a network share), for example to
   `C:\Users\<you>\Downloads\Petra-Agentic-OS-Windows`.
2. Install Claude Code once: open PowerShell and run `irm https://claude.ai/install.ps1 | iex`,
   then `claude` and log in. It needs Git for Windows (`winget install Git.Git`).
3. Open PowerShell in this folder and start Claude Code: `cd $HOME\Downloads\Petra-Agentic-OS-Windows; claude`
4. Say: **"Set this up."** Claude reads `CLAUDE.md` here and walks through it with you.

## By hand

1. Install what it needs, once (open a new PowerShell after each so the PATH is fresh):
   - `winget install OpenJS.NodeJS.LTS` (Node 20 or newer)
   - `winget install Git.Git` (Claude Code uses its bash)
   - `winget install Microsoft.PowerShell` (PowerShell 7; the vault hooks run through it)
   - Claude Code: `irm https://claude.ai/install.ps1 | iex`, then run `claude` and log in
   - For voice: `winget install Python.Python.3.12` and `winget install Gyan.FFmpeg`
2. Open your vault in Obsidian once, so it has a `.obsidian` folder.
3. Run the installer, with your vault's path:
   ```powershell
   cd $HOME\Downloads\Petra-Agentic-OS-Windows
   pwsh -ExecutionPolicy Bypass -File .\install.ps1 -Vault "$HOME\Documents\GTD"
   ```
   It tells you where everything will go and asks before it starts. `-NoVoice` skips the
   hearing model; `-NoServices` skips starting at logon. If Windows blocked the files when they
   were copied in, `Get-ChildItem -Recurse | Unblock-File` first.
4. Check it: `.\check.ps1 "$HOME\Documents\GTD"`. All `[OK]` means it is running.
5. In Obsidian: Settings > Community plugins > Restricted mode off > GTD Rubric on. Click
   the orbit icon in the left ribbon. Click Petra > Type, and say hello.

The first time Petra listens in the dashboard, faster-whisper downloads its model; give it a
minute. The first time you click the microphone, Windows asks whether Obsidian may use it.
Petra's spoken voice in the dashboard is Kokoro (built into the bridge); the Voice Agent in the
app speaks with ElevenLabs. Voxtral and Parakeet are Apple-only and are not in this package.

## What it does to the computer

- **Your vault:** adds `Installers\Robonuggets\` (the three dashboards, `start.ps1`/`stop.ps1`,
  and `.tasks\` with one `.cmd` per service holding its settings), `.claude\hooks` (PowerShell
  hooks; the Mac `.sh` ones come along), `.claude\skills\agent-creator`, `.claude\settings.json`
  hooks, `Agents\` (only agents you do not already have), the GTD Rubric plugin, and
  `.claude\agents` as a junction to `Agents\`. It never changes your notes. It adds `CLAUDE.md`,
  the Chat Logging and Agent Report Filing automations and three empty indexes only if they are
  missing (a synced vault has them). Anything it replaces is copied to
  `<vault>\.petra-backup\<date-time>\` first.
- **`$HOME\Coding\jarvis`:** Petra's bridge, with its packages and the hearing environment
  (`.stt-venv`). node-pty, which gives the Mac board its CLAUDE CODE tab, is not installed:
  its build in this package is Mac-only, so that tab stays off on Windows.
- **Five logon tasks** in Task Scheduler, `Petra Rubric console`, `Petra Second Brain`,
  `Petra Agentic OS`, `Petra bridge` and `Petra voice agent`: each runs `node` with no window
  through `Installers\Robonuggets\.tasks\run-hidden.vbs`, restarts it if it dies, and logs to
  `Installers\Robonuggets\.logs\` and `$HOME\Coding\jarvis\.gtd-jobs\`. `.\uninstall.ps1`
  removes them. The voice agent task is a fallback: the Agentic OS app starts that backend
  itself while it runs.

## Not included, on purpose

- Your vault's notes (they come with the vault, by Obsidian Sync or a copy).
- API keys and connections: the `api-registry` and `marketing` MCP servers, the Instagram
  token, Google Calendar sign-in, the ElevenLabs key (that goes into the app's Settings). Petra
  uses whatever MCP servers Claude Code has on the PC; add them there if you want them.
- Logs, chat history, job transcripts, your calendar and stats snapshots, the reports on the
  ring, the Voice Agent's memory, and the local apps the launcher starts (Lead Tracking, Story
  Builder and the rest live in `~/Coding` on the work Mac; the launcher still lists them, and
  starting one that is not on this PC says its folder was not found).
- Petra's Mac voice and hearing (Voxtral, Parakeet) and the Mac `Petra Computer` helper.

## The Agentic OS app

The app itself (the Voice Agent: hold Ctrl+Alt and talk, the pointer, dictation, screen agents)
is built on the PC, not shipped here. `app\` holds the Windows port of OpenClicky (C#, .NET 8,
WPF), the Mac app's sources as `app\mac-reference\` (our additions live there; the PC session
ports them), and `app\AGENTIC-OS-WINDOWS-BRIEF.md`, the brief for that work. After the installer
has run, open Claude Code in `app\` and say "Follow the brief". It needs the .NET 8 SDK
(`winget install Microsoft.DotNet.SDK.8`) and, for the installer, the Velopack `vpk` tool
(`dotnet tool install -g vpk`). Until the app is built, Ctrl+Alt voice is not available, but
typing to Petra in Obsidian is, and the dashboard microphone works once voice is installed.
