param([Parameter(Mandatory=$true)][string]$Installation)
$ErrorActionPreference='Stop'
$Installation=(Resolve-Path -LiteralPath $Installation).Path
if(!(Test-Path -LiteralPath (Join-Path $Installation 'runtime-config.json'))){throw 'Select the existing identity installation directory'}
$version=Get-Content (Join-Path $Installation 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($version.version -notin @('0.1.10','0.1.11')){throw 'This small update requires an existing 0.1.10 or 0.1.11 installation'}
$active=@(Get-CimInstance Win32_Process|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf((Join-Path $Installation 'Launch-Codex.ps1'),[StringComparison]::OrdinalIgnoreCase) -ge 0})
if($active.Count){throw 'A launch attempt is still running. Wait for it to finish before updating launcher files'}
$manifest=Get-Content (Join-Path $PSScriptRoot 'launcher-fix-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
foreach($entry in $manifest.files){
    if($entry.name -notmatch '^[A-Za-z0-9_.-]+$'){throw 'Invalid update file name'}
    if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot ('payload\'+$entry.name))).Hash -ne $entry.sha256){throw ('Update file hash mismatch: '+$entry.name)}
}
$backup=Join-Path $Installation ('backups\launcher-fix-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Path $backup -Force|Out-Null
$existed=@{}
foreach($entry in $manifest.files){$path=Join-Path $Installation $entry.name;$existed[$entry.name]=Test-Path -LiteralPath $path;if($existed[$entry.name]){Copy-Item -LiteralPath $path -Destination (Join-Path $backup $entry.name)}}
try{
    foreach($entry in $manifest.files){
        $target=Join-Path $Installation $entry.name;$temporary=$target+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        try{Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('payload\'+$entry.name)) -Destination $temporary;Move-Item -LiteralPath $temporary -Destination $target -Force}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
    }
    @{passed=$true;version='0.1.11';backup=$backup;activation='next-normal-launch';desktopRestarted=$false;runtimeConfigChanged=$false}|ConvertTo-Json -Compress
}catch{
    foreach($entry in $manifest.files){$target=Join-Path $Installation $entry.name;if($existed[$entry.name]){Copy-Item -LiteralPath (Join-Path $backup $entry.name) -Destination $target -Force}else{if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force}}}
    throw
}
