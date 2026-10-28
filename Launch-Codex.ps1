param([switch]$CheckOnly,[switch]$Restart,[switch]$Admin,[string]$ExpectedUserSid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
. (Join-Path $PSScriptRoot 'launcher-permissions.ps1')
. (Join-Path $PSScriptRoot 'launch-process.ps1')
# Elevate before taking the launcher mutex. Keep the same Windows user and vault.
if($ExpectedUserSid -and (Get-LauncherUserSid) -ne $ExpectedUserSid){throw 'Administrator mode must use the same Windows account. Sign in with an administrator account before launching.'}
if($Admin -and !(Test-LauncherAdministrator)){
    $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Admin','-ExpectedUserSid',(Get-LauncherUserSid))
    if($Restart){$arguments+='-Restart'}
    if($CheckOnly){$arguments+='-CheckOnly'}
    try{
        $elevated=Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
        $null=$elevated.Handle
        $elevated.WaitForExit()
        exit $elevated.ExitCode
    }catch [ComponentModel.Win32Exception]{
        if($_.Exception.NativeErrorCode -eq 1223){exit 1223}
        throw
    }
}
$logPath=Join-Path $PSScriptRoot 'launcher-status.json'
$stage='starting'
function Write-LauncherStatus([string]$State,[object]$Details){
    $script:stage=$State
    $record=@{time=[DateTime]::UtcNow.ToString('o');launcherPid=$PID;state=$State;details=$Details}
    [IO.File]::WriteAllText($logPath,($record|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $eventsPath=Join-Path $PSScriptRoot 'launcher-events.jsonl'
    if((Test-Path -LiteralPath $eventsPath) -and (Get-Item -LiteralPath $eventsPath).Length -gt 5242880){Move-Item -LiteralPath $eventsPath -Destination ($eventsPath+'.previous') -Force}
    Add-Content -LiteralPath $eventsPath -Value ($record|ConvertTo-Json -Depth 5 -Compress) -Encoding UTF8
}
function Test-IdentityDesktopProcess([object]$Process,[object]$Configuration){
    if(!$Process.ExecutablePath -or $Process.SessionId -ne (Get-Process -Id $PID).SessionId){return $false}
    # An explicitly isolated Electron profile owns only its own desktop instance.
    $isolatedProfile=[Environment]::GetEnvironmentVariable('CODEX_ELECTRON_USER_DATA_PATH')
    if($isolatedProfile){
        $profileArgument='(?:^|\s)"?--user-data-dir="?'+[regex]::Escape($isolatedProfile)+'"?(?:\s|$)'
        if(!$Process.CommandLine -or $Process.CommandLine -notmatch $profileArgument){return $false}
    }
    if($Process.ExecutablePath -eq $Configuration.desktopExe){return $true}
    $storePattern='[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]ChatGPT\.exe$'
    # Custom/fixture installations must never claim unrelated Store desktops.
    return $Configuration.desktopExe -match $storePattern -and $Process.ExecutablePath -match $storePattern
}
function Show-LauncherMessage([string]$Text,[uint32]$Style){
    if(!('CodexIdentityLauncherDialog' -as [type])){
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodexIdentityLauncherDialog {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int MessageBoxW(IntPtr owner, string text, string caption, uint style);
}
'@
    }
    return [CodexIdentityLauncherDialog]::MessageBoxW([IntPtr]::Zero,$Text,'Codex Session Identities',($Style -bor 0x50000))
}
function Get-CodexProcessTree([object[]]$Processes,[int[]]$RootIds){
    $ids=New-Object 'System.Collections.Generic.HashSet[int]'
    foreach($id in $RootIds){[void]$ids.Add($id)}
    do{
        $added=$false
        foreach($process in $Processes){
            if($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)){$added=$true}
        }
    }while($added)
    return @($ids)
}
function Get-CodexRestartProcesses([object[]]$Processes,[int[]]$RootIds,[object]$Configuration){
    $tree=Get-CodexProcessTree $Processes $RootIds
    return @($Processes|Where-Object {
        $_.ProcessId -in $tree -and (
            (Test-IdentityDesktopProcess $_ $Configuration) -or
            $_.ExecutablePath -eq $Configuration.appServerExe -or
            ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $PSScriptRoot 'runtime-bundles')+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.Name -eq 'codex-app-server.exe') -or
            ($_.ExecutablePath -and (Split-Path -Parent $_.ExecutablePath) -eq $PSScriptRoot -and $_.Name -like 'codex-app-server*.exe') -or
            ($_.ExecutablePath -eq (Join-Path $PSScriptRoot 'node.exe') -and $_.CommandLine -like '*runtime-bridge.cjs*')
        )
    })
}
function Stop-CodexRestartProcesses([object[]]$Processes){
    foreach($snapshot in $Processes){
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$snapshot.ProcessId)
        if($current -and $current.CreationDate -eq $snapshot.CreationDate -and $current.ExecutablePath -eq $snapshot.ExecutablePath){
            Stop-Process -Id $snapshot.ProcessId -ErrorAction SilentlyContinue
        }
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do{
        $remaining=@(foreach($snapshot in $Processes){
            $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$snapshot.ProcessId)
            if($current -and $current.CreationDate -eq $snapshot.CreationDate -and $current.ExecutablePath -eq $snapshot.ExecutablePath){$current}
        })
        if(!$remaining.Count){return};Start-Sleep -Milliseconds 200
    }while([DateTime]::UtcNow -lt $deadline)
    throw ('Previous Codex processes have not stopped: '+(($remaining|ForEach-Object {$_.ProcessId}) -join ','))
}
$launcherMutex=$null;$mutexAcquired=$false
try{
    $hash=[Security.Cryptography.SHA256]::Create()
    $mutexKey=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant()))).Replace('-','')
    $hash.Dispose()
    $launcherMutex=New-Object Threading.Mutex($false,('Local\CodexIdentityLauncher_'+$mutexKey))
    try{$mutexAcquired=$launcherMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$mutexAcquired=$true}
    if(!$mutexAcquired){
        @{ready=$false;preflightReady=$false;state='launcher_busy';message='Another identity launcher is still active. Close its existing error or confirmation dialog first.'}|ConvertTo-Json -Compress
        exit 2
    }
    Write-LauncherStatus 'starting' @{}
    $configuration=Get-Content (Join-Path $PSScriptRoot 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
    . (Join-Path $PSScriptRoot 'resolve-installation.ps1')
    $configuration=Resolve-CodexInstallation $configuration $PSScriptRoot
    Write-LauncherStatus 'checking_browser_runtime_paths' @{}
    $browserRepair=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'repair-browser-runtime.mjs') $PSScriptRoot|ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or !$browserRepair.passed){throw ('Browser runtime path check failed: '+$browserRepair.error)}
    Write-LauncherStatus 'repairing_provider_aliases' @{}
    $aliasRepair=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'ensure-provider-aliases.mjs') $PSScriptRoot|ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or !$aliasRepair.passed){throw 'Missing identity provider definitions could not be repaired. See the configuration backup and identity profile status.'}
    . (Join-Path $PSScriptRoot 'runtime-bundle.ps1')
    Write-LauncherStatus 'preparing_runtime_bundle' @{}
    $configuration=Resolve-IdentityRuntime $configuration $PSScriptRoot
    foreach($file in @($configuration.desktopExe,$configuration.appServerExe,(Join-Path $PSScriptRoot 'codex-identity.exe'),(Join-Path $PSScriptRoot 'node.exe'))){
        if(!$file -or !(Test-Path -LiteralPath $file)){throw ('Installed executable is unavailable: '+$file+'. If installed from a packaged app, use the Documents installation directory.')}
    }
    # Fail before stopping the current window if an updated combination cannot load.
    Write-LauncherStatus 'checking_protocol_compatibility' @{}
    $compatibility=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'compatibility-probe.mjs') $PSScriptRoot|ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or !$compatibility.passed){throw ('Identity protocol compatibility check failed: '+$compatibility.error)}
    # Never launch a second Desktop during ordinary startup or --check.
    # Full Desktop probes are an explicit maintenance operation only.
    $desktopCompatibility=@{passed=$false}
    $desktopCheckPath=Join-Path $PSScriptRoot 'desktop-compatibility-status.json'
    if(Test-Path -LiteralPath $desktopCheckPath){
        try{$previousDesktopCheck=Get-Content -LiteralPath $desktopCheckPath -Raw -Encoding UTF8|ConvertFrom-Json}catch{$previousDesktopCheck=$null}
        if($previousDesktopCheck.passed -and $previousDesktopCheck.fingerprint -eq $compatibility.fingerprint){$desktopCompatibility=$previousDesktopCheck}
    }
    $env:CODEX_HOME=$configuration.codexHome
    # Resolve-IdentityRuntime already verified the complete paired native runtime.
    $env:CODEX_CLI_PATH=Join-Path $PSScriptRoot 'codex-identity.exe'
    $env:IDENTITY_PANEL_PORT=[string]$configuration.panelPort
    $env:RUST_MIN_STACK='33554432'
    $status=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'runtime-status.mjs') $configuration.codexHome|ConvertFrom-Json
    if($LASTEXITCODE -ne 0){throw 'Cannot read identity backend status.'}
    $backend=if($status.connected){Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)}else{$null}
    $alreadyLoaded=$backend -and $backend.ExecutablePath -eq $configuration.appServerExe
    $running=@(Get-CimInstance Win32_Process|Where-Object {(Test-IdentityDesktopProcess $_ $configuration) -and $_.CommandLine -notmatch '--type=|--user-data-dir='})
    $desktopVersionChanged=@($running|Where-Object {$_.ExecutablePath -ne $configuration.desktopExe}).Count -gt 0
    $backendElevated=if($backend){Get-ProcessElevation ([int]$backend.ProcessId)}else{$null}
    $mustRestart=$running.Count -gt 0 -and ($Restart -or !$alreadyLoaded -or $desktopVersionChanged -or ($alreadyLoaded -and $status.terminalControlAvailable -eq $false) -or ($Admin -and $backendElevated -ne $true))
    $previousBackendPid=if($backend){[int]$backend.ProcessId}else{0}
    if($CheckOnly){
        $result=@{ready=[bool]$alreadyLoaded;preflightReady=$true;protocolVerified=$true;desktopVerified=[bool]$desktopCompatibility.passed;desktopVerificationMode='normal-start-handshake';fingerprint=$compatibility.fingerprint;backendLoaded=[bool]$alreadyLoaded;desktopRunning=[bool]$running.Count;restartRequired=[bool]$mustRestart;backendPid=$previousBackendPid;administratorRequested=[bool]$Admin;launcherElevated=(Test-LauncherAdministrator);backendElevated=$backendElevated}
        Write-LauncherStatus 'preflight_passed' $result
        $result|ConvertTo-Json -Compress
        exit 0
    }
    if($mustRestart){
        Write-LauncherStatus 'awaiting_restart_confirmation' @{desktopPids=@($running.ProcessId)}
        $choice=Show-LauncherMessage 'Restart Codex to reload the current account and configuration? Active replies will be interrupted. Choose No to keep the current window running.' 0x24
        if($choice -ne 6){Write-LauncherStatus 'cancelled' @{};exit 0}
        Write-LauncherStatus 'stopping_previous_desktop' @{desktopPids=@($running.ProcessId)}
        $restartProcesses=Get-CodexRestartProcesses @(Get-CimInstance Win32_Process) @($running.ProcessId) $configuration
        Write-LauncherStatus 'stopping_previous_desktop' @{processIds=@($restartProcesses.ProcessId);backendPid=$previousBackendPid}
        Stop-CodexRestartProcesses $restartProcesses
    }
    Write-LauncherStatus 'starting_desktop' @{}
    $desktop=Start-IdentityDesktop -DesktopExe $configuration.desktopExe -Installation $PSScriptRoot
    $deadline=[DateTime]::UtcNow.AddSeconds(35)
    $verified=$false
    do{
        $status=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'runtime-status.mjs') $configuration.codexHome|ConvertFrom-Json
        if($status.connected){
            $backend=Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)
            if($backend.ExecutablePath -eq $configuration.appServerExe -and (!$mustRestart -or $backend.ProcessId -ne $previousBackendPid)){
                $backendElevated=Get-ProcessElevation ([int]$backend.ProcessId)
                if($Admin -and $backendElevated -ne $true){throw 'Administrator launch reused a non-elevated backend. Close other Codex windows and retry the Administrator shortcut.'}
                $verified=$true;break
            }
        }
        Start-Sleep -Milliseconds 500
    }while([DateTime]::UtcNow -lt $deadline)
    if(!$verified){throw 'Desktop started, but its identity backend did not connect. See launcher-status.json; do not assume the patch is active.'}
    Sync-PanelServiceElevation -Installation $PSScriptRoot -CodexDirectory $configuration.codexHome -Port $configuration.panelPort -BackendElevated ([bool]$backendElevated)
    & (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'open-panel.mjs') --check
    if($LASTEXITCODE -ne 0){throw 'Identity backend is active, but the panel service could not start.'}
    Start-Process -FilePath (Join-Path $PSScriptRoot 'identity-tray.exe') -WindowStyle Hidden
    Write-LauncherStatus 'ready' @{backendPid=$status.pid;desktopLaunchPid=$desktop.Id;panelPort=$configuration.panelPort;administratorRequested=[bool]$Admin;launcherElevated=(Test-LauncherAdministrator);backendElevated=$backendElevated}
    $successful=@{time=[DateTime]::UtcNow.ToString('o');fingerprint=$compatibility.fingerprint;configuration=$configuration;backendPid=$status.pid;backendElevated=$backendElevated}
    $successfulPath=Join-Path $PSScriptRoot 'last-successful-launch.json'
    [IO.File]::WriteAllText(($successfulPath+'.tmp'),($successful|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath ($successfulPath+'.tmp') -Destination $successfulPath -Force
}catch{
    $failedStage=$stage
    $failureMessage=$_.Exception.Message
    try{Write-LauncherStatus 'failed' @{stage=$failedStage;message=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber}}catch{}
    # An error dialog must not keep all later launch attempts locked out.
    if($mutexAcquired){$launcherMutex.ReleaseMutex();$mutexAcquired=$false}
    if($CheckOnly){[Console]::Error.WriteLine('Identity launcher preflight failed. See launcher-status.json.');exit 1}
    try{[void](Show-LauncherMessage ('Session identities could not start at '+$failedStage+'.'+[Environment]::NewLine+$failureMessage+[Environment]::NewLine+'Diagnostic file: '+$logPath) 0x10)}catch{[Console]::Error.WriteLine('Identity launcher failed. See launcher-status.json.');Read-Host 'Press Enter to close'|Out-Null}
    exit 1
}finally{
    if($mutexAcquired){$launcherMutex.ReleaseMutex()}
    if($launcherMutex){$launcherMutex.Dispose()}
}
