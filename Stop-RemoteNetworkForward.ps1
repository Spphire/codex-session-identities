param([int]$ProxyPort=19091,[string]$RemoteHost='apricity@100.88.46.40')
$ErrorActionPreference='Stop'
$targets=Get-CimInstance Win32_Process|Where-Object {($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*local-connect-proxy.mjs* '+$ProxyPort)) -or ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like ('*-R 127.0.0.1:'+ $ProxyPort + '*') -and $_.CommandLine -like ('*'+$RemoteHost+'*'))}
foreach($target in $targets){$current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$target.ProcessId);if($current -and $current.CreationDate -eq $target.CreationDate -and $current.ExecutablePath -eq $target.ExecutablePath){Stop-Process -Id $target.ProcessId -Force}}
[pscustomobject]@{stopped=@($targets.ProcessId)}|ConvertTo-Json -Compress
