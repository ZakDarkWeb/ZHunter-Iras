# ZHunter Iras: Project Handoff (v9.12.13)

> **Nayi chat ke liye (user):** nayi chat mein ye file paste/attach karein, aur extension ka folder connect karein (ya folder ka zip attach karein). Phir likhein:
> *"Ye mera ZHunter Iras Chrome extension hai. Pehle `PROJECT_HANDOFF.md`, `.agents/AGENTS.md` aur `CHANGELOG.md` parho, phir mera naya kaam suno."*
>
> **Nayi AI ke liye:** ye poori file parhein, phir section 7 ki checklist follow karein. Folder connect na ho to user se connect karwayein (ya zip mangwayein). Andaze par kaam na karein.

Last updated: 04 Oct 2026 · Version: **9.12.13** (`manifest.json`) · Naam: **ZHunter Iras** (v9.12.2 tak "ZHunter PRO")
Folder (user ke computer par): `C:\Users\Basit\Downloads\06_Extensions_&_Code_Projects\Temu Working\05_ZHunter-Catalog\ZHunter Iras - Codex`
Temu template sample: `C:\Users\Basit\Downloads\Temu\TEMU_GENERAL_UPLOAD_TEMPLATE_*.xlsx`

---

## 1. User kaun hai aur kaise kaam karna hai (zaroor parhein)

### Business
- Temu seller, **2-step dropshipping**: products Amazon / Walmart / Sam's Club (aur Temu pages) se hunt hote hain (title, images, price), Temu Seller Center par list hote hain. Order aaye to source se khareed kar ship.
- **Kai Temu stores** (Charmhouse, HQ TWO, HQ- 4 SHOP, Chroma Haus, Cloverhill, aur bhi). Extension mein store ka naam Temu Seller Center ke top-right mall name se **bilkul same** hona chahiye.
- **Budget nahi:** koi paid API / Temu API / paid tool nahi. Sab free aur local. (Groq free keys title rewrite ke liye.)
- 30–100 listings/day. ~8 lb se bhari product source nahi hota.
- **Har color = alag Temu listing** (single variant), multi-variant listing nahi. Variation value baad mein Temu par edit nahi hoti, isliye numbers/weights variation mein nahi.

### Baat-cheet
- Small updates par version bump, naya ZIP, ya naya release folder na banayein; existing files aur version update karein. Version/release packaging sirf user ke kehne par.
- **Zaban:** Roman Urdu (Urdu, English letters mein), simple aur chhota. Extension UI texts bhi zyada tar Roman Urdu.
- **User coder nahi.** Code chat mein na dikhayein, code edit karne ko na kahein. **Changed files seedha connected folder mein likhein**, phir bolein: `chrome://extensions` → Reload.
- **Pehle plan, phir code** (`.agents/AGENTS.md`): kya badlega, kaunsi file, kyun → user "haan/yes" kahe tab code. Minimal changes, aakhir mein chhota summary (kya badla, kya test nahi hua).
- **Sawal:** multiple-choice (2–4 options, "Recommended" pehle, har option ki ek line wazahat). Ek waqt mein kam sawal.
- **Andaza nahi:** Temu page (selectors, layout) se juri koi bhi fix → pehle user se **DOM harvest (HTML) / screenshot / Activity report lines** maangein. User khushi se deta hai. Blind patching se ghante zaya huay hain.
- User ne kaha "har cheez perfect ho": ship karne se pehle khud test karein (section 6), aur saaf batayein kya asli Temu/Flow par test nahi hua.
- **Manual pasand:** Google Flow mein images user khud (manual) edit karna tez samajhta hai. Naye features pehle manual workflow tez karein.
- **Account safety:** Flow par "unusual activity" error aata raha. Bot-detection se bachne wale tricks kabhi nahi. Ek waqt mein ek generation. **Exception (v9.12.6, user ne khud chuna):** unusual activity par 60s ruk kar naya project, max 2 dafa per run, phir manual — is limit ko barhana/hatana nahi jab tak user khud na kahe.
- **Design:** dark theme, cyan `#00E5FF`, purple `#8B5CF6` (AI/studio), rounded 8–10px, halki animations, professional (rounded-rect, segmented controls; pills/circles kam). CSS variables `:root` mein (`--accent`, `--ok`, `--surface-2`, `--line-2`, `--ink-2`… light theme bhi hai) — naye styles yahi variables use karein, `style.css` ke aakhir mein version comment ke saath.
- **Groq API keys `sidepanel.js` mein hain** — user ne kaha theek hai (sirf apne use ke liye, share nahi karta).

