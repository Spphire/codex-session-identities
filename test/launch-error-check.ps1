param([string]$Installation=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
. (Join-Path $Installation 'launch-process.ps1')
$native=New-Object ComponentModel.Win32Exception(5)
$wrapper=New-Object System.Exception('Synthetic wrapper',$native)
$chain=@(Get-IdentityLaunchError $wrapper)
if($chain.Count -ne 2 -or $chain[1].nativeErrorCode -ne 5){throw 'Nested Windows error code was not retained'}
$json=$chain|ConvertTo-Json -Depth 5
if($json -match 'Environment|Arguments|TOKEN|API_KEY'){throw 'Unexpected diagnostic fields'}
@{passed=$true;nestedNativeErrorCode=5;exceptionTypesRetained=$true}|ConvertTo-Json -Compress
