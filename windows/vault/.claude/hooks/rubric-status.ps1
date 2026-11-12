# Reports this vault's Claude session to the Rubric console (http://127.0.0.1:5050).
# Windows port of rubric-status.sh. Usage from settings.json hooks:
#   rubric-status.ps1 <active|idle> [fallback task text]
# Best effort: 2 s timeout, always exits 0, so a stopped console never blocks a session.
# (The Mac hook forks itself into the background; PowerShell has no cheap equivalent, so
# this one posts in the foreground. A console that is off refuses the connection at once.)
param(
  [string]$Status = 'idle',
  [string]$Fallback = ''
)
$stdin = ''
try { $stdin = [Console]::In.ReadToEnd() } catch { }
$task = ''
try {
  $d = $stdin | ConvertFrom-Json
  if ($d.prompt) {
    $p = ("$($d.prompt)" -split '\s+' | Where-Object { $_ }) -join ' '
    $task = if ($p.Length -gt 70) { $p.Substring(0, 70) + '...' } else { $p }
  }
} catch { }
if (-not $task) { $task = $Fallback }
# a queued agent run sets RUBRIC_AGENT_ID, so it reports as itself, not as the vault agent
$agent = if ($env:RUBRIC_AGENT_ID) { $env:RUBRIC_AGENT_ID } else { 'gtd-vault' }
$body = @{ agent = $agent; status = $Status; task = $task } | ConvertTo-Json -Compress
try {
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5050/api/agent-status' -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 2 -ErrorAction Stop | Out-Null
} catch { }
exit 0
