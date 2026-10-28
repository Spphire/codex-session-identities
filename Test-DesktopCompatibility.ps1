param([string]$Installation=$PSScriptRoot,[Parameter(Mandatory=$true)][string]$Fingerprint,[switch]$Force)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$configuration=Get-Content -LiteralPath (Join-Path $Installation 'runtime-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$statusPath=Join-Path $Installation 'desktop-compatibility-status.json'
if(!$Force -and (Test-Path -LiteralPath $statusPath)){
    try{$cached=Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8|ConvertFrom-Json}catch{$cached=$null}
    if($cached.passed -and $cached.fingerprint -eq $Fingerprint){$cached|ConvertTo-Json -Compress;exit 0}
}
. (Join-Path $Installation 'launch-process.ps1')
$diagnostics=Join-Path $Installation 'diagnostics'
$fixture=Join-Path $diagnostics ('desktop-'+[guid]::NewGuid().ToString('N'))
$profile=Join-Path $fixture 'profile';$probeHome=Join-Path $fixture 'codex'
New-Item -ItemType Directory -Path $profile,$probeHome -Force|Out-Null
$known=@{};$process=$null;$report=$null
$names=@('CODEX_HOME','CODEX_SQLITE_HOME','CODEX_CLI_PATH','CODEX_ELECTRON_USER_DATA_PATH','RUST_MIN_STACK')
$saved=@{};foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name)}
try{
    $env:CODEX_HOME=$probeHome;$env:CODEX_CLI_PATH=Join-Path $Installation 'codex-identity.exe';$env:CODEX_ELECTRON_USER_DATA_PATH=$profile;$env:RUST_MIN_STACK='33554432'
    $env:CODEX_SQLITE_HOME=$probeHome
    $process=Start-IdentityDesktop -DesktopExe $configuration.desktopExe -Installation $Installation -Arguments ('--no-startup-window --user-data-dir="'+$profile+'"') -Probe
    $outputTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
    $snapshot=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.Id)
    if(!$snapshot){throw 'Probe Desktop exited before initialization'}
    $known[$process.Id]=$snapshot.CreationDate
    $deadline=[DateTime]::UtcNow.AddSeconds(35);$verified=$false
    do{
        $all=@(Get-CimInstance Win32_Process)
        do{$added=$false;foreach($item in $all){if($known.ContainsKey([int]$item.ParentProcessId) -and !$known.ContainsKey([int]$item.ProcessId)){$known[[int]$item.ProcessId]=$item.CreationDate;$added=$true}}}while($added)
        $status=& (Join-Path $Installation 'node.exe') (Join-Path $Installation 'runtime-status.mjs') $probeHome|ConvertFrom-Json
        if($status.connected){
            $backend=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$status.pid)
            if($backend.ExecutablePath -eq $configuration.appServerExe){$verified=$true;break}
        }
        Start-Sleep -Milliseconds 500
    }while([DateTime]::UtcNow -lt $deadline)
    if(!$verified){throw 'New Desktop did not initialize the identity backend in the isolated profile. The current Desktop was not stopped.'}
    $report=@{passed=$true;fingerprint=$Fingerprint;testedAt=[DateTime]::UtcNow.ToString('o');desktopExe=$configuration.desktopExe;backendExe=$backend.ExecutablePath;scope='real-desktop-isolated-profile';productionRestarted=$false}
}catch{
    $report=@{passed=$false;fingerprint=$Fingerprint;testedAt=[DateTime]::UtcNow.ToString('o');message=$_.Exception.Message;diagnostics=$fixture}
}finally{
    foreach($entry in @($known.GetEnumerator())){
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$entry.Key)
        if($current -and $current.CreationDate -eq $entry.Value){Stop-Process -Id $entry.Key -ErrorAction SilentlyContinue}
    }
    foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$saved[$name])}
    if($process){
        if($outputTask.Wait(3000)){[IO.File]::WriteAllText((Join-Path $fixture 'stdout.log'),$outputTask.Result)}
        if($errorTask.Wait(3000)){[IO.File]::WriteAllText((Join-Path $fixture 'stderr.log'),$errorTask.Result)}
        $process.Dispose()
    }
}
$temporary=$statusPath+'.'+$PID+'.tmp'
[IO.File]::WriteAllText($temporary,($report|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $statusPath -Force
$report|ConvertTo-Json -Compress
if(!$report.passed){exit 1}
