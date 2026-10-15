# Codex Session Identities

An unofficial Windows sidecar and replayable source patches for OpenAI Codex Desktop. Assign a separate official ChatGPT account or API provider to each local chat, while retaining its ID, history and working directory.

This is not an official OpenAI product, and is not a supported Desktop plugin API. It launches the installed Desktop with a bridge and a patched open-source app-server; it does not modify the Desktop installation files. Upstream updates require compatibility testing, not just reapplying a patch.

## Install

Download the Windows ZIP from this repository's Releases, extract it and run `Install.ps1`. An existing Windows Codex Desktop installation is required. Close Codex once and start it with the new **Codex - Session Identities** desktop shortcut. The launcher starts the panel service and tray icon together. Open the panel from the tray icon.

See [USER-GUIDE.md](USER-GUIDE.md) for installation, identity registration, switching, rollback and updates. The installer discovers the original CLI and copies its execution-host companions. Do not deploy only the patched backend executable.

## Features

- Independent official and API identities per chat; system official login and separately registered official accounts.
- Busy switches wait until idle; saved and runtime-confirmed bindings are distinguished.
- Account/user fencing, sibling isolation, cold-chat binding and child/fork inheritance.
- Official identities display the matching account email when available.
- Per-official-account remaining allowances, reset times and Credits balance in the identity sidebar, queried independently without changing the host login.
- Persistent private official profiles with native automatic token refresh; a per-account re-login action repairs a provider-revoked refresh token without changing session bindings.
- Duplicate official profiles are grouped by verified account/user, and unused identities can be removed from the panel without deleting credentials.
- Authenticated loopback panel, single-instance tray and reusable dedicated Edge/Chrome panel window.
- Restart launcher, installed-model catalog compatibility and execution-host synchronization.
- Release backend, identity-scoped model caches, catalog preparation outside the shared commit lock, lifecycle-triggered queued retries and reusable panel rows.

## Build And Test

See [BUILDING.md](BUILDING.md). The repository contains the sidecar and a patch series, not a forked copy of the entire upstream tree.

See [PERFORMANCE.md](PERFORMANCE.md) for measured startup, switching, RPC, shell-execution and panel costs on local and remote Windows hosts, including the unoptimized-backend limitation and reproduction commands.

```powershell
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File test/vault-test.ps1
```

Node.js 24 or newer is required for the built-in SQLite API. No npm dependencies are needed. Tests use synthetic credentials and temporary directories; they do not log in to real accounts.

## Compatibility And Limits

The tested baseline is Windows Desktop `26.1007.2314.0`, installed CLI `0.162.0-alpha.17.2`, and upstream commit `0c7362d121d1c7f69540262425fd4e2209fd8e8d`. See [VALIDATION.md](VALIDATION.md). Other versions and platforms are not validated.

Fast availability in the Desktop UI is still gated by the host account. Use an official host login for that UI capability; per-chat identities do not migrate third-party connector authorizations. Model availability and quota remain subject to each provider and account. Switching can reset temporary tool memory, but preserves files and conversation history.

The adapter aligns Desktop initialization, official model requests/catalog queries and remote-control registration with the actual installed CLI version, including a guarded refresh of cached remote registrations. Execution companions come from that same installation. See [VERSION-COMPATIBILITY.md](VERSION-COMPATIBILITY.md) for the policy, fallback behavior and update checklist. Version alignment does not grant account access or prove compatibility with a newer Desktop.

## Security And License

Never commit auth files, access tokens, API keys, private profile homes or session databases. API credentials use Windows Credential Manager; independent official profiles are private credential homes with DPAPI-backed import. The panel does not receive those secrets. See [SECURITY.md](SECURITY.md).

Apache-2.0; upstream attribution is preserved in LICENSE and NOTICE. Windows releases include Node.js and its license. Codex Desktop itself is not redistributed. The project is experimental; back up your configuration and validate on non-critical chats before use.
