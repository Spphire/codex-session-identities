param([Parameter(Mandatory=$true)][string]$Installation)
$ErrorActionPreference='Stop'
$launcher=Join-Path $Installation 'Launch-Codex.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($launcher,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Launcher syntax check failed'}
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-CodexProcessTree'},$true)
if(!$definition){throw 'Missing process-tree resolver'}
. ([scriptblock]::Create($definition.Extent.Text))
$processes=@(
    [pscustomobject]@{ProcessId=100;ParentProcessId=1},
    [pscustomobject]@{ProcessId=300;ParentProcessId=200},
    [pscustomobject]@{ProcessId=200;ParentProcessId=100},
    [pscustomobject]@{ProcessId=400;ParentProcessId=300},
    [pscustomobject]@{ProcessId=900;ParentProcessId=1}
)
$tree=@(Get-CodexProcessTree $processes @(100))
if($tree.Count -ne 4 -or 300 -notin $tree -or 400 -notin $tree -or 900 -in $tree){throw 'Restart process ownership check failed'}
$native=Join-Path $Installation 'codex-session-desktop.exe'
$process=Start-Process -FilePath $native -ArgumentList '--restart --check' -Wait -PassThru -WindowStyle Hidden
if($process.ExitCode -ne 0){throw 'Native restart preflight failed'}
$status=Get-Content (Join-Path $Installation 'launcher-status.json') -Raw|ConvertFrom-Json
if($status.state -ne 'preflight_passed' -or !$status.details.backendLoaded -or !$status.details.restartRequired){throw 'An already patched backend must still request restart'}
@{passed=$true;backendPid=$status.details.backendPid;alreadyPatchedRestartRecognized=$true;descendantBackendTracked=$true;unrelatedProcessExcluded=$true;actualRestartPerformed=$false}|ConvertTo-Json -Compress
