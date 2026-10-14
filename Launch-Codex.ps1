param([switch]$CheckOnly,[switch]$Restart)
$ErrorActionPreference='Stop'
$logPath=Join-Path $PSScriptRoot 'launcher-status.json'
$stage='starting'
function Write-LauncherStatus([string]$State,[object]$Details){
    $script:stage=$State
    $record=@{time=[DateTime]::UtcNow.ToString('o');launcherPid=$PID;state=$State;details=$Details}
    [IO.File]::WriteAllText($logPath,($record|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
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
            $_.ExecutablePath -eq $Configuration.desktopExe -or
            $_.ExecutablePath -eq $Configuration.appServerExe -or
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
    if(!$mutexAcquired){exit 0}
    Write-LauncherStatus 'starting' @{}
    $configuration=Get-Content (Join-Path $PSScriptRoot 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($file in @($configuration.desktopExe,$configuration.appServerExe,(Join-Path $PSScriptRoot 'codex-identity.exe'),(Join-Path $PSScriptRoot 'node.exe'))){
        if(!$file -or !(Test-Path -LiteralPath $file)){throw ('Installed executable is unavailable: '+$file+'. If installed from a packaged app, use the Documents installation directory.')}
    }
    $env:CODEX_HOME=$configuration.codexHome
    foreach($name in @('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){
        if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $name))){
            $source=Join-Path (Split-Path -Parent $configuration.originalCodexExe) $name
            if(!(Test-Path -LiteralPath $source)){throw ('Original CLI companion is missing: '+$source+'. Repair the original Codex installation.')}
            Copy-Item -LiteralPath $source -Destination (Join-Path $PSScriptRoot $name) -Force
        }
    }
    $env:CODEX_CLI_PATH=Join-Path $PSScriptRoot 'codex-identity.exe'
    $env:IDENTITY_PANEL_PORT=[string]$configuration.panelPort
    $env:RUST_MIN_STACK='33554432'
    $status=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'runtime-status.mjs') $configuration.codexHome|ConvertFrom-Json
    if($LASTEXITCODE -ne 0){throw 'Cannot read identity backend status.'}
    $backend=if($status.connected){Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)}else{$null}
    $alreadyLoaded=$backend -and $backend.ExecutablePath -eq $configuration.appServerExe
    $running=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $configuration.desktopExe -and $_.CommandLine -notmatch '--type=|--user-data-dir='})
    $mustRestart=$running.Count -gt 0 -and ($Restart -or !$alreadyLoaded)
    $previousBackendPid=if($backend){[int]$backend.ProcessId}else{0}
    if($CheckOnly){
        $result=@{ready=$true;backendLoaded=[bool]$alreadyLoaded;desktopRunning=[bool]$running.Count;restartRequired=[bool]$mustRestart;backendPid=$previousBackendPid}
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
    $desktop=Start-Process -FilePath $configuration.desktopExe -WindowStyle Normal -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(35)
    $verified=$false
    do{
        $status=& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'runtime-status.mjs') $configuration.codexHome|ConvertFrom-Json
        if($status.connected){
            $backend=Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)
            if($backend.ExecutablePath -eq $configuration.appServerExe -and (!$mustRestart -or $backend.ProcessId -ne $previousBackendPid)){$verified=$true;break}
        }
        Start-Sleep -Milliseconds 500
    }while([DateTime]::UtcNow -lt $deadline)
    if(!$verified){throw 'Desktop started, but its identity backend did not connect. See launcher-status.json; do not assume the patch is active.'}
    & (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'open-panel.mjs') --check
    if($LASTEXITCODE -ne 0){throw 'Identity backend is active, but the panel service could not start.'}
    Start-Process -FilePath (Join-Path $PSScriptRoot 'identity-tray.exe') -WindowStyle Hidden
    Write-LauncherStatus 'ready' @{backendPid=$status.pid;desktopLaunchPid=$desktop.Id;panelPort=$configuration.panelPort}
}catch{
    $failedStage=$stage
    try{Write-LauncherStatus 'failed' @{stage=$failedStage;message=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber}}catch{}
    if($CheckOnly){[Console]::Error.WriteLine('Identity launcher preflight failed. See launcher-status.json.');exit 1}
    try{[void](Show-LauncherMessage ('Session identities could not start. Diagnostic file: '+$logPath) 0x10)}catch{[Console]::Error.WriteLine('Identity launcher failed. See launcher-status.json.');Read-Host 'Press Enter to close'|Out-Null}
    exit 1
}finally{
    if($mutexAcquired){$launcherMutex.ReleaseMutex()}
    if($launcherMutex){$launcherMutex.Dispose()}
}
