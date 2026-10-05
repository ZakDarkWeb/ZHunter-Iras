# Google Flow Automation — Source Review, 2026-10-05

Implementation follow-up: see FLOW_AUTOMATION_IMPLEMENTATION_2026-10-05.md. The audit below records the pre-upgrade baseline.


Branch reviewed: fix/core-bugs (3df9e96). Analysis only: no extension source modified. This is a source-code review, not a live Google Flow certification. Current Flow UI/selectors and account behavior need a live test before changes based on the UI.

## Current end-to-end sequence

1. Select products and image slots; build a deduplicated queue (sidepanel.js:14380). Batch configuration supports background, pack, pack → background, and skip. It calculates generation count before starting (14250–14334).
2. Each step gets a fresh job ID, product ID, slot index and source URL (14625). Image bytes are prefetched, unsupported formats converted, and one pendingFlowAction written to Chrome local storage (2978–3060).
3. Focus an existing Flow project or open Flow. Inject the runner and send its execute message (2938). Runner has a per-page single-job gate (flow_automation.js:747–785).
4. Turn Agent off, enforce Nano Banana 2 / square / x1 settings, clear previous prompt, attach exactly one image chip and wait for readiness (flow_automation.js:299–555).
5. Paste prompt, verify its first 40 non-whitespace characters, recheck settings, submit once via Chrome debugger click, and wait for visible start (558–635).
6. Snapshot existing grid/reference media IDs. Detect new generated media, excluding uploaded references. Runner polls every 700ms; panel has a parallel fallback scan every 1500ms (flow_automation.js:637–682; sidepanel.js:3701).
7. Deliver result by message and storage backup. Panel validates known/current job and deduplicates delivery (sidepanel.js:3425–3448, 3760).
8. Fetch signed Flow image into local bytes, apply image, journal edits, and rehost local image asynchronously for Temu. Schedule next stage or image (3564–3623). Original main image is retained in slot 2, with later slot indices shifted (3104–3199).
9. Failures show manual recovery actions. Unusual activity switches pacing to Safe and permits at most two new-project attempts after 60 seconds, then manual recovery (3396, 14427). These limits should not be increased as an improvement.

## What is already strong

- Unique job IDs, active-job checks and duplicate-result suppression.
- One generate click per submission; no blind repeated generate clicks after ambiguous start.
- Supported-format conversion and a ready-chip check before generation.
- Distinguishes generated media from uploaded images using Reuse prompt and reference IDs.
- Original main image retention and image-index adjustment.
- Serialized Library writes and an edited-image journal; already applied edits have recovery support.
- Prefetches next image while current generation runs.
- Useful manual alternatives: device/paste/drop, manual attach, latest Flow image and skip.
- Pack/background multi-stage queue and generation-count preview already exist; improvements should build on these.

## Confirmed code gaps and risks

