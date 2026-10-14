# Performance Assessment

Measured on 2026-10-14 against Desktop `26.1007.2314.0`, original CLI `0.162.0-alpha.17.2`, Node `24.19.0` and patched backend SHA-256 `05c13eb605bdfa5fcb5f7f8d295034d6d546c31cb9916dd2a051bd54f6eaf7c4`. Local CPU: i9-14900K, 32 logical processors. Remote Windows CPU: i5-13600KF, 20 logical processors. Both existing Desktops remained running; test runtimes and chats were isolated.

## Conclusion

The adapter has measurable startup and memory costs. Steady bridge overhead is small for the tested RPCs and shell commands. **Real official switches took several seconds and blocked another chat's rename for most of that interval.** This is shared-lock contention introduced by the switching path, not ordinary JSON forwarding overhead. Queued retries and UI polling add perceived delay. First model-catalog lookup is also noticeable, and the full panel list scales with chat count.

The final synthetic/metadata-only measurement files are saved under [benchmarks/2026-10-14](benchmarks/2026-10-14). They contain scalar results rather than live panel payloads or real account profiles. Real-account source reports remain private; selected timing and match results are transcribed below.

The deployed patched backend is a **development, unoptimized Rust build**, without debug symbols; the packaged original CLI is an optimized product build. Original-versus-patched differences include compiler optimization, source/build differences and test state. They cannot be assigned entirely to the identity patches. Patched-direct versus the same patched binary through the bridge isolates the adapter path more closely, subject to ordinary scheduling/cache noise. No pristine source build with identical build flags was benchmarked.

## Method

`test/performance-smoke.mjs` compares original CLI app-server, patched-direct and bridged-patched runtimes in temporary credential-free homes. It rotates startup order over five launches, then measures each mode's workload sequentially. A loopback SSE endpoint supplies short replies and bursts of 1,000 text deltas without inference, billing or real account networking. API A/B switches are verified by native confirmation and actual subsequent bearer headers. Test homes have no production MCP servers. History before switching is 13 synthetic turns, not a long business conversation.

`command/exec` runs `cmd.exe /d /c echo PERF_OK` and a PowerShell `Write-Output PERF_OK`, validating exit/output. This measures native process execution without model latency. It does not benchmark the full model-to-code-mode tool dispatch pipeline. Resources use only identified test processes; idle CPU is sampled over about ten seconds after settling. It is a short sample, not an overnight leak/CPU test.

`test/performance-panel.mjs` makes 30 authenticated, read-only requests to each live panel. Returned titles, directories, identity metadata and access tokens are not recorded. Its CPU estimate can contain unrelated activity in that panel process. `test/performance-ui.mjs` renders synthetic rows in headless Edge at 1365 x 900; timing includes synchronous DOM creation and forced layout, not final display paint. It does not alter the installed UI.

## Runtime Results

Medians in milliseconds. Startup uses 5 samples, account/read 100, thread/list 30, cmd execution 15, PowerShell 5, short turns 10, streaming bursts 3, idle switches 20, switch/reply pairs 6 and panel-coordinated idle switches 10. Small samples, particularly startup, shell and streaming, do not establish reliable tail latency. Single first-catalog observations are explicitly marked.

| Operation | Local original | Local patched | Local bridge | Remote original | Remote patched | Remote bridge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Spawn through initialize | 89.8 | 130.3 | 391.1 | 178.5 | 245.3 | 405.5 |
| account/read | 1.80 | 2.64 | 2.59 | 1.59 | 2.45 | 2.81 |
| thread/list, limit 10 | 0.25 | 0.64 | 0.72 | 0.28 | 0.58 | 0.87 |
| model/list, first observation | 0.85 | 2.91 | 766.1 | 1.32 | 3.41 | 3151.9 |
| model/list, cached | 0.67 | 2.87 | 3.31 | 0.73 | 2.80 | 3.58 |
| cmd command/exec | 32.2 | 32.4 | 36.0 | 28.7 | 28.5 | 28.7 |
| PowerShell command/exec | 175.0 | 173.8 | 180.0 | 209.3 | 211.6 | 212.0 |
| Synthetic short turn | 30.8 | 61.5 | 60.9 | 31.1 | 77.7 | 62.8 |
| Synthetic 1,000-delta burst | 31.2 | 154.9 | 154.3 | 47.0 | 169.1 | 171.4 |
| Native idle identity switch | N/A | 75.9 | 75.3 | N/A | 78.8 | 78.9 |
| Switch plus routed synthetic reply | N/A | 138.0 | 138.2 | N/A | 139.5 | 139.5 |
| Panel coordinator to verified switch | N/A | N/A | 86.4 | N/A | N/A | 88.4 |

Relevant p95 observations: bridged idle switch 80.4/82.2 ms (local/remote), panel idle switch 93.3/98.1 ms, bridged cmd execution 55.6/32.4 ms and bridged account/read 3.27/3.87 ms. Negative differences in the table are measurement variation, not evidence that the bridge accelerates execution.

