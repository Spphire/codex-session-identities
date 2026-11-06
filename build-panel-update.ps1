param([Parameter(Mandatory=$true)][string]$ReleaseDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$ReleaseDirectory=(Resolve-Path -LiteralPath $ReleaseDirectory).Path
$source=Join-Path $ReleaseDirectory 'payload'
if(!(Test-Path -LiteralPath (Join-Path $source 'Update-Panel.ps1'))){throw 'Build the complete release first'}
$OutputDirectory=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a new output directory to avoid retaining stale files'}
$payload=Join-Path $OutputDirectory 'payload';New-Item -ItemType Directory -Path $payload -Force|Out-Null
. (Join-Path $source 'payload-files.ps1')
foreach($relative in @(Get-IdentityPayloadFiles -Source $source -PanelUpdate)){
    $target=Join-Path $payload $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
    Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $target
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Apply-PanelUpdate.ps1') -Destination $OutputDirectory
$version=(Get-Content (Join-Path $payload 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
$files=@(Get-ChildItem -LiteralPath $payload -Recurse -File|ForEach-Object {@{name=$_.FullName.Substring($payload.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}})
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'panel-update-manifest.json'),(@{version=$version;files=$files}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
@{built=$true;version=$version;files=$files.Count;output=$OutputDirectory}|ConvertTo-Json -Compress
