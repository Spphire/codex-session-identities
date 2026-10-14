param([switch]$Reload)
$ErrorActionPreference='Stop'
$profile=$env:IDENTITY_PANEL_BROWSER_PROFILE
if(!$profile -or !$env:IDENTITY_PANEL_OPEN_URL){throw 'Missing panel window configuration'}
$hash=[Security.Cryptography.SHA256]::Create()
try{$key=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($profile.ToLowerInvariant()))).Replace('-','')}finally{$hash.Dispose()}
$mutex=New-Object Threading.Mutex($false,('Local\CodexIdentityPanelWindow_'+$key))
$locked=$false
try{
    try{$locked=$mutex.WaitOne(15000)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(!$locked){throw 'Panel window activation is busy'}
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IdentityPanelWindow {
    public delegate bool EnumCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    public static IntPtr Find(int[] processIds) {
        var ids = new HashSet<int>(processIds);
        IntPtr result = IntPtr.Zero;
        EnumWindows((window, state) => {
            uint pid; GetWindowThreadProcessId(window, out pid);
            if (ids.Contains((int)pid) && IsWindowVisible(window)) { result = window; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    public static void Activate(IntPtr window) { ShowWindowAsync(window, 9); SetForegroundWindow(window); }
    public static void Close(IntPtr window) { PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero); }
}
'@
    function Find-PanelWindow {
        $processes=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'")
        $ids=New-Object 'Collections.Generic.HashSet[int]'
        foreach($p in $processes){if($p.CommandLine -and $p.CommandLine.Contains($profile)){[void]$ids.Add([int]$p.ProcessId)}}
        do{
            $changed=$false
            foreach($p in $processes){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}
        }while($changed)
        return [IdentityPanelWindow]::Find([int[]]@($ids))
    }
    $window=Find-PanelWindow
    if($Reload -and $window -ne [IntPtr]::Zero){
        [IdentityPanelWindow]::Close($window)
        $deadline=[DateTime]::UtcNow.AddSeconds(5)
        do{Start-Sleep -Milliseconds 200;$window=Find-PanelWindow}while($window -ne [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
        if($window -ne [IntPtr]::Zero){throw 'Existing panel window did not close'}
    }
    $reused=$window -ne [IntPtr]::Zero
    if(!$reused){
        $browser=@(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
        ) | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
        if(!$browser){throw 'Microsoft Edge or Google Chrome is required for the reusable panel window'}
        Start-Process -FilePath $browser -WindowStyle Hidden -ArgumentList @('--user-data-dir="'+$profile+'"','--app="'+$env:IDENTITY_PANEL_OPEN_URL+'"','--no-first-run','--no-default-browser-check') | Out-Null
        $deadline=[DateTime]::UtcNow.AddSeconds(12)
        do{Start-Sleep -Milliseconds 200;$window=Find-PanelWindow}while($window -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
        if($window -eq [IntPtr]::Zero){throw 'Panel browser window did not appear'}
    }
    [IdentityPanelWindow]::Activate($window)
    @{reused=$reused;window=$window.ToInt64()} | ConvertTo-Json -Compress
}finally{
    if($locked){$mutex.ReleaseMutex()}
    $mutex.Dispose()
}