An exploratory local run had an idle-switch maximum of 1.79 seconds; the corrected final harness saw 0.25 seconds local and 0.09 seconds remote. These runs support typical timing, not an upper latency guarantee. The exploratory harness accidentally recognized burst markers in prior history; the final harness selects only the current user input, and the final reports supersede that run.

The original-versus-dev-backend streaming gap is substantial even without the bridge. The bridge added no consistent large delay in the measured bursts. A release build and an equally configured pristine upstream build are required to quantify patch-only cost. Slow production token generation and a synthetic loopback burst exercise different workloads.

## Real Identities And Concurrent Operations

On the remote host, a separate isolated chat completed the following sequence using `gpt-6-luna`, low effort and standard tier. Each subsequent reply was OK, with the expected real bearer credential/account header and HTTP 200 verified through a transparent relay. These are single observations, not latency percentiles. Reply observation includes networking, inference and up to 500 ms harness polling; it is **not** adapter overhead.

| Transition | Native switch acknowledged | Subsequent reply observed |
| --- | ---: | ---: |
| Initially unbound -> official A | 4.913 s | 17.942 s |
| Official A -> API | 2.811 s | 7.199 s |
| API -> distinct official B | 4.505 s | 8.723 s |
| Official B -> official A | 3.199 s | 12.381 s |

An earlier trial completed the first official/API replies with 2.685/3.412 second switches, but one API request encountered a transport failure before a successful retry. The old smoke assertion required every attempt to return 200 and stopped the sequence despite successful completion. The harness now requires correct identity on **every** attempt, at least one HTTP 200, a completed OK reply, and rejects unexpected HTTP statuses; status-less transport failures remain visible rather than being mistaken for wrong identity routing. The final four-step run above had no recorded retries. Raw real-account reports remain private.

`test/performance-official.mjs` then tested two distinct official profiles without model inference, using private short-lived token copies and the actual official catalog. Both original auth files retained their hashes. During A -> B and B -> A switches, it concurrently issued account/read, thread/list, a rename on a different isolated chat, and a harmless command/exec. The probe loop was delayed by the rename; each transition produced only two samples per operation, so use maximum observations rather than claiming a latency distribution.

| Operation | Idle baseline median | Max during A -> B | Max during B -> A |
| --- | ---: | ---: | ---: |
| Switch itself | N/A | 4309.5 ms | 3692.3 ms |
| account/read | 2.9 ms | 5.4 ms | 6.5 ms |
| thread/list | 2.1 ms | 6.8 ms | 9.6 ms |
| Other chat's thread/name/set | 4.2 ms | **4241.5 ms** | **3619.7 ms** |
| command/exec | 33.0 ms | 34.5 ms | 38.4 ms |

The baseline rename's first-call maximum was 470.1 ms; later calls were near the 4.2 ms median. The concurrent multi-second waits are substantially larger. Source inspection explains the affected category: `thread_identity_set` reacquires the global single-permit `thread_list_state_permit` before draining/reloading a loaded runtime and holds it across the replacement; `thread_set_name_response_inner` requires that same permit. Archive/unarchive and some project mutations also use it, but their contention was not individually benchmarked. It is incorrect to claim all other-chat native operations are unaffected. List reads and standalone command execution remained responsive in this sample; ongoing sibling model turns were not measured here.

The synthetic 75-79 ms switch is a local implementation baseline, not an estimate for a real official-account switch. Real switches include catalog networking, credential handling and runtime replacement. The current measurements do not break down every internal stage, and a release build alone will not remove a network wait while a global lock is held.

## Where Waiting Comes From

- Startup runs the installed CLI's version probe and reads/hashes both copies of three companion executables. Warm version probing cost about 60/56 ms local/remote; companion hash checks cost 130/154 ms. These ensure version/host alignment and occur at bridge startup, not once per normal operation. Measurements exclude full Desktop startup, cold disks and antivirus variability. Version probing can wait up to 10 seconds on a faulty installation.
- A first `model/list` launches an original-CLI helper, fetches its catalog and waits for helper shutdown, then merges results with the patched catalog. Cached results expire after 30 seconds or executable/config/auth metadata changes. A later lookup can therefore repeat the first-lookup cost. The helper deadline is 15 seconds, including shutdown. The 0.77/3.15 second observations are end-to-end helper costs; they do not identify which portion was initialization, retrieval or teardown. Official network and token refresh can add more time.
- An idle native switch reconstructs auth, model and tool state while preserving conversation history. Configured MCP reconnects, history length, credential helpers and official catalog refresh are outside the synthetic baseline. A cold chat can receive a saved binding before any runtime is loaded; that is not equivalent to an already-loaded switch.
- Busy switches retry on a 2-second coordinator timer. The measured wait after releasing a held turn was 1.07/1.17 seconds, in addition to application work. The UI refreshes every 5 seconds, so displayed confirmation can lag runtime application by another refresh interval. Immediate idle submissions already trigger a tick and do not deliberately wait two seconds.
- Every request/response and streaming event is parsed and serialized by one Node bridge process. Panel sockets receive selected lifecycle notifications, rather than copies of all model/tool events. Connected control pipes are reused; successful periodic ticks do not rescan descriptors every time.

