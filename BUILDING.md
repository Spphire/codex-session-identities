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

Real routing QA is separate and billable: `node test/real-identity-routing-smoke.mjs <installation> <API-profile-id> <private-report>`. It requires a system official profile, an independent official profile, and a registered API profile. The independent account may match the system account or be distinct; the report distinguishes these cases. It creates isolated chats and short-lived credential copies without refresh tokens; a transparent loopback relay forwards requests to the original HTTPS endpoints and records only credential/account-match booleans and HTTP status. It selects an available Luna model, low reasoning and standard tier. With Node.js 24.19+, the relay honors configured HTTP proxies, and the backend bypasses those proxies for the temporary loopback relay only. Keep reports private and run only with the account owner's consent.

Optional fourth/fifth arguments select an exact backend executable and model, e.g. `<backend.exe> gpt-5.6-luna`. This bypasses the bridge to verify the identity implementation in a particular compiled backend, and records its SHA-256. Without those arguments the test uses the configured installed bridge/backend.

## Package

Read-only real official-usage QA: `node test/real-official-usage-smoke.mjs <installation>`. This performs no model inference, verifies that registered official accounts each return quota data, and checks that original auth-file hashes are unchanged. Its output contains real quota/credit values; keep it private. The optional browser QA also checks quota bars and Credits labels with synthetic values.

```powershell
.\build-release.ps1 -PatchedAppServer .\upstream\codex-rs\target\release\codex-app-server.exe -OutputDirectory .\dist\windows
Compress-Archive -Path .\dist\windows\* -DestinationPath .\dist\CodexSessionIdentity-Windows.zip
```

The packager includes Node.js, launcher binaries, scripts, the web UI, patches and licenses. It records payload SHA-256 hashes. At installation and launch, the original installed CLI supplies the compatible code-mode host, command runner and Windows sandbox setup executables.

For updates, `prepare-update.ps1` prepares a candidate checkout and tests; it does not prove Desktop compatibility. Verify both official-account switching and official/API switching, model catalog, Fast, tool execution, restart and panel authentication before deployment.

Follow the full [version-alignment checklist](VERSION-COMPATIBILITY.md#update-checklist), including native paginated forks, remote registration and a real phone reconnection. Never treat reporting the installed version as proof that an older source checkout implements newer features.

Performance checks and reproduction commands are in [PERFORMANCE.md](PERFORMANCE.md). Record build optimization flags alongside timing results. v0.1.2 was a dev build; v0.1.3 uses release with opt-level 3, debug 0, LTO false and 16 codegen units. The command above uses the upstream default release profile; set `CARGO_PROFILE_RELEASE_DEBUG=0`, `CARGO_PROFILE_RELEASE_LTO=false` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` to reproduce the measured profile. `prepare-update.ps1 -Build` now builds its runtime candidate in release mode. Comparing the old dev binary to the optimized original CLI does not isolate patch-only cost.

Patch preflight simulates overlapping patches sequentially in private Git indexes, then applies one combined change atomically. Both a clean full-series replay and already-applied detection were verified. The user's real index and unrelated changes are preserved. A partially applied series still requires review; start with a fresh pinned checkout when upgrading source patches.

For a real routing model override without a backend override, set `IDENTITY_TEST_MODEL` (e.g. `gpt-5.6-luna`). Explicit command-line model arguments take precedence. An upstream capacity failure is a failed request, not a successful identity test.
