# Project audit — 2026-11-06

Status: source audit and implementation complete. This report records the audit
checkpoint before v0.1.13 publication and deployment; release operations are separate.
Base: `main` at `d9727e7`. Existing uncommitted force-feedback UI and bridge
owner-exit changes were preserved and included in regression verification.

Scope covers panel UI/HTTP, identity persistence and credentials, bridge and
compatibility adapters, Windows lifecycle, full/small packaging, native overlays,
and test/documentation structure. This is a maintenance audit, not a guarantee
against every future Desktop or upstream service change.

## Implemented structural changes

| Area | Before | Maintained boundary / evidence |
| --- | --- | --- |
| HTTP | Repeated access/origin/body parsing in route branches. | `panel-http.mjs` owns token comparison, same-origin JSON checks, bounded byte reads and response encoding. Routes preserve their existing status-code/side-effect order. UTF-8 split-chunk regression passes. |
| Bridge | Method/parameter rules were embedded in pipe orchestration. | `bridge-policy.cjs` is pure; a frozen v0.1.12 policy fixture verifies the extracted decisions across feature gates and invalid/boundary inputs. Authentication and IO remain in `runtime-bridge.cjs`. |
| Identifiers | Force switching imported validation from tool diagnostics. | `identity-contract.cjs` owns strict native RPC identifiers. Broader historical SQLite keys are deliberately unchanged. |
| Tool recovery | Selected-chat browser and global MCP recovery shared one module. | `browser-health.mjs` and `tool-health.mjs` own their different scopes; native tests verify the target refresh and unchanged sibling catalog. |
| UI | Recovery timers and identity selection shared one large controller scope. | `public/recovery-controls.js` owns browser/MCP state and invalidation. The UI ignores delayed responses across selection round trips. Desktop/mobile smoke tests and visual checks pass. |
| Delivery | Full release and updater maintained separate growing filename lists, omitting `bindings.mjs` from updates. | `payload-files.json` and its PowerShell reader drive both builds and the updater. Closure tests and actual built-payload hashes verify all modules/assets. |
| Test fixtures | Adapter dependencies were repeated across smoke-test copy lists. | `test/support/bridge-fixture.mjs` copies literal require/import dependencies, including conditional helpers. |

## Defects fixed and verified

1. **Force failure did not reliably stop retrying.** `TerminalSwitch` wrote
   `force_unverified`, which `BindingStore.reject` rejected. The actual SQLite
   regression now proves the failed request disappears from `pendingRequests()`;
   unknown error codes remain rejected.
2. **Runtime replacement during awaits could misattribute success.** Coordinator
   reads/writes and confirmation side effects are bound to the original PID.
   `BridgeClient.call` checks it after reconnecting, before sending. Replacement
   races keep the queue pending for fresh verification instead of accepting an
   old result or forcing a new backend.
3. **Stale UI results could overwrite a newer selection of the same chat.** Request
   generation plus runtime checks reject the old response after A → B → A.
4. **Update rollback retained newly introduced files.** Rollback now restores old
   files and removes files that did not exist before the update. A real old-panel
   installation was updated with a deliberately broken candidate, recovered, then
   successfully updated with the good package; auth/config/backend were unchanged.
5. **Panel PID reuse was not fenced during update.** The updater now rechecks
   creation time, executable and command line immediately before stopping its
   service. An isolated Windows fixture verifies reused/unrelated PIDs survive.
6. **Diagnostic output included a pipe access token.** `bridge-health.mjs` now uses
   an explicit metadata allowlist; the diagnostic smoke test rejects token or
   arbitrary descriptor-field leakage.
7. **Existing lifecycle and UI fixes were retained.** A backend ignoring Desktop
   EOF is terminated after the grace period, pending route timers are cleared,
   and force-action errors persist across UI refresh until the request changes.
   These changes were already present when the audit started.

## Reviewed areas retained deliberately