## Panel And Resources

| Live panel | Local, 1218 chats | Remote, 791 chats |
| --- | ---: | ---: |
| /api/state response size | 711115 bytes | 450197 bytes |
| Request median / p95 | 53.9 / 74.0 ms | 46.5 / 47.5 ms |
| Panel process CPU per request | 42.2 ms | 19.8 ms |
| Estimated 5-second polling CPU, one tab | 0.84% of one core | 0.40% of one core |
| Panel working set / private memory | 99.1 / 109.7 MiB | 74.5 / 104.5 MiB |
| Bridge working set / private memory | 84.0 / 59.5 MiB | 59.1 / 23.3 MiB |

Over the final ten-second isolated idle sample, bridge CPU consumption was below the process timer's recorded resolution (reported 0 seconds); patched backend CPU was 0.016/0.078 seconds. This does not mean zero overhead under traffic. Panel CPU during its separate ten-second live sample was 0.063/0.016 seconds; a separately open browser may poll during this period. Tray working sets in separate snapshots were 33.3/27.8 MiB local/remote. The measured bridge/panel/tray working sets sum to roughly 216/161 MiB, excluding the browser and backend. These snapshots are not a simultaneous aggregate or peak. Working set and private memory are different OS metrics and must not be added to each other.

The isolated original backend working set was about 90/88 MiB; the bridged dev backend after the switch workload was about 215/178 MiB. Build optimization and reconstructed/cached runtime state differ, so this additional observed backend footprint is not a controlled measure of patch-only memory overhead. A release-versus-release comparison is still needed.

Synthetic frontend rebuild/layout medians were 6.8 ms at 100 rows, 48.4 ms at 800, 73.8 ms at 1200 and 318.0 ms at 5000. All visible rows are recreated every refresh and on selection/search changes. The server also rereads profile/binding metadata and the full thread table; it does not issue a native RPC for every chat. Closing the panel window stops that window's browser polling, but the panel service and coordinator timer remain running.

## Recommended Priorities

1. Reduce the switch's global critical section: prepare slow auth/catalog/tool state outside it where possible, then use per-thread coordination plus revision/runtime rechecks for commit and rollback. Verify same-chat race handling, fork/archive behavior, pairing and account fencing before deployment. Simply dropping the permit around mutation is unsafe. The observed unrelated-chat rename stall is the highest-priority concurrency issue.
2. Build and validate a release backend before claiming patch-only CPU cost or shipping performance assurances. Preserve the measured debug baseline to compare the replacement.
3. Reduce repeat model-catalog helper startup/shutdown costs while retaining bounded failure handling, account/config invalidation, version alignment and correct model availability. A cache lifetime change alone has a freshness tradeoff.
4. For faster confirmation, drive queued retries and UI updates from lifecycle/switch events with polling as fallback. Retain revision checks, account fencing and busy protection.
5. Paginate or virtualize the panel list and avoid rebuilding unchanged rows. Consider a short metadata cache with explicit invalidation; preserve identity verification and credential separation.
6. Consider startup companion-check caching only with a safe invalidation policy. Removing version checks or allowing stale execution hosts would regress functionality for roughly 0.2 seconds of warm startup savings.

These are proposed optimizations, not changes included in this assessment. No production runtime, cache or switching semantics were changed for the benchmark. No CPU saturation or broad shell-execution regression was demonstrated in these bounded tests; long histories, many MCP servers, sustained streaming, concurrent active chats, cold starts and real phone operations remain outside the measured scope.

## Reproduce

```powershell
node test/performance-smoke.mjs <installation> <report.json>
node test/performance-panel.mjs <installation> <panel-report.json>
$env:PLAYWRIGHT_MODULE = '<existing-playwright>/index.mjs'
node test/performance-ui.mjs <ui-report.json>
# Explicit opt-in, real catalog requests with two distinct official accounts:
node test/performance-official.mjs <installation> <private-report.json>
# Billable four-reply routing check, including switch/reply observation timings:
node test/real-identity-routing-smoke.mjs <installation> <API-profile-id> <private-report.json>
```

On a remote host with low system-disk space, set `PERF_TMP` to an existing directory on a roomy drive. The runtime fixture needs the original and patched executables plus matching companions; the panel test needs a running authenticated panel. Fixture code/configuration lives in the OS temporary directory and contains no real credentials. Do not include real profile directories or live `/api/state` payloads in published reports.
