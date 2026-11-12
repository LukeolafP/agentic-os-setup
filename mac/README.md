# Petra and the Agentic OS, at home

Everything to run Petra and the Agentic OS on another Mac, from the setup at work on
22 October 2026: the OS (board, agent constellation, Petra's chat with tabs, managers,
photos, history, voice, the CLAUDE CODE tab), the Second Brain, the Rubric console, the
GTD Rubric Obsidian plugin, the vault hooks, the agent-creator skill and the seven agents.

## The quick way

1. Copy this folder to the home Mac (AirDrop, iCloud Drive or a USB stick).
2. Open Terminal in it and start Claude Code: `cd ~/Downloads/Petra-Agentic-OS-Setup && claude`
3. Say: **"Set this up."** Claude reads `CLAUDE.md` here and walks through it with you.

## By hand

1. Install what it needs, once:
   - Homebrew from brew.sh
   - `brew install node ffmpeg python@3.12`
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` and log in
2. Open your vault in Obsidian once, so it has a `.obsidian` folder.
3. Run the installer, with your vault's path:
   ```
   cd ~/Downloads/Petra-Agentic-OS-Setup
   ./install.sh --vault ~/Documents/GTD
   ```
   It tells you where everything will go and asks before it starts. `--no-voice` skips the
   voice models; `--no-launchd` skips starting at login.
4. Check it: `./check.sh ~/Documents/GTD`. All green ticks means it is running.
5. In Obsidian: Settings > Community plugins > Restricted mode off > GTD Rubric on. Click
   the orbit icon in the left ribbon. Click Petra > Type, and say hello.

The first time Petra talks or listens, she downloads her voice and hearing models (about
3 GB, Apple Silicon only); give it a minute. The first time you click the microphone,
macOS asks whether Obsidian may use it.

## What it does to the computer

- **Your vault:** adds `Installers/Robonuggets/` (the three dashboards), `.claude/hooks`,
  `.claude/skills/agent-creator`, `.claude/settings.json` hooks, `Agents/` (only agents you
  do not already have), the GTD Rubric plugin, and `.claude/agents` as a link to `Agents/`.
  It never changes your notes. It adds `CLAUDE.md`, the Chat Logging and Agent Report Filing
  automations and three empty indexes only if they are missing (a synced vault has them).
  Anything it replaces is copied to `<vault>/.petra-backup/<date-time>/` first.
- **`~/Coding/jarvis`:** Petra's bridge, with its packages and the voice environments.
- **Four login services** (`~/Library/LaunchAgents/com.gettruckdrivers.*`): the console,
  the Second Brain, the OS and Petra's bridge. `./uninstall.sh` removes them.

## Not included, on purpose

- Your vault's notes (they come with the vault, by Obsidian Sync or a copy).
- API keys and connections: the `api-registry` and `marketing` MCP servers, the Instagram
  token, Google Calendar sign-in. Petra uses whatever MCP servers Claude Code has on the
  home Mac; add them there if you want them.
- Logs, chat history, job transcripts, your calendar and stats snapshots, the reports on
  the ring, and the local apps the launcher starts (Lead Tracking, Story Builder and the
  rest live in `~/Coding` on the work Mac; the launcher still lists them, and starting one
  that is not on this Mac says its folder was not found).
