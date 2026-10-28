function Resolve-IdentityRuntime([object]$Configuration,[string]$Installation){
    $bundleRoot=[IO.Path]::GetFullPath((Join-Path $Installation 'runtime-bundles'))
    $alreadyBundled=[IO.Path]::GetFullPath($Configuration.appServerExe).StartsWith($bundleRoot+'\',[StringComparison]::OrdinalIgnoreCase)
    $source=if($alreadyBundled -and $Configuration.backendSourceExe){$Configuration.backendSourceExe}else{$Configuration.appServerExe}
    $sources=[ordered]@{'codex-app-server.exe'=$source}
    if(!$Configuration.backendRuntimeManifest -or !(Test-Path -LiteralPath $Configuration.backendRuntimeManifest -PathType Leaf)){throw 'A paired backend runtime manifest is required. Repair the identity runtime before launching; the current Desktop was not stopped.'}
    $paired=Get-Content -LiteralPath $Configuration.backendRuntimeManifest -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($name in @('codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe')){$sources[$name]=Join-Path (Split-Path -Parent $Configuration.backendRuntimeManifest) $name}
    $hashes=[ordered]@{}
    foreach($name in $sources.Keys){
        if(!(Test-Path -LiteralPath $sources[$name] -PathType Leaf)){throw ('Runtime input is unavailable: '+$sources[$name])}
        $hashes[$name]=(Get-FileHash -LiteralPath $sources[$name]).Hash
        if($paired.$name -notmatch '^[a-fA-F0-9]{64}$' -or $hashes[$name] -ne $paired.$name){throw ('Paired backend runtime hash mismatch: '+$name+'. The current Desktop was not stopped.')}
    }
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$key=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($hashes|ConvertTo-Json -Compress)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $bundle=Join-Path $bundleRoot $key
    if(Test-Path -LiteralPath $bundle){
        foreach($name in $hashes.Keys){
            $target=Join-Path $bundle $name
            if(!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target).Hash -ne $hashes[$name]){throw ('Runtime bundle changed: '+$target+'. The current Desktop has not been stopped.')}
        }
    }else{
        $staging=Join-Path $bundleRoot ('staging-'+[guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $staging -Force|Out-Null
        foreach($name in $sources.Keys){
            $target=Join-Path $staging $name
            if($name -eq 'codex-app-server.exe'){
                # Copy into our immutable content store; never link to a replaceable deployment file.
                $storedBackend=Join-Path $bundleRoot ('backend-'+$hashes[$name]+'.exe')
                if(!(Test-Path -LiteralPath $storedBackend)){
                    $temporaryBackend=$storedBackend+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
                    Copy-Item -LiteralPath $source -Destination $temporaryBackend
                    if((Get-FileHash -LiteralPath $temporaryBackend).Hash -ne $hashes[$name]){throw 'Backend content store verification failed'}
                    Move-Item -LiteralPath $temporaryBackend -Destination $storedBackend
                }
                if((Get-FileHash -LiteralPath $storedBackend).Hash -ne $hashes[$name]){throw 'Stored backend hash changed'}
                try{New-Item -ItemType HardLink -Path $target -Target $storedBackend -ErrorAction Stop|Out-Null}catch{Copy-Item -LiteralPath $storedBackend -Destination $target}
            }else{Copy-Item -LiteralPath $sources[$name] -Destination $target}
            if((Get-FileHash -LiteralPath $target).Hash -ne $hashes[$name]){throw ('Runtime copy verification failed: '+$name)}
        }
        [IO.File]::WriteAllText((Join-Path $staging 'manifest.json'),($hashes|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        foreach($directory in @($staging,$bundle)){if(![IO.Path]::GetFullPath($directory).StartsWith($bundleRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime publish escaped installation directory'}}
        Move-Item -LiteralPath $staging -Destination $bundle
    }
    $backend=Join-Path $bundle 'codex-app-server.exe'
    if($Configuration.appServerExe -ne $backend -or !$Configuration.backendSourceExe){
        $configPath=Join-Path $Installation 'runtime-config.json'
        $backup=Join-Path $Installation 'backups'
        New-Item -ItemType Directory -Path $backup -Force|Out-Null
        Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup ('runtime-config-before-bundle-'+[guid]::NewGuid().ToString('N')+'.json'))
        $Configuration|Add-Member -NotePropertyName backendSourceExe -NotePropertyValue $source -Force
        $Configuration.appServerExe=$backend
        $temporary=$configPath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        [IO.File]::WriteAllText($temporary,($Configuration|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $configPath -Force
    }
    return $Configuration
}