- Account/user identity fences, API credential staging/rollback, create-only
  Windows vault writes, official reauthentication and quota attribution have
  different contracts. They remain separate modules; their focused tests and
  actual synthetic-vault/native routing regression pass.
- The panel SQLite schema and native profile/binding formats are unchanged. Desired,
  applied, configured and verified state remain distinct. Generic refactoring
  must not merge these states or treat a provider label as an account identity.
- Windows Store package fallback, registered installation discovery and paired
  native-runtime content storage remain distinct responsibilities. Ownership,
  update rejection and pairing checks pass; there is no broad process-name kill.
- Model catalog, structured-feature and client-version adapters are separate
  compatibility transformations. Their pure tests and real structured-config /
  native execution fixtures pass. Version equality alone is not acceptance.
- The ten native patches remain an ordered, reproducible history. Replaying all
  patches from the pinned base yields the same 21 touched files as the current
  upstream checkout (normalizing only CRLF). Patch 9 intentionally supersedes
  patch 5's ordinary-fork coupling. Collapsing that history would lose provenance
  without reducing the final runtime's responsibility boundaries.
- Native Rust and native helper source were not changed in this audit. Existing
  v13 backend SHA-256: `1208BF80A68FAADD6D59F7F05DE49A870862C9197C97F30C253603CDE948F353`.
  Actual loopback regression validates that binary and its paired companions;
  no claim is made that Rust was rebuilt during this audit.

## Verification and completion evidence

| Gate | Evidence |
| --- | --- |
| Full Node suite | 109 passed locally and 109 on a second Windows host, Node 24.19.0. The remote system Node 20 was unsuitable; tests used its existing bundled Node 24 without changing global installation. |
| Diagnostics | `node --test test/bridge-health-smoke.mjs`: passed; secrets excluded. |
| Native behavior | 15 loopback cases passed: legacy/paginated identity routing and ephemeral forks, ordinary-fork independence, terminal blockers, completed/active owned agents, browser and MCP refresh, structured features, permissions, Appshots, real synthetic vault/cold resume, paired code-mode and nested shell. |
| Windows lifecycle | Nine runner cases passed plus updater PID-reuse regression: ten checks total. Actual fixture processes restart; rejected compatibility keeps the existing fixture running. |
| UI | Panel desktop/mobile, API form desktop/mobile, and delayed selection-response suites passed. Force dialog and API mobile screenshots inspected visually. |
| Shipping | Fresh full and small payload hashes verified; successful old-version update and failed-candidate rollback exercised with real isolated panel processes. |
| Native overlays | Ten patches applied to fresh pinned files; all 21 final files match the authoritative upstream working tree. |
| Source hygiene | `git diff --check` passed; dependency inventory includes all runtime modules and the new browser asset. |

Validation artifacts are under the task workspace's `outputs/audit-20261106/`:
`validation-summary.json`, `node-tests.txt`, `apricity-node-tests.txt`,
`native/results.json`, `native-r2/results.json`, `native-execution/results.json`, `native-ephemeral/results.json`,
`windows-r2/results.json`, `package-verification-r2/result.json`,
`patch-replay/result.json`, `panel-ui/`, and `api-ui/`.
Initial harness failures are retained alongside corrected reruns: a missing
launcher fixture dependency/module path, a too-short restart deadline, and two
native fixtures requiring an installation-directory argument instead of an exe.
A disk-space failure was resolved using a shared Node fixture binary and reversible
NTFS compression of this audit's generated executables, preserving the evidence.

## Deployment and limits

At the audit checkpoint, changes were in the development checkout only. The audit did not publish a release,
bump the package version, restart production Codex, or apply the refactor to the
user's installation. Staging directories are QA candidates, not public releases.
Commit/tag/publication and production rollout are separate actions.

All required audit areas have a disposition and the scoped regressions above pass.
The validation covers the pinned backend and observed local interfaces. It does
not certify future official Desktop versions, real website authorization, external
provider availability, or remote inference routing. Those remain release-specific
compatibility checks, not unfinished structural work.
