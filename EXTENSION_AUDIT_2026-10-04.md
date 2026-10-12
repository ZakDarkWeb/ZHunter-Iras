# ZHunter Iras ? Extension audit

Date: 2026-10-04. Working manifest: 9.12.13. Git reference at completion: 5f38671.

## Scope and confidence

Read-only audit of the core product workflows: source scraping, bulk/queue hunting and recovery, Library storage/filtering/import/export, image edits/Flow/Gemini/ChatGPT integration, title/bullet/description generation, Temu pricing/category/variation/template/upload/drafts/history, settings, backup/reset, permissions and Google sourcing connector.

This is a code and local-fixture audit, not certification of every branch or marketplace selector. No real listings were submitted, no Google Sheet rows were appended, no AI keys were tested, and no production code was changed. Real Chrome extension service-worker lifecycle, logged-in marketplaces, Temu dropdown behavior, AI generation and deployed Apps Script still need live checks. Fixtures use a stubbed chrome API and cannot establish live reliability.

The repository already contains commits labelled 9.12.20/9.12.21 while manifest remains 9.12.13; source behavior and commit hash are more useful than those labels. Existing files were not reverted.

## Verified checks

- All 13 top-level JavaScript files pass Node syntax checks. Apps Script Code.gs also passes JavaScript syntax checking; Google APIs were not executed.
- No duplicate static HTML IDs, no inline HTML event attributes, no duplicate top-level named function declarations in sidepanel.js/content.js/background.js.
- Settings/History: seven collapsible settings sections, remembered state, history rendering/search, no pane overflow at 360/500px in dark/light themes.
- Categories: render, expansion, add/edit form and shared dark/light surfaces at 360/500px.
- Recent Hunts: new batch ID persistence, latest/older legacy matching, search reset, repeated-click reset and rejection of ambiguous legacy membership.
- Local audit fixtures reproduce exclusion/export mismatch, stale Library overwrite, source-price mutation, imported price override, max-price rounding overflow, weight/dimension precedence, ISO-date sort failure, insufficient content token budget, unsupported-fact validation gap, stale template rows and cross-platform source ID collision.
- Categories initially failed to load under three simultaneous browser startups because the harness uses a fixed one-second delay. A separate rerun passed. That startup failure is a test-harness limitation, not evidence of a Categories product defect.

## Urgent findings

### A01 ? Unticked products still export (critical; reproduced)
Evidence: sidepanel.js:11927 temuRunExport and :13476 checkbox handler. Review exclusions live in TemuReviewExcluded, but the export path builds rows directly and never applies that set. Local fixture excluded product b and still found it in TemuLast.items.
Impact: uploaded products can differ from the selection the user approved.
Fix: one shared export-snapshot builder using stable IDs, checked selection, applied image/text edits and explicit source. The preview count must equal actual workbook row count. Invalidate old snapshots when selection changes.
Acceptance: select one of three products; workbook and upload request contain exactly that one; zero selected blocks upload.

### A02 ? Stale Library writes can delete products (critical; reproduced)
Evidence: sidepanel.js:12005, :13569, :13622, :13634 save MasterUIState.allRows wholesale. Local price-change fixture seeded an extra stored product absent from the UI cache; changing the review price deleted that unrelated row.
Other race paths: appendToMasterSheet, reHuntMasterRow and import/delete perform independent read/modify/write cycles outside zhLibPatch. Re-hunt reads storage before a long network operation.
Fix: move all product mutations through one background-owned serialized patch API; fresh reads, field-only updates and revisions. Existing zhLibPatch helps only callers in the same panel instance.
Acceptance: concurrent hunt, price/image/title edit, import and delete preserve unrelated products and fields, including two panel instances.