| Item | Priority | Evidence | Impact and suggested direction |
|---|---|---|---|
| Stop is panel-only, not end-to-end cancellation | High | sidepanel.js:14412 and 14542; flow_automation.js:695–711, 648 | Cancel removes panel job tracking but does not write a cancellation state consumed by the runner. Preparation/upload/prompt/submission have no job cancellation checkpoints. A closed/skipped job can continue generating even though its result is ignored. Add a shared cancellation state checked before each side effect; once submitted, stop accepting/advancing and explain that generation itself may continue. |
| Resend can overlap old preparation | High | sidepanel.js:14582, 14625; flow_automation.js:648, 695–711 | Send Again replaces the single pending record. Existing runner notices a different record only in result waiting, after its old generate stage. No button/in-flight guard protects the asynchronous send path. Use a submission lock and explicit old-job cancellation/acknowledgment; retry only a known failed or safely stopped job. |
| Multiple Flow tabs are not bound to one batch | High | sidepanel.js:2938, 3661; flow_automation.js:749–785, 807 | Focus/scans pick a project tab from the tab list; the job record has no owning tab/project. Every injected Flow tab can observe the same storage record, and the claim is not atomic across pages. Risk of duplicate submission or scanning a different project. Bind session/jobs to one tab/project and enforce a central owner before execution. |
| Batch progress has no durable resume state | Medium | sidepanel.js:2933, 13374, 14403; flow_automation.js:764 | Queue, current index, job map, stage and statistics live in panel memory. Pending job and edited-image journal are persistent, but neither reconstructs the whole batch. Reload can lose remaining work/result ownership. Persist compact session metadata and resume explicitly, without automatically resubmitting an uncertain job. |
| Application marked complete before successful save | High | sidepanel.js:3445–3447 and 3568–3596 | cur.done/handled-result state is set before fetching/applying; active job is cancelled before save succeeds. A failure can leave the result deduplicated and the step unable to accept it again. Add received → applying → saved states; retain the result and allow apply-only retry until saved. |
| Stepper replacement bypasses original-source check | Medium | sidepanel.js:3590; contrast replaceProductImage at 3154 | Stepper passes null as expectedUrl and also directly writes its row after awaited work. External/manual image changes or a session change during async fetch need fresh validation. Recheck session, job, product slot and expected source before committing. |
| Result correlation depends on grid freshness | Medium | flow_automation.js:660–670; sidepanel.js:3714 | New media ID plus generated flag is not proof that the image belongs to this prompt. Manual generation in the same project, concurrent tabs or newly rendered old tiles can confuse correlation. Prevent concurrent generation in the batch project; retain snapshots plus submission context and allow explicit review when association is uncertain. |
| Manual attach reports success too loosely | Medium | flow_automation.js:841–859 | Chip-readiness wait result is ignored and prompt-injection exceptions are swallowed. A positive added count can produce success despite incomplete readiness/missing prompt. Return separate attached, ready and prompt-confirmed status; expose partial success honestly. |
| Prompt verification checks only a prefix | Low | flow_automation.js:558–580 | A matching first 40 characters does not verify the full prompt or exclude duplicate/truncated text. Compare normalized full content where editor structure allows it, and report mismatch before generating. |
| Overlapping ownership/delivery paths complicate diagnosis | Medium | sidepanel.js:3425, 3701, 3760; flow_automation.js:719 | Runner message, storage backup and panel poll all deliver results. Dedup helps, but state transitions are distributed. Keep backups while routing all deliveries through one idempotent apply/save operation with clear logging. |

These are code-path findings. User-visible frequency and current Google Flow selector compatibility are not measured by this review.

## UX and workflow improvement opportunities

- One batch screen with product/image, chosen action, stage, status and a compact completed/failed/remaining summary.
- Clear Pause after current image, Stop batch, Retry failed, Skip image, and Resume controls with precise semantics.
- Separate generation from application/upload status: generating, result received, saved locally, public link ready, needs attention.
- Show credit/generation count before starting. Pack → Background costs two generations per image.
- Provide review/accept before replacing if desired, while retaining original main image and undo.
- Keep manual mode fast: attach image + verified prompt, user clicks Generate, then select/apply the corresponding result.
- Preserve successful work and offer apply-only retries; do not regenerate merely because public hosting failed.

## Suggested order before implementing the user's idea

1. Agree on desired automatic versus manual actions and where review is required.
2. Make job ownership, cancellation, resend locking and successful-save states reliable.
3. Persist batch/session progress and add controlled resume.
4. Improve the existing batch interface around those states.
5. Test on current Flow UI with user-provided DOM evidence or live authorized browser access.

No implementation requested or performed yet. User's improvement idea is pending.

## Required tests for an eventual implementation

Single image; multiple products; main-image retention and shifted slots; pack → background stages; Stop during upload, prompt and generation; rapid Send Again; Skip with late result; two open Flow projects; panel reload during generation; image download failure; public-host failure; duplicate message/storage/poll delivery; prompt mismatch; manual partial attach; timeout; unusual-activity manual handoff; save failure followed by apply-only retry. Live tests should avoid unnecessary paid generation.
