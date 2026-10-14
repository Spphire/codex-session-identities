# Validation Summary

Baseline: Windows Desktop `26.1007.2314.0`, original CLI `0.162.0-alpha.17.2`, Rust `1.95.0`, upstream commit `0c7362d121d1c7f69540262425fd4e2209fd8e8d`.

The following checks were performed during development. Raw real-account reports remain private because they include machine, identity and chat metadata. These are historical checks on the stated baseline, not guarantees for newer Desktop builds.

- 33 Node unit/integration tests passed, covering authenticated bridge routing, data minimization, origin/host checks, identity isolation, queued and cancelled switches, offline bindings, model catalog, desktop-runtime discovery, duplicate grouping and guarded removal.
- Synthetic Edge browser QA passed on desktop/mobile: grouping and alias labels, bound-removal disabled, unused-removal confirmation/persistence, no JavaScript errors and no identity-text/button overlap.
- Real routing QA used one isolated chat across system official -> API -> independent official -> system official with `gpt-6-luna`, low reasoning and standard tier. All four requests reached their real upstream service via a transparent local relay, matched the expected bearer credential (and official account header), returned HTTP 200 and replied OK. A sibling chat and both original official credential files remained unchanged. The two official aliases in this local check belong to the same account; this does not prove a fresh two-distinct-official-account switch.
- The same four-step real routing check also passed with `gpt-5.6-luna` against the exact older binary still loaded by the local Desktop (SHA-256 `080f52b47a55126fcf6dc673d654db95fd78a6354f4ddb6e811d6879d8ee5663`). This was another isolated test runtime using that binary, not a request injected into an existing business chat. Both the currently loaded implementation and the staged newer implementation performed actual credential/provider switching.
- Rust validation previously passed 44 thread-manager tests and one official account/user fencing test.
- Synthetic DPAPI checks covered import, refresh synchronization and refusal of concurrent vault changes.
- Native routing smoke tests covered legacy/paginated histories, busy refusal, sibling progress, instruction retention, fork inheritance, cold resume and unavailable-identity replacement.
- Two distinct official accounts and one API identity passed all six directed switch transitions. Global login and sibling bindings were preserved.
- Both official accounts subsequently made real `gpt-6-sol` and `gpt-6.1-sol` Fast requests; API switching and returning to official Fast also passed.
- A real remote tool-execution test observed the code-mode host process and successful shell execution after deployment companion synchronization.
- An isolated native restart fixture verified backend stop/reopen and survival of unrelated auxiliary processes. This was not a restart test against a live production Desktop.
- Repeated panel-open calls reused one dedicated browser window. A panel-only restart retained the access token; the authenticated state endpoint confirmed connection afterward.

Desktop UI screenshots were not obtained for every latest launcher, tray and Fast state. Panel window activation was checked by window handle, not a physical tray click. Tests do not cover every account entitlement, provider, Windows configuration or future upstream revision.