### A03 ? Partial uploads mark failed products as listed (critical; code confirmed)
Evidence: content.js:3069 returns confirmed:true for processing results containing errors. sidepanel.js:12092 then calls temuMarkListed(TemuLast.items) for the entire attempted batch.
Example: 24 processed / 21 added / 3 errors causes all 24 to enter the skip-listed map. ?Action required? is processing confirmation, not proof that every product is a live listing.
Fix: distinguish attempted, processed, accepted/draft, listed and failed. Match per-product result IDs/SKUs. Where only totals are available, retain an unresolved state rather than claim all listed.
Acceptance: failed products remain retryable and successful products are not duplicated; history displays the actual state.

### A04 ? Store verification fails open (high; code confirmed)
Evidence: content.js:2908 and :3239. Missing mall-name text does not block upload/draft fixes. Upload even reports ?Store verified? using the expected name when no actual name was read.
Fix: wait for a readable actual store identifier/name and require a match; otherwise pause for user resolution. Bind store to immutable upload snapshot and use it for history/listed marking.
Acceptance: absent, delayed or mismatched store never submits a file or draft.

### A05 ? Backup/reset controls do not match actual storage (high; code confirmed)
Evidence: sidepanel.js:4562 and sidepanel-shell.js:143 attach two handlers to the same Backup button. Both request GET_DATA; background.js:1258 returns links/settings, not zhunterMasterSheet, batches or bulk queue. One downloads that incomplete object, the other can display ?Nothing to back up yet?.
Reset also has duplicate handlers. Wipe in sidepanel.js:4599 removes obsolete zak* keys, while active keys are zhunterMasterSheet / zhunterMasterBatches / zhunterBulkQueue. History clears but core data can remain. Destructive controls were not clicked during the audit.
Fix: one versioned backup/restore schema covering products, batches, queue, stores, listed/history and saved edit journals; exclude credentials by default. One handler per action and exact reset scope.
Acceptance: backup ? separate profile restore round trip preserves data; reset removes exactly the advertised records and pending sync behavior is explicit.

### A06 ? Embedded Groq keys in current Git HEAD (high; inspected without disclosing values)
Two credential-shaped Groq keys are present in both working sidepanel.js and current committed HEAD. Their validity and repository visibility were not tested. Values were not included in this report.
Fix: remove bundled keys from distributable source, use per-profile private settings, and revoke/rotate any keys distributed to others. Scan publication artifacts/history for credentials; merely deleting the latest line does not retract prior copies.
Acceptance: committed source/package contains no Groq credentials; user-configured keys still work locally.

## Product/data correctness

### A07 ? Temu price edit overwrites sourcing price (high; reproduced)
Evidence: sidepanel.js:13555 sets r.temuBase and also r.price to the entered Temu base; storage patches only price. Fixture changed source price 40 to 123 through the real review control. After reload the custom Temu override can be missing while source price is already altered, causing multiplication again and incorrect sourcing records.
Fix: separate sourcePrice, currency, temuBaseOverride and listPrice; persist overrides independently and never mutate source facts when editing listing prices.

### A08 ? Imported source prices become Temu base overrides (high; reproduced)
Evidence: sidepanel.js:9440 parseImportFile assigns generic price/Price to temuBase. Fixture JSON source price 40 exported base 40 instead of applying the configured multiplier.
Fix: classify source/library sheets versus Temu templates; only explicit Base Price/temuBase fields create overrides. Keep supplier price and listing price separate. Do not reset IDs/batch membership when restoring a backup.

### A09 ? Physical facts are replaced by defaults (high; reproduced)
Evidence: sidepanel.js:11845 profile weight has precedence; scraped weights above max are ignored and replaced with default if no usable title weight exists. Dimensions use profile/default and do not consult r.dimL/r.dimW/r.dimH.
Fixture: scraped 20lb product exported as profile 0.5lb; scraped length 15in exported as 1in. The configured 8lb skip therefore cannot reliably enforce actual known weight.
Fix: define explicit measured/scraped/user override/estimated fields, units and provenance. Known overweight evidence must block even if a category default is lighter. Use defaults only when facts are absent. Title liquid volume/pack estimates need uncertainty labels and pack-total handling.

