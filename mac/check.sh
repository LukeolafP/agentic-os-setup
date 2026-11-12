#!/bin/bash
# Health check for Petra / Agentic OS. Read only: it changes nothing.
VAULT="${1:-$HOME/Documents/GTD}"; JARVIS="$HOME/Coding/jarvis"; R="$VAULT/Installers/Robonuggets"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }; bad() { printf "  \033[31m✗\033[0m %s\n" "$*"; }
echo "Vault: $VAULT"
command -v node >/dev/null && ok "node $(node -v)" || bad "node missing"
{ [ -x "$HOME/.local/bin/claude" ] || command -v claude >/dev/null; } && ok "Claude Code installed" || bad "Claude Code missing"
for p in 5050:"Rubric console" 5211:"Second Brain" 50000:"Agentic OS" 8790:"Petra's bridge"; do
  port=${p%%:*}; name=${p#*:}
  curl -s -m 3 -o /dev/null "http://127.0.0.1:$port" && ok "$name on :$port" || bad "$name not answering on :$port"
done
for l in rubric-console second-brain agentic-os jarvis-bridge; do
  launchctl print "gui/$(id -u)/com.gettruckdrivers.$l" >/dev/null 2>&1 && ok "launchd: $l loaded" || bad "launchd: $l not loaded"
done
[ -L "$VAULT/.claude/agents" ] && ok ".claude/agents -> $(readlink "$VAULT/.claude/agents") ($(ls "$VAULT/Agents" | grep -c '\.md$') notes)" || bad ".claude/agents is not a link to Agents/"
[ -f "$VAULT/.obsidian/plugins/gtd-rubric/main.js" ] && ok "Obsidian plugin present" || bad "Obsidian plugin missing"
grep -q gtd-rubric "$VAULT/.obsidian/community-plugins.json" 2>/dev/null && ok "plugin turned on" || bad "plugin not in community-plugins.json"
[ -d "$JARVIS/node_modules/@anthropic-ai/claude-agent-sdk" ] && ok "bridge packages" || bad "bridge packages missing (cd $JARVIS && npm ci --ignore-scripts)"
[ -x "$JARVIS/vendor-pty/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper" ] || [ -x "$JARVIS/vendor-pty/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper" ] && ok "node-pty (Claude Code tab)" || bad "node-pty missing or helper not executable"
[ -x "$JARVIS/.tts-venv/bin/python" ] && ok "voice environment (.tts-venv)" || bad "no voice environment: typing works, talking falls back"
grep -q "__VAULT__\|__HOME__" -r "$R" "$VAULT/.claude" 2>/dev/null && bad "unfilled path placeholders left (run install.sh again)" || ok "paths filled in"
echo; echo "Last lines of Petra's bridge log:"; tail -5 "$JARVIS/.gtd-jobs/bridge.log" 2>/dev/null | sed 's/^/    /'
