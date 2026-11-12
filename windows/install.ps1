<#
Petra / Agentic OS installer for Windows (10 version 2004 or later, or 11).

  .\install.ps1                          vault at $HOME\Documents\GTD, everything
  .\install.ps1 -Vault "D:\path\to\vault"
  .\install.ps1 -NoVoice                 skip the dashboard's hearing (faster-whisper); Petra still types
  .\install.ps1 -NoServices              do not start anything at logon (use start.ps1 by hand)
  .\install.ps1 -Yes                     do not ask before overwriting

Runs in PowerShell 7 (pwsh) or Windows PowerShell 5.1. If scripts are blocked:
  pwsh -ExecutionPolicy Bypass -File .\install.ps1

What it does, in order (each step says what it did):
  1. checks the tools it needs (Node 20+, npm, Claude Code, Git, and for voice Python 3 + ffmpeg)
  2. copies the dashboards, hooks, skill, agents and Obsidian plugin into the vault
     (anything it replaces is copied to <vault>\.petra-backup\<time>\ first)
  3. writes this PC's paths into the files that need them
  4. links .claude\agents to Agents\ (a junction), turns the GTD Rubric plugin on
  5. copies the JARVIS bridge (Petra) to $HOME\Coding\jarvis and installs its packages
  6. sets up the dashboard's hearing: faster-whisper in a Python venv (Petra's spoken voice
     on Windows is Kokoro in the dashboard and ElevenLabs through the Agentic OS app)
  7. installs five Scheduled Tasks so it all starts at logon, and checks they answer
#>
[CmdletBinding()]
param(
  [string]$Vault = (Join-Path $HOME 'Documents\GTD'),
  [switch]$NoVoice,
  [switch]$NoServices,
  [switch]$Yes
)
$ErrorActionPreference = 'Continue'
$Here = $PSScriptRoot
$Vault = $Vault.TrimEnd('\', '/')
$Jarvis = if ($env:PETRA_JARVIS_DIR) { $env:PETRA_JARVIS_DIR } else { Join-Path $HOME 'Coding\jarvis' }   # the bridge expects ~\Coding\jarvis; the variable is only for testing
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = Join-Path $Vault ".petra-backup\$Stamp"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$TextExt = @('.json', '.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.md', '.txt', '.sh', '.ps1', '.py', '.yml', '.yaml', '.cmd', '.svg')

function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [X]  $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan }
function Ask($q)  { if ($Yes) { return $true }; $a = Read-Host "  $q [y/N]"; return ($a -eq 'y' -or $a -eq 'Y') }

