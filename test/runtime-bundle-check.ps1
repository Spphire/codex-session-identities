param([Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\runtime-bundle.ps1')
New-Item -ItemType Directory -Path $FixtureDirectory -Force|Out-Null
$FixtureDirectory=(Resolve-Path -LiteralPath $FixtureDirectory).Path
$cli=Join-Path $FixtureDirectory 'cli'
New-Item -ItemType Directory -Path $cli -Force|Out-Null
foreach($name in @('codex.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){[IO.File]::WriteAllText((Join-Path $cli $name),'version-1')}
$source=Join-Path $FixtureDirectory 'backend.exe';[IO.File]::WriteAllText($source,'backend-1')
$paired=Join-Path $FixtureDirectory 'paired';New-Item -ItemType Directory -Path $paired -Force|Out-Null
$manifest=@{'codex-app-server.exe'=(Get-FileHash $source).Hash}
foreach($name in @('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){Copy-Item -LiteralPath (Join-Path $cli $name) -Destination $paired -Force;$manifest[$name]=(Get-FileHash (Join-Path $paired $name)).Hash}
$manifestPath=Join-Path $paired 'manifest.json';$manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding UTF8
$config=[pscustomobject]@{appServerExe=$source;originalCodexExe=(Join-Path $cli 'codex.exe');codexHome='preserved';backendRuntimeManifest=$manifestPath}
$configPath=Join-Path $FixtureDirectory 'runtime-config.json'
[IO.File]::WriteAllText($configPath,($config|ConvertTo-Json))
$first=Resolve-IdentityRuntime $config $FixtureDirectory
$oldBundle=$first.appServerExe
$oldHash=(Get-FileHash -LiteralPath $oldBundle).Hash
$oldCompanion=Join-Path (Split-Path -Parent $oldBundle) 'codex-code-mode-host.exe'
$time=(Get-Item -LiteralPath $configPath).LastWriteTimeUtc
$null=Resolve-IdentityRuntime $first $FixtureDirectory
if((Get-Item -LiteralPath $configPath).LastWriteTimeUtc -ne $time){throw 'Stable bundle rewrote config'}
[IO.File]::WriteAllText((Join-Path $cli 'codex-code-mode-host.exe'),'version-2')
$second=Resolve-IdentityRuntime $first $FixtureDirectory
if($second.appServerExe -ne $oldBundle -or [IO.File]::ReadAllText($oldCompanion) -ne 'version-1'){throw 'Desktop update replaced a pinned companion'}
[IO.File]::WriteAllText((Join-Path $paired 'codex-code-mode-host.exe'),'paired-version-2')
$failed=$false;try{$null=Resolve-IdentityRuntime $second $FixtureDirectory}catch{$failed=$_.Exception.Message -like '*hash mismatch*'}
if(!$failed){throw 'Unmanifested companion replacement accepted'}
$manifest['codex-code-mode-host.exe']=(Get-FileHash (Join-Path $paired 'codex-code-mode-host.exe')).Hash
$manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding UTF8
$second=Resolve-IdentityRuntime $second $FixtureDirectory
if($second.appServerExe -eq $oldBundle){throw 'Manifested companion update did not produce a new bundle'}
[IO.File]::WriteAllText($source,'backend-2')
$failed=$false;try{$null=Resolve-IdentityRuntime $second $FixtureDirectory}catch{$failed=$_.Exception.Message -like '*hash mismatch*'}
if(!$failed){throw 'Different backend accepted with old companion manifest'}
$manifest['codex-app-server.exe']=(Get-FileHash $source).Hash;$manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding UTF8
$third=Resolve-IdentityRuntime $second $FixtureDirectory
if((Get-FileHash -LiteralPath $oldBundle).Hash -ne $oldHash){throw 'Backend deployment replacement changed previous bundle'}
$before=[IO.File]::ReadAllText($configPath)
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $third.appServerExe) 'codex-command-runner.exe'),'corrupt')
$failed=$false
try{$null=Resolve-IdentityRuntime $third $FixtureDirectory}catch{$failed=$_.Exception.Message -like '*Runtime bundle changed*'}
if(!$failed -or [IO.File]::ReadAllText($configPath) -ne $before){throw 'Corrupt runtime was accepted or altered config'}
@{passed=$true;unchangedBundleReused=$true;desktopUpdateCannotReplaceCompanions=$true;unpairedChangesRejected=$true;companionUpgradeIsolated=$true;backendReplacementIsolated=$true;corruptionRejected=$true;settingsPreserved=($third.codexHome -eq 'preserved')}|ConvertTo-Json -Compress
