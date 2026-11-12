# Session start load (Windows port of session-load.sh). Deliberately small: automations in
# full, plus the chat index. Nothing else from the vault is loaded. Everything else is read
# on demand, grep first, then 00 Master Index.md. See the "What loads every session"
# section of CLAUDE.md.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$null = [Console]::In.ReadToEnd()   # the hook's JSON is not needed here; drain it so Claude Code is not left waiting
$Vault = '__VAULT__'

$found = $false
$autos = Join-Path $Vault 'Memory\Automations'
if (Test-Path -LiteralPath $autos) {
  foreach ($f in (Get-ChildItem -LiteralPath $autos -Filter '*.md' -File | Sort-Object Name)) {
    $found = $true
    Write-Output "=== ACTIVE AUTOMATION: $($f.FullName) ==="
    Write-Output (Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8)
    Write-Output ''
  }
}
if ($found) { Write-Output 'Follow the triggers and actions in the automation notes above without being asked.' }

$idx = Join-Path $Vault 'Memory\Chats\00 Chat Index.md'
if (Test-Path -LiteralPath $idx) {
  Write-Output ''
  Write-Output '=== CHAT INDEX: every past chat, one line each ==='
  Write-Output (Get-Content -LiteralPath $idx -Raw -Encoding UTF8)
  Write-Output ''
}

# Brand Asset Feedback: brand-agent files changed since an agent made them. Prints nothing when all match.
$sync = Join-Path $Vault 'Brand\tools\brand-sync.mjs'
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $sync)) {
  try {
    $changed = (& node $sync check --quiet 2>$null | Out-String).Trim()
    if ($changed) { Write-Output ''; Write-Output "=== $changed"; Write-Output '' }
  } catch { }
}

Write-Output ''
Write-Output 'That is the whole session load. Do not scan, list or read the rest of the vault.'
Write-Output "To find something: grep first, then $Vault/00 Master Index.md, then follow it down."
exit 0
