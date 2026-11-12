# Chat Logging automation, safety net half (Windows port of chat-log.sh).
# Runs on every user prompt (UserPromptSubmit hook).
#   1. Appends the prompt verbatim to Memory\Chats\.raw\<session>.md so nothing is
#      lost if the chat is closed mid-turn.
#   2. Prints a reminder into Claude's context pointing at the chat note to update.
# The readable summary note is written by Claude, per
# Memory\Automations\Chat Logging.md.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$stdin = [Console]::In.ReadToEnd()

# A queued background agent (run by the JARVIS bridge with GTD_JOB=1) is not a chat:
# its result is filed as a report on the Agentic OS ring instead.
if ($env:GTD_JOB -eq '1') { exit 0 }

$Vault = '__VAULT__'
$Chats = Join-Path $Vault 'Memory\Chats'
$Raw = Join-Path $Chats '.raw'
New-Item -ItemType Directory -Force -Path $Raw | Out-Null

$sid = 'unknown'; $prompt = ''
try {
  $d = $stdin | ConvertFrom-Json
  if ($d.session_id) { $sid = "$($d.session_id)" }
  if ($d.prompt) { $prompt = "$($d.prompt)" }
} catch { }
if (-not $sid) { $sid = 'unknown' }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$log = Join-Path $Raw "$sid.md"
if (-not (Test-Path -LiteralPath $log)) {
  $opened = Get-Date -Format 'yyyy-MM-dd HH:mm'
  [IO.File]::WriteAllText($log, "Raw prompt log, session ``$sid``, opened $opened.`nAppend only, written by the Chat Logging hook. The readable summary is the`nmatching note in ``Memory/Chats/``.`n", $Utf8)
}
$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
[IO.File]::AppendAllText($log, "`n## $now`n`n$prompt`n", $Utf8)

# the chat note for this session is the first note in Memory\Chats whose text carries the session id
$note = $null
try {
  $hit = Get-ChildItem -LiteralPath $Chats -Filter '*.md' -File -ErrorAction SilentlyContinue |
    Select-String -SimpleMatch -Pattern $sid -List -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $note = $hit.Path }
} catch { }

Write-Output '=== CHAT LOGGING AUTOMATION ==='
Write-Output "session: $sid"
Write-Output "raw log: Memory/Chats/.raw/$sid.md (this prompt is already appended)"
if ($note) {
  $rel = $note.Substring($Vault.Length).TrimStart('\', '/') -replace '\\', '/'
  Write-Output "chat note: $rel"
  Write-Output 'Update that note during this turn, per Memory/Automations/Chat Logging.md.'
} else {
  Write-Output 'chat note: none yet for this session'
  Write-Output 'Create it before other work, per Memory/Automations/Chat Logging.md. Its'
  Write-Output "frontmatter must carry: session: $sid"
}
# Petra's voice sessions (the JARVIS bridge sets GTD_VOICE=1): Luke is waiting in silence,
# so the spoken reply comes first and the note is written straight after it
if ($env:GTD_VOICE -eq '1') {
  Write-Output 'VOICE SESSION: reply to Luke first, in speech, then create or update the chat note'
  Write-Output 'in the same turn. The note still has to be written; it just never delays the answer.'
}
exit 0
