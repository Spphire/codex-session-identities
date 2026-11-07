param([string]$FixtureDirectory=(Join-Path ([IO.Path]::GetTempPath()) ('identity-installer-config-'+[Guid]::NewGuid().ToString('N'))))
$ErrorActionPreference='Stop';New-Item -ItemType Directory -Force $FixtureDirectory|Out-Null
try{
  . (Join-Path $PSScriptRoot '..\installer-config.ps1')
  $existing=[pscustomobject]@{panelPort=18191;networkProxyUrl='http://127.0.0.1:19091';managePermissions=$false;integrationTests=$true;identityForceRevision=1;codexHome='C:\\Users\\Apricity\\.codex'}
  $config=New-IdentityRuntimeConfiguration $existing 'C:\\Users\\Apricity\\bin\\codex.exe' 'C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\ChatGPT.exe' $FixtureDirectory $existing.codexHome
  if($config.panelPort -ne 18191 -or $config.networkProxyUrl -ne $existing.networkProxyUrl -or $config.managePermissions -or !$config.integrationTests){throw 'Existing settings were not preserved'}
  if($config.codexHome.Contains('\\\\') -or $config.desktopExe.Contains('\\\\')){throw 'Duplicate separators were not normalized'}
  $fresh=New-IdentityRuntimeConfiguration $null 'C:\\Users\\Apricity\\bin\\codex.exe' 'C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\ChatGPT.exe' $FixtureDirectory 'C:\\Users\\Apricity\\.codex'
  if($fresh.panelPort -ne 18189 -or $fresh.networkProxyUrl){throw 'Fresh defaults were not applied'}
  @{passed=$true;preservedPanelPort=$true;preservedProxy=$true;normalizedPaths=$true;freshDefaults=$true}|ConvertTo-Json -Compress
}finally{if(Test-Path -LiteralPath $FixtureDirectory){Remove-Item -LiteralPath $FixtureDirectory -Recurse -Force}}
