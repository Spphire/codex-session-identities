$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\launcher-permissions.ps1')
$self=Get-ProcessElevation $PID
if($self -ne (Test-LauncherAdministrator)){throw 'Process token elevation does not match current user token'}
if($null -ne (Get-ProcessElevation 2147483647)){throw 'Missing process must report unknown elevation'}
if((Get-LauncherUserSid) -notlike 'S-1-*'){throw 'Missing Windows user SID'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('identity-shortcuts-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root|Out-Null
try{
    [IO.File]::WriteAllText((Join-Path $root 'runtime-config.json'),'{"desktopExe":"C:\\Windows\\notepad.exe"}')
    & (Join-Path $PSScriptRoot '..\Install-Shortcuts.ps1') -Installation $root -DesktopDirectory $root
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut((Join-Path $root 'Codex - Session Identities (Administrator).lnk'))
    if($link.Arguments -ne '--admin --restart' -or $link.TargetPath -ne (Join-Path $root 'codex-session-desktop.exe')){throw 'Administrator shortcut does not invoke the elevated launcher'}
    @{passed=$true;currentProcessElevated=$self;processTokenQuery=$true;adminShortcut=$true}|ConvertTo-Json -Compress
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
