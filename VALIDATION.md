# Validation Summary

Baseline: Windows Desktop `26.1007.2314.0`, original CLI `0.162.0-alpha.17.2`, Rust `1.95.0`, upstream commit `0c7362d121d1c7f69540262425fd4e2209fd8e8d`.

The following checks were performed during development. Raw real-account reports remain private because they include machine, identity and chat metadata. These are historical checks on the stated baseline, not guarantees for newer Desktop builds.

- 27 Node unit/integration tests passed, covering authenticated bridge routing, data minimization, origin/host checks, identity isolation, queued and cancelled switches, offline bindings, model catalog and desktop-runtime discovery.
- Rust validation previously passed 44 thread-manager tests and one official account/user fencing test.
- Synthetic DPAPI checks covered import, refresh synchronization and refusal of concurrent vault changes.
- Native routing smoke tests covered legacy/paginated histories, busy refusal, sibling progress, instruction retention, fork inheritance, cold resume and unavailable-identity replacement.
- Two distinct official accounts and one API identity passed all six directed switch transitions. Global login and sibling bindings were preserved.
- Both official accounts subsequently made real `gpt-6-sol` and `gpt-6.1-sol` Fast requests; API switching and returning to official Fast also passed.
- A real remote tool-execution test observed the code-mode host process and successful shell execution after deployment companion synchronization.
- An isolated native restart fixture verified backend stop/reopen and survival of unrelated auxiliary processes. This was not a restart test against a live production Desktop.
- Repeated panel-open calls reused one dedicated browser window. A panel-only restart retained the access token; the authenticated state endpoint confirmed connection afterward.

Desktop UI screenshots were not obtained for every latest launcher, tray and Fast state. Panel window activation was checked by window handle, not a physical tray click. Tests do not cover every account entitlement, provider, Windows configuration or future upstream revision.
