param([Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $FixtureDirectory -Force|Out-Null
$Installation=(Resolve-Path -LiteralPath $FixtureDirectory).Path
$accessPath=Join-Path $Installation 'access.json'
[IO.File]::WriteAllText($accessPath,'{"pid":12345}')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\Update-Panel.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Updater syntax errors'}
$function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-OwnedPanel'},$true)
. ([scriptblock]::Create($function.Extent.Text))
$script:reads=0;$script:stopped=@();$script:replace=$false
$script:service=[pscustomobject]@{ProcessId=12345;ExecutablePath=(Join-Path $Installation 'node.exe');CommandLine=('node.exe "'+(Join-Path $Installation 'server.mjs')+'"');CreationDate='original'}
function Get-CimInstance {
    param($ClassName,$Filter)
    $script:reads++
    $value=$script:service.PSObject.Copy()
    if($script:replace -and $script:reads -gt 1){$value.CreationDate='replacement'}
    return $value
}
function Stop-Process {param($Id) $script:stopped+=,$Id}
function Wait-Process {param($Id,$Timeout,$ErrorAction)}
$script:replace=$true
$rejected=$false;try{Stop-OwnedPanel}catch{$rejected=$_.Exception.Message -like '*changed before update*'}
if(!$rejected -or $script:stopped.Count){throw 'Updater stopped a reused PID'}
$script:replace=$false;$script:reads=0
Stop-OwnedPanel
if($script:stopped.Count -ne 1 -or $script:stopped[0] -ne 12345){throw 'Owned panel was not stopped exactly once'}
$script:stopped=@();$script:reads=0;$script:service.CommandLine='node.exe unrelated.mjs'
$rejected=$false;try{Stop-OwnedPanel}catch{$rejected=$_.Exception.Message -like '*does not belong*'}
if(!$rejected -or $script:stopped.Count){throw 'Updater stopped unrelated Node service'}
@{passed=$true;pidReuseGuarded=$true;unrelatedServicePreserved=$true;ownedPanelStopped=$true}|ConvertTo-Json -Compress
