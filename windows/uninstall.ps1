# Stops Petra / Agentic OS and removes the five logon tasks. Files are left where they are
# (the vault code in Installers\Robonuggets, the hooks and plugin, $HOME\Coding\jarvis and the
# task wrappers in Installers\Robonuggets\.tasks); delete those by hand if you want them gone.
foreach ($t in @('Petra Rubric console', 'Petra Second Brain', 'Petra Agentic OS', 'Petra bridge', 'Petra voice agent')) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  stopped and removed: $t"
  }
}
foreach ($p in @(5050, 5211, 50000, 8790, 8793)) {   # anything still listening (a copy started by hand)
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Write-Host "  stopped :$p" }
  }
}
Write-Host '  Logon tasks removed. Turn the GTD Rubric plugin off in Obsidian if you like. The Agentic OS app,'
Write-Host '  if you built it, is uninstalled from Settings > Apps like any other program.'