### A10 ? Draft fixer can invent attributes and overstate success (high; code confirmed)
Evidence: content.js:3152 chooses other/first option when intended value is absent; :3181 includes factual material/age/care defaults; :3291 assigns Polishing to unknown fields, including text inputs. Selection verification accepts current text OR clicked option text rather than verifying the exact selected value.
Submit fallback can report ?Submit dabaya? even if no button was clicked. success:true also includes unresolved fields and only proves the routine finished, not Temu accepted the draft. Only currently loaded rows are iterated.
Fix: select only sourced/user-approved exact attributes. Unknown or unavailable values stay unresolved. Verify field value, intended Submit control and resulting row status; paginate explicitly. This needs actual Temu DOM fixtures/live checks.

### A11 ? No reliable single upload job state (high; code confirmed)
Evidence: sidepanel.js:12034 has no upload-in-flight guard; background.js:1175 has one mutable global _temuUpload but no lock rejecting a second upload. TemuLast is also reread after awaited operations and may be cleared/replaced by edits/settings. Local global state is not a durable job journal.
Fix: background-owned immutable job ID/store/items/file snapshot; one active upload per profile; return structured phase/result data and recover from persisted checkpoints. Reference-count keepalive ownership instead of unrelated tasks stopping each other's shared interval.
Official Chrome documentation recommends persisting state instead of relying on worker globals: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

### A12 ? Cached export can be stale (high; code confirmed)
Evidence: temuAutoUpload rebuilds only when TemuLast is null. Review checkbox and some price/image edits do not invalidate it. Export runs a separate row-selection path rather than temuGetQueuedRows and does not explicitly replay image edits there.
Fix: build one immutable snapshot immediately before upload, or verify a hash/revision of store, selection, settings and edits before reusing an export. Show ?changed since export? status.

### A13 ? Filled templates retain old product rows (high; reproduced)
Evidence: temuFillTemplate writes from row 5 and extends !ref but does not remove previous data cells/rows. It validates item_name but not the complete required key set/version.
Fixture: fill a workbook containing three old product rows with one new item; the second old row remains.
Fix: validate a supported template schema; clear only the actual data region while preserving headers/styles; resize the data range exactly. Reject missing critical columns. Test a filled template and duplicated/missing headers.

### A14 ? Critical preflight warnings do not prevent export (high; code confirmed)
Evidence: temuEnrich emits NO_IMAGES, NO_PRICE and NO_CATEGORY_PROFILE warnings but pushes the item; null values are omitted by template writer.
Fix: hard blockers for missing required data, with reason and direct edit navigation. Keep optional warnings separate. Ensure uploaded row count equals the validated snapshot.

### A15 ? Price rounding can exceed the configured cap (medium; reproduced)
Evidence: temuPrice clamps to max then applies floor(base)+0.99. Configured max 999 produces 999.99. List price is calculated before base rounding, so exact ratio and rounding policy differ.
Fix: define inclusive bounds and rounding order; validate min?max and finite positive values; clamp after rounding or select the last valid .99 price inside the bounds.

### A16 ? Product IDs collide across suppliers (medium; reproduced)
Evidence: temuSourceId returns only an ASIN/numeric ID; seenSrc, SKU and listed-map keys omit supplier identity. Walmart and Sam's numeric ID 12345678 resolve to the same ID. Some supported hunt URL forms also lack a reliable Temu ID parser.
Fix: canonical identity = supplier + product ID + variant where appropriate. Preserve legacy mapping during migration; never infer identity from an arbitrary URL tail without validation.

### A17 ? Newest/oldest sorting does not parse ISO dates (medium; reproduced)
Evidence: filterAndRenderMasterRows subtracts scrapedAt strings. The stored values are ISO timestamps. Fixture ordered old then new and remained old then new under newest sort.
Fix: normalize timestamps to numbers or compare Date.parse results with explicit invalid-date fallback.

## AI/content, sourcing and settings

