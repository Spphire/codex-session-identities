# Changelog

## 0.1.11 - 2026-10-28

- When direct process creation returns Windows access-denied for the current user's registered Codex Store executable, retry in that exact package's context. Preserve the launcher configuration paths explicitly; package activation does not inherit the caller's environment.
- Keep the existing backend-path and administrator handshake checks. A launched window alone never confirms identity integration. No package ACL, registration or global environment changes are made.
- Preserve nested Windows error codes, exception types, launch path and elevation context in launch failure diagnostics.
- Validate package-context startup in an isolated real Desktop profile on 26.1021.3705.0; the reported 26.1023.6123.0 host still requires its own handshake verification.

## 0.1.10 - 2026-10-28

- Release completed owned subagents before an ordinary identity switch, retaining their result in the parent context and keeping their saved history.
- Extend explicit force confirmation to active replies and owned subagents. Pause active goals, stop the selected chat's reply and background terminals, close its owned subagents, then retry and verify the requested identity. Independent forks remain independent.
- Report success only after native identity verification. Failed cleanup stops automatic retries with an explicit error; a stale selection or changed backend requires a fresh confirmation.
- Gate the new bridge methods on a paired native runtime capability, including strict pause-only goal control. Existing running backends require normal restart to load it.

## 0.1.9 - 2026-10-27

- Prompt once when a selected chat's identity switch is blocked by its own background terminals, with a manual retry button and explicit terminal-closure confirmation.
- Bind each short-lived one-use confirmation to the pending identity revision, backend process and exact terminal inventory; recheck native busy reasons and preserve sibling chats. Never force a switch during an active reply.
- Expose strictly validated per-chat terminal list/terminate bridge methods. Older running bridges explain that a normal confirmed restart is needed instead of pretending terminal management is available.

## 0.1.8 - 2026-10-26

- Preserve the current Desktop's official `cua_repl` browser plugin instead of replacing plain `node_repl` with the legacy browser-only bootstrap. Keep runtime path migration constrained to the matching official manifest.
- Inspect live Desktop startup evidence before offering per-chat browser recovery. Explain feature-bootstrap timeouts and withhold ineffective reload confirmations when the browser control service never started.
- Include the diagnostic module in panel updates and release payloads. A connected MCP catalog remains distinct from a verified page read.

## Unreleased

- Add per-bridge JSONL diagnostics with startup, control-pipe, request completion, response timeout, backend stderr/exit and ten-second heartbeat events. Add a bridge health command that reports stale descriptors, unreachable pipes and duplicate desktop bridges.
- Repair a retained standard-permission panel service before connecting to an Administrator backend. Check the installation executable, server command and process creation time before replacing only the panel service; preserve already elevated services and unrelated processes.
- Preserve the typed ephemeral flag when preparing an inherited identity. Temporary title/description forks stay temporary and do not acquire durable side-chat bindings on later parent identity changes.
- Add isolated legacy/paginated regressions for temporary fork routing, repeated rename description refreshes, database/list exclusion, binding exclusion and ordinary side-chat synchronization. Include the previously omitted fork parent initializer in patch 5 so the seven-patch series replays exactly.
- Explain queued identity switches using backend-confirmed reply, background terminal, side-chat, loaded subagent and idle-race blockers. Include the related thread and terminal count without commands or outputs.
- Keep blockers scoped to the queued revision and backend process; clear them on completion, cancellation or runtime replacement. Older backends show an explicit generic busy reason.
- Add a sixth replayable backend patch and regressions for paused goals with surviving monitor commands, UI reason/link rendering and queue lifecycle cleanup.

## 0.1.7 - 2026-10-15

- Add an explicit Administrator shortcut and `--admin` launcher option using Windows UAC, same-user checks and backend process-token verification.
- Retain the normal launcher and native Appshots capture; add a real-backend/bridge synthetic image-and-text regression covering identity reload and local screenshot input.
- Add a persistent global YOLO panel switch, enabled by default, applying full access/no command approvals or workspace/on-request permissions to subsequent bridged Desktop requests across identities and side chats. Keep active turns unchanged and retain native managed-policy validation.
- Make the main desktop shortcut request Administrator access; keep a separate Standard entry.

## 0.1.6 - 2026-10-15

- Propagate identity changes from a root session to existing forked side chats.
- Record the parent reference on fork bindings, block a switch while a descendant is active, and reload idle descendants from the new identity before their next request.
- Add a compiled-backend side-chat smoke test covering A -> fork -> B -> resumed side-chat request routing.

## 0.1.5 - 2026-10-15

- Keep independent official profiles persistent through the native refresh-token flow; do not add a competing background refresh loop.
- Add per-account “重新登录” for revoked or invalid refresh tokens. Device-code reauthorization is isolated, account/user fenced, atomically persisted to the matching private profile and preserves session bindings.
- Keep system-level host login protected from panel overwrite and add reauthorization status polling and mismatch coverage.

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
