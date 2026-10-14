param(
    [Parameter(Mandatory=$true)][string]$VaultFile,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$ExpectedIdentity,
    [switch]$SynchronizeVault
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
    # A parent PowerShell 7 process can leave Windows PowerShell with a different module search path.
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    Add-Type -AssemblyName System.Security
    $directory=Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl=Get-Acl -LiteralPath $directory
    $unexpected=@($acl.Access|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value,'S-1-5-18')})
    if(!$acl.AreAccessRulesProtected -or $unexpected.Count){
        $acl.SetAccessRuleProtection($true,$false)
        foreach($existing in @($acl.Access)){$acl.RemoveAccessRuleSpecific($existing)}
        foreach($principal in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
            $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $directory -AclObject $acl
    }
    $receipt=Join-Path $directory 'vault-import.json'
    if(Test-Path -LiteralPath $Destination){
        $bytes=[IO.File]::ReadAllBytes($Destination)
    }else{
        if($SynchronizeVault){throw 'Missing profile'}
        $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($VaultFile),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    }
    $payload=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if($payload.auth_mode -ne 'chatgpt' -or !$payload.tokens.access_token -or !$payload.tokens.refresh_token){throw 'Invalid official credentials'}
    $encoded=$payload.tokens.id_token.Split('.')[1].Replace('-','+').Replace('_','/')
    while($encoded.Length % 4){$encoded+='='}
    $claims=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    $authClaims=$claims.'https://api.openai.com/auth'
    $account=$payload.tokens.account_id
    if(!$account){$account=$authClaims.chatgpt_account_id}
    $subject=if($claims.sub){[string]$claims.sub}else{''}
    $stable=ConvertTo-Json -InputObject @([string]$account,$subject) -Compress
    $hash=[Security.Cryptography.SHA256]::Create()
    $identity=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($stable)))).Replace('-','').ToLowerInvariant()
    if($identity -ne $ExpectedIdentity){throw 'Account identity mismatch'}
    $user=$authClaims.chatgpt_user_id
    if(!$user){$user=$authClaims.user_id}
    if(!$account -or !$user){throw 'Missing account identity claims'}
    if($SynchronizeVault){
        $proof=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        if((Get-FileHash -LiteralPath $VaultFile).Hash -ne $proof.sourceSha256){throw 'Original vault changed since import'}
        $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $temporary=$VaultFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
        [IO.File]::WriteAllBytes($temporary,$protected)
        $replacementBackup=$VaultFile+'.'+[Guid]::NewGuid().ToString('N')+'.previous'
        [IO.File]::Replace($temporary,$VaultFile,$replacementBackup)
        Remove-Item -LiteralPath $replacementBackup
        [IO.File]::WriteAllText($receipt,(@{sourceSha256=(Get-FileHash -LiteralPath $VaultFile).Hash}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    }elseif(!(Test-Path -LiteralPath $Destination)){
        $stream=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
        [IO.File]::WriteAllText($receipt,(@{sourceSha256=(Get-FileHash -LiteralPath $VaultFile).Hash}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    }
    @{accountId=[string]$account;userId=[string]$user} | ConvertTo-Json -Compress
}catch{
    [Console]::Error.WriteLine(('Official credential transfer failed at step {0} ({1}); credential values are omitted.' -f $_.InvocationInfo.ScriptLineNumber,$_.Exception.GetType().Name))
    exit 1
}
