# Stops whatever is listening on the dashboard, bridge and voice agent ports (the Windows
# sibling of stop.sh). The Scheduled Tasks are stopped first, or they would start it all again.
foreach ($t in @('Petra Rubric console', 'Petra Second Brain', 'Petra Agentic OS', 'Petra bridge', 'Petra voice agent')) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
}
foreach ($p in @(5050, 5211, 50000, 8790, 8793)) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Write-Host "  stopped :$p ($($proc.ProcessName) $($proc.Id))" }
  }
}
exit 0
