# Changelog

## 0.1.4 - 2026-10-14

- Display each official account's remaining periodic allowances, reset times and Credits balance in the registered-identity sidebar; do not infer a monetary currency.
- Query verified credentials independently through the native usage endpoint, without modifying host login or issuing inference. Bound request time/concurrency and cache results; fence token/account changes and preserve marked old data on network failures.
- Add quota-only refresh, authenticated endpoint coverage, account isolation/cache/error tests and synthetic desktop/mobile browser checks. The patched Rust backend and client version alignment are unchanged.

## 0.1.2 - 2026-10-14

- Add official-account device authorization in the identity sidebar, using an isolated original-CLI login process and automatic email registration.
- Report the installed CLI version during Desktop and direct backend initialization, so paginated chats use the supported native fork route instead of the source-build fallback.
- Report that version during remote-control device enrollment. Refresh cached registrations on startup while retaining existing pairing IDs; preserve cached pairing if refresh fails or returns different IDs.
- Include a third replayable upstream patch and compatibility regression checks.

## 0.1.1 - 2026-10-14

- Merge duplicate official profiles by verified account and user IDs, retaining existing binding aliases. Never merge by email alone.
- Mark fixed system identities unavailable after the host account changes, without relabeling them as the new account.
- Add confirmed panel removal of unused identities. Keep credentials and profiles intact; reject bound, queued, observed or stale selections.
- Add six identity-management tests and optional synthetic desktop/mobile browser QA.

## 0.1.0 - 2026-10-14

First public experimental Windows release.

- Per-chat official/API identities with persisted bindings, busy-switch queue and cancellation.
- Replayable upstream patches with account/user fencing and installed-client version compatibility.
- Windows installer, guarded restart launcher, execution-host synchronization and tray service.
- Dedicated reusable panel window, account-email labels and stable panel authentication across service restarts.
- Synthetic tests, build instructions and privacy-safe validation summary.
