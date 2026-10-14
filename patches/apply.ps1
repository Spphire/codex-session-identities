param(
    [Parameter(Mandatory=$true)][string]$Repository,
    [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$repositoryPath=(Resolve-Path -LiteralPath $Repository).Path
$revision=& git -C $repositoryPath rev-parse HEAD
if($LASTEXITCODE -ne 0){throw 'Target is not a Git checkout.'}
if($revision.Trim() -ne $manifest.baseCommit){throw 'Upstream revision changed. Review and regenerate the patch before applying it.'}
$patchPaths=@($manifest.patches | ForEach-Object {Join-Path $PSScriptRoot $_})
foreach($path in $patchPaths){if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing patch: $path"}}
$previousIndex=$env:GIT_INDEX_FILE
$previousEncoding=[Console]::OutputEncoding
$prefix=Join-Path ([IO.Path]::GetTempPath()) ('codex-patch-'+[Guid]::NewGuid().ToString('N'))
$initialIndex=$prefix+'-initial.index'
$candidateIndex=$prefix+'-candidate.index'
$flattenPath=$prefix+'.patch'
function Apply-ToIndex($paths,[switch]$Reverse){
    foreach($path in $paths){
        $savedPreference=$ErrorActionPreference
        try{
            $ErrorActionPreference='Continue'
            if($Reverse){$diagnostics=& git -C $repositoryPath apply --cached --reverse $path 2>&1}
            else{$diagnostics=& git -C $repositoryPath apply --cached $path 2>&1}
            if($LASTEXITCODE -ne 0){return $false}
        }finally{$ErrorActionPreference=$savedPreference}
    }
    return $true
}
try{
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    # Check overlapping patches in private indexes, never the user's index.
    $sourceIndex=& git -C $repositoryPath rev-parse --path-format=absolute --git-path index
    if($LASTEXITCODE -ne 0){throw 'Cannot locate the Git index.'}
    $env:GIT_INDEX_FILE=$initialIndex
    if(Test-Path -LiteralPath $sourceIndex){Copy-Item -LiteralPath $sourceIndex -Destination $initialIndex}
    else{& git -C $repositoryPath read-tree HEAD;if($LASTEXITCODE -ne 0){throw 'Cannot initialize the comparison index.'}}
    $numstat=& git -C $repositoryPath apply --numstat @patchPaths
    if($LASTEXITCODE -ne 0){throw 'Cannot read the patch paths.'}
    $paths=@($numstat | ForEach-Object {($_ -split "`t",3)[2]} | Sort-Object -Unique)
    $tracked=@(& git -C $repositoryPath ls-files -- @paths)
    if($LASTEXITCODE -ne 0){throw 'Cannot read tracked patch paths.'}
    $present=@($paths | Where-Object {(Test-Path -LiteralPath (Join-Path $repositoryPath $_)) -or ($tracked -contains $_)})
    if($present.Count){& git -C $repositoryPath add -A -- @present;if($LASTEXITCODE -ne 0){throw 'Cannot snapshot the patch paths.'}}
    $initialTree=& git -C $repositoryPath write-tree
    if($LASTEXITCODE -ne 0){throw 'Cannot snapshot the initial tree.'}
    Copy-Item -LiteralPath $initialIndex -Destination $candidateIndex
    $env:GIT_INDEX_FILE=$candidateIndex
    $reversePaths=@($patchPaths);[array]::Reverse($reversePaths)
    if(Apply-ToIndex $reversePaths -Reverse){Write-Output 'Patch series is already present.';exit 0}
    Copy-Item -LiteralPath $initialIndex -Destination $candidateIndex -Force
    if(!(Apply-ToIndex $patchPaths)){throw 'Patch preflight failed. No changes applied.'}
    if($CheckOnly){Write-Output 'Patch series passes preflight; no files changed.';exit 0}
    $finalTree=& git -C $repositoryPath write-tree
    if($LASTEXITCODE -ne 0){throw 'Cannot snapshot the patched tree.'}
    $combined=& git -C $repositoryPath diff --binary --no-color $initialTree $finalTree -- @paths
    if($LASTEXITCODE -ne 0){throw 'Cannot combine the patch series.'}
    [IO.File]::WriteAllText($flattenPath,(($combined -join "`n")+"`n"),[Text.UTF8Encoding]::new($false))
    $env:GIT_INDEX_FILE=$previousIndex
    # Apply the combined change atomically; also detect edits since preflight.
    & git -C $repositoryPath apply --check $flattenPath
    if($LASTEXITCODE -ne 0){throw 'Source changed after preflight. No changes applied.'}
    & git -C $repositoryPath apply $flattenPath
    if($LASTEXITCODE -ne 0){throw 'Patch application failed.'}
    Write-Output 'Identity patch applied. Build and test before using the executable.'
}finally{
    $env:GIT_INDEX_FILE=$previousIndex
    [Console]::OutputEncoding=$previousEncoding
    Remove-Item -LiteralPath $initialIndex,$candidateIndex,$flattenPath -Force -ErrorAction SilentlyContinue
}
