#!/bin/bash
# Petra / Agentic OS installer for a Mac.
#
#   ./install.sh                       vault at ~/Documents/GTD, everything
#   ./install.sh --vault "/path/to/vault"
#   ./install.sh --no-voice            skip the local voice models (Petra still types)
#   ./install.sh --no-launchd          do not start anything at login (use start.sh by hand)
#   ./install.sh --yes                 do not ask before overwriting
#
# What it does, in order (each step says what it did):
#   1. checks the tools it needs (Node 20+, npm, Claude Code, and for voice Python 3 + ffmpeg)
#   2. copies the dashboards, hooks, skill, agents and Obsidian plugin into the vault
#      (anything it replaces is moved to <vault>/.petra-backup/<time>/ first)
#   3. writes this Mac's paths into the files that need them
#   4. links .claude/agents to Agents/, turns the GTD Rubric plugin on
#   5. copies the JARVIS bridge (Petra) to ~/Coding/jarvis and installs its packages
#   6. sets up the voice: Voxtral + Parakeet (Apple Silicon) and faster-whisper as fallback
#   7. installs four launchd services so it all starts at login, and checks they answer
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VAULT="$HOME/Documents/GTD"
JARVIS="${PETRA_JARVIS_DIR:-$HOME/Coding/jarvis}"   # the bridge expects ~/Coding/jarvis; the variable is only for testing
VOICE=1; LAUNCHD=1; YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vault) VAULT="${2%/}"; shift 2 ;;
    --no-voice) VOICE=0; shift ;;
    --no-launchd) LAUNCHD=0; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$VAULT/.petra-backup/$STAMP"
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }
step() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ask()  { [ $YES = 1 ] && return 0; read -r -p "  $1 [y/N] " a; [ "$a" = y ] || [ "$a" = Y ]; }

# ------------------------------------------------------------------ 1. tools
step "1. Checking this Mac"
[ "$(uname)" = Darwin ] || die "This installer is for macOS (it uses launchd)."
ARCH="$(uname -m)"; ok "macOS $(sw_vers -productVersion) on $ARCH"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "Node.js is missing. Install it: brew install node   (or from nodejs.org), then run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old; Petra needs Node 20 or newer (brew upgrade node)."
ok "Node $(node -v) at $NODE"
command -v npm >/dev/null || die "npm is missing (it comes with Node)."
CLAUDE_BIN="$HOME/.local/bin/claude"; [ -x "$CLAUDE_BIN" ] || CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || die "Claude Code is missing. Install it: curl -fsSL https://claude.ai/install.sh | bash   then run claude once and log in."
ok "Claude Code $("$CLAUDE_BIN" --version 2>/dev/null | head -1) at $CLAUDE_BIN"
[ -d "$VAULT" ] || die "No vault at $VAULT. Pass --vault \"/path/to/your vault\"."
[ -d "$VAULT/.obsidian" ] || warn "$VAULT has no .obsidian folder yet: open it in Obsidian once (Open folder as vault) so the plugin can be turned on."
ok "Vault: $VAULT"
if [ $VOICE = 1 ]; then
  PY="$(command -v python3.12 || command -v python3.11 || command -v python3 || true)"
  if [ -z "$PY" ]; then warn "No Python 3: skipping voice (brew install python@3.12, then run again)."; VOICE=0
  else ok "Python $("$PY" -c 'import sys;print(sys.version.split()[0])') at $PY"; fi
  command -v ffmpeg >/dev/null && ok "ffmpeg found" || warn "ffmpeg is missing: speech-to-text needs it. brew install ffmpeg"
fi

echo
echo "  Will install into:  $VAULT   and   $JARVIS"
echo "  Replaced files go to $BACKUP"
ask "Go ahead?" || { echo "  Stopped. Nothing changed."; exit 0; }

