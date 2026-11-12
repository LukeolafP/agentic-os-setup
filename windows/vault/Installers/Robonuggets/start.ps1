# Starts the three RoboNuggets dashboards, Petra's bridge and the Voice Agent backend on this
# PC by hand, bound to localhost only (the Windows sibling of start.sh).
#   Rubric console  http://localhost:5050    Second Brain  http://localhost:5211
#   Agentic OS      http://localhost:50000   bridge ws://localhost:8790   voice agent :8793
# Already running? It leaves that one alone. Each one normally runs as a Scheduled Task
# (install.ps1); when its task exists, the task is started rather than a second copy that
# would fight it for the port. Logs: Robonuggets\.logs\ and ~\Coding\jarvis\.gtd-jobs\
$R = $PSScriptRoot
$Jarvis = Join-Path $HOME 'Coding\jarvis'
$Logs = Join-Path $R '.logs'
$Tasks = Join-Path $R '.tasks'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
# the vault is the nearest folder above this one holding CLAUDE.md and .obsidian
$Vault = $R
while ($Vault -and -not ((Test-Path (Join-Path $Vault 'CLAUDE.md')) -and (Test-Path (Join-Path $Vault '.obsidian')))) {
  $up = Split-Path $Vault -Parent
  if (-not $up -or $up -eq $Vault) { $Vault = $null; break }
  $Vault = $up
}
if (-not $Vault) { $Vault = Split-Path (Split-Path $R -Parent) -Parent }
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Host '  node is not on the PATH (winget install OpenJS.NodeJS.LTS)'; exit 1 }
$ClaudeBin = Join-Path $HOME '.local\bin\claude.exe'
if (-not (Test-Path $ClaudeBin)) { $c = Get-Command claude -ErrorAction SilentlyContinue; if ($c) { $ClaudeBin = $c.Source } }

function Up($port) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://127.0.0.1:$port/" | Out-Null; return $true }
  catch { return ($null -ne $_.Exception.Response) }
}
function TaskExists($name) { return ($null -ne (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)) }
function Start-Service-Petra($name, $task, $file, $dir, $port, $url, $cmdline, $envs) {
  if (Up $port) { Write-Host "  $name already on :$port"; return }
  if (TaskExists $task) {
    Start-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Write-Host "  $name starting (Scheduled Task) -> $url"; return
  }
  $cmd = Join-Path $Tasks "$file.cmd"
  $vbs = Join-Path $Tasks 'run-hidden.vbs'
  if ((Test-Path $cmd) -and (Test-Path $vbs)) {   # the installer's wrapper holds the settings; run it with no window
    Start-Process -FilePath 'wscript.exe' -ArgumentList "//B //Nologo ""$vbs"" ""$cmd""" -WindowStyle Hidden | Out-Null
    Write-Host "  $name -> $url"; return
  }
  # no installer wrapper: start node directly with the usual settings
  $old = @{}
  foreach ($k in $envs.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, "$($envs[$k])") }
  try {
    Start-Process -FilePath $Node -ArgumentList $cmdline -WorkingDirectory $dir -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $Logs "$file.log") -RedirectStandardError (Join-Path $Logs "$file.err.log") | Out-Null
  } finally {
    foreach ($k in $envs.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) }
  }
  Write-Host "  $name -> $url"
}

Start-Service-Petra 'rubric-console' 'Petra Rubric console' 'rubric-console' (Join-Path $R 'rubric\templates\scaffold') 5050 'http://localhost:5050' 'server.js' @{
  PORT = 5050; SKILL_TREE_ROOT = $Vault; VAULT_ROOT = $Vault }
Start-Service-Petra 'second-brain' 'Petra Second Brain' 'second-brain' (Join-Path $R 'rubric-second-brain') 5211 'http://localhost:5211' 'server.js' @{
  PORT = 5211 }
Start-Service-Petra 'agentic-os' 'Petra Agentic OS' 'agentic-os' (Join-Path $R 'rubric-agentic-os') 50000 'http://localhost:50000' 'server.js' @{
  PORT = 50000; VAULT_ROOT = $Vault }
# JARVIS bridge (voice + agent queue) and the Voice Agent backend live outside the vault in ~\Coding\jarvis
if (Test-Path $Jarvis) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Jarvis '.gtd-jobs') | Out-Null
  Start-Service-Petra 'jarvis bridge' 'Petra bridge' 'jarvis-bridge' $Jarvis 8790 'ws://localhost:8790' 'bridge\server.mjs' @{
    JARVIS_MODE = 'gtd'; JARVIS_CWD = $Vault; JARVIS_BRIDGE_PORT = 8790; JARVIS_MODEL = 'claude-sonnet-5'; JARVIS_EFFORT = 'low'
    JARVIS_CLAUDE_BIN = $ClaudeBin; GTD_JOB_MODEL = 'claude-opus-5-5'; GTD_JOB_EFFORT = 'high'; GTD_TTS_ENGINE = 'kokoro'
    JARVIS_ALLOWED_ORIGINS = 'http://localhost:50000,http://127.0.0.1:50000' }
  Start-Service-Petra 'voice agent' 'Petra voice agent' 'voice-agent' $Jarvis 8793 'http://localhost:8793' 'clicky\server.mjs' @{
    JARVIS_CLAUDE_BIN = $ClaudeBin; PETRA_CLICKY_PORT = 8793; PETRA_CLICKY_BRIDGE = 'ws://localhost:8790' }
} else { Write-Host "  no bridge at $Jarvis (run install.ps1 from the setup package)" }
