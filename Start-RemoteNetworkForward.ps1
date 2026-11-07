param([string]$RemoteHost='apricity@100.88.46.40',[int]$ProxyPort=19091,[string]$NodeExecutable=(Join-Path $PSScriptRoot 'node.exe'))
$ErrorActionPreference='Stop'
$proxyScript=Join-Path $PSScriptRoot 'local-connect-proxy.mjs';if(!(Test-Path -LiteralPath $proxyScript)){throw 'local-connect-proxy.mjs is missing'}
$ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
$proxy=Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -like ('*local-connect-proxy.mjs* '+$ProxyPort)}|Select-Object -First 1
if(!$proxy){$proxyProcess=Start-Process -FilePath $NodeExecutable -ArgumentList @($proxyScript,[string]$ProxyPort) -WindowStyle Hidden -PassThru;$proxy=$proxyProcess}
$forward=Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'ssh.exe' -and $_.CommandLine -like ('*-R 127.0.0.1:'+ $ProxyPort + '*') -and $_.CommandLine -like ('*'+$RemoteHost+'*')}|Select-Object -First 1
if(!$forward){$forwardProcess=Start-Process -FilePath $ssh -ArgumentList @('-N','-T','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-R',('127.0.0.1:{0}:127.0.0.1:{0}' -f $ProxyPort),$RemoteHost) -WindowStyle Hidden -PassThru;$forward=$forwardProcess}
Start-Sleep -Milliseconds 500
[pscustomobject]@{proxyPid=[int]$proxy.Id;sshPid=[int]$forward.Id;proxyUrl=('http://127.0.0.1:'+ $ProxyPort);remote=$RemoteHost}|ConvertTo-Json -Compress
