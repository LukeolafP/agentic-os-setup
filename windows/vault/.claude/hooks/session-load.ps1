# Session start load (Windows port of session-load.sh). The logic is in session-load.js beside
# this file, shared with the Mac: a one-line trigger for each active automation and the newest
# 12 chats, kept under about 9,000 characters (Claude Code cuts larger hook output to a 2 KB
# preview). The automation notes themselves are read only when their trigger fires.
# See the "What loads every session" section of CLAUDE.md.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$null = [Console]::In.ReadToEnd()   # the hook's JSON is not needed here; drain it so Claude Code is not left waiting
$js = Join-Path $PSScriptRoot 'session-load.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and (Test-Path -LiteralPath $js)) {
  & $node.Source $js
} else {
  Write-Output '=== session-load: node or session-load.js not found, so the automation list could not load. Read Memory/Automations/ notes when their trigger fires. ==='
}
exit 0
