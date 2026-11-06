# Architecture and maintenance boundaries

Changes should stay inside the layer that owns the contract. Files remain at their
installed names because native launchers, shortcuts and update packages consume them.

## Entry points and ownership

| Layer | Entry points | Responsibility |
| --- | --- | --- |
| Windows launch | `Launch-Codex.ps1`, `launch-process.ps1`, `runtime-bundle.ps1` | Resolve the installed Desktop and paired native runtime, perform preflight, and own restart process selection. |
| Native bridge | `runtime-bridge.cjs`, `bridge-policy.cjs`, `bridge-client.mjs`, `runtime-companions.cjs` | Adapt Desktop JSON-RPC to the pinned app-server, publish an authenticated local control pipe, and enforce pure allowlist/parameter policy. |
| HTTP boundary | `server.mjs`, `panel-http.mjs` | Authenticate local requests, enforce origin/body limits, route requests and serialize mutations. |
| Panel domain | `switch-coordinator.mjs`, `terminal-switch.mjs`, `tool-health.mjs`, `browser-health.mjs`, `bindings.mjs` | Persist desired identity state, coordinate runtime changes, and distinguish global MCP reload from selected-chat browser recovery. |
| Catalog and credentials | `catalog.mjs`, `identity-management.mjs`, `api-identities.mjs`, `official-login.mjs`, `official-usage.mjs` | Read credential-free metadata; keep API keys in Windows Credential Manager and official credentials in account-fenced profile files. |
| UI | `public/app.js`, `public/recovery-controls.js` | Render sessions and identities; recovery controllers own their polling and stale-response fences. |
| Delivery | `payload-files.json`, `payload-files.ps1`, build/update scripts | Declare shipped files once, derive full and small payloads, verify integrity and restore failed panel updates. |

The browser UI in `public/` is a client of the panel HTTP API. It must not infer a live account from provider labels or write credentials. Native app-server patches under `patches/` are source overlays for the pinned backend and are built separately from the Node and PowerShell layers.

## Shared contracts

- `panel-http.mjs` owns local panel HTTP mechanics: access-token comparison, same-origin JSON checks, bounded request bodies, and JSON responses. Route handlers should only decode domain input and call domain services.
- `bindings.mjs` is the sole owner of the panel SQLite schema and compare-and-set rules. Runtime code must use `BindingStore`; it must not modify `panel-bindings.sqlite` directly.
- `bridge-client.mjs` is the sole runtime discovery and authenticated control-pipe client. `runtime-bridge.cjs` owns the server side of that protocol and must remove its descriptor when either the backend or Desktop input closes.
- `catalog.mjs` is read-only with respect to Codex state. It may derive display metadata, but it must never return tokens, API keys, or unverified account attribution.
- `identity-contract.cjs` contains strict native RPC identifiers. Historical panel database keys deliberately have a broader grammar; do not silently migrate them by reusing the narrower validator.
- A destructive confirmation belongs to a specific backend PID. Pass that PID to `BridgeClient.call` so reconnection cannot redirect the confirmed operation to a replacement backend. Recheck ownership before acknowledging results.
- After Desktop EOF, the bridge allows five seconds for backend shutdown, then terminates the direct backend and releases pending timers/control sockets. Auxiliary processes are not discovered or killed by name.
- `payload-files.json` is the shipping inventory. Every new runtime module and browser asset belongs there; panel-update dependencies must ship with their callers. Desktop/native backend executables remain full-install artifacts, except the explicitly listed credential helper.

## Native overlays and compatibility

The ten patches in `patches/manifest.json` are an ordered history against one
upstream commit. The applied result is authoritative: patch 9 supersedes patch
5's ordinary-fork coupling, while owned agents still follow their parent's
lifecycle. Keep the history for reproducibility; do not reapply an individual
old patch to a newer Desktop or infer support from version strings.

`thread_identity.rs` in the applied backend owns account preparation, persistent
bindings, idle replacement/rollback and the explicitly scoped force operation.
Core thread/session changes preserve owned-agent results, ephemeral persistence,
and tool host behavior. Windows vault helpers, profile imports and provider-alias
migration remain separate because their storage and credential contracts differ.

## Validation layers

- Node tests cover pure policy (including a frozen pre-refactor policy comparison),
  HTTP boundaries, real panel SQLite, mocked RPC races and pipe authentication.
- Native smoke tests use the pinned executable and loopback model/MCP fixtures.
  They exercise actual request credentials, fork independence, cleanup, history,
  feature compatibility, browser refresh, Appshots and permissions.
- UI tests run isolated Edge pages on desktop/mobile sizes and delayed responses.
- Windows checks isolate process ownership, restart rejection and runtime pairing.
- Package update smoke tests reconstruct the old published source and run real
  panel processes through both rollback and successful small update.
- Patch replay compares all touched files against the actual applied checkout.
  It does not rebuild Rust or establish compatibility with a newer Desktop.

## Change checklist

1. Identify the owning layer and its callers before editing a contract.
2. Preserve identity revisions, runtime ownership, error codes, and persisted profile shapes.
3. Add a focused test for invalid and boundary inputs before moving shared logic.
4. Run the Node suite plus the relevant native or PowerShell smoke checks.
5. Treat an installed package as a deployment target; source refactors do not become active there until an explicit update is built and applied.

The repository intentionally keeps the Windows launch scripts and native overlay visible at the root because they are shipped artifacts and operational entry points. Consolidation should happen through shared contracts, not by hiding those entry points behind a generic plugin layer.