# ------------------------------------------------------------------ 1. tools
Step '1. Checking this PC'
if ($env:OS -ne 'Windows_NT') { Fail 'This installer is for Windows (it uses Scheduled Tasks).' }
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) { Ok "$($os.Caption) build $($os.BuildNumber), PowerShell $($PSVersionTable.PSVersion)" }
$PwshCmd = 'powershell'
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwsh) { $PwshCmd = 'pwsh'; Ok "PowerShell 7 at $($pwsh.Source) (the vault hooks run through it)" }
else { Warn 'PowerShell 7 (pwsh) not found: the vault hooks will run through Windows PowerShell 5.1, which is slower. Better: winget install Microsoft.PowerShell' }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail 'Node.js is missing. Install it: winget install OpenJS.NodeJS.LTS   then open a new PowerShell and run this again.' }
$Node = $nodeCmd.Source
$NodeMajor = 0
try { $NodeMajor = [int](& node -p 'process.versions.node.split(".")[0]' 2>$null | Select-Object -First 1) } catch { }
if ($NodeMajor -lt 20) { Fail "Node $NodeMajor is too old; Petra needs Node 20 or newer (winget upgrade OpenJS.NodeJS.LTS)." }
Ok "Node $(& node -v) at $Node"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm is missing (it comes with Node).' }
$ClaudeBin = Join-Path $HOME '.local\bin\claude.exe'
if (-not (Test-Path $ClaudeBin)) {
  $c = Get-Command claude -ErrorAction SilentlyContinue
  if ($c) { $ClaudeBin = $c.Source } else { $ClaudeBin = $null }
}
if (-not $ClaudeBin) { Fail 'Claude Code is missing. Install it: irm https://claude.ai/install.ps1 | iex   then run claude once and log in.' }
$cv = ''
try { $cv = (& $ClaudeBin --version 2>$null | Select-Object -First 1) } catch { }
Ok "Claude Code $cv at $ClaudeBin"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'Git for Windows is missing: Claude Code uses its bash. winget install Git.Git' }
if (-not (Test-Path $Vault -PathType Container)) { Fail "No vault at $Vault. Pass -Vault 'D:\path\to\your vault'." }
if (-not (Test-Path (Join-Path $Vault '.obsidian'))) { Warn "$Vault has no .obsidian folder yet: open it in Obsidian once (Open folder as vault) so the plugin can be turned on." }
Ok "Vault: $Vault"
$Voice = -not $NoVoice
$Py = $null
if ($Voice) {
  # the Microsoft Store stub called python.exe only opens the Store, so each candidate has to prove itself
  foreach ($cand in @(@('py', '-3.12'), @('py', '-3.11'), @('python', $null), @('python3', $null), @('py', '-3'))) {
    $exe = $cand[0]; $arg = $cand[1]
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
      $probe = if ($arg) { & $exe $arg -c 'import sys;print(sys.executable+"|"+sys.version.split()[0])' 2>$null } else { & $exe -c 'import sys;print(sys.executable+"|"+sys.version.split()[0])' 2>$null }
      $probe = "$probe".Trim()
      if ($probe -match '^(.+)\|(3\.\d+)') { $Py = $Matches[1]; $PyVer = $Matches[2]; break }
    } catch { }
  }
  if (-not $Py) { Warn 'No Python 3: skipping voice (winget install Python.Python.3.12, then run again).'; $Voice = $false }
  else { Ok "Python $PyVer at $Py" }
  if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok 'ffmpeg found' } else { Warn 'ffmpeg is missing: speech-to-text needs it. winget install Gyan.FFmpeg (then open a new PowerShell)' }
}

Write-Host ''
Write-Host "  Will install into:  $Vault   and   $Jarvis"
Write-Host "  Replaced files go to $Backup"
if (-not (Ask 'Go ahead?')) { Write-Host '  Stopped. Nothing changed.'; exit 0 }

# ------------------------------------------------------------------ helpers
function Rel($path) {   # where a replaced file goes inside the backup folder
  if ($path.StartsWith($Vault, [StringComparison]::OrdinalIgnoreCase)) { return $path.Substring($Vault.Length).TrimStart('\') }
  if ($path.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { return 'home\' + $path.Substring($HOME.Length).TrimStart('\') }
  return ($path -replace '^[A-Za-z]:\\', '')
}
function Put($src, $dst, [switch]$KeepExisting, [string[]]$Skip = @()) {
  # copy a folder from the package into place (like rsync --backup): a file already there is
  # copied to the backup first, then replaced; -KeepExisting leaves files that are there alone
  if (-not (Test-Path $src)) { Warn "the package has no $src"; return }
  $src = (Resolve-Path $src).Path
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Get-ChildItem -LiteralPath $src -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart('\')
    if ($Skip -contains $rel) { return }
    $to = Join-Path $dst $rel
    $dir = Split-Path $to -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if (Test-Path -LiteralPath $to) {
      if ($KeepExisting) { return }
      $b = Join-Path $Backup (Join-Path (Rel $dst) $rel)
      $bd = Split-Path $b -Parent
      if (-not (Test-Path $bd)) { New-Item -ItemType Directory -Force -Path $bd | Out-Null }
      Copy-Item -LiteralPath $to -Destination $b -Force
    }
    Copy-Item -LiteralPath $_.FullName -Destination $to -Force
  }
}
$VaultFwd = $Vault -replace '\\', '/'
$HomeFwd = $HOME -replace '\\', '/'
function Detoken([string[]]$dirs) {
  # replace __VAULT__ / __HOME__ / __PWSH__ in every text file under the given folders or files.
  # Paths go in with forward slashes: Node, JSON and pwsh -File all accept them, and JSON needs no escaping.
  foreach ($d in $dirs) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $items = if (Test-Path -LiteralPath $d -PathType Leaf) { @(Get-Item -LiteralPath $d) }
             else { Get-ChildItem -LiteralPath $d -Recurse -File -Force | Where-Object { $TextExt -contains $_.Extension.ToLower() -and $_.FullName -notmatch '\\node_modules\\' } }
    foreach ($f in $items) {
      $t = [IO.File]::ReadAllText($f.FullName)
      if ($t.Contains('__VAULT__') -or $t.Contains('__HOME__') -or $t.Contains('__PWSH__')) {
        $t = $t.Replace('__VAULT__', $VaultFwd).Replace('__HOME__', $HomeFwd).Replace('__PWSH__', $PwshCmd)
        [IO.File]::WriteAllText($f.FullName, $t, $Utf8)
      }
    }
  }
}
function PortUp($port, $secs = 3) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec $secs -Uri "http://127.0.0.1:$port/" | Out-Null; return $true }
  catch { return ($null -ne $_.Exception.Response) }   # any HTTP answer, even 404 or 426, means someone is listening
}
function StopPort($port) {   # an older copy started by hand would fight the task for the port
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
  } catch { }
}

