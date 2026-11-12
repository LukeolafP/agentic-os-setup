# Petra and the Agentic OS

Petra is a main agent who lives in your Obsidian vault and runs everything else: managers that
work in the background, specialist agents, screen agents that use your computer, three local
dashboards, and a Voice Agent you talk to from anywhere on your Mac or PC. It all runs on your
own Claude plan through the Claude Agent SDK; nothing goes to a hosted service.

This repository holds the installers. The program you talk to (the Voice Agent, our fork of
OpenClicky) is in its own repository: **[agentic-os](https://github.com/LukeolafP/agentic-os)**.

## What you get

- **The Agentic OS**: a dashboard with Petra's chat (tabs, managers, photos, history, voice),
  the agent constellation, the ring of your work, calendar and stats.
- **The Second Brain**: your whole vault as one map, with instant recall.
- **The Rubric console**: agents, flows, skill trees.
- **The GTD Rubric plugin** for Obsidian: all of it inside Obsidian, with the microphone.
- **The Voice Agent**: hold a shortcut, say what you want, and it goes into the right chat; it
  tells you when work comes back and walks you through the result on screen; Petra can send a
  screen agent to work inside an app window while you keep working.

## Install

| | Mac | Windows |
|---|---|---|
| Folder | [`mac/`](mac/) | [`windows/`](windows/) |
| Read first | [mac/README.md](mac/README.md) | [windows/README.md](windows/README.md) |
| Needs | macOS 14+, Node 20+, Claude Code, Obsidian; Apple Silicon for Petra's own voice | Windows 10 2004+ or 11, Node 20+, Claude Code, Obsidian; .NET 8 SDK to build the program |
| Installer | `./install.sh --vault <your vault>` | `.\install.ps1 -Vault <your vault>` |
| Check | `./check.sh` | `.\check.ps1` |
| The program | the Agentic OS app, from the [agentic-os](https://github.com/LukeolafP/agentic-os) repository (or its Releases) | built on the PC from the same repository's `windows/` folder, following `AGENTIC-OS-WINDOWS-BRIEF.md` |

The quickest way on either system: copy the folder, open a terminal in it, start Claude Code
with `claude`, and say **"Set this up."** The `CLAUDE.md` in each folder walks it through.

## What it does to your computer

Each installer says exactly what it will do before it starts and asks first. In short: it adds
the dashboards, hooks, the agent-creator skill, the agents and the plugin to your vault (backing
up anything it replaces), installs Petra's bridge under `~/Coding/jarvis`, and sets four services
to start at login. The uninstaller removes the services. Your notes are never changed.

## Not included

Your vault's notes, your API keys and MCP connections, and anything already on the machine that
built this. Petra uses whatever Claude Code can reach on your computer.

## Licence

MIT, see [LICENSE](LICENSE). It includes work by Aditya Dewaskar (JARVIS), Prasanth Sasikumar and
Farza (OpenClicky and Clicky) and Zach Latta (FreeFlow), each under MIT.
