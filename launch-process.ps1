function Get-IdentityLaunchError([System.Exception]$Exception) {
    $chain=@();$current=$Exception
    for($i=0;$current -and $i -lt 8;$i++){
        $entry=[ordered]@{type=$current.GetType().FullName;message=$current.Message;hresult=$current.HResult}
        if($current -is [ComponentModel.Win32Exception]){$entry.nativeErrorCode=$current.NativeErrorCode}
        $chain+=@($entry);$current=$current.InnerException
    }
    return $chain
}
function Start-IdentityPackageContext([string]$DesktopExe,[string]$Installation,[string]$Arguments,[switch]$Probe) {
    if(!(Get-Command Invoke-CommandInDesktopPackage -ErrorAction SilentlyContinue)){throw 'Package-context launch is unavailable on this Windows installation'}
    $package=Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Where-Object {
        [IO.Path]::GetFullPath((Join-Path $_.InstallLocation 'app\ChatGPT.exe')) -eq [IO.Path]::GetFullPath($DesktopExe)
    } | Select-Object -First 1
    if(!$package){throw 'Access denied and Desktop does not match the current user registered Codex package'}
    [xml]$manifest=Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
    $application=@($manifest.Package.Applications.Application) | Where-Object {
        $_.Executable -and [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $_.Executable)) -eq [IO.Path]::GetFullPath($DesktopExe)
    } | Select-Object -First 1
    if(!$application){throw 'Registered Codex package has no matching Desktop application'}
    $helper=Join-Path $Installation 'package-launch-helper.ps1'
    if(!(Test-Path -LiteralPath $helper -PathType Leaf)){throw 'Package launch helper is missing; install the complete launcher update'}
    $directory=Join-Path $Installation ('diagnostics\package-launch-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $directory -Force|Out-Null
    $request=Join-Path $directory 'request.json';$response=Join-Path $directory 'result.json'
    # Package activation does not inherit our environment. Transfer only launcher
    # configuration paths, never credentials or the caller's full environment.
    $environment=@{}
    foreach($name in @('CODEX_HOME','CODEX_SQLITE_HOME','CODEX_CLI_PATH','CODEX_ELECTRON_USER_DATA_PATH','IDENTITY_PANEL_PORT','RUST_MIN_STACK')){
        $environment[$name]=[Environment]::GetEnvironmentVariable($name)
    }
    $value=@{desktopExe=$DesktopExe;installation=$Installation;arguments=$Arguments;probe=[bool]$Probe;environment=$environment}
    [IO.File]::WriteAllText($request,($value|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    try{
        $shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $helperArgs='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$helper+'" -RequestPath "'+$request+'"'
        Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId $application.Id -Command $shell -Args $helperArgs -ErrorAction Stop|Out-Null
        $deadline=[DateTime]::UtcNow.AddSeconds(15)
        while(!(Test-Path -LiteralPath $response) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
        if(!(Test-Path -LiteralPath $response)){throw 'Package-context launcher did not return a result; identity backend is unverified'}
        $result=Get-Content -LiteralPath $response -Raw -Encoding UTF8|ConvertFrom-Json
        if(!$result.started){throw ('Package-context Desktop launch failed: '+$result.message)}
        $process=Get-Process -Id $result.processId -ErrorAction Stop
        $process|Add-Member -NotePropertyName IdentityLaunchMethod -NotePropertyValue 'registered-package-context'
        return $process
    }finally{
        if(Test-Path -LiteralPath $request){Remove-Item -LiteralPath $request -Force}
    }
}
function Start-IdentityDesktop([string]$DesktopExe,[string]$Installation,[string]$Arguments='',[switch]$Probe) {
    # Launch directly: ShellExecute/Chromium relaunch can discard our environment.
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$DesktopExe
    $info.WorkingDirectory=$Installation
    $info.UseShellExecute=$false
    $isolatedProfile=[Environment]::GetEnvironmentVariable('CODEX_ELECTRON_USER_DATA_PATH')
    if($isolatedProfile -and $Arguments -notmatch '(?:^|\s)--user-data-dir='){
        if($isolatedProfile.Contains('"')){throw 'Electron profile path cannot contain a quote'}
        $Arguments=('--user-data-dir="'+$isolatedProfile+'" '+$Arguments).Trim()
    }
    $info.Arguments=('--do-not-de-elevate '+$Arguments).Trim()
    $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
    if($Probe){
        $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
        $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        foreach($key in @($info.EnvironmentVariables.Keys)){if($key -match 'TOKEN|API_KEY|PASSWORD|SECRET'){[void]$info.EnvironmentVariables.Remove($key)}}
    }
    try{return [Diagnostics.Process]::Start($info)}catch{
        $chain=@(Get-IdentityLaunchError $_.Exception)
        if($DesktopExe -match '[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]ChatGPT\.exe$' -and @($chain|Where-Object {$_.nativeErrorCode -eq 5}).Count){
            return Start-IdentityPackageContext -DesktopExe $DesktopExe -Installation $Installation -Arguments $info.Arguments -Probe:$Probe
        }
        throw
    }
}