# ------------------------------------------------------------------ 2-3. vault
Step '2. Dashboards, hooks, skill, agents and plugin into the vault'
$R = Join-Path $Vault 'Installers\Robonuggets'
$PkgR = Join-Path $Here 'vault\Installers\Robonuggets'
Put $PkgR $R -Skip @('00 Robonuggets Index.md')
if (-not (Test-Path (Join-Path $R '00 Robonuggets Index.md'))) { Copy-Item (Join-Path $PkgR '00 Robonuggets Index.md') $R }
Ok 'Installers\Robonuggets (Rubric console, Second Brain, Agentic OS)'
Put (Join-Path $Here 'vault\.claude\hooks') (Join-Path $Vault '.claude\hooks');                      Ok '.claude\hooks (.ps1 hooks; the .sh ones come along for a Mac)'
Put (Join-Path $Here 'vault\.claude\skills') (Join-Path $Vault '.claude\skills');                    Ok '.claude\skills (agent-creator)'
Put (Join-Path $Here 'vault\.obsidian\plugins\gtd-rubric') (Join-Path $Vault '.obsidian\plugins\gtd-rubric'); Ok '.obsidian\plugins\gtd-rubric'
Put (Join-Path $Here 'vault\Agents') (Join-Path $Vault 'Agents') -KeepExisting;                      Ok 'Agents\ (existing agent notes left as they are)'
# hook settings: keep anything else already in .claude\settings.json, set the hooks
$SettingsDst = Join-Path $Vault '.claude\settings.json'
$new = Get-Content -Raw -Encoding UTF8 (Join-Path $Here 'vault\.claude\settings.json') | ConvertFrom-Json
$cur = New-Object PSObject
if (Test-Path $SettingsDst) {
  $bd = Join-Path $Backup '.claude'; New-Item -ItemType Directory -Force -Path $bd | Out-Null
  Copy-Item $SettingsDst (Join-Path $bd 'settings.json') -Force
  try { $cur = Get-Content -Raw -Encoding UTF8 $SettingsDst | ConvertFrom-Json } catch { $cur = $null }
  if (-not ($cur -is [PSCustomObject])) { $cur = New-Object PSObject }
}
$cur | Add-Member -NotePropertyName hooks -NotePropertyValue $new.hooks -Force
New-Item -ItemType Directory -Force -Path (Split-Path $SettingsDst -Parent) | Out-Null
[IO.File]::WriteAllText($SettingsDst, ($cur | ConvertTo-Json -Depth 20), $Utf8)
Ok '.claude\settings.json (hooks set, other settings kept)'
# notes Petra relies on, only if the vault does not have them (a synced vault will)
foreach ($f in @('CLAUDE.md', 'Memory\Automations\Chat Logging.md', 'Memory\Automations\Agent Report Filing.md')) {
  $to = Join-Path $Vault $f
  if (-not (Test-Path -LiteralPath $to)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Here "vault-seed\$f") -Destination $to
    Detoken @($to); Ok "added $f"
  }
}
foreach ($f in @('Memory\Chats\00 Chat Index.md', 'Memory\Facts\00 Facts Index.md', 'Reports\00 Reports Index.md')) {
  $to = Join-Path $Vault $f
  if (-not (Test-Path -LiteralPath $to)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
    $name = [IO.Path]::GetFileNameWithoutExtension($f)
    [IO.File]::WriteAllText($to, "---`ntype: index`n---`n`n# $name`n`nUp: [[00 Master Index]]`n", $Utf8)
    Ok "added $f"
  }
}

