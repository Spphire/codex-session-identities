param([string]$Installation=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$source=Get-Content (Join-Path $Installation 'launch-process.ps1') -Raw
$source=$source.Replace('try{return [Diagnostics.Process]::Start($info)}catch{','try{throw (New-Object ComponentModel.Win32Exception($script:fakeCode))}catch{')
. ([scriptblock]::Create($source))
$script:fallback=$null
function Start-IdentityPackageContext([string]$DesktopExe,[string]$Installation,[string]$Arguments,[switch]$Probe){
    $script:fallback=@{path=$DesktopExe;arguments=$Arguments;probe=[bool]$Probe}
    return [pscustomobject]@{Id=42}
}
$store='C:\Program Files\WindowsApps\OpenAI.Codex_fixture_x64\app\ChatGPT.exe'
$script:fakeCode=5
$p=Start-IdentityDesktop -DesktopExe $store -Installation $Installation -Arguments '--no-startup-window' -Probe
if($p.Id -ne 42 -or !$script:fallback.probe -or $script:fallback.arguments -notmatch '--do-not-de-elevate'){throw 'Access-denied fallback did not preserve launch context'}
foreach($case in @(@{path='C:\custom\ChatGPT.exe';code=5},@{path=$store;code=2},@{path=$store;code=1223})){
    $script:fallback=$null;$script:fakeCode=$case.code;$failed=$false
    try{Start-IdentityDesktop -DesktopExe $case.path -Installation $Installation|Out-Null}catch{$failed=$true}
    if(!$failed -or $script:fallback){throw 'Fallback must only handle access denied for a Store target'}
}
@{passed=$true;onlyStoreAccessDeniedRetried=$true;probeArgumentsPreserved=$true;otherFailuresRetained=$true}|ConvertTo-Json -Compress
