$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$root=Join-Path ([IO.Path]::GetTempPath()) ('codex-vault-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root|Out-Null
try {
    $claims=@{sub='synthetic-sub';'https://api.openai.com/auth'=@{chatgpt_user_id='synthetic-user';chatgpt_account_id='synthetic-account'}}|ConvertTo-Json -Compress
    $payload64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($claims)).TrimEnd('=').Replace('+','-').Replace('/','_')
    $payload=@{auth_mode='chatgpt';tokens=@{account_id='synthetic-account';id_token=('e30.'+$payload64+'.test');access_token='synthetic-access';refresh_token='synthetic-refresh'}}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 5 -Compress))
    $vault=Join-Path $root 'account.dpapi'
    [IO.File]::WriteAllBytes($vault,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    $stable='["synthetic-account","synthetic-sub"]'
    $sha=[Security.Cryptography.SHA256]::Create()
    $identity=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($stable)))).Replace('-','').ToLowerInvariant()
    $destination=Join-Path $root 'profile\auth.json'
    $helper=Join-Path (Split-Path -Parent $PSScriptRoot) 'official-vault.ps1'
    $result=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -VaultFile $vault -Destination $destination -ExpectedIdentity $identity
    if($LASTEXITCODE -ne 0){throw 'Synthetic import failed'}
    if(($result|ConvertFrom-Json).userId -ne 'synthetic-user'){throw 'Identity mismatch'}
    $payload.tokens.refresh_token='synthetic-rotated'
    [IO.File]::WriteAllText($destination,($payload|ConvertTo-Json -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -VaultFile $vault -Destination $destination -ExpectedIdentity $identity -SynchronizeVault | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Synthetic synchronization failed'}
    $restored=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($vault),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))|ConvertFrom-Json
    if($restored.tokens.refresh_token -ne 'synthetic-rotated'){throw 'Rotation was not synchronized'}
    [IO.File]::WriteAllBytes($vault,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    $before=(Get-FileHash -LiteralPath $vault).Hash
    # Windows PowerShell turns native stderr into an error even for this expected refusal.
    $savedErrorPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -VaultFile $vault -Destination $destination -ExpectedIdentity $identity -SynchronizeVault 2>$null | Out-Null
        $refusalExitCode=$LASTEXITCODE
    } finally { $ErrorActionPreference=$savedErrorPreference }
    if($refusalExitCode -eq 0 -or (Get-FileHash -LiteralPath $vault).Hash -ne $before){throw 'Concurrent vault change was overwritten'}
    'Synthetic DPAPI import, refresh synchronization, and concurrent-change refusal passed.'
}finally{
    $resolved=(Resolve-Path -LiteralPath $root).Path
    $temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(!$resolved.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected test cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
