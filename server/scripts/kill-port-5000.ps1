$connections = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($null -eq $connections) {
  Write-Output "no listener"
  exit 0
}

$ids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $ids) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

Write-Output ("killed " + ($ids -join ","))
