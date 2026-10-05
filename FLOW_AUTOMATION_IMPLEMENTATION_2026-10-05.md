# Flow automation implementation — 2026-10-05

Branch: fix/core-bugs. No merge. Extension version remains 9.12.13; no ZIP/release generated.

## Implemented

| Baseline finding | Change |
|---|---|
| Stop / Skip did not cancel runner preparation | Worker cancellation record plus runner checkpoints in polling, paste/drop, prompt, component clicks and Generate. Final worker CDP guard revalidates job, tab and project before mouse press. A generation already accepted by Google may continue; its late result cannot advance a cancelled batch. |
| Send Again / dispatch races | Per-session send lock, global dispatch lock and batch-creation lock. Existing pending work must finish or be cancelled. Generate is never blindly retried after an ambiguous debugger click. |
| Multiple tabs / wrong project | Worker serializes claims, validates bound tab and project, persists running claim and rejects repeated claims. Batch scans and recovery navigation use the bound tab. Project changes stop the runner. |
| Results marked complete before save | Separate received/applying/saved/apply_failed states. Library and journal failures keep the generated result; Retry Save applies it without regenerating. Single-image edits also retain failed results for retry through the same edit action. |
| Missing batch recovery | Durable queue, stages, current index, product/image references, results, save candidate, tab/project, counters and countdown. Explicit Resume Flow batch appears after panel reload. Unknown/stopped jobs require manual confirmation, never automatic resubmission. |
| Original-source check bypassed | Expected image source checked before commit; independent manual changes preserved. Known journal-backed public rehosting is treated as equivalent source. Original main image retained and queue indices shifted. Resume recognizes a Library save even if the following journal write failed, keeping the main slot intact. |
| Ambiguous new-grid result | Removed generic panel newest-image automatic application. Verified runner delivers through message + storage backup to one idempotent application path. Multiple new results are rejected for manual selection. |
| Loose manual success / prompt prefix check | Full normalized prompt comparison and final pre-Generate verification. Manual attach requires ready chips and confirmed prompt; incomplete attachment or prompt returns explicit failure/partial status. |
| Overlapping completion paths | Message/storage/watchdog share the same in-flight and saved-result guards. Generated output is written to storage before notification. |

Unusual-activity recovery remains bounded: Safe pacing, 60-second wait, maximum two new-project attempts per batch, then manual. Attempts now persist across Resume. Home navigation must actually finish; timeout stops recovery instead of resending into an uncertain project.

## Pacing

- Settings/upload transitions: readiness checks remain authoritative; a single 0.5–1.5 second randomized delay after preparation and after ready attachment.
- Immediately before Generate: 1–3 seconds after verified image/prompt/settings; job rechecked before click.
- Normal between images/stages: 2–6 seconds. Existing Safe 4–9 seconds and Fast 0.8–1.6 seconds modes retained.
- Every 10 successfully saved images, when work remains: randomized 10–30 second break REPLACES the ordinary gap. Pack → Background counts one completed image after both stages.
- Pause after image / Resume and Stop interrupt countdowns; countdown survives reload.
- Generation/download/save are readiness-driven. No artificial save delay. Upload/start/result timeout limits remain fixed; layout-settle and internal polling intervals are not randomized.

These are engineering pacing defaults, not measured human behavior and not a promise of avoiding Google detection.

## Tests

| Test | Result / evidence |
|---|---|
| tests/flow-ownership.test.cjs | PASS: competing worker claims, wrong tab/project, cancellation, late claim rejection, guarded active CDP click, cancellation before press, changed project |
| tests/flow-pacing.test.cjs | PASS: inclusive 2–6 and 10–30 second boundaries, every-10 counting, single scheduler, intermediate stage, Stop, Pause, remaining countdown. Uses a virtual clock; no real 30-second wait. |
| tests/flow-session-browser.test.cjs | PASS in real Chrome: injected Library failure; apply-only retry; original retention; duplicate result; pack/background stages counted once; journal failure and Resume after Library save; single-image retry; Stop during fetch; manual slot protection; uncertain job not auto-resubmitted; retained-result Resume; rapid Send Again lock. Actual page reload restores Resume UI and retained result. |
| tests/flow-runner-browser.test.cjs | PASS in real Chrome with controlled Flow DOM: full prompt, truncated prefix rejection, unready manual chip, ready manual attach, exactly one submit + ambiguous-result rejection, cancelled checkpoint, project navigation interruption |
| tests/audit-storage.test.cjs | PASS: field-only merge, stale updates/deletions, conflicts, failure propagation, backup/restore and reset scope |
| tests/core-bugs-browser.test.cjs | PASS: title-copy special characters, Unicode, newlines |
| tests/core-currency-browser.test.cjs | PASS: Walmart currencies and legacy Library prices |
| tests/core-favicon-browser.test.cjs | PASS: real broken favicon hides image and reveals fallback |
| tests/exported-catalog-browser.test.cjs | PASS: standalone console clean, copy/filter/switch/remove, verified Individual and Save All files, explicit unavailable ZIP notice |
| Syntax and diff checks | PASS: node --check for sidepanel.js, background.js, flow_automation.js; git diff --check |

Browser tests load actual source in isolated Chrome. Storage/download error injection and the Flow DOM fixtures are controlled tests, not live-account testing. The Flow fixture request is intercepted and fulfilled locally; no Google generation credits used. Its shortened readiness timeout and test-only helper exports are in the test harness, not production.

## Remaining validation and practical limits

- Live Google Flow account/current deployed DOM has NOT been tested. Selector compatibility, actual debugger permission behavior, upload acceptance and real generated-result matching need a small live batch before merge.
- One fresh generated tile is a heuristic, not a cryptographic association to the submitted prompt. The batch must have exclusive use of its Flow project; concurrent manual generation in that project is unsupported. Multiple fresh tiles stop automatic application.
- Resume tests exercise real page reload and application source with injected Chrome storage adapters; they do not certify full MV3 worker lifecycle on the user's installed extension.
- Supplier/image-host CORS, signed-link expiry, public-host outages and Google-side policy/account errors remain external limitations. Failed application retains the result where available; no new host bypass or detection-evasion mechanism added.
- A storage/quota failure can also prevent saving the recovery snapshot; UI must be kept open until storage succeeds.
- Original styling, manifest, extension version and bundled libraries unchanged. UI controls use existing button classes; no theme refactor.

## Review / quick user test

Reload the unpacked extension on chrome://extensions. Use two products in one Flow project first; test original-image retention, Pause/Resume and Stop. Reload the side panel and use Resume Flow batch. Then test an 11-image batch to see the every-10 break before image 11. If Flow UI differs or shows errors, collect the current DOM/error text rather than guessing new selectors.

Commits: 77f6aac (ownership/cancellation), 2c4c381 (durable saves/session/pacing), followed by a separate guarded-click/component/recovery validation commit. Main remains unmerged.