### A18 ? Content Studio output budget is too small (high; request reproduced)
Evidence: text_studio.js:142 calls callGroqAPI without an output budget; sidepanel.js:4659 defaults to 150 tokens and :4722 caps at 600. One call requests title + up to six bullets + description as JSON. Mocked request confirmed max_tokens:150. finish_reason is not checked.
Impact: response truncation can break JSON and trigger a second equally constrained request. This was a request-budget test, not a real Groq generation test.
Fix: field-dependent output budgets, structured JSON support where available, finish_reason handling and a bounded retry for truncated output. Add a request timeout/cancellation path.
Reference: https://console.groq.com/docs/api-reference

### A19 ? Claim checks do not enforce all product facts (high; reproduced limitation)
Evidence: title_optimizer_rules.js zhContentIssues checks restricted terms/claims, not all invented quantity/material/audience/function facts. Unsupported ?Stainless Steel, 99 Pack, Waterproof, for Kids? generated no validation issues for a source that provides none of those facts. buildProductAiPrompt can also present generated fallback variation values as product information.
Fix: immutable source-fact snapshot, normalized quantity/dimensions/material/color comparison, and human review for ambiguous additions. Do not use already edited output as evidence of its own accuracy. Keep contextual USB/LED/Green support; do not blindly strip legitimate facts.

### A20 ? Five visible settings are silently dropped (medium; static comparison confirmed)
showTabHunt, showTabBulk, showTabLibrary, showTabSettings and maxHuntImages appear as data-setting controls but are absent from background PUBLIC_SETTING_KEYS. UI still reports save success and optimistically changes in-memory state. sidepanel.js and sidepanel-shell.js also bind duplicate setting handlers.
Fix: one typed settings registry drives UI, defaults, worker validation and save responses; reject unsupported keys explicitly; bind once.

### A21 ? Storage write failures can appear successful (high; code confirmed)
Evidence: background saveData returns false on failure, but UPDATE_SETTINGS ignores that result and returns success:true. Sidepanel setMasterRows/setMasterBatches callbacks do not inspect chrome.runtime.lastError.
Fix: propagate failures, verify revisions/critical writes and avoid refreshing the UI as if data persisted. Add controlled write-failure fixtures.

### A22 ? Sourcing queue can stall behind one bad batch (medium; code confirmed)
Evidence: sourcing_sync.js retry breaks on the first failing batch; a permanent incompatible store tab can hold later valid stores indefinitely. Synced snapshots remain without retention/compaction. Connection UI has no explicit disconnect/change-workbook path; blank connection fields do not represent persisted private connection settings.
Good existing behavior: authenticated fixed workbook, HTTPS source links, durable pending batches, serialized retry, Apps Script lock, hidden batch deduplication key, destination verification, formula-text escaping and no clear/overwrite of existing incompatible tabs.
Fix: classify transient versus permanent failures, isolate each batch/store, backoff and cap retention while keeping unresolved records. Add export/repair/retry-one actions, key rotation and explicit destination migration. Test duplicate retry after a server success/client timeout and multi-profile use. Deployed Apps Script was not exercised.

### A23 ? History numbers mix stores and UTC/local days (medium; code confirmed)
Evidence: temuRenderHistory calculates progress from Object.values(listedMap) across all stores before applying record-store filters. UTC date keys are displayed alongside local day/time labels. Export records and unconfirmed attempts are not the same as accepted/live listings.
Fix: explicit active-store/all-stores scope, one business timezone, separate attempted/accepted/draft/listed/failed counters, and structured backend result fields instead of parsing report strings.

### A24 ? Recovery can overwrite manually edited content (medium; code confirmed)
Evidence: appendToMasterSheet replaces title/images when score improves; reHuntMasterRow replaces them unconditionally when fresh values exist. Journals help replay some known previous values, but freshly scraped different content may not match the journal's old-value list. Repeated hunts of an already stored URL do not consistently record membership in the newest batch.
Fix: source facts and edited listing content separate; re-hunt updates source facts by default, offers an explicit reset for edited fields. Batch membership should support repeated hunts, not depend only on first insertion.

## Architecture and quality upgrades

