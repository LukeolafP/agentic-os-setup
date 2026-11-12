# Health check for Petra / Agentic OS on Windows. Read only: it changes nothing.
#   .\check.ps1                       vault at $HOME\Documents\GTD
#   .\check.ps1 "D:\path\to\vault"
param([string]$Vault = (Join-Path $HOME 'Documents\GTD'))
$Vault = $Vault.TrimEnd('\', '/')
$Jarvis = Join-Path $HOME 'Coding\jarvis'
$R = Join-Path $Vault 'Installers\Robonuggets'
function Ok($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [X]  $m" -ForegroundColor Red }
function Up($port) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$port/" | Out-Null; return $true }
  catch { return ($null -ne $_.Exception.Response) }
}
Write-Host "Vault: $Vault"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Ok "node $(& node -v)" } else { Bad 'node missing' }
if ((Test-Path (Join-Path $HOME '.local\bin\claude.exe')) -or (Get-Command claude -ErrorAction SilentlyContinue)) { Ok 'Claude Code installed' } else { Bad 'Claude Code missing' }
if (Get-Command pwsh -ErrorAction SilentlyContinue) { Ok 'PowerShell 7 (pwsh) for the hooks' } else { Bad 'pwsh missing: hooks fall back to Windows PowerShell (winget install Microsoft.PowerShell)' }
foreach ($p in @(@(5050, 'Rubric console'), @(5211, 'Second Brain'), @(50000, 'Agentic OS'), @(8790, "Petra's bridge"), @(8793, 'Voice Agent backend'))) {
  if (Up $p[0]) { Ok "$($p[1]) on :$($p[0])" } else { Bad "$($p[1]) not answering on :$($p[0])" }
}
foreach ($t in @('Petra Rubric console', 'Petra Second Brain', 'Petra Agentic OS', 'Petra bridge', 'Petra voice agent')) {
  $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($task) { Ok "task: $t ($($task.State))" } else { Bad "task: $t not registered" }
}
$link = Get-Item -LiteralPath (Join-Path $Vault '.claude\agents') -Force -ErrorAction SilentlyContinue
if ($link -and (([int]$link.Attributes -band 1024) -ne 0)) {
  $n = (Get-ChildItem (Join-Path $Vault 'Agents') -Filter '*.md' -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Ok ".claude\agents -> Agents\ ($n notes)"
} else { Bad '.claude\agents is not a junction to Agents\' }
if (Test-Path (Join-Path $Vault '.obsidian\plugins\gtd-rubric\main.js')) { Ok 'Obsidian plugin present' } else { Bad 'Obsidian plugin missing' }
$cp = Join-Path $Vault '.obsidian\community-plugins.json'
if ((Test-Path $cp) -and ((Get-Content -Raw $cp) -match 'gtd-rubric')) { Ok 'plugin turned on' } else { Bad 'plugin not in community-plugins.json' }
if (Test-Path (Join-Path $Jarvis 'node_modules\@anthropic-ai\claude-agent-sdk')) { Ok 'bridge packages' } else { Bad "bridge packages missing (cd $Jarvis; npm ci --ignore-scripts)" }
if (Test-Path (Join-Path $Jarvis '.stt-venv\Scripts\python.exe')) { Ok 'hearing environment (.stt-venv, faster-whisper)' } else { Bad 'no hearing environment: typing works, the dashboard microphone does not' }
$left = @(foreach ($d in @($R, (Join-Path $Vault '.claude'))) {
  if (Test-Path $d) {
    Get-ChildItem $d -Recurse -File -Include '*.json', '*.js', '*.mjs', '*.html', '*.ps1', '*.sh', '*.md' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
      Select-String -SimpleMatch -Pattern '__VAULT__', '__HOME__', '__PWSH__' -List -ErrorAction SilentlyContinue
  }
})
if ($left.Count -gt 0) { Bad "unfilled path placeholders left in $($left.Count) files (run install.ps1 again)" } else { Ok 'paths filled in' }
Write-Host ''; Write-Host "Last lines of Petra's bridge log:"
$bl = Join-Path $Jarvis '.gtd-jobs\bridge.log'
if (Test-Path $bl) { Get-Content $bl -Tail 5 | ForEach-Object { "    $_" } }
