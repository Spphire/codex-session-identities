param([Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\resolve-installation.ps1')
New-Item -ItemType Directory -Path $FixtureDirectory -Force | Out-Null
$FixtureDirectory=(Resolve-Path -LiteralPath $FixtureDirectory).Path
function Assert-Discovery([bool]$Condition,[string]$Message){if(!$Condition){throw $Message}}
function New-PackageFixture([string]$Name,[string]$Version){
    $directory=Join-Path $FixtureDirectory ('WindowsApps\OpenAI.Codex_'+$Name)
    $resources=Join-Path $directory 'app\resources'
    New-Item -ItemType Directory -Path $resources -Force | Out-Null
    foreach($name in @('codex.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){[IO.File]::WriteAllText((Join-Path $resources $name),'fixture')}
    [IO.File]::WriteAllText((Join-Path $directory 'app\ChatGPT.exe'),'fixture')
    return [pscustomobject]@{InstallLocation=$directory;Version=$Version}
}
function Get-AppxPackage {param($Name,$ErrorAction) return $script:registeredPackages}
$old=New-PackageFixture 'old' '1.0.0.0'
$new=New-PackageFixture 'new' '2.0.0.0'
$broken=New-PackageFixture 'incomplete' '3.0.0.0'
$config=[pscustomobject]@{desktopExe=(Join-Path $old.InstallLocation 'app\ChatGPT.exe');originalCodexExe=(Join-Path $old.InstallLocation 'app\resources\codex.exe');appServerExe='custom-backend-v10.exe';codexHome='unchanged-home';panelPort=18189;managePermissions=$true}
$path=Join-Path $FixtureDirectory 'runtime-config.json'
[IO.File]::WriteAllText($path,($config|ConvertTo-Json))
$script:registeredPackages=@($old,$new)
$resolved=Resolve-CodexInstallation $config $FixtureDirectory
Assert-Discovery ($resolved.desktopExe -eq (Join-Path $new.InstallLocation 'app\ChatGPT.exe')) 'Update did not select registered new Desktop while old files remain'
Assert-Discovery ($resolved.originalCodexExe -eq (Join-Path $new.InstallLocation 'app\resources\codex.exe')) 'CLI did not follow the same package'
Assert-Discovery ($resolved.appServerExe -eq 'custom-backend-v10.exe' -and $resolved.codexHome -eq 'unchanged-home' -and $resolved.managePermissions) 'Unrelated settings changed'
$writeTime=(Get-Item -LiteralPath $path).LastWriteTimeUtc
$null=Resolve-CodexInstallation $resolved $FixtureDirectory
Assert-Discovery ((Get-Item -LiteralPath $path).LastWriteTimeUtc -eq $writeTime) 'Unchanged installation rewrote configuration'
Assert-Discovery (@(Get-ChildItem -LiteralPath (Join-Path $FixtureDirectory 'backups') -File).Count -eq 1) 'Backup was not created exactly once'
$before=[IO.File]::ReadAllText($path)
$script:registeredPackages=@($broken)
[IO.File]::Delete((Join-Path $broken.InstallLocation 'app\resources\codex.exe'))
$failed=$false
try{$null=Resolve-CodexInstallation $resolved $FixtureDirectory}catch{$failed=$_.Exception.Message -like '*package is incomplete*'}
Assert-Discovery $failed 'Incomplete registered package did not produce a specific error'
Assert-Discovery ([IO.File]::ReadAllText($path) -eq $before) 'Incomplete update changed saved configuration'
$script:registeredPackages=@($old)
$resolved=Resolve-CodexInstallation $resolved $FixtureDirectory
Assert-Discovery ($resolved.desktopExe -eq (Join-Path $old.InstallLocation 'app\ChatGPT.exe')) 'Store rollback did not select registered older version'
$script:registeredPackages=@()
$before=[IO.File]::ReadAllText($path)
$null=Resolve-CodexInstallation $resolved $FixtureDirectory
Assert-Discovery ([IO.File]::ReadAllText($path) -eq $before) 'Discovery unavailable changed working configuration'
@{passed=$true;cases=@('update-with-old-files','matching-package-cli','preserve-settings','idempotent','backup','incomplete-update','store-rollback','discovery-unavailable')}|ConvertTo-Json -Compress
