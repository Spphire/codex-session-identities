function Resolve-CodexInstallation([object]$Configuration, [string]$Installation) {
    $changed=$false
    $oldDesktop=$Configuration.desktopExe
    $oldCli=$Configuration.originalCodexExe
    # Resolve both executables from the registered package, even if old files remain.
    $package=$null
    # Respect explicit portable/custom Desktop paths used by separate installations.
    if(!$oldDesktop -or !(Test-Path -LiteralPath $oldDesktop) -or $oldDesktop -match '[\\/]WindowsApps[\\/]OpenAI\.Codex_'){
        $package=Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |
            Sort-Object {[version]$_.Version} -Descending | Select-Object -First 1
    }
    if($package){
        $desktop=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
        $packageCli=Join-Path $package.InstallLocation 'app\resources\codex.exe'
        foreach($required in @($desktop,$packageCli)){
            if(!(Test-Path -LiteralPath $required -PathType Leaf)){throw ('Registered Codex package is incomplete: '+$required+'. Finish or repair the Store update and retry.')}
        }
        foreach($name in @('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){
            $companion=Join-Path (Split-Path -Parent $packageCli) $name
            if(!(Test-Path -LiteralPath $companion -PathType Leaf)){throw ('Registered Codex package companion is missing: '+$companion)}
        }
        if($Configuration.desktopExe -ne $desktop){
            $Configuration.desktopExe=$desktop
            $changed=$true
        }
        if($Configuration.originalCodexExe -ne $packageCli){
            $Configuration | Add-Member -NotePropertyName originalCodexExe -NotePropertyValue $packageCli -Force
            $changed=$true
        }
    }
    if(!$Configuration.originalCodexExe -or !(Test-Path -LiteralPath $Configuration.originalCodexExe)){
        $binRoot=Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        $cli=Get-ChildItem -LiteralPath $binRoot -Filter codex.exe -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if($cli){$Configuration | Add-Member -NotePropertyName originalCodexExe -NotePropertyValue $cli.FullName -Force;$changed=$true}
    }
    if($changed){
        $configPath=Join-Path $Installation 'runtime-config.json'
        $previous=[ordered]@{desktopExe=$oldDesktop;originalCodexExe=$oldCli}
        $record=[ordered]@{time=[DateTime]::UtcNow.ToString('o');event='installation_paths_refreshed';previous=$previous;desktopExe=$Configuration.desktopExe;originalCodexExe=$Configuration.originalCodexExe}
        $temporary=Join-Path $Installation ('runtime-config-'+[guid]::NewGuid().ToString('N')+'.tmp')
        try{
            if(Test-Path -LiteralPath $configPath){
                $backupRoot=Join-Path $Installation 'backups'
                New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
                Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupRoot ('runtime-config-discovery-'+[guid]::NewGuid().ToString('N')+'.json'))
            }
            [IO.File]::WriteAllText($temporary,($Configuration|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath $temporary -Destination $configPath -Force
        }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
        try{Add-Content -LiteralPath (Join-Path $Installation 'installation-discovery.jsonl') -Value ($record|ConvertTo-Json -Depth 5 -Compress) -Encoding UTF8}catch{Write-Warning 'Installation paths were updated, but the discovery log could not be written.'}
    }
    return $Configuration
}