# copy a folder from the package, backing up anything it overwrites
put() { # src(relative to package) dest(absolute)
  mkdir -p "$2"
  rsync -a --backup --backup-dir="$BACKUP/$(echo "$2" | sed "s#^$VAULT/##; s#^$HOME/#home/#")" "$HERE/$1/" "$2/"
}
detoken() { # replace __VAULT__ / __HOME__ in every file under the given folders
  for d in "$@"; do
    [ -e "$d" ] || continue
    grep -rlI -e '__VAULT__' -e '__HOME__' "$d" 2>/dev/null | while IFS= read -r f; do
      V="$VAULT" H="$HOME" perl -pi -e 's/__VAULT__/$ENV{V}/g; s/__HOME__/$ENV{H}/g' "$f"
    done
  done
}

# ------------------------------------------------------------------ 2-3. vault
step "2. Dashboards, hooks, skill, agents and plugin into the vault"
R="$VAULT/Installers/Robonuggets"
mkdir -p "$R"; rsync -a --backup --backup-dir="$BACKUP/Installers/Robonuggets" --exclude "00 Robonuggets Index.md" "$HERE/vault/Installers/Robonuggets/" "$R/"
[ -e "$R/00 Robonuggets Index.md" ] || cp "$HERE/vault/Installers/Robonuggets/00 Robonuggets Index.md" "$R/"
ok "Installers/Robonuggets (Rubric console, Second Brain, Agentic OS)"
put vault/.claude/hooks "$VAULT/.claude/hooks";               chmod +x "$VAULT/.claude/hooks/"*.sh; ok ".claude/hooks"
put vault/.claude/skills "$VAULT/.claude/skills";             ok ".claude/skills (agent-creator)"
put vault/.obsidian/plugins/gtd-rubric "$VAULT/.obsidian/plugins/gtd-rubric"; ok ".obsidian/plugins/gtd-rubric"
mkdir -p "$VAULT/Agents"
rsync -a --ignore-existing "$HERE/vault/Agents/" "$VAULT/Agents/";   ok "Agents/ (existing agent notes left as they are)"
# hook settings: keep anything else already in .claude/settings.json, set the hooks
python3 - "$VAULT/.claude/settings.json" "$HERE/vault/.claude/settings.json" "$BACKUP" <<'PY'
import json, os, sys, shutil
dst, src, backup = sys.argv[1:4]
new = json.load(open(src))
cur = {}
if os.path.exists(dst):
    os.makedirs(backup + '/.claude', exist_ok=True); shutil.copy2(dst, backup + '/.claude/settings.json')
    try: cur = json.load(open(dst))
    except Exception: cur = {}
cur['hooks'] = new['hooks']
os.makedirs(os.path.dirname(dst), exist_ok=True)
json.dump(cur, open(dst, 'w'), indent=2)
PY
ok ".claude/settings.json (hooks set, other settings kept)"
# notes Petra relies on, only if the vault does not have them (a synced vault will)
for f in "CLAUDE.md" "Memory/Automations/Chat Logging.md" "Memory/Automations/Agent Report Filing.md"; do
  if [ ! -e "$VAULT/$f" ]; then mkdir -p "$(dirname "$VAULT/$f")"; cp "$HERE/vault-seed/$f" "$VAULT/$f"; detoken "$VAULT/$f"; ok "added $f"; fi
done
for f in "Memory/Chats/00 Chat Index.md" "Memory/Facts/00 Facts Index.md" "Reports/00 Reports Index.md"; do
  if [ ! -e "$VAULT/$f" ]; then mkdir -p "$(dirname "$VAULT/$f")"; printf -- "---\ntype: index\n---\n\n# %s\n\nUp: [[00 Master Index]]\n" "$(basename "$f" .md)" > "$VAULT/$f"; ok "added $f"; fi
done

step "3. This Mac's paths"
detoken "$R" "$VAULT/.claude" "$VAULT/.obsidian/plugins/gtd-rubric"
ok "paths written (vault $VAULT, home $HOME)"

