param([string]$InstallDirectory=(Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\Applications\CodexSessionIdentity'),[string]$CodexHome=(Join-Path $env:USERPROFILE '.codex'),[string]$CodexExe,[string]$DesktopExe,[switch]$NoShortcuts)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
if(!$CodexExe){$CodexExe=Get-ChildItem (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Filter codex.exe -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1 -ExpandProperty FullName}
if(!$DesktopExe){$package=Get-AppxPackage -Name OpenAI.Codex|Select-Object -First 1;if($package){$DesktopExe=Join-Path $package.InstallLocation 'app\ChatGPT.exe'}}
if(!$CodexExe -or !(Test-Path -LiteralPath $CodexExe)){throw 'Pass -CodexExe with the installed Codex CLI path.'}
if(!$DesktopExe -or !(Test-Path -LiteralPath $DesktopExe)){throw 'Pass -DesktopExe with the installed Desktop executable path.'}
$version=& $CodexExe --version
if($LASTEXITCODE -ne 0 -or $version -notlike 'codex-cli *'){throw 'The selected executable is not the Codex CLI.'}
$companionNames=@('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')
$originalDirectory=Split-Path -Parent $CodexExe
foreach($name in $companionNames){if(!(Test-Path -LiteralPath (Join-Path $originalDirectory $name))){throw ('Original CLI companion is missing: '+$name)}}
$payload=Join-Path $PSScriptRoot 'payload'
if(!(Test-Path -LiteralPath (Join-Path $payload 'codex-app-server.exe'))){throw 'Use the packaged release containing payload binaries.'}
if(!(Test-Path -LiteralPath (Join-Path $payload 'backend-runtime\manifest.json'))){throw 'Use a release containing the paired backend runtime.'}
$paired=Get-Content -LiteralPath (Join-Path $payload 'backend-runtime\manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
foreach($name in @('codex-app-server.exe')+$companionNames){
    $file=if($name -eq 'codex-app-server.exe'){Join-Path $payload $name}else{Join-Path $payload ('backend-runtime\'+$name)}
    if($paired.$name -notmatch '^[a-fA-F0-9]{64}$' -or !(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file).Hash -ne $paired.$name){throw ('Release backend runtime is incomplete or mismatched: '+$name)}
}
if(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.Name -like 'codex*'}){throw 'Close the patched Codex before replacing its files.'}
$trayPath=Join-Path $InstallDirectory 'identity-tray.exe'
if(Test-Path -LiteralPath $trayPath){
    $trayProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $trayPath})
    if($trayProcesses.Count){
        Start-Process -FilePath $trayPath -ArgumentList '--stop' -WindowStyle Hidden -Wait
        foreach($tray in $trayProcesses){Wait-Process -Id $tray.ProcessId -Timeout 5 -ErrorAction SilentlyContinue;if(Get-Process -Id $tray.ProcessId -ErrorAction SilentlyContinue){throw 'Tray has not exited; close it before updating.'}}
    }
}
$accessFile=Join-Path $CodexHome 'session-identities\panel-access-18189.json'
if(Test-Path -LiteralPath $accessFile){
    $access=Get-Content -LiteralPath $accessFile -Raw|ConvertFrom-Json
    $panel=Get-CimInstance Win32_Process -Filter ('ProcessId='+$access.pid)
    if($panel.ExecutablePath -eq (Join-Path $InstallDirectory 'node.exe') -and $panel.CommandLine -like '*server.mjs*'){Stop-Process -Id $panel.ProcessId}
}
New-Item -ItemType Directory -Path $InstallDirectory -Force|Out-Null
Copy-Item -Path (Join-Path $payload '*') -Destination $InstallDirectory -Recurse -Force
$configuration=@{originalCodexExe=$CodexExe;appServerExe=(Join-Path $InstallDirectory 'codex-app-server.exe');desktopExe=$DesktopExe;codexHome=$CodexHome;panelPort=18189;integrationTests=$false;managePermissions=$true;upstreamCommit='0c7362d121d1c7f69540262425fd4e2209fd8e8d'}
$configuration.backendRuntimeManifest=Join-Path $InstallDirectory 'backend-runtime\manifest.json'
$configuration.identityForceRevision=1
[IO.File]::WriteAllText((Join-Path $InstallDirectory 'runtime-config.json'),($configuration|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$env:CODEX_HOME=$CodexHome
$node=Join-Path $InstallDirectory 'node.exe'
if(Test-Path -LiteralPath (Join-Path $CodexHome 'auth.json')){
    $authMode=(Get-Content -LiteralPath (Join-Path $CodexHome 'auth.json') -Raw -Encoding UTF8|ConvertFrom-Json).auth_mode
    if($authMode -eq 'chatgpt'){
    & $node (Join-Path $InstallDirectory 'register-system-official.mjs') $CodexHome
    if($LASTEXITCODE -ne 0){Write-Warning 'Current login was not registered as an official identity.'}
    }
}
if(Test-Path -LiteralPath (Join-Path $CodexHome 'identity-switcher\state.json')){
    & $node (Join-Path $InstallDirectory 'import-profiles.mjs') $CodexExe $CodexHome
    if($LASTEXITCODE -ne 0){Write-Warning 'Some saved identities require re-registration or import from the interactive Windows login.'}
}
if(!$NoShortcuts){
    & (Join-Path $InstallDirectory 'Install-Shortcuts.ps1') -Installation $InstallDirectory
}
Write-Output ('Installed: '+$InstallDirectory)
Write-Output ('Original CLI: '+$version)
Write-Output 'Close Codex once, then use the Session Identities shortcut. Later identity changes do not restart Codex.'
