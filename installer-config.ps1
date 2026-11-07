function Normalize-IdentityPath([string]$Value){
    if(!$Value){return $Value}
    $one=[string][char]92;$two=$one+$one
    $normalized=$Value
    while($normalized.Contains($two)){$normalized=$normalized.Replace($two,$one)}
    if(![IO.Path]::IsPathRooted($normalized)){return $normalized}
    try{return [IO.Path]::GetFullPath($normalized)}catch{return $normalized}
}

function New-IdentityRuntimeConfiguration([object]$Existing,[string]$CodexExe,[string]$DesktopExe,[string]$InstallDirectory,[string]$CodexHome){
    $old=$Existing
    $port=if($old -and [int]$old.panelPort -ge 1024 -and [int]$old.panelPort -le 65535){[int]$old.panelPort}else{18189}
    $proxy=if($old -and $old.networkProxyUrl -and $old.networkProxyUrl -match '^https?://127\.0\.0\.1:\d{1,5}$'){[string]$old.networkProxyUrl}else{$null}
    $config=[ordered]@{
        originalCodexExe=(Normalize-IdentityPath $CodexExe)
        appServerExe=(Normalize-IdentityPath (Join-Path $InstallDirectory 'codex-app-server.exe'))
        desktopExe=(Normalize-IdentityPath $DesktopExe)
        codexHome=(Normalize-IdentityPath $CodexHome)
        panelPort=$port
        integrationTests=if($null -ne $old.integrationTests){[bool]$old.integrationTests}else{$false}
        managePermissions=if($null -ne $old.managePermissions){[bool]$old.managePermissions}else{$true}
        upstreamCommit='0c7362d121d1c7f69540262425fd4e2209fd8e8d'
    }
    if($proxy){$config.networkProxyUrl=$proxy}
    $config.backendRuntimeManifest=Normalize-IdentityPath (Join-Path $InstallDirectory 'backend-runtime\manifest.json')
    $config.identityForceRevision=if([int]$old.identityForceRevision -eq 1){1}else{1}
    return [pscustomobject]$config
}
