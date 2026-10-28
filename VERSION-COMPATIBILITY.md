# Version Alignment

## Policy

The identity adapter must report the actual installed original Codex CLI version consistently to Desktop and official services. It must not expose the patched source build's `0.0.0` as the installed product version, hard-code an invented newer version, or replace Desktop installation files. The adapter's own release number remains separate.

The validated combination is Windows Desktop `26.1007.2314.0`, installed CLI `0.162.0-alpha.17.2`, upstream commit `0c7362d121d1c7f69540262425fd4e2209fd8e8d`, and Rust `1.95.0`. Matching version fields is necessary on this baseline; it does not prove that the patched implementation supports a future Desktop protocol or feature.

That combination is the original validation baseline, not a version allowlist. Desktop `26.1021.3705.0` with CLI `0.164.0-alpha.11.1` also passed the 0.1.10 protocol, startup policy and real nested-execution preflight. The 0.1.11 package-context launch path additionally passed a real isolated Desktop handshake on that installation. A reported Desktop `26.1023.6123.0` / CLI `0.165.0-alpha.1.2` installation passed its backend protocol probe but hit access-denied during Desktop process creation; its complete launch remains unverified. Do not classify that process-creation failure as a protocol/version rejection.

Compatibility decisions use actual protocol/capability probes and backend handshakes. Version and file fingerprints invalidate cached results and trigger fresh checks; a version change alone is not a hard rejection. The Store fallback applies only to Windows access-denied and an exact matching package registered for the current user.

## Covered Paths

At app-server startup, `runtime-bridge.cjs` runs the configured original CLI's `--version`. Only a successful, validated `codex-cli <version>` result supplies `CODEX_IDENTITY_CLIENT_VERSION`. The version patches cover the paths below; the fourth performance patch retains these checks and the upstream model cache's identity/version/TTL validation:

| Path | Alignment mechanism | Reason |
| --- | --- | --- |
| Desktop `initialize` result | Native user-agent uses the installed version; bridge also replaces the source `0.0.0` prefix while retaining suffix/provenance | Desktop gates native paginated forks and other capabilities using this version |
| Official model requests | Validated version override supplies the official `version` header | Official model routing must see the installed client version |
| Official model catalog | The `client_version` query uses the whole-version form of the same override (e.g. `0.162.0`) | Account model availability must be queried consistently |
| Remote-control registration | Enrollment sends the installed version, including direct backend connections | A source `0.0.0` registration previously caused the phone to require an update |
| Cached remote registration | Source builds with a valid override attempt re-enrollment before the initial cached-token refresh | Refresh an obsolete advertised version while retaining the existing pairing |

Cached registration replacement is accepted only when both server ID and environment ID match. Failure or a different pairing preserves the cached registration and its normal refresh path. This is not a migration to a new remote environment.

In the normal launch path, failed original-version discovery emits a diagnostic and supplies no override, leaving the compiled backend version. Native user-agent/catalog/registration code also validates the override and has a compiled-version fallback. Official request-header insertion checks HTTP header encoding and relies on the bridge's prior version validation; manually supplying arbitrary environment values is outside the validated launch path. Alignment is therefore a requirement to validate, not an unconditional promise when installation discovery fails. API-provider requests do not receive the official-only version header.

Execution companions (`codex-code-mode-host.exe`, `codex-command-runner.exe`, `codex-windows-sandbox-setup.exe`) are bundled with the pinned backend and checked against paired hashes at launch. They are not replaced by companions from independently updated official CLIs. Their compatibility cannot be replaced by changing a version string.

## Update Checklist

1. Record the installed Desktop version, original CLI version, upstream revision, patched binary hash and companion hashes. Keep build provenance separate from the installed version.
2. Port patches in a separate checkout and run patch preflight, Node tests and the Rust version/enrollment tests. Preserve account fencing and cached-pairing behavior.
3. Verify direct patched and bridged `initialize` report the installed CLI version. Verify official request headers/catalog queries, invalid-version fallback and absence of the official header on API requests.
4. Exercise a native paginated fork with retained history and identity, then continue the child chat. Check model selection, Fast, both official-account and official/API switching, and actual shell/code-mode execution.
5. Reconnect an already-paired phone and test an actual remote operation. Enrollment mock tests alone do not establish phone-to-PC compatibility.
6. Deploy only after the actual protocol and behaviors pass. Update the baseline and validation record together; rollback when they do not.

Current evidence and remaining limits are in [VALIDATION.md](VALIDATION.md). Phone-to-PC end-to-end interaction remains unverified. Version alignment does not add model entitlement, quota, account features or connector authorizations.
