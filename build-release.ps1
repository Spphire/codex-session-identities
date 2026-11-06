param([Parameter(Mandatory=$true)][string]$PatchedAppServer,[Parameter(Mandatory=$true)][string]$BackendRuntimeDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory,[string]$NodeExecutable=(Get-Command node).Source)
$ErrorActionPreference='Stop'
$OutputDirectory=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a new output directory to avoid retaining stale files'}
$payload=Join-Path $OutputDirectory 'payload'
New-Item -ItemType Directory -Path $payload -Force|Out-Null
. (Join-Path $PSScriptRoot 'payload-files.ps1')
$files=@(Get-IdentityPayloadFiles -Source $PSScriptRoot)
foreach($name in $files){
    $destination=Join-Path $payload $name
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Force
}
Copy-Item -LiteralPath $PatchedAppServer -Destination (Join-Path $payload 'codex-app-server.exe') -Force
$paired=Get-Content -LiteralPath (Join-Path $BackendRuntimeDirectory 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
if((Get-FileHash -LiteralPath $PatchedAppServer).Hash -ne $paired.'codex-app-server.exe'){throw 'Backend runtime manifest does not match the release backend'}
$pairedDestination=Join-Path $payload 'backend-runtime';New-Item -ItemType Directory -Path $pairedDestination -Force|Out-Null
foreach($name in @('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){
    $file=Join-Path $BackendRuntimeDirectory $name
    if($paired.$name -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $file).Hash -ne $paired.$name){throw ('Backend runtime companion is invalid: '+$name)}
    Copy-Item -LiteralPath $file -Destination (Join-Path $pairedDestination $name) -Force
}
Copy-Item -LiteralPath (Join-Path $BackendRuntimeDirectory 'manifest.json') -Destination $pairedDestination -Force
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $payload 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1') -Destination $OutputDirectory -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'USER-GUIDE.md') -Destination $OutputDirectory -Force
foreach($name in @('VERSION-COMPATIBILITY.md','PERFORMANCE.md','VALIDATION.md')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory -Force}
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'patches') -Force|Out-Null
$patchManifest=Get-Content (Join-Path $PSScriptRoot 'patches\manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
foreach($name in @('manifest.json','apply.ps1','verification.json')+$patchManifest.patches){Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('patches\'+$name)) -Destination (Join-Path $OutputDirectory 'patches') -Force}
foreach($name in @('LICENSE','NOTICE','NODE-LICENSE.txt')){if(Test-Path -LiteralPath (Join-Path $PSScriptRoot $name)){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory -Force}}
$manifest=@{builtAt=[DateTime]::UtcNow.ToString('o');upstreamCommit='0c7362d121d1c7f69540262425fd4e2209fd8e8d';files=@()}
foreach($file in Get-ChildItem -LiteralPath $payload -File -Recurse){$manifest.files+=@{path=$file.FullName.Substring($OutputDirectory.Length+1);sha256=(Get-FileHash -LiteralPath $file.FullName).Hash}}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'manifest.json'),($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Write-Output ('Release staged: '+$OutputDirectory)
