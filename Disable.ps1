$ErrorActionPreference='Stop'
$configuration=Get-Content (Join-Path $PSScriptRoot 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
if(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $configuration.appServerExe}){throw 'Close Codex before disabling the identity backend.'}
& (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'export-compat.mjs')
if($LASTEXITCODE -ne 0){throw 'Compatibility preparation failed; no history was removed.'}
Remove-Item Env:CODEX_CLI_PATH -ErrorAction SilentlyContinue
Start-Process -FilePath $configuration.desktopExe -WindowStyle Normal
Write-Output 'Original Codex started. Official chats now follow the original global login. Session history and identity records were retained.'
