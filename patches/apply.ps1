param(
    [Parameter(Mandatory=$true)][string]$Repository,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$repositoryPath = (Resolve-Path -LiteralPath $Repository).Path
$revision = & git -C $repositoryPath rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Target is not a Git checkout.' }
if ($revision.Trim() -ne $manifest.baseCommit) {
    throw 'Upstream revision changed. Review and regenerate the patch before applying it.'
}
# Preflight the whole series in one call; do not leave a partly applied series.
$patchPaths = @($manifest.patches | ForEach-Object { Join-Path $PSScriptRoot $_ })
foreach ($patchPath in $patchPaths) {
    if (-not (Test-Path -LiteralPath $patchPath -PathType Leaf)) { throw "Missing patch: $patchPath" }
}
& git -C $repositoryPath apply --reverse --check @patchPaths 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Output 'Patch series is already present.'
    exit 0
}
& git -C $repositoryPath apply --check @patchPaths
if ($LASTEXITCODE -ne 0) { throw 'Patch preflight failed. No changes applied.' }
if ($CheckOnly) {
    Write-Output 'Patch series passes preflight; no files changed.'
    exit 0
}
& git -C $repositoryPath apply @patchPaths
if ($LASTEXITCODE -ne 0) { throw 'Patch application failed.' }
Write-Output 'Identity patch applied. Build and test before using the executable.'
