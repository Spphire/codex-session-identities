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
