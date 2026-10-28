param([Parameter(Mandatory=$true)][string]$Installation,[Parameter(Mandatory=$true)][string]$FixtureDirectory,[switch]$Administrator,[switch]$RejectCompatibility,[string]$ResultPath)
$ErrorActionPreference='Stop'
$FixtureDirectory=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($FixtureDirectory)
New-Item -ItemType Directory -Path $FixtureDirectory -Force|Out-Null
$launcher=Get-Content (Join-Path $Installation 'Launch-Codex.ps1') -Raw
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($launcher,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Launcher syntax errors'}
$dialog=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Show-LauncherMessage'},$true)
# Only the confirmation dialog is mocked. Process stop/start and native entry are real.
$fixtureLauncher=$launcher.Remove($dialog.Extent.StartOffset,$dialog.Extent.EndOffset-$dialog.Extent.StartOffset).Insert($dialog.Extent.StartOffset,'function Show-LauncherMessage([string]$Text,[uint32]$Style){ if($Style -eq 0x24){return 6}; throw $Text }')
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'Launch-Codex.ps1'),$fixtureLauncher,[Text.UTF8Encoding]::new($false))
foreach($name in @('node.exe','codex-session-desktop.exe','launcher-permissions.ps1','resolve-installation.ps1','launch-process.ps1')){Copy-Item (Join-Path $Installation $name) $FixtureDirectory -Force}
$fixtureSource=Join-Path $PSScriptRoot 'restart-fixture.cs'
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe /reference:System.Web.Extensions.dll ('/out:'+(Join-Path $FixtureDirectory 'TestDesktop.exe')) $fixtureSource
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
foreach($name in @('TestBackend.exe','TestAuxiliary.exe','identity-tray.exe','codex-identity.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){Copy-Item (Join-Path $FixtureDirectory 'TestDesktop.exe') (Join-Path $FixtureDirectory $name) -Force}
$config=@{codexHome=$FixtureDirectory;desktopExe=(Join-Path $FixtureDirectory 'TestDesktop.exe');appServerExe=(Join-Path $FixtureDirectory 'TestBackend.exe');panelPort=18199}
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'runtime-config.json'),($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'runtime-status.mjs'),@'
import fs from 'node:fs';
import path from 'node:path';
const file=path.join(process.argv[2],'test-live.json');
try{const state=JSON.parse(fs.readFileSync(file));process.kill(state.pid,0);console.log(JSON.stringify({connected:true,pid:state.pid}));}
catch{console.log(JSON.stringify({connected:false}));}
'@,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'open-panel.mjs'),'console.log(JSON.stringify({ready:true}));',[Text.UTF8Encoding]::new($false))
# These isolated process-ownership fixtures do not run the real protocol/Desktop probes.
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'compatibility-probe.mjs'),'console.log(JSON.stringify({passed:true,fingerprint:"fixture",cliVersion:"fixture"}));',[Text.UTF8Encoding]::new($false))
if($RejectCompatibility){[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'compatibility-probe.mjs'),'console.log(JSON.stringify({passed:false,error:"synthetic incompatible backend"}));process.exitCode=1;',[Text.UTF8Encoding]::new($false))}
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'Test-DesktopCompatibility.ps1'),'param($Installation,$Fingerprint) @{passed=$true}|ConvertTo-Json -Compress',[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'runtime-bundle.ps1'),'function Resolve-IdentityRuntime($Configuration,$Installation){return $Configuration}',[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'ensure-provider-aliases.mjs'),'console.log(JSON.stringify({passed:true,providersAdded:0}));',[Text.UTF8Encoding]::new($false))
$desktopPath=Join-Path $FixtureDirectory 'TestDesktop.exe'
try {
    Start-Process -FilePath $desktopPath -WindowStyle Hidden|Out-Null
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while(!(Test-Path (Join-Path $FixtureDirectory 'test-live.json')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
    $before=Get-Content (Join-Path $FixtureDirectory 'test-live.json') -Raw|ConvertFrom-Json
    $arguments=if($Administrator){'--admin --restart'}else{'--restart'}
    if($RejectCompatibility){
        # The native wrapper intentionally opens an error dialog on failure.
        # Exercise rejection through its PowerShell target without creating a UI.
        $runner=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $runnerArguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $FixtureDirectory 'Launch-Codex.ps1')+'"'),'-Restart')
        $native=Start-Process -FilePath $runner -ArgumentList $runnerArguments -WindowStyle Hidden -PassThru
    }else{
        $native=Start-Process -FilePath (Join-Path $FixtureDirectory 'codex-session-desktop.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
    }
    if(!$native.WaitForExit(25000)){throw 'Restart integration timed out'}
    if($RejectCompatibility){
        $failure=Get-Content -LiteralPath (Join-Path $FixtureDirectory 'launcher-status.json') -Raw -Encoding UTF8|ConvertFrom-Json
        if($native.ExitCode -eq 0 -or $failure.state -ne 'failed' -or $failure.details.stage -ne 'checking_protocol_compatibility'){throw 'Compatibility rejection did not fail at the expected stage'}
        if(!(Get-Process -Id $before.pid -ErrorAction SilentlyContinue) -or !(Get-Process -Id $before.desktopPid -ErrorAction SilentlyContinue)){throw 'Rejected update interrupted the existing Desktop'}
        @{passed=$true;incompatibleUpdateRejected=$true;existingDesktopPreserved=$true;existingBackendPreserved=$true;actualCodexRestarted=$false}|ConvertTo-Json -Compress
        return
    }
    if($native.ExitCode -ne 0){throw 'Native restart failed'}
    $status=Get-Content (Join-Path $FixtureDirectory 'launcher-status.json') -Raw|ConvertFrom-Json
    $after=Get-Content (Join-Path $FixtureDirectory 'test-live.json') -Raw|ConvertFrom-Json
    if($status.state -ne 'ready' -or $before.pid -eq $after.pid -or $before.desktopPid -eq $after.desktopPid){throw 'Restart did not reopen with a new backend'}
    if(Get-Process -Id $before.pid -ErrorAction SilentlyContinue){throw 'Previous backend still running'}
    if(!(Get-Process -Id $after.desktopPid -ErrorAction SilentlyContinue)){throw 'New desktop is not running'}
    if(!(Get-Process -Id $before.auxiliaryPid -ErrorAction SilentlyContinue)){throw 'Auxiliary child should not be killed or block restart'}
    if($Administrator -and (!$status.details.administratorRequested -or !$status.details.launcherElevated -or !$status.details.backendElevated)){throw 'Administrator mode did not elevate the backend'}
    $result=@{passed=$true;nativeLauncherUsed=$true;confirmationDialogMocked=$true;realProcessesStoppedAndReopened=$true;auxiliaryChildSurvived=$true;oldBackendPid=$before.pid;newBackendPid=$after.pid;administratorRequested=[bool]$Administrator;launcherElevated=$status.details.launcherElevated;backendElevated=$status.details.backendElevated;actualCodexRestarted=$false}|ConvertTo-Json -Compress
    if($ResultPath){[IO.File]::WriteAllText($ResultPath,$result,[Text.UTF8Encoding]::new($false))}
    $result
} finally {
    Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($FixtureDirectory+'\',[StringComparison]::OrdinalIgnoreCase)}|ForEach-Object {Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
}
