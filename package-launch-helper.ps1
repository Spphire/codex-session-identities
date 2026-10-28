param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
$response=Join-Path (Split-Path -Parent $RequestPath) 'result.json'
try{
    $request=Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($name in @('CODEX_HOME','CODEX_SQLITE_HOME','CODEX_CLI_PATH','CODEX_ELECTRON_USER_DATA_PATH','IDENTITY_PANEL_PORT','RUST_MIN_STACK')){
        [Environment]::SetEnvironmentVariable($name,$request.environment.$name)
    }
    if($request.probe){foreach($key in @([Environment]::GetEnvironmentVariables().Keys)){if($key -match 'TOKEN|API_KEY|PASSWORD|SECRET'){[Environment]::SetEnvironmentVariable($key,$null)}}}
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$request.desktopExe;$info.Arguments=$request.arguments;$info.WorkingDirectory=$request.installation;$info.UseShellExecute=$false
    if($request.probe){$info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden}
    $process=[Diagnostics.Process]::Start($info)
    $result=@{started=$true;processId=$process.Id;method='registered-package-context'}
}catch{
    $current=$_.Exception;$native=$null
    while($current){if($current -is [ComponentModel.Win32Exception]){$native=$current.NativeErrorCode};$current=$current.InnerException}
    $result=@{started=$false;message=$_.Exception.Message;nativeErrorCode=$native}
}
$temporary=$response+'.tmp'
[IO.File]::WriteAllText($temporary,($result|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $response -Force