step "4. Agents link and the Obsidian plugin"
if [ -d "$VAULT/.claude/agents" ] && [ ! -L "$VAULT/.claude/agents" ]; then
  rsync -a --ignore-existing "$VAULT/.claude/agents/" "$VAULT/Agents/"
  mkdir -p "$BACKUP/.claude"; mv "$VAULT/.claude/agents" "$BACKUP/.claude/agents"
fi
[ -L "$VAULT/.claude/agents" ] || ln -s ../Agents "$VAULT/.claude/agents"
ok ".claude/agents -> Agents/"
CP="$VAULT/.obsidian/community-plugins.json"
mkdir -p "$VAULT/.obsidian"
python3 - "$CP" <<'PY'
import json, os, sys
p = sys.argv[1]
cur = []
if os.path.exists(p):
    try: cur = json.load(open(p))
    except Exception: cur = []
if 'gtd-rubric' not in cur: cur.append('gtd-rubric')
json.dump(cur, open(p, 'w'), indent=2)
PY
ok "GTD Rubric turned on in community-plugins.json"

# ------------------------------------------------------------------ 5. bridge
step "5. Petra's bridge (JARVIS) in $JARVIS"
mkdir -p "$JARVIS"
rsync -a --backup --backup-dir="$BACKUP/home/Coding/jarvis" --exclude node_modules --exclude .gtd-jobs --exclude .tts-venv --exclude .stt-venv "$HERE/jarvis/" "$JARVIS/"
mkdir -p "$JARVIS/.gtd-jobs"
( cd "$JARVIS" && npm ci --ignore-scripts --no-audit --no-fund >/tmp/petra-npm.log 2>&1 ) && ok "bridge packages installed" || die "npm ci failed in $JARVIS (see /tmp/petra-npm.log)"
( cd "$JARVIS/vendor-pty" && npm install --no-audit --no-fund >>/tmp/petra-npm.log 2>&1 ) && ok "node-pty installed (the Claude Code tab)" || warn "node-pty failed: the CLAUDE CODE tab will be off (see /tmp/petra-npm.log)"
chmod +x "$JARVIS"/vendor-pty/node_modules/node-pty/prebuilds/darwin-*/spawn-helper 2>/dev/null
( cd "$R/rubric/templates/flows" && npm install --omit=dev --no-audit --no-fund >>/tmp/petra-npm.log 2>&1 ) && ok "console flows packages" || warn "console flows packages failed (only the Flows tab needs them)"

# ------------------------------------------------------------------ 6. voice
GTD_PY=""
if [ $VOICE = 1 ]; then
  step "6. Petra's voice (models download on first use: about 3 GB)"
  if [ "$ARCH" = arm64 ]; then
    if [ ! -x "$JARVIS/.tts-venv/bin/python" ]; then "$PY" -m venv "$JARVIS/.tts-venv"; fi
    "$JARVIS/.tts-venv/bin/pip" install -q --upgrade pip >/dev/null 2>&1
    "$JARVIS/.tts-venv/bin/pip" install -q -r "$HERE/requirements-voice-mlx.txt" && ok "Voxtral (voice) + Parakeet (hearing) on the GPU" || warn "MLX voice install failed: Petra falls back to the Kokoro voice and faster-whisper"
  else
    warn "Not Apple Silicon: no Voxtral/Parakeet. Petra uses the Kokoro voice and faster-whisper."
  fi
  if [ ! -x "$JARVIS/.stt-venv/bin/python" ]; then "$PY" -m venv "$JARVIS/.stt-venv"; fi
  "$JARVIS/.stt-venv/bin/pip" install -q --upgrade pip >/dev/null 2>&1
  "$JARVIS/.stt-venv/bin/pip" install -q -r "$HERE/requirements-voice-whisper.txt" && ok "faster-whisper (fallback hearing)" || warn "faster-whisper install failed"
  GTD_PY="$JARVIS/.stt-venv/bin/python"
else
  step "6. Voice skipped (--no-voice). Typing to Petra works; talking needs this step."
