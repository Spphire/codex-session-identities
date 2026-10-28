param([Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\launcher-permissions.ps1')
$installation=Join-Path $FixtureDirectory 'installation'
$homePath=Join-Path $FixtureDirectory 'codex'
New-Item -ItemType Directory -Force -Path $installation,(Join-Path $homePath 'session-identities')|Out-Null
$descriptorPath=Join-Path $homePath 'session-identities\panel-access-18189.json'
[IO.File]::WriteAllText($descriptorPath,'{"port":18189,"pid":12345}')
$script:admin=$true
$script:elevated=$false
$script:stopped=@()
$script:reads=0
$script:reused=$false
$script:service=[pscustomobject]@{ProcessId=12345;ExecutablePath=(Join-Path $installation 'node.exe');CommandLine=('node.exe "'+(Join-Path $installation 'server.mjs')+'"');CreationDate='first'}
function Test-LauncherAdministrator {return $script:admin}
function Get-ProcessElevation([int]$ProcessId) {return $script:elevated}
function Get-CimInstance {
    param($ClassName,$Filter)
    $script:reads++
    if($script:stopped.Count){return $null}
    if($script:reused -and $script:reads -gt 1){return [pscustomobject]@{ProcessId=12345;ExecutablePath=$script:service.ExecutablePath;CommandLine=$script:service.CommandLine;CreationDate='replacement'}}
    return $script:service
}
function Stop-Process {param([int]$Id,$ErrorAction) $script:stopped+=,$Id}
function Invoke-Check([bool]$backend=$true){
    $script:stopped=@();$script:reads=0
    Sync-PanelServiceElevation -Installation $installation -CodexDirectory $homePath -Port 18189 -BackendElevated $backend
}
Invoke-Check $false
if($script:reads -or $script:stopped.Count){throw 'Standard backend must not restart the service'}
$script:admin=$false;Invoke-Check
if($script:reads -or $script:stopped.Count){throw 'Standard launcher must not attempt elevation repair'}
$script:admin=$true;$script:elevated=$true;Invoke-Check
if($script:stopped.Count){throw 'Already elevated service must be retained'}
$script:elevated=$false
$original=$script:service.ExecutablePath;$script:service.ExecutablePath='unrelated.exe';Invoke-Check
if($script:stopped.Count){throw 'Unrelated process must not be stopped'}
$script:service.ExecutablePath=$original
$original=$script:service.CommandLine;$script:service.CommandLine='node.exe other-service.mjs';Invoke-Check
if($script:stopped.Count){throw 'Another Node service must not be stopped'}
$script:service.CommandLine=$original;$script:reused=$true;Invoke-Check
if($script:stopped.Count){throw 'Reused PID must not be stopped'}
$script:reused=$false;Invoke-Check
if($script:stopped.Count -ne 1 -or $script:stopped[0] -ne 12345){throw 'Owned standard panel must restart exactly once'}
@{passed=$true;standardBackendPreserved=$true;alreadyElevatedPreserved=$true;unrelatedProcessesPreserved=$true;pidReuseGuarded=$true;ownedStandardPanelRestarted=$true}|ConvertTo-Json -Compress
