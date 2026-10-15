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
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'patches\apply.ps1') -Repository $Checkout
if($LASTEXITCODE -ne 0){throw 'Patch preflight failed. Review the pinned upstream revision and integration points; the installed runtime is unchanged.'}
if($Build){
    $env:CARGO_PROFILE_DEV_DEBUG='0';$env:CARGO_PROFILE_TEST_DEBUG='0';$env:CARGO_INCREMENTAL='0';$env:RUST_MIN_STACK='33554432'
    Push-Location (Join-Path $Checkout 'codex-rs')
    try{
        & cargo build --release -p codex-app-server --bin codex-app-server --no-default-features
        if($LASTEXITCODE -ne 0){throw 'Candidate build failed'}
        & cargo test -p codex-core --lib 'thread_manager::tests::' --no-default-features -- --test-threads=4
        if($LASTEXITCODE -ne 0){throw 'Candidate thread tests failed'}
        & cargo test -p codex-core --lib bound_official_identity --no-default-features
        if($LASTEXITCODE -ne 0){throw 'Candidate authentication test failed'}
    }finally{Pop-Location}
    foreach($mode in @('legacy','paginated')){
        & node (Join-Path $PSScriptRoot 'test\runtime-smoke.mjs') (Join-Path $Checkout 'codex-rs\target\release\codex-app-server.exe') $mode
        if($LASTEXITCODE -ne 0){throw 'Candidate native routing smoke failed'}
    }
    & node (Join-Path $PSScriptRoot 'test\appshot-smoke.mjs') (Join-Path $Checkout 'codex-rs\target\release\codex-app-server.exe')
    if($LASTEXITCODE -ne 0){throw 'Candidate Appshots transport smoke failed'}
    & node (Join-Path $PSScriptRoot 'test\execution-policy-smoke.mjs') (Join-Path $Checkout 'codex-rs\target\release\codex-app-server.exe')
    if($LASTEXITCODE -ne 0){throw 'Candidate execution permissions smoke failed'}
}
Write-Output ('Candidate prepared: '+$Checkout)
Write-Output 'Validate the actual Desktop version before replacing the installed runtime or updating the supported-version manifest.'