Step "3. This PC's paths"
Detoken @($R, (Join-Path $Vault '.claude'), (Join-Path $Vault '.obsidian\plugins\gtd-rubric'), (Join-Path $Vault 'Agents'))
Ok "paths written (vault $VaultFwd, home $HomeFwd, hooks through $PwshCmd)"

Step '4. Agents link and the Obsidian plugin'
$AgentsLink = Join-Path $Vault '.claude\agents'
$AgentsDir = Join-Path $Vault 'Agents'
$it = Get-Item -LiteralPath $AgentsLink -Force -ErrorAction SilentlyContinue
if ($it -and (([int]$it.Attributes -band 1024) -ne 0)) {   # 1024 = ReparsePoint: already a junction or link
  Ok '.claude\agents is already a link'
} else {
  if ($it) {   # a real folder: its agents move into Agents\ (never overwriting), the folder goes to the backup
    Put $AgentsLink $AgentsDir -KeepExisting
    $bd = Join-Path $Backup '.claude'; New-Item -ItemType Directory -Force -Path $bd | Out-Null
    Move-Item -LiteralPath $AgentsLink -Destination (Join-Path $bd 'agents') -Force
  }
  New-Item -ItemType Junction -Path $AgentsLink -Target $AgentsDir | Out-Null
  Ok '.claude\agents -> Agents\ (junction)'
}
$CP = Join-Path $Vault '.obsidian\community-plugins.json'
New-Item -ItemType Directory -Force -Path (Split-Path $CP -Parent) | Out-Null
$list = @()
if (Test-Path $CP) { try { $list = @(Get-Content -Raw -Encoding UTF8 $CP | ConvertFrom-Json) } catch { $list = @() } }
$list = @($list | Where-Object { $_ -is [string] })
if ($list -notcontains 'gtd-rubric') { $list += 'gtd-rubric' }
[IO.File]::WriteAllText($CP, (ConvertTo-Json -InputObject $list), $Utf8)
Ok 'GTD Rubric turned on in community-plugins.json'

# ------------------------------------------------------------------ 5. bridge
Step "5. Petra's bridge (JARVIS) in $Jarvis"
Put (Join-Path $Here 'jarvis') $Jarvis
New-Item -ItemType Directory -Force -Path (Join-Path $Jarvis '.gtd-jobs') | Out-Null
$NpmLog = Join-Path $env:TEMP 'petra-npm.log'
function Npm($dir, [string[]]$npmArgs) {
  Push-Location $dir
  try { & npm @npmArgs 2>&1 | Out-File -Append -FilePath $NpmLog; return ($LASTEXITCODE -eq 0) }
  finally { Pop-Location }
}
if (Npm $Jarvis @('ci', '--ignore-scripts', '--no-audit', '--no-fund')) { Ok 'bridge packages installed' } else { Fail "npm ci failed in $Jarvis (see $NpmLog)" }
Warn 'node-pty is not installed on Windows (vendor-pty holds a Mac-only build), so the CLAUDE CODE tab on the board stays off. Claude Code runs in its own terminal window instead.'
if (Npm (Join-Path $R 'rubric\templates\flows') @('install', '--omit=dev', '--no-audit', '--no-fund')) { Ok 'console flows packages' } else { Warn "console flows packages failed (only the Flows tab needs them; see $NpmLog)" }