---

## 2. Extension kya hai

Chrome MV3 side-panel extension. Amazon, Walmart, Sam's Club, Temu, Alibaba waghera se product data (title, price, images, video, bullets, brand, weight) "hunt" karta hai, Library mein save karta hai, aur **Temu Seller Center** par general template XLSX bana kar auto-upload karta hai. Sath mein **AI Image Studio** (Google Flow / Gemini / ChatGPT se image edit) aur **AI Title Optimizer** (Groq).

### Files

| File | Lines | Kaam |
|---|---|---|
| `manifest.json` | – | MV3, name "ZHunter Iras", version, permissions, content scripts |
| `sidepanel.html` | ~1840 | Poora UI: tabs Hunt / Bulk / Library / Settings, Temu Export modal, bulk progress popup, Edit Studio, mode chooser |
| `sidepanel.js` | ~15200 | Saari UI logic, bulk hunt, Library, Temu export (module `const TEMU_DEFAULT_CONFIG` se neeche), AI Image Studio, Edit Studio |
| `text_studio.js` | ~350 | Bulk Content Studio: titles, bullet points, description; staged drafts, manual preview, field-only saves and persistent `zhTextEdits` recovery |
| `title_optimizer_rules.js` | ~180 | Shared title structure and contextual claim rules used by all AI title/copy paths and export cleaning |
| `style.css` | ~3920 | Sab styles; naye versions ke styles file ke aakhir mein |
| `background.js` | ~1900 | Service worker: storage, settings (`PUBLIC_SETTING_KEYS` allowlist!), image fetch, CDP click, Temu upload (`temuBgAutoUpload`) |
| `content.js` | ~5300 | Har page par scraper (`SCRAPE_PAGE`, `PING`, `extractProductDetails`) + Temu page automation (`temuPageAutoUpload`, `TEMU_FIX_DRAFTS`) |
| `flow_automation.js` | ~870 | flow.google.com: auto job runner + manual "prompt box mein images lagao" |
| `gemini_automation.js`, `gpt_automation.js` | ~200 | Gemini / ChatGPT par image + prompt |
| `temu_categories.js` | ~2750 | 172 official Temu categories (`TEMU_OFFICIAL_CATEGORIES`: name, category_keyword, `full_path`, match, weight/dims) |
| `title_optimizer_rules.js` | – | Title optimizer rules |
| `lib/` | – | jszip, xlsx-js-style, mux-mp4 |
| `CHANGELOG.md` | – | Har version (Roman Urdu) — har kaam ke baad upar naya entry |
| `.agents/AGENTS.md` | – | AI agent rules (plan pehle, minimal changes) |

### Roz ka flow (user)
1. Source product pages tabs mein kholta hai → **Bulk → Hunt all open tabs** (progress popup → "Hunt complete" popup: Temu upload / Master ZIP / Sheet / PDF / Images ZIP).
2. **Temu Export** modal (tabs Upload / Settings / Categories / History). Source: Last hunt / Library (selected) / Import sheet. Review list: har product card (checkbox upload ke liye, ✨ image edit ke liye, title/price edit, ⚡ AI title). Title Optimizer (Groq) aur AI Image Studio (Flow) yahin.
3. **Export + Upload to Temu** → background tab `seller.temu.com/upload-goods-multiple.html` → **general template** section mein file → Upload ID + "Processing data %" khatam hone tak wait → focus wapas user ke tab par → products store ki **listed history** mein (sirf confirmed upload ke baad).
4. Kuch listings drafts ban jati hain ("Complete product details") → **Fix drafts** button.

