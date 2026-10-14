param([Parameter(Mandatory=$true)][string]$PatchedAppServer,[Parameter(Mandatory=$true)][string]$OutputDirectory,[string]$NodeExecutable=(Get-Command node).Source)
$ErrorActionPreference='Stop'
$OutputDirectory=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$payload=Join-Path $OutputDirectory 'payload'
New-Item -ItemType Directory -Path $payload -Force|Out-Null
$files=@('server.mjs','catalog.mjs','bindings.mjs','switch-coordinator.mjs','bridge-client.mjs','runtime-bridge.cjs','runtime-status.mjs','stdio-client.mjs','open-panel.mjs','import-profiles.mjs','register-system-official.mjs','official-vault.ps1','export-compat.mjs','Launch-Codex.ps1','Disable.ps1','codex-identity.exe','codex-identity-credential.exe','identity-panel.exe','package.json')
$files+='model-catalog-compat.cjs'
$files+='Open-PanelWindow.ps1'
$files+='codex-session-desktop.exe'
$files+='identity-tray.exe'
$files+='register-second-official.mjs'
foreach($name in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $payload $name) -Force}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'public') -Destination $payload -Recurse -Force
Copy-Item -LiteralPath $PatchedAppServer -Destination (Join-Path $payload 'codex-app-server.exe') -Force
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $payload 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1') -Destination $OutputDirectory -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'USER-GUIDE.md') -Destination $OutputDirectory -Force
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'patches') -Force|Out-Null
$patchManifest=Get-Content (Join-Path $PSScriptRoot 'patches\manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
foreach($name in @('manifest.json','apply.ps1','verification.json')+$patchManifest.patches){Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('patches\'+$name)) -Destination (Join-Path $OutputDirectory 'patches') -Force}
foreach($name in @('LICENSE','NOTICE','NODE-LICENSE.txt')){if(Test-Path -LiteralPath (Join-Path $PSScriptRoot $name)){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory -Force}}
$manifest=@{builtAt=[DateTime]::UtcNow.ToString('o');upstreamCommit='0c7362d121d1c7f69540262425fd4e2209fd8e8d';files=@()}
foreach($file in Get-ChildItem -LiteralPath $payload -File -Recurse){$manifest.files+=@{path=$file.FullName.Substring($OutputDirectory.Length+1);sha256=(Get-FileHash -LiteralPath $file.FullName).Hash}}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'manifest.json'),($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Write-Output ('Release staged: '+$OutputDirectory)