# ------------------------------------------------------------------ 6. voice
$GtdPy = $null
if ($Voice) {
  Step "6. The dashboard's hearing (faster-whisper; its model downloads the first time Petra listens)"
  $Venv = Join-Path $Jarvis '.stt-venv'
  $VenvPy = Join-Path $Venv 'Scripts\python.exe'
  if (-not (Test-Path $VenvPy)) { & $Py -m venv $Venv 2>&1 | Out-File -Append -FilePath $NpmLog }
  if (Test-Path $VenvPy) {
    & $VenvPy -m pip install -q --upgrade pip 2>&1 | Out-File -Append -FilePath $NpmLog
    & $VenvPy -m pip install -q -r (Join-Path $Here 'requirements-voice-whisper.txt') 2>&1 | Out-File -Append -FilePath $NpmLog
    if ($LASTEXITCODE -eq 0) { Ok "faster-whisper in $Venv"; $GtdPy = $VenvPy } else { Warn "faster-whisper install failed (see $NpmLog)" }
  } else { Warn "could not make the Python venv at $Venv (see $NpmLog)" }
  Ok "Petra's spoken voice: Kokoro in the dashboard (built into the bridge), ElevenLabs through the Agentic OS app's Settings. Voxtral is Apple-only."
} else {
  Step '6. Voice skipped (-NoVoice). Typing to Petra works; the microphone in the dashboard needs this step.'
}

