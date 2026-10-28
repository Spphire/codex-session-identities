param([Parameter(Mandatory=$true)][string]$Installation,[string]$ResultPath)
$ErrorActionPreference='Stop'
$Installation=(Resolve-Path -LiteralPath $Installation).Path
if(!(Test-Path -LiteralPath (Join-Path $Installation 'runtime-config.json'))){throw 'Select the existing identity installation directory'}
$version=Get-Content (Join-Path $Installation 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($version.version -notin @('0.1.10','0.1.11','0.1.12')){throw 'This panel update requires 0.1.10 or newer; use the complete installer for earlier releases'}
$manifest=Get-Content (Join-Path $PSScriptRoot 'panel-update-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$payload=Join-Path $PSScriptRoot 'payload'
foreach($entry in $manifest.files){
    if($entry.name -notmatch '^(?:public[\\/])?[A-Za-z0-9_.-]+$'){throw 'Invalid panel update file name'}
    if((Get-FileHash -LiteralPath (Join-Path $payload $entry.name)).Hash -ne $entry.sha256){throw ('Panel update hash mismatch: '+$entry.name)}
}
& (Join-Path $payload 'Update-Panel.ps1') -Installation $Installation -Source $payload -ResultPath $ResultPath