### Temu business rules (per store, Settings tab)
- Price: source × **Price ×** (default 5) → Min/Max clamp (80 / 999) → x.99; List price = base × 1.25. **v9.12:** Department pricing table + category ka apna Price × (order: Category → Department → Store).
- Quantity random 250–500. Weight: category profile → title se ("24 oz" → 1.7 lb, +10% packaging) → scraped → default; > Max (8 lb) = skip.
- Variations: real color → `Color: Black`; multipack words → `Style: Multipack`; single → `Style: 1 Pack`; warna fallback list (Standard, Special, New, Classic).
- Brand: store ke Temu brand list se match, warna khaali (`NO_BRAND_MATCH`). Title cleaner: "Remove words" list.
- SKU `CH-<sourceId>-<Variation>`, listing id `CH-<sourceId>`. Shipping: Main Shipping Template, 2 Days, I will ship this item myself, United States.
- **v9.12:** description + 6 bullets (section 3.7).

### Temu template (general, Sept/Oct 2026)
Sheet `Template`, **row 3 = keys**, data row 5 se. Columns: `goods_id, sku_id, status, details` (result), `listing_id, seller_sku, item_name, category, reference_id, reference_link, brand, trademark, Variation_type_1, Variation_Variants_1, Variation_type_2, Variation_Variants_2, item_note ×6` (bullet, max 700 each), `item_description` (max 2000), `Keyword_attributes, main_image_url, other_image_url ×9, map_price, list_price, market_price, quantity, SKU_type…, item_length, item_volume_unit, item_width, item_height, item_weight, item_weight_unit, external_product_id_type/id, shipping_template, handling_time, fulfillment_channel, origin_country…`. Fill: `temuFillTemplate()` (key → column, repeated keys by index).

### Temu page facts (upload-goods-multiple.html, DOM se seekha)
- Ek page par **do uploader**: categories section (`ul.TLE_box_123 …`) aur **general** section (`.importUploadBoxWrap`). File hamesha **general** wale mein (galat wale mein = "Number of records processed: 0").
- Upload history row: 15-digit Upload ID. "Processing data (NN%)" khatam hone tak wait. Temu ki result files mein failure reasons nahi hote.
- Drafts page `products-excel-multiple-edit.html`: form items `[data-testid=beast-core-form-item]`, selects `[data-testid=beast-core-select]`. Fix drafts ka dropdown selector **live test nahi hua** — user DOM bhejne wala hai.

### Zaroori code concepts
- **Settings save:** `msg({action:'UPDATE_SETTINGS', settings:{key:val}})` → background `sanitizeSettingsPatch`. Naya global setting key `PUBLIC_SETTING_KEYS` mein add karna zaroori. Temu ki per-store settings `temuStores[store].config` mein (`temuGetCfg()` / `temuSaveCfg(cfg)` → `=== true` check).
- Side-panel settings: `data-setting="key"` input `#tab-settings` mein → `initSettingsPanel()` khud save.
- **Product rows kai jagah:** Library storage (`getMasterRows()` / `setMasterRows()`), `MasterUIState.allRows` (Library ki in-memory copy — **purani/khaali ho sakti hai**), `BulkState.results` (last hunt), `TemuSheetRows`, Studio items. `_productRowsById(id)` sab copies dhoondta hai. Image badalne ke liye `replaceProductImage(...)`. **Title save ke liye `temuSaveTitles([{id,url,title}])`** (v9.12.3). `setMasterRows(MasterUIState.allRows)` se Library overwrite/khaali hone ka khatra hai.
- Temu modal: `#temuModal`, tabs `data-ttab` / panes `data-tpane`; `openTemuModal()` har open par init functions chalata hai — listeners sirf ek dafa lagayein (`_done` flag pattern).
- Toasts modal ke peeche chhup sakte hain → results modal ke andar (`#temuReport` Activity) dikhayein.
- Flow images `flow-content.google` signed URLs → `FETCH_FLOW_IMAGE` (base64) → `uploadImageToPublicHost()` (freeimage.host).

---

## 3. Version history (detail `CHANGELOG.md` mein)

