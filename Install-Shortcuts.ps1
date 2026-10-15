param([string]$Installation=$PSScriptRoot,[string]$DesktopDirectory=[Environment]::GetFolderPath('DesktopDirectory'))
$ErrorActionPreference='Stop'
$configuration=Get-Content (Join-Path $Installation 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$shell=New-Object -ComObject WScript.Shell
foreach($entry in @(
    @{name='Codex - Session Identities';exe='codex-session-desktop.exe';arguments='--admin --restart'},
    @{name='Codex - Session Identities (Standard)';exe='codex-session-desktop.exe';arguments='--restart'},
    @{name='Codex - Session Identities (Administrator)';exe='codex-session-desktop.exe';arguments='--admin --restart'},
    @{name='Codex Identity Panel';exe='identity-panel.exe';arguments=''}
)){
    $link=$shell.CreateShortcut((Join-Path $DesktopDirectory ($entry.name+'.lnk')))
    $link.TargetPath=Join-Path $Installation $entry.exe
    $link.Arguments=$entry.arguments
    $link.WorkingDirectory=$Installation
    $link.IconLocation=$configuration.desktopExe
    $link.Save()
}
