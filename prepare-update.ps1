param([Parameter(Mandatory=$true)][string]$Repository,[Parameter(Mandatory=$true)][string]$UpstreamRef,[Parameter(Mandatory=$true)][string]$Checkout,[switch]$Build)
$ErrorActionPreference='Stop'
$Checkout=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Checkout)
if(Test-Path -LiteralPath $Checkout){throw 'Use a new empty checkout path.'}
$repositoryPath=(Resolve-Path -LiteralPath $Repository).Path
& git -C $repositoryPath fetch --depth=1 -- origin $UpstreamRef
if($LASTEXITCODE -ne 0){throw 'Upstream fetch failed'}
& git -C $repositoryPath -c core.longpaths=true worktree add --detach --no-checkout $Checkout FETCH_HEAD
if($LASTEXITCODE -ne 0){throw 'Candidate checkout creation failed'}
& git -C $Checkout sparse-checkout set codex-rs docs
& git -C $Checkout -c core.longpaths=true checkout --detach HEAD
if($LASTEXITCODE -ne 0){throw 'Candidate checkout failed'}
$manifest=Get-Content (Join-Path $PSScriptRoot 'patches\manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$patchPaths=@($manifest.patches|ForEach-Object {Join-Path $PSScriptRoot ('patches\'+$_)})
& git -C $Checkout apply --check @patchPaths
if($LASTEXITCODE -ne 0){throw 'Upstream changed the integration points. Review this candidate; the installed runtime is unchanged.'}
& git -C $Checkout apply @patchPaths
if($LASTEXITCODE -ne 0){throw 'Candidate patch failed'}
if($Build){
    $env:CARGO_PROFILE_DEV_DEBUG='0';$env:CARGO_PROFILE_TEST_DEBUG='0';$env:CARGO_INCREMENTAL='0';$env:RUST_MIN_STACK='33554432'
    Push-Location (Join-Path $Checkout 'codex-rs')
    try{
        & cargo build -p codex-app-server --bin codex-app-server
        if($LASTEXITCODE -ne 0){throw 'Candidate build failed'}
        & cargo test -p codex-core --lib 'thread_manager::tests::' --no-default-features -- --test-threads=4
        if($LASTEXITCODE -ne 0){throw 'Candidate thread tests failed'}
        & cargo test -p codex-core --lib bound_official_identity --no-default-features
        if($LASTEXITCODE -ne 0){throw 'Candidate authentication test failed'}
    }finally{Pop-Location}
    foreach($mode in @('legacy','paginated')){
        & node (Join-Path $PSScriptRoot 'test\runtime-smoke.mjs') (Join-Path $Checkout 'codex-rs\target\debug\codex-app-server.exe') $mode
        if($LASTEXITCODE -ne 0){throw 'Candidate native routing smoke failed'}
    }
}
Write-Output ('Candidate prepared: '+$Checkout)
Write-Output 'Validate the actual Desktop version before replacing the installed runtime or updating the supported-version manifest.'