- Replace the 16k-line sidepanel controller gradually with modules for product storage, sourcing, AI, Temu jobs and UI. Keep existing behavior and add integration checks before moving code.
- Consolidate appended CSS overrides into component rules and shared tokens; one action hierarchy and consistent sizes reduce repeated design regressions. Existing dark/light tokens and native details controls are useful foundations.
- Split status/errors into structured codes plus user-facing messages. Hidden catch blocks currently make failure diagnosis difficult.
- Restrict broad host access/content-script injection where practical. Some universal hunting features need optional site permissions; do not remove required access blindly. Debugger should remain limited to the explicit Auto Flow workflow.
- Public image hosting is an external dependency. Mark failed rehosting explicitly and block invalid/nonpublic main images; retry with status instead of silently dropping failed base64/blob/Flow images.
- Create versioned schema migrations and round-trip backup tests. Correct stale documentation and mismatched commit-version labels. Continue the user's requested same-version/no-ZIP workflow for small fixes.

## What is already a good foundation

- Marketplace-specific scrapers with fallback media/spec extraction, deduplication and capped arrays.
- Hunt best-result scoring, retry/recovery state and original-position tracking; these are useful mechanisms, though live selector coverage is still unproven.
- Image edit journal and field-patch helper; original-main-image preservation and undo are intentional workflows worth retaining.
- Shared title/content restriction rules, staged Content Studio drafts, explicit saves and serial AI requests.
- Background content-action allowlist, settings-key allowlist, CSP without inline scripts, fixed/durable sourcing connector and authenticated append.
- Same-version UI improvements and tested Categories/Settings/History/Recent Hunt controls.

None of these mechanisms makes the entire extension ?perfect?; correctness must be assessed per workflow and against live data.

## Recommended implementation order

1. Data protection and truthful export: A01/A02/A03/A05/A06/A21. First verify backup/restore, then fix selection and all unsafe writes, protect failed products and remove distributable secrets.
2. Listing correctness: A04/A07/A08/A09/A12/A13/A14/A15/A16. Unify source facts, listing overrides and export snapshot; strict preflight; store and template validation.
3. AI/drafts/jobs: A10/A11/A18/A19/A24. Appropriate budgets and stop handling, factual validation, safe attribute selection, immutable durable upload jobs and source/edited-field separation.
4. Daily workflow: A17/A20/A22/A23 plus component cleanup. Correct sorting/settings, unblock sync queues, truthful scoped history and consistent UI.

Each phase should be reviewable and tested before the next. No broad rewrite or new version/ZIP is required to start these fixes.

## Required live acceptance pass

Use a deliberate small test batch only after code fixes: two or three sourced products; one unticked; one known overweight; one manual Temu price override; one edited main image; one invalid required field. Validate workbook, exact store, per-product Temu outcome and sourcing row. Then reload the panel/profile and repeat a sync to verify persistence/deduplication. Verify a failed upload remains retryable. Separately verify Flow job/image identity, cancellation and recovery without parallel generation. Do not use production mass uploads as the first test.

Supporting local fixture evidence: tmp/audit-findings.json and tmp/audit-logic.cjs. UI/browser fixture scripts are also in tmp; they are diagnostic artifacts, not production test guarantees.

## Implementation update - 5 October 2026
Implemented safeguards for selected-only export, concurrent Library writes, source-price preservation, partial upload results, store detection, backup/reset wiring, embedded keys, stale templates, required export fields, price bounds, supplier identities, ISO sorting, AI budgets/fact checks, settings persistence, sourcing retries, local-day history and repeat-hunt membership. Interrupted uploads require explicit review before unlocking.

Validation: storage unit fixtures and headless browser regression fixtures passed. No live Temu upload, Google Sheets append or AI request was performed.

Remaining limits: upload result history/accepted marking still depends on the panel remaining open; the durable worker result survives for review. Draft correction handles visible rows only and cannot confirm publication. Backup media writes are not transactional with Chrome local storage. Fact validation is deterministic and cannot prove every semantic claim. Existing published API keys must be revoked by their owner; removing them from current source does not erase Git history. Per-product partial outcomes require reviewing Temu processing results before retries.
