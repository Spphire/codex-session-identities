param([string]$RustCompiler='rustc',[string]$CSharpCompiler=(Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'))
$ErrorActionPreference='Stop'
$targets=@{
    'launcher.rs'='codex-identity.exe'
    'credential.rs'='codex-identity-credential.exe'
    'panel-launcher.rs'='identity-panel.exe'
    'desktop-launcher.rs'='codex-session-desktop.exe'
}
foreach($target in $targets.GetEnumerator()){
    & $RustCompiler --edition=2024 -C opt-level=2 (Join-Path $PSScriptRoot ('native\'+$target.Key)) -o (Join-Path $PSScriptRoot $target.Value)
    if($LASTEXITCODE -ne 0){throw ('Native build failed: '+$target.Key)}
}
if(!(Test-Path -LiteralPath $CSharpCompiler)){throw 'Windows .NET Framework C# compiler is missing'}
& $CSharpCompiler /nologo /target:winexe ('/out:'+(Join-Path $PSScriptRoot 'identity-tray.exe')) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native\tray.cs')
if($LASTEXITCODE -ne 0){throw 'Tray build failed'}
Write-Output 'Native sidecar executables built.'
