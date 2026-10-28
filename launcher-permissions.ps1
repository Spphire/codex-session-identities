function Get-LauncherUserSid {
    return [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
}
function Test-LauncherAdministrator {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Get-ProcessElevation([int]$ProcessId) {
    if(!('CodexIdentityProcessToken' -as [type])){
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodexIdentityProcessToken {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool? IsElevated(int pid) {
        IntPtr process=OpenProcess(0x1000, false, pid);
        if(process==IntPtr.Zero) return null;
        IntPtr token=IntPtr.Zero;
        try {
            if(!OpenProcessToken(process, 0x0008, out token)) return null;
            int value, returned;
            return GetTokenInformation(token, 20, out value, sizeof(int), out returned) ? (bool?)(value!=0) : null;
        } finally { if(token!=IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
'@
    }
    return [CodexIdentityProcessToken]::IsElevated($ProcessId)
}

function Sync-PanelServiceElevation([string]$Installation,[string]$CodexDirectory,[int]$Port,[bool]$BackendElevated) {
    if(!$BackendElevated -or !(Test-LauncherAdministrator)){return}
    $descriptorPath=Join-Path $CodexDirectory ('session-identities\panel-access-'+$Port+'.json')
    if(!(Test-Path -LiteralPath $descriptorPath)){return}
    try{$descriptor=Get-Content -LiteralPath $descriptorPath -Raw|ConvertFrom-Json}catch{return}
    if($descriptor.port -ne $Port -or !$descriptor.pid){return}
    $service=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$descriptor.pid)
    if(!$service -or $service.ExecutablePath -ne (Join-Path $Installation 'node.exe')){return}
    $scriptPath=Join-Path $Installation 'server.mjs'
    if(!$service.CommandLine -or $service.CommandLine.IndexOf($scriptPath,[StringComparison]::OrdinalIgnoreCase) -lt 0){return}
    if((Get-ProcessElevation ([int]$service.ProcessId)) -ne $false){return}
    # An old standard panel cannot access an elevated bridge's named pipe.
    # Stop only the identified panel service; open-panel starts its replacement.
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$service.ProcessId)
    if($current -and $current.CreationDate -eq $service.CreationDate -and $current.ExecutablePath -eq $service.ExecutablePath){
        Stop-Process -Id $current.ProcessId -ErrorAction Stop
        $deadline=[DateTime]::UtcNow.AddSeconds(5)
        do{
            $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$service.ProcessId)
            if(!$current -or $current.CreationDate -ne $service.CreationDate){return}
            Start-Sleep -Milliseconds 100
        }while([DateTime]::UtcNow -lt $deadline)
        throw 'Previous panel service did not stop before elevation repair.'
    }
}
