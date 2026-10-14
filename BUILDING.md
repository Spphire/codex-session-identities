# Building On Windows

Prerequisites: Git, Node.js 24+, Rust 1.95.0 MSVC toolchain, Visual Studio C++ build tools, Windows .NET Framework C# compiler, and an installed Windows Codex Desktop. Builds may require substantial disk space and time.

## Patched Backend

Run from the repository root in a PowerShell shell configured for the MSVC compiler:

```powershell
git clone https://github.com/openai/codex.git upstream
git -C upstream checkout 0c7362d121d1c7f69540262425fd4e2209fd8e8d
.\patches\apply.ps1 -Repository .\upstream -CheckOnly
.\patches\apply.ps1 -Repository .\upstream
Push-Location upstream/codex-rs
try {
    cargo +1.95.0 build --release -p codex-app-server --no-default-features
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
} finally { Pop-Location }
```

The patch preflight requires the exact baseline commit. It refuses a different revision and detects an already-applied series. Use an independent checkout when porting; never change the baseline manifest without testing the new version.

## Sidecar Executables

```powershell
.\build-native.ps1
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File test/vault-test.ps1
node test/runtime-smoke.mjs upstream/codex-rs/target/release/codex-app-server.exe legacy
node test/runtime-smoke.mjs upstream/codex-rs/target/release/codex-app-server.exe paginated
```

`build-native.ps1` uses `rustc` from PATH; select Rust 1.95.0 before running it. Native launcher integration tests under `test/` use isolated fixture processes rather than restarting the production Desktop. Read their parameters before running them.

Optional panel UI QA: install Playwright locally (not a runtime dependency), ensure Microsoft Edge is present, then run `node test/panel-ui-smoke.mjs <screenshot-directory>`. It uses only synthetic identities and checks duplicate grouping, guarded removal and desktop/mobile layouts. `PLAYWRIGHT_MODULE` can instead point to an existing Playwright entrypoint.

## Package

```powershell
.\build-release.ps1 -PatchedAppServer .\upstream\codex-rs\target\release\codex-app-server.exe -OutputDirectory .\dist\windows
Compress-Archive -Path .\dist\windows\* -DestinationPath .\dist\CodexSessionIdentity-Windows.zip
```

The packager includes Node.js, launcher binaries, scripts, the web UI, patches and licenses. It records payload SHA-256 hashes. At installation and launch, the original installed CLI supplies the compatible code-mode host, command runner and Windows sandbox setup executables.

For updates, `prepare-update.ps1` prepares a candidate checkout and tests; it does not prove Desktop compatibility. Verify both official-account switching and official/API switching, model catalog, Fast, tool execution, restart and panel authentication before deployment.
