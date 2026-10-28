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
    return [Diagnostics.Process]::Start($info)
}
