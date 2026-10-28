param([string]$Installation=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Installation 'Launch-Codex.ps1'),[ref]$tokens,[ref]$errors)
if($errors){throw 'Launcher parse failed'}
foreach($name in @('Test-IdentityDesktopProcess','Get-CodexProcessTree','Get-CodexRestartProcesses')){
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    . ([scriptblock]::Create($function.Extent.Text))
}
$configuration=@{desktopExe='C:\Program Files\WindowsApps\OpenAI.Codex_new_x64\app\ChatGPT.exe';appServerExe='C:\identity\codex-app-server-v10.exe'}
$old=[pscustomobject]@{ProcessId=100;ParentProcessId=1;ExecutablePath='C:\Program Files\WindowsApps\OpenAI.Codex_old_x64\app\ChatGPT.exe';Name='ChatGPT.exe';CommandLine='desktop'}
$old|Add-Member -NotePropertyName SessionId -NotePropertyValue (Get-Process -Id $PID).SessionId
$backend=[pscustomobject]@{ProcessId=101;ParentProcessId=100;ExecutablePath=$configuration.appServerExe;Name='codex-app-server-v10.exe';CommandLine='backend'}
$other=[pscustomobject]@{ProcessId=200;ParentProcessId=1;ExecutablePath=$configuration.appServerExe;Name='codex-app-server-v10.exe';CommandLine='another desktop backend'}
if(!(Test-IdentityDesktopProcess $old $configuration)){throw 'Old Store version was not recognized'}
$custom=@{desktopExe='C:\isolated-fixture\TestDesktop.exe';appServerExe=$configuration.appServerExe}
if(Test-IdentityDesktopProcess $old $custom){throw 'Fixture claimed an unrelated production Store desktop'}
$otherSession=$old.PSObject.Copy();$otherSession.SessionId=$old.SessionId+1
if(Test-IdentityDesktopProcess $otherSession $configuration){throw 'Launcher claimed another interactive session desktop'}
$savedProfile=$env:CODEX_ELECTRON_USER_DATA_PATH
try{
    $env:CODEX_ELECTRON_USER_DATA_PATH='C:\isolated fixture\electron'
    if(Test-IdentityDesktopProcess $old $configuration){throw 'Isolated launcher claimed the default profile desktop'}
    $isolated=$old.PSObject.Copy();$isolated.CommandLine='"ChatGPT.exe" --user-data-dir="C:\isolated fixture\electron"'
    if(!(Test-IdentityDesktopProcess $isolated $configuration)){throw 'Isolated launcher failed to recognize its own quoted profile'}
    $isolated.CommandLine='"ChatGPT.exe" --user-data-dir="C:\isolated fixture\electron-other"'
    if(Test-IdentityDesktopProcess $isolated $configuration){throw 'Isolated launcher claimed another profile with a shared path prefix'}
}finally{$env:CODEX_ELECTRON_USER_DATA_PATH=$savedProfile}
$owned=@(Get-CodexRestartProcesses @($old,$backend,$other) @(100) $configuration)
if($owned.Count -ne 2 -or 100 -notin $owned.ProcessId -or 101 -notin $owned.ProcessId -or 200 -in $owned.ProcessId){throw 'Version upgrade restart ownership failed'}
@{passed=$true;oldDesktopDetected=$true;ownedBackendIncluded=$true;unrelatedBackendExcluded=$true}|ConvertTo-Json -Compress
