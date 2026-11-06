param([Parameter(Mandatory=$true)][string]$Installation,[string]$Source,[string]$ResultPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(!$Source){$Source=$PSScriptRoot}
$Installation=(Resolve-Path -LiteralPath $Installation).Path
$Source=(Resolve-Path -LiteralPath $Source).Path
if($Installation -eq $Source){throw 'Source and installation must be separate directories'}
$configuration=Get-Content (Join-Path $Installation 'runtime-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
. (Join-Path $Source 'payload-files.ps1')
$files=@(Get-IdentityPayloadFiles -Source $Source -PanelUpdate)
foreach($name in $files){if(!(Test-Path -LiteralPath (Join-Path $Source $name))){throw ('Missing panel update file: '+$name)}}
$authFiles=@(Join-Path $configuration.codexHome 'auth.json')
$profiles=Join-Path $configuration.codexHome 'session-identities\profiles'
if(Test-Path $profiles){$authFiles+=@(Get-ChildItem -LiteralPath $profiles -Directory | ForEach-Object {Join-Path $_.FullName 'auth.json'})}
$hashes=@{}
foreach($file in $authFiles){if(Test-Path -LiteralPath $file){$hashes[$file]=(Get-FileHash -LiteralPath $file).Hash}}
$backendHash=(Get-FileHash -LiteralPath $configuration.appServerExe).Hash
$accessPath=Join-Path $configuration.codexHome ('session-identities\panel-access-'+$configuration.panelPort+'.json')
function Stop-OwnedPanel {
    if(!(Test-Path -LiteralPath $accessPath)){return}
    $access=Get-Content $accessPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $panel=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$access.pid)
    if(!$panel){return}
    if($panel.ExecutablePath -ne (Join-Path $Installation 'node.exe') -or $panel.CommandLine -notmatch [regex]::Escape((Join-Path $Installation 'server.mjs'))){throw 'Panel PID does not belong to this installation'}
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$panel.ProcessId)
    if(!$current){return}
    if($current.CreationDate -ne $panel.CreationDate -or $current.ExecutablePath -ne $panel.ExecutablePath -or $current.CommandLine -ne $panel.CommandLine){throw 'Panel process changed before update; retry after checking its owner'}
    Stop-Process -Id $panel.ProcessId
    Wait-Process -Id $panel.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
}
function Start-UpdatedPanel {
    $env:CODEX_HOME=$configuration.codexHome
    $env:IDENTITY_PANEL_PORT=[string]$configuration.panelPort
    $process=Start-Process -FilePath (Join-Path $Installation 'node.exe') -ArgumentList @('"'+(Join-Path $Installation 'open-panel.mjs')+'"','--check') -WorkingDirectory $Installation -WindowStyle Hidden -PassThru
    $null=$process.Handle
    if(!$process.WaitForExit(20000)){throw 'Panel startup exceeded deadline'}
    if($process.ExitCode -ne 0){throw 'Panel startup failed'}
    $access=Get-Content $accessPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return Invoke-RestMethod -Uri ('http://127.0.0.1:'+$configuration.panelPort+'/api/state') -Headers @{'X-Codex-Identity-Access'=$access.token} -TimeoutSec 5
}
$backup=Join-Path $Installation ('backups\panel-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
foreach($name in $files){
    $old=Join-Path $Installation $name
    if(Test-Path -LiteralPath $old){$save=Join-Path $backup $name;New-Item -ItemType Directory -Force (Split-Path $save) | Out-Null;Copy-Item -LiteralPath $old -Destination $save}
}
Stop-OwnedPanel
try{
    foreach($name in $files){$target=Join-Path $Installation $name;New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null;Copy-Item -LiteralPath (Join-Path $Source $name) -Destination $target -Force}
    $state=Start-UpdatedPanel
    foreach($file in $hashes.Keys){if((Get-FileHash -LiteralPath $file).Hash -ne $hashes[$file]){throw 'An official auth file changed during the update'}}
    if((Get-FileHash -LiteralPath $configuration.appServerExe).Hash -ne $backendHash){throw 'Backend binary changed during panel update'}
    $result=[pscustomobject]@{passed=$true;panelConnected=$state.runtime.connected;identities=$state.identities.Count;authUnchanged=$true;backendUnchanged=$true;backup=$backup} | ConvertTo-Json -Compress
    if($ResultPath){[IO.File]::WriteAllText($ResultPath,$result,[Text.UTF8Encoding]::new($false))}
    Write-Output $result
}catch{
    $failure=$_
    Stop-OwnedPanel
    foreach($name in $files){
        $save=Join-Path $backup $name;$target=Join-Path $Installation $name
        if(Test-Path -LiteralPath $save){Copy-Item -LiteralPath $save -Destination $target -Force}
        elseif(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force}
    }
    try{$null=Start-UpdatedPanel}catch{Write-Warning 'Restored panel files, but the previous panel could not start'}
    throw $failure
}
