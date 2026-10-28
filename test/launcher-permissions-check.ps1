$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\launcher-permissions.ps1')
$self=Get-ProcessElevation $PID
if($self -ne (Test-LauncherAdministrator)){throw 'Process token elevation does not match current user token'}
if($null -ne (Get-ProcessElevation 2147483647)){throw 'Missing process must report unknown elevation'}
if((Get-LauncherUserSid) -notlike 'S-1-*'){throw 'Missing Windows user SID'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('identity-shortcuts-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root|Out-Null
try{
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\resolve-installation.ps1') -Destination $root
    [IO.File]::WriteAllText((Join-Path $root 'runtime-config.json'),'{"desktopExe":"C:\\Windows\\notepad.exe","originalCodexExe":"C:\\Windows\\notepad.exe"}')
    $shell=New-Object -ComObject WScript.Shell
    $legacyPath=Join-Path $root 'Codex - Session Identities (Administrator).lnk'
    $legacy=$shell.CreateShortcut($legacyPath);$legacy.TargetPath=Join-Path $root 'codex-session-desktop.exe';$legacy.Arguments='--admin --restart';$legacy.Save()
    & (Join-Path $PSScriptRoot '..\Install-Shortcuts.ps1') -Installation $root -DesktopDirectory $root
    $link=$shell.CreateShortcut((Join-Path $root 'Codex - Session Identities.lnk'))
    if($link.Arguments -ne '--admin --restart' -or $link.TargetPath -ne (Join-Path $root 'codex-session-desktop.exe')){throw 'Administrator shortcut does not invoke the elevated launcher'}
    if(Test-Path -LiteralPath $legacyPath){throw 'Duplicate Administrator shortcut was retained'}
    if(@(Get-ChildItem -LiteralPath (Join-Path $root 'backups') -Filter '*.lnk' -Recurse).Count -ne 1){throw 'Retired shortcut was not backed up'}
    & (Join-Path $PSScriptRoot '..\Install-Shortcuts.ps1') -Installation $root -DesktopDirectory $root
    if(@(Get-ChildItem -LiteralPath $root -Filter '*.lnk').Count -ne 3){throw 'Repeated installation recreated duplicates'}
    $custom=$shell.CreateShortcut($legacyPath);$custom.TargetPath=Join-Path $root 'custom.exe';$custom.Arguments='--custom';$custom.Save()
    & (Join-Path $PSScriptRoot '..\Install-Shortcuts.ps1') -Installation $root -DesktopDirectory $root
    if(!(Test-Path -LiteralPath $legacyPath)){throw 'Customized legacy shortcut was removed'}
    @{passed=$true;currentProcessElevated=$self;processTokenQuery=$true;adminShortcut=$true}|ConvertTo-Json -Compress
}finally{
    $resolved=[IO.Path]::GetFullPath($root)
    $temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(!$resolved.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'identity-shortcuts-*'){throw 'Fixture cleanup escaped the temporary directory'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