# ------------------------------------------------------------------ 7. services
$Tasks = Join-Path $R '.tasks'
$Logs = Join-Path $R '.logs'
$NodeDir = Split-Path $Node -Parent
$ClaudeDir = Split-Path $ClaudeBin -Parent
$Vbs = Join-Path $Tasks 'run-hidden.vbs'
$User = "$env:USERDOMAIN\$env:USERNAME"
$TaskNames = @('Petra Rubric console', 'Petra Second Brain', 'Petra Agentic OS', 'Petra bridge', 'Petra voice agent')
function Wrapper($name, $file, $workdir, $log, $cmdline, $envs) {
  # schtasks cannot set environment variables, so each service is a small .cmd that sets them and runs node
  $cmd = Join-Path $Tasks "$file.cmd"
  $lines = @('@echo off',
             "rem Petra service: $name. Written by install.ps1 on $Stamp. Edit the set lines to change a",
             'rem setting (model, effort, port), then restart the task: Stop-ScheduledTask / Start-ScheduledTask.',
             'set "HOME=%USERPROFILE%"',
             "set ""PATH=$NodeDir;$ClaudeDir;%PATH%""")
  foreach ($k in $envs.Keys) { $lines += "set ""$k=$($envs[$k])""" }
  $lines += "cd /d ""$workdir"""
  $lines += "echo [%date% %time%] $name starting >> ""$log"""
  $lines += """$Node"" $cmdline >> ""$log"" 2>&1"
  $lines += 'exit /b %ERRORLEVEL%'
  [IO.File]::WriteAllText($cmd, (($lines -join "`r`n") + "`r`n"), $Utf8)
  return $cmd
}
function Service($name, $file, $workdir, $log, $port, $cmdline, $envs) {
  $cmd = Wrapper $name $file $workdir $log $cmdline $envs
  $arg = "//B //Nologo ""$Vbs"" ""$cmd"""
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
  StopPort $port
  try {
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $arg -WorkingDirectory $workdir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Hidden
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $name -ErrorAction Stop
    Ok "$name (task registered and started)"
  } catch {
    Warn "$name could not be registered through Register-ScheduledTask ($($_.Exception.Message)); trying schtasks"
    & schtasks /Create /F /SC ONLOGON /TN $name /TR "wscript.exe $arg" /RL LIMITED 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { & schtasks /Run /TN $name 2>&1 | Out-Null; Warn "$name registered with schtasks (it will not restart itself after a crash)" }
    else { Warn "$name was not registered. Start it by hand: $R\start.ps1" }
  }
}
if (-not $NoServices) {
  Step '7. Starting at logon (Scheduled Tasks)'
  New-Item -ItemType Directory -Force -Path $Tasks, $Logs, (Join-Path $Jarvis '.gtd-jobs') | Out-Null
  # a VBScript launcher is the one way a Scheduled Task can run a console program with no window
  $vbsText = "' Runs a .cmd with no console window, waits for it, and hands its exit code back to Task Scheduler`r`n" +
             "' so a service that dies is restarted. Written by install.ps1 on $Stamp.`r`n" +
             "Set sh = CreateObject(""WScript.Shell"")`r`n" +
             "WScript.Quit sh.Run(""cmd.exe /c """""" & WScript.Arguments(0) & """""""", 0, True)`r`n"
  [IO.File]::WriteAllText($Vbs, $vbsText, $Utf8)
  Service 'Petra Rubric console' 'rubric-console' (Join-Path $R 'rubric\templates\scaffold') (Join-Path $Logs 'rubric-console.log') 5050 'server.js' ([ordered]@{
    PORT = 5050; SKILL_TREE_ROOT = $Vault; VAULT_ROOT = $Vault })
  Service 'Petra Second Brain' 'second-brain' (Join-Path $R 'rubric-second-brain') (Join-Path $Logs 'second-brain.log') 5211 'server.js' ([ordered]@{
    PORT = 5211 })
  Service 'Petra Agentic OS' 'agentic-os' (Join-Path $R 'rubric-agentic-os') (Join-Path $Logs 'agentic-os.log') 50000 'server.js' ([ordered]@{
    PORT = 50000; VAULT_ROOT = $Vault })
  $bridgeEnv = [ordered]@{
    JARVIS_MODE = 'gtd'; JARVIS_CWD = $Vault; JARVIS_BRIDGE_PORT = 8790
    JARVIS_MODEL = 'claude-sonnet-5'; JARVIS_EFFORT = 'low'; JARVIS_CLAUDE_BIN = $ClaudeBin
    GTD_JOB_MODEL = 'claude-opus-5-5'; GTD_JOB_EFFORT = 'high'
    GTD_TTS_ENGINE = 'kokoro'
    JARVIS_ALLOWED_ORIGINS = 'http://localhost:50000,http://127.0.0.1:50000' }
  if ($GtdPy) { $bridgeEnv['GTD_PYTHON'] = $GtdPy }
  Service 'Petra bridge' 'jarvis-bridge' $Jarvis (Join-Path $Jarvis '.gtd-jobs\bridge.log') 8790 'bridge\server.mjs' $bridgeEnv
  # the Voice Agent backend. The Agentic OS app starts it itself while it runs (unless 8793 already answers),
  # so this task is a fallback: the voice backend is up even when the app is not
  Service 'Petra voice agent' 'voice-agent' $Jarvis (Join-Path $Jarvis '.gtd-jobs\voice-agent.log') 8793 'clicky\server.mjs' ([ordered]@{
    JARVIS_CLAUDE_BIN = $ClaudeBin; PETRA_CLICKY_PORT = 8793; PETRA_CLICKY_BRIDGE = 'ws://localhost:8790' })
  Ok "settings live in $Tasks\*.cmd"
} else {
  Step "7. Services skipped (-NoServices). Start everything with: $R\start.ps1"
}

# ------------------------------------------------------------------ check
Step 'Checking'
Start-Sleep -Seconds 4
foreach ($p in @(@(5050, 'Rubric console'), @(5211, 'Second Brain'), @(50000, 'Agentic OS'), @(8790, "Petra's bridge"), @(8793, 'Voice Agent backend'))) {
  if (PortUp $p[0]) { Ok "$($p[1]) answers on :$($p[0])" }
  else { Warn "$($p[1]) is not answering on :$($p[0]) yet (logs: $Logs, $Jarvis\.gtd-jobs\bridge.log)" }
}

Write-Host @"

Done. Next, in Obsidian:
  1. Settings > Community plugins: turn off Restricted mode if it is on, then make sure
     "GTD Rubric" is on (turn it off and on once if Obsidian was already open).
  2. Click the orbit icon in the left ribbon, or run "GTD Rubric: Open Rubric OS".
  3. Click Petra, choose Type, and say hello. The first time you talk, Windows asks whether
     Obsidian may use the microphone (if it does not: Settings > Privacy & security > Microphone).
Health check any time: $Here\check.ps1
Anything replaced is in $Backup
"@
