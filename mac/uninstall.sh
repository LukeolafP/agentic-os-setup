#!/bin/bash
# Stops Petra / Agentic OS and removes the four login services. Files are left where they are
# (the vault code, ~/Coding/jarvis); delete those by hand if you want them gone.
for l in rubric-console second-brain agentic-os jarvis-bridge; do
  launchctl bootout "gui/$(id -u)/com.gettruckdrivers.$l" 2>/dev/null && echo "  stopped $l"
  rm -f "$HOME/Library/LaunchAgents/com.gettruckdrivers.$l.plist"
done
echo "  Login services removed. Turn the GTD Rubric plugin off in Obsidian if you like."