Purana (v8.x–v9.10): Temu export, categories editor, auto-upload (background worker), multi-store, listed guard, smart variation/weight, Fix drafts, bulk popups, Flow automation, hunt "koi link skip nahi" + retry.

### 3.1 v9.11.0 — Google Flow auto: tez kiya
**Masla:** "Edit in Flow" auto bohat slow tha: title paste ke baad lamba gap, replace aur agli image mein der.
**Wajah:** Generate par pehle page-click hota tha jo Flow ignore karta hai (~8s zaya), result 4s poll, replace se pehle public upload ka intezaar, har image ke beech 4–9s.
**Kya kiya (`flow_automation.js`, `sidepanel.js`):**
- Generate attempts order: **Enter key (2.5s) → CDP click → page click**. Enter chal jaye to "debugging this browser" patti nahi aati.
- Result scan 1500ms → 700ms, chip-ready 500 → 250ms, next job 800 → 300ms. Side-panel poller 4s → 1.5s.
- `flowPrefetchImage()` + `FlowB64Cache`: agli image current generate ke dauran download.
- `temuStepApplyManualImage()`: pehle local base64 (`FETCH_FLOW_IMAGE`) se foran replace, public link background mein.
- **Speed setting** `#temuAiImgSpeedSel` (Safe 4–9s / Normal 2–4s / Fast 1–2s), storage key `zhunterFlowSpeed`, `FLOW_SPEEDS`, `flowSpeedKey()`. Hamesha **ek waqt mein ek generation** (warna result galat product par lag sakta hai). "unusual activity" error par khud **Safe** ho jata hai (`onFlowStatus`).
- Stepper queue item ab apna `prompt` rakh sakta hai; `temuStartBulkImageEdit({prompt, mainOnly})`.

### 3.2 Edit Studio (manual), user ka main workflow
"Edit Images" dabane par **mode chooser** `#zhModeModal`: **Manual studio** (default) ya **Auto** (purana stepper). Code: `zhChooseEditMode()`, `zhStudioOpen()`, `zhStudioRender()`; state `ZhStudio`; modal `#zhStudioModal`, body `#zhStudioBody`; CSS classes `zs-*`.

Studio mein ek waqt **1 product** (‹ Prev / Next ›, ← → keys, progress bar):
- **Title** textarea (x/180) + **✨ AI rewrite** (`zsAiRewriteTitle`: wahi Groq optimizer `buildProductAiPrompt` + `getTemuOptimizerInstruction`; pack prefix bacha rehta hai).
- **Pack size** segmented: 1 Single · 2× · 3× · 4× · 6× · 8× · 10× · 12× (`ZS_PACKS`). Title ke **aage** `"2 Pack - Title"` lagta hai (`packTitle`, `packFromTitle`, `PACK_PREFIX_RE`). Single = prefix hatao.
- **Image prompt / Pack prompt** (editable) + Copy. Pack prompt simple: `packImagePrompt(n)` = "Create a N pack of this product…".
- **Images:** sirf wahi jo edit ke liye select thin (`temuImgTargetIndices`), "+ Sab images" toggle. Har image par:
  - original, **📋 Copy** (`zhCopyImage`: PNG clipboard mein),
  - result slot (click = paste),
  - **📥 Paste** (`zsReadClipboardImage`: side panel clipboard, warna Flow tab ke through),
  - **⬇ Flow se lo** (`flowLatestGenerated`: Flow ki sab se nayi generated image jo is studio mein pehle use na hui; `ZhStudio.usedFlowIds`),
  - ↩ Undo.
  - Ctrl+V bhi selected slot mein jata hai. Replace ke baad agla khaali slot khud select hota hai.
- **⚡ Paste in Flow:** tick ki hui images (+ prompt agar "+ prompt" on, key `zhStudioWithPrompt`) Flow ke **prompt box mein attach**. Generate user khud dabata hai. Flow side: message `ZH_FLOW_MANUAL_ATTACH` → `manualAttach()` in `flow_automation.js`. **Manual mode kabhi CDP/debugger use nahi karta.** Agent mode on ho to sirf error deta hai.
- Drag-and-drop Flow se kaam nahi karta (Flow images drag nahi hoti). Isliye Paste / Flow se lo.
- **📦 Make Pack** (image bar, `temuMakePack`): selected products ke title ke aage "N Pack - " lagata hai, phir **Edit Studio (manual)** kholta hai. Auto nahi chalata.
- Purana "📋 Manual Board" hata diya, studio ne us ki jagah le li.