fi

# ------------------------------------------------------------------ 7. services
if [ $LAUNCHD = 1 ]; then
  step "7. Starting at login (launchd)"
  LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA" "$R/.logs"
  P="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  plist() { # label workdir logfile program-args... ; then env pairs on stdin
    local label=$1 wd=$2 log=$3; shift 3
    { echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0"><dict>'
      echo "  <key>Label</key><string>$label</string>"
      echo '  <key>ProgramArguments</key><array>'; for a in "$@"; do echo "    <string>$a</string>"; done; echo '  </array>'
      echo "  <key>WorkingDirectory</key><string>$wd</string>"
      echo '  <key>EnvironmentVariables</key><dict>'
      echo "    <key>HOME</key><string>$HOME</string><key>PATH</key><string>$P</string>"
      while IFS='=' read -r k v; do [ -n "$k" ] && echo "    <key>$k</key><string>$v</string>"; done
      echo '  </dict>'
      echo '  <key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>'
      echo '  <key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Interactive</string>'
      echo "  <key>StandardOutPath</key><string>$log</string><key>StandardErrorPath</key><string>$log</string>"
      echo '</dict></plist>'; } > "$LA/$label.plist"
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$LA/$label.plist" && ok "$label" || warn "$label did not load (launchctl bootstrap)"
  }
  plist com.gettruckdrivers.rubric-console "$R/rubric/templates/scaffold" "$R/.logs/rubric-console.log" "$NODE" server.js <<EOF
PORT=5050
SKILL_TREE_ROOT=$VAULT
VAULT_ROOT=$VAULT
EOF
  plist com.gettruckdrivers.second-brain "$R/rubric-second-brain" "$R/.logs/second-brain.log" "$NODE" server.js <<EOF
PORT=5211
EOF
  plist com.gettruckdrivers.agentic-os "$R/rubric-agentic-os" "$R/.logs/agentic-os.log" "$NODE" server.js <<EOF
PORT=50000
VAULT_ROOT=$VAULT
EOF
  plist com.gettruckdrivers.jarvis-bridge "$JARVIS" "$JARVIS/.gtd-jobs/bridge.log" "$NODE" bridge/server.mjs <<EOF
JARVIS_MODE=gtd
JARVIS_CWD=$VAULT
JARVIS_BRIDGE_PORT=8790
JARVIS_MODEL=claude-sonnet-5
JARVIS_EFFORT=low
JARVIS_CLAUDE_BIN=$CLAUDE_BIN
GTD_JOB_MODEL=claude-opus-5-5
GTD_JOB_EFFORT=high
GTD_TTS_VOICE=casual_female
JARVIS_ALLOWED_ORIGINS=http://localhost:50000,http://127.0.0.1:50000
${GTD_PY:+GTD_PYTHON=$GTD_PY}
EOF
else
  step "7. launchd skipped (--no-launchd). Start everything with: $R/start.sh"
fi

# ------------------------------------------------------------------ check
step "Checking"
sleep 4
for p in 5050:"Rubric console" 5211:"Second Brain" 50000:"Agentic OS" 8790:"Petra's bridge"; do
  port=${p%%:*}; name=${p#*:}
  if curl -s -m 3 -o /dev/null "http://127.0.0.1:$port"; then ok "$name answers on :$port"; else warn "$name is not answering on :$port yet (logs: $R/.logs, $JARVIS/.gtd-jobs/bridge.log)"; fi
done

cat <<EOF

Done. Next, in Obsidian:
  1. Settings > Community plugins: turn off Restricted mode if it is on, then make sure
     "GTD Rubric" is on (turn it off and on once if Obsidian was already open).
  2. Click the orbit icon in the left ribbon, or run "GTD Rubric: Open Rubric OS".
  3. Click Petra, choose Type, and say hello. The first time you talk, macOS asks whether
     Obsidian may use the microphone.
Health check any time: $HERE/check.sh
Anything replaced is in $BACKUP
EOF
