param([string]$Installation=$PSScriptRoot,[string]$DesktopDirectory=[Environment]::GetFolderPath('DesktopDirectory'))
$ErrorActionPreference='Stop'
$configuration=Get-Content (Join-Path $Installation 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
. (Join-Path $Installation 'resolve-installation.ps1')
$configuration=Resolve-CodexInstallation $configuration $Installation
# Keep the icon outside the versioned Store package directory.
$iconPath=Join-Path $Installation 'codex-shortcut.ico'
Add-Type -AssemblyName System.Drawing
$icon=[Drawing.Icon]::ExtractAssociatedIcon($configuration.desktopExe)
if(!$icon){throw 'Cannot extract the installed Codex icon'}
$stream=[IO.File]::Create($iconPath)
try{$icon.Save($stream)}finally{$stream.Dispose();$icon.Dispose()}
$shell=New-Object -ComObject WScript.Shell
foreach($entry in @(
    @{name='Codex - Session Identities';exe='codex-session-desktop.exe';arguments='--admin --restart'},
    @{name='Codex - Session Identities (Standard)';exe='codex-session-desktop.exe';arguments='--restart'},
    @{name='Codex Identity Panel';exe='identity-panel.exe';arguments=''}
)){
    $link=$shell.CreateShortcut((Join-Path $DesktopDirectory ($entry.name+'.lnk')))
    $link.TargetPath=Join-Path $Installation $entry.exe
    $link.Arguments=$entry.arguments
    $link.WorkingDirectory=$Installation
    $link.IconLocation=$iconPath+',0'
    $link.Save()
}
# Earlier installers created an identical Administrator alias. Retire only that
# exact owned alias; preserve links whose target or arguments were customized.
$legacyPath=Join-Path $DesktopDirectory 'Codex - Session Identities (Administrator).lnk'
if(Test-Path -LiteralPath $legacyPath){
    $legacy=$shell.CreateShortcut($legacyPath)
    if($legacy.TargetPath -eq (Join-Path $Installation 'codex-session-desktop.exe') -and $legacy.Arguments -eq '--admin --restart'){
        $backup=Join-Path $Installation ('backups\shortcuts-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
        New-Item -ItemType Directory -Path $backup -Force|Out-Null
        Copy-Item -LiteralPath $legacyPath -Destination (Join-Path $backup (Split-Path -Leaf $legacyPath))
        Remove-Item -LiteralPath $legacyPath
    }
}