### 3.3 Bulk hunt: tez
**Masla:** background tabs reload mein bohat time.
**Wajah:** Chrome soye (discarded) tabs ko reload kar ke sirf 2s wait → scrape fail → phir reload → 3–4 reloads per tab.
**Kya kiya (`sidepanel.js` `processSmartQueue`, `scrapeOneTab`, `startBulkHunt`):**
- `huntWaitComplete(tabId)`: asli load complete tak wait (max 25s) + `huntSettleMs(url)` (Walmart/Sam's/Amazon 900ms, baaki 400ms). Har reload ke baad yahi.
- Hunt se pehle har tab check: loaded tabs pehle aur foran scrape. Soye/loading tabs ("heavy") ek sath sirf `huntWakeLimit()` tak.
- **Setting:** Settings → Bulk hunt → "Tabs ek sath hunt" (`data-setting="bulkParallelTabs"`, 1/2/3/4/6/8/12, default **3**). `bulkParallelTabs` + `bulkAutoRetry` ab `PUBLIC_SETTING_KEYS` mein.
- Hunt ke dauran `chrome.tabs.update(id,{autoDiscardable:false})`, khatam par wapis `true`.

### 3.4 Temu Export UI (professional)
- **Setup card** (`#temuSetupCard`): store + template dono hon to class `is-ready` → sirf ek patti `#temuSetupCompact` (store naam, template ✓, **Test / Change**). Change = class `expanded`. Logic `temuUpdateTplStatus()` ke aakhir mein.
- **Products source:** dropdown ki jagah segmented `#temuSrcSeg` (Last hunt / Library / Import sheet). Asli `<select id="temuSource">` chhupa hua mojood hai (saari purani logic us par chalti hai). Sync `temuSyncSrcSeg()` (`temuUpdateSrcInfo` se call). Library-selected / sheet ka naam `#temuSrcNote`.
- Upload tab se **Price multiplier hataya** (Settings mein pehle se hai). Hidden `#tgPx` input rakha hai kyunke code parhta hai. Kone mein chip "Price × N" (`#temuSrcPxChip`) Settings kholta hai.
- **Title Optimizer** aur **AI Image Studio** collapsible (`.temu-coll-tgl[data-coll]`, body `[data-coll-body]`, class `coll-open`). Default band, haalat `zhTemuCollapse` storage mein.
- **Settings auto-save:** settings pane mein change → 800ms baad `#tgSaveBtn` click. Note: save `TemuLast=null` karta hai (as-is Temu file reset), jo pehle bhi hota tha.
- Package Specs: 4 columns + Max Skip alag line. History/Categories search icon fix, empty states, department pills wrap.
- Bulk tab ka neeche wala **"Temu" button hataya** (header ka "Temu Export" kaafi hai).
- Header: Temu Export button rounded-rect (pill nahi), Bulk tab count badge cyan theme (pehle yellow/olive).

### 3.5 Image bar mein naye controls
`#temuAiImgSpeedSel` (Speed), `#temuAiImgPackSel` (Pack), `#temuMakePackBtn`.

### 3.6 AI Title Optimizer & Groq Keys Fix (v9.11.3)
- **Settings mein "🧪 Test Keys"**: live verify karta hai kaunsi key active (200 OK) hai aur kaunsi invalid (401). "🗑️ Remove Dead Keys" button se 1-click cleanup.
- **Fast 1-call title rewrite**: double-LLM review judge hata diya jiski wajah se titles reject ho rahe the aur quota khatam hota tha. Direct, high-quality prompt se fast rewrite.
- **Title cleaner**: 120-170 char rules par crash nahi hota, 180 limit ke mutabiq graceful trimming.
- **Pacing**: 500ms pacing delay between products taake Groq rate limit na lage. Fallback to bundled working keys if user keys fail.

### 3.7 v9.12.0 / v9.12.1 — Description/Bullets, Department pricing
- **Description/bullets:** `temuBuildCopy(r, title, cfg, brandOk)` (+ `temuCleanText`, `temuScrubText`, `temuShorten`, `TEMU_DESC_AVOID_DEFAULT`, `TEMU_PLATFORM_WORDS`, `TEMU_JUNK_SENT_RE`) above `TEMU_DEFAULT_CONFIG`; `temuFillTemplate` puts `item_note` ×6 + `item_description`. Cfg: `fill_description`, `desc_avoid_words` (UI `#tgDescOn`, `#tgAvoidWords`, `#tgAvoidReset`).
- **Pricing:** `temuDeptOf(prof)` (first part of `full_path`), `temuDepartments`, `temuProfileFor(title,cfg)`, `temuPriceRule(cfg,prof)`, `temuPrice(src,cfg,prof)` → `[base,list,rule]`. Cfg `dept_pricing {dept:{px,min,max}}` (table `#tgDeptTable`, `temuRenderDeptTable` / `temuReadDeptTable`, doesn't rebuild while focused); profile `price_multiplier`, `price_min` (`#tcPx`, `#tcMinPx`). `temuApplyLiveCopyPrice(cfg)` = live-read in export + save.
- **Auto-pilot (v9.12.0) user ke live test mein kaam nahi kiya → v9.12.1 mein poora hataya.** Baad mein dobara banana hai: pehle user se poochein kya hua tha (screenshot / Activity lines), phir banayein. Idea tha: Hunt complete popup mein ticks (AI title / Edit Studio / Upload) + Start; Studio mein "Done → Upload".
- Tested: Playwright (stubbed chrome) — real Temu template filled (item_note/item_description), dept price, settings autosave. **Asli Temu par test nahi hua.**

### 3.8 v9.12.3 — AI title rewrite fix
- `temuAiBulkRewrite` rewritten: `TemuRewriteBusy` guard, per-product old→new report + verify, `temuMarkCardUpdated(card, old, new, same)` (badge `.temu-rv-upd-tag`, `.temu-rv-old-title` with `.temu-rv-new-line` / `.temu-rv-old-line`, classes `rv-updated` / `rv-same`).
- `temuSaveTitles([{id,url,title}])` → updates in-memory copies, Library storage (fresh read, by id then url), re-renders Library, verifies via `temuGetQueuedRows()`; returns `{inFile, inLib, savedLib}`; sets `TemuLast = null`. **Rule: title saves must never `setMasterRows(MasterUIState.allRows)`** (stale/empty copy can wipe Library).
- `temuInitReviewToggle` binds once (`_done` flag) — openTemuModal calls it on every open.
- Not fixed (other places still save `MasterUIState.allRows` wholesale: studio close, image replace, price edit…) — same risk, fix when touched.

### 3.9 v9.12.2 — Naya naam
- "ZHunter PRO" → **"ZHunter Iras"**: `manifest.json` (name, default_title, command), side panel header badge "IRAS", `<title>`, export files (PDF/Excel/HTML catalog). Data/settings same (wahi folder, wahi extension ID).

### 3.10 v9.12.4 — Bulk hunt: recovery ke baad tabs band, naya hunt popup
- `huntCloseTab(t)` (sirf `BulkState.AUTO_CLOSE_TABS` ON): pehla pass, `huntRecoveryRounds` (har link complete hote hi), `huntManualRetry`. `huntEnsureTab` dobara khole tab par `t._reopened` lagata hai → `huntCloseFinishedTabs(items)` aakhir mein complete + reopened tabs band karta hai; user ke apne incomplete tabs khule rehte hain. `BulkState.tabsClosed` count. Queue mode: `huntRecoveryRounds` ab `return` ki jagah `break` → worker tab hamesha band.
- Popup: `#bpRecover` card (`bpRecoverShow/Step/Tick/Hide`, round dots, "Link k/n", bar, theek hue/baqi). Recovery phase mein ring = complete links (`updateBulkProgressBar` mein `recovering`). `bpPinRowsTop` retry rows upar; filter `#bpFilter` (All/Complete/Baqi, `bpSetFilter`, `bpUpdateFilterCounts`); `.tab-closed` row marker.
- Result: `#bpListWrap` finish par result screen mein move (`acts.before(lw)`), open par wapas `#bpsCurrent` ke baad. `#bulkResultMeta` = coverage chips ("✓ hunted/total · N skip · N tabs band"). Tiles click → list filter; `.zero` tiles dim; SVG check draw; `bpConfetti()`. **User rule: koi link skip nahi — "Skip → Results" button nahi banana.**

### 3.11 v9.12.5 — AI title rewrite ke baad list chhoti
- `temuMarkCardUpdated` ab card **nahi kholta**; "✨ Updated ▾" tag click → `.temu-rv-diff` (Naya/Pehle) card ke neeche. Snippet `title` = dono titles.
- `temuShowTitleChanges(changes, failures)` → `#temuTitleChanges` panel list ke upar (Compare ▾, apna scroll, row click → `temuJumpToCard(id)`). Activity ab khud nahi khulti.
- `.temu-review-list` max-height ~62vh + apna scroll; sticky `.temu-rv-tools` ("✨ Sirf updated" = `.only-upd`, "▴ Sab band"). Cards `flex-shrink:0` zaroori (warna dab jate hain).

### 3.12 v9.12.6 / v9.12.7 — Flow "unusual activity": auto naya project + manual row
- `onFlowStatus`: unusual activity + stepper flow → `flowAutoNewProject()`: 60s countdown (`FLOW_NP_WAIT_S`), `flowGoHomeForNewProject()` (Flow tab URL `/project/` se pehle wala hissa = home), phir `temuStepSendCurrent()` → content script khud "+ New project" dabata hai. Max `FLOW_NP_MAX = 2` per run (`TemuImgStepper.npCount`), phir ruk kar manual. `TemuImgStepper.npToken` countdown token — `temuStepCancelActiveJob()` (Skip/Send Again/Close/manual) countdown rokta hai. User ne yahi chuna: "ruk kar, limit ke saath".
- Stepper `#temuStepManualRow`: 📋 Image (`zhCopyImage`), 📝 Prompt, ⚡ Paste in Flow (`ZH_FLOW_MANUAL_ATTACH`, auto job cancel), ✋ Manual Studio (`zhStudioOpen(startProductId)` isi product se). `.attn` = amber chamak. Handler: `temuStepManualAction(act)`.
- v9.12.7: `flow_automation.js` runJob catch — `JobError` → `log`, sirf unexpected → `warn` (Chrome Errors page par ghalat alarm band).
- **Asli Flow par naya-project flow abhi test nahi hua** — user se confirm karna hai.

### 3.13 v9.12.8 — Edit hui images kabhi purani na hon
- Bug: auto edit mein 5 images badlin, error ke baad purani ho gayin. Wajah: `replaceProductImage` stale `MasterUIState.allRows` poori save karta tha + do saves ek saath (background Temu link upload + agla step) lost update.
- Fix: `zhLibPatch(fn)` — serialized fresh read-modify-write; `replaceProductImage` ab sirf usi product/image ko patch karta hai (by id, phir url). **`setMasterRows(MasterUIState.allRows)` yahan se hata diya.**
- Journal `zhImgEdits` (storage): `zhEditsRecord(id, idx, old, new, url)` (orig yaad, `via` = beech ke URLs, undo → delete, 30 din / 600 cap); `zhApplyImgEdits(rows)` — `temuGetQueuedRows()` har source par lagata hai (review, export, agla Edit Images). Stepper (`temuStepApplyManualImage`) aur background public-link swap bhi record karte hain.
- Tested: Playwright race test (3 saves ek saath → teeno bache; memory saaf → journal se wapas; undo → original). Pending idea (user se poochna): dobara "Edit Images" par pehle se edit hui images khud skip.

---

## 4. Pending kaam (user ki priority)

1. **Fix Drafts (generic)** — user agla kaam yahi chahta hai aur **saare pages ka DOM bhejega**. DOM aane ke baad: har khaali required dropdown category profile / defaults se bharna, dropdown option selector live DOM se. Pehle plan dikhayein.
2. **Auto-pilot (kam clicks)** — user ko sab se zyada pasand, lekin v9.12.0 wala live kaam nahi kiya, hata diya. Dobara banane se pehle user se poochein kya hua tha (screenshot / Activity lines). User ka matlab: hunt → (AI title, images edit ka mauqa) → Temu file → upload, bina baar baar click; edit ke options wahi jo Temu window mein hain.
3. Baad mein (user ne abhi mana kiya): stock/price checker for listed products, har store mein duplicate check.
4. Technical: baqi jagah bhi `setMasterRows(MasterUIState.allRows)` hai (studio close, price edit, delete…) → Library overwrite ka khatra; jab in ko chhooein to `zhLibPatch` / `temuSaveTitles` jaisa safe save banayein. (Image replace v9.12.8 mein theek.)
5. Purane ideas: Studio mein price edit; pack ke sath price × N; Flow Agent mode bina CDP ke off.
6. Optional (user se poochein): dobara "Edit Images" par `zhImgEdits` wali images khud skip.
7. Live confirm baqi: Flow auto naya project (v9.12.6), recovery tab close (v9.12.4).

## 5. Maaloom limitations

- Browser clipboard mein ek waqt ek image → "Paste in Flow" button.
- Flow mein parallel generations nahi (result galat product par lag sakta hai).
- Auto Flow mein Enter na chale to CDP click → "debugging" patti thori der.
- Extension headless Chromium mein asli load nahi hota (service worker) → tests `sidepanel.html` ko stub ke saath chalate hain.

## 6. Test kaise karein

- Syntax: `node --check sidepanel.js background.js content.js flow_automation.js`.
- **UI/logic test:** Playwright + Chromium, `sidepanel.html` ko `file://` se kholein, `addInitScript` se `window.chrome` stub (runtime.sendMessage: `GET_DATA` → `{success:true, data:{settings}}`, `UPDATE_SETTINGS` → success, `TEMU_AUTO_UPLOAD` → `{success:true, confirmed:true, report:[…'Completed: N records processed, N added, 0 errors']}`; in-memory `storage.local`; tabs/scripting stubs). Folder ki `lib/` bhi saath copy karein (warna `XLSX is not defined`).
- Page globals (`State`, `BulkState`, `TemuLibPick`, `callGroqAPI` …) `page.evaluate` se set/override ho jate hain. Template: `State.data.settings.temuStores = {S:{templateB64}}`, `temuActiveStore='S'`.
- Export check: `TEMU_AUTO_UPLOAD` message ka `b64` file mein likh kar openpyxl se row 5 parhein.
- **Asli Temu / Google Flow / Groq par test nahi hota** — user ko saaf batayein ke pehli dafa 2–3 products se check kare.

## 7. Naya kaam shuru karne ki checklist (AI ke liye)

1. Ye file + `.agents/AGENTS.md` + `CHANGELOG.md` parhein. Folder connected na ho to connect karwayein (ya zip).
2. User ki baat samjhein; screenshot ho to dekhein. Temu page wala kaam → pehle DOM/screenshot maangein. Zaroori sawal multiple-choice mein.
3. **Plan dikhayein** (kya, kaunsi files, kyun) → "haan" ka intezaar.
4. Files likhne se pehle folder ki **current** files parhein (mtime/md5 check) — koi aur editor (Codex) bhi kabhi kabhi isi folder mein kaam karta hai; unki changes mitayein nahi.
5. `grep` se jagah dhoondein, sirf woh hissa badlein. `node --check` + Playwright test + screenshot.
6. Version badlein (`manifest.json`), `CHANGELOG.md` mein upar entry, **is file** ke section 3/4 update.
7. Files seedha folder mein likhein (chat mein code nahi). Chhota Roman Urdu summary: kya badla, kaise check kiya, kya asli Temu par test nahi hua, Reload ka bolein.
