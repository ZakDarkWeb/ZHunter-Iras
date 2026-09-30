# ZHunter PRO: Project Handoff (v9.11.0)

> **Nayi chat ke liye:** ye file aur zip AI ko de dein aur likhein:
> *"Ye mera ZHunter PRO Chrome extension hai. Pehle `PROJECT_HANDOFF.md`, `.agents/AGENTS.md` aur `CHANGELOG.md` parho, phir mera naya kaam suno."*
> Is file mein sab kuch hai: extension kya karta hai, code kahan hai, is session mein kya badla, aur kaam karne ka tareeqa.

Last updated: 30 Sep 2026 · Version: **9.11.0** (`manifest.json`)

---

## 1. User aur kaam karne ka tareeqa (zaroor parhein)

- **Zaban:** user Roman Urdu / Urdu-English mix mein baat karta hai. Jawab bhi Roman Urdu mein, simple alfaaz mein. Extension ke UI texts bhi zyada tar Roman Urdu mein hain.
- **Pehle sawal, phir code:** user ne kaha hai "jo question ho pehle poochna hai, phir upgrade". `.agents/AGENTS.md` ke rules bhi yahi kehte hain: pehle plan/sawal, "haan" ke baad code, minimal changes, chhota summary.
- **Sawal ka tareeqa:** multiple-choice sawal (2–4 options, "Recommended" wala pehle) user ko pasand hain. Har option ki ek line ki wazahat. Mushkil technical baat simple misaal se samjhayein.
- **Manual pasand hai:** user Google Flow mein images **khud (manual)** edit karna tez samajhta hai. Auto kabhi kabhi use hota hai. Naye features pehle manual workflow ko tez banayein.
- **Account safety:** Google Flow par "We noticed some unusual activity" error aata raha hai. Kabhi bhi bot-detection se bachne wale tricks (fingerprint spoofing waghera) na banayein. Speed ka matlab: zaya waits hatana, parallel generations nahi. Tez = zyada risk, ye user ko saaf batayein.
- **Design:** dark theme, cyan accent `#00E5FF`, purple accent `#8B5CF6` (AI / studio cheezon ke liye), rounded 8–10px, halki animations. User "professional look" chahta hai: circles/pills ki jagah saaf rounded-rect, segmented controls, har cheez theme se match kare.
- **Deliver:** har kaam ke baad poora folder zip karke (`ZHunter_v<version>.zip`) user ko bhejein. User `chrome://extensions` mein folder replace karke Reload karta hai.

---

## 2. Extension kya hai

Chrome MV3 side-panel extension. Amazon, Walmart, Sam's Club, Temu, Alibaba waghera se product data (title, price, images, video, specs) "hunt" karta hai, Library mein save karta hai, aur **Temu Seller Center** par bulk listing file bana kar auto-upload karta hai. Sath mein **AI Image Studio**: product images Google Flow (Nano Banana 2) / Gemini / ChatGPT se edit karwata hai, aur AI (Groq) se titles rewrite karta hai.

### Files

| File | Lines | Kaam |
|---|---|---|
| `manifest.json` | – | MV3, permissions (debugger, clipboardRead/Write, tabs, scripting…), content scripts |
| `sidepanel.html` | ~1770 | Poora UI: tabs Hunt / Bulk / Library / Settings, Temu Export modal, stepper, Edit Studio, mode chooser |
| `sidepanel.js` | ~14500 | Saari UI logic, bulk hunt pipeline, Temu export, AI Image Studio, Edit Studio |
| `style.css` | ~3850 | Sab styles. v9.11.0 ke naye styles **file ke aakhir mein** "v9.11.0" comments ke neeche hain |
| `background.js` | ~1900 | Service worker: storage, settings (`PUBLIC_SETTING_KEYS` allowlist!), image fetch, CDP click, Temu upload |
| `content.js` | ~5300 | Har page par scraper (`SCRAPE_PAGE`, `PING`) |
| `flow_automation.js` | ~870 | flow.google.com par: auto job runner + manual "prompt box mein images lagao" |
| `gemini_automation.js`, `gpt_automation.js` | ~200 | Gemini / ChatGPT par image + prompt daalna |
| `temu_categories.js` | ~2750 | Temu category catalog |
| `lib/` | – | jszip, xlsx-js-style, mux-mp4 |
| `CHANGELOG.md` | – | Har version ki tafseel (Roman Urdu) |
| `.agents/AGENTS.md` | – | AI agent ke rules (plan pehle, minimal changes) |

### Zaroori concepts

- **Settings save:** `msg({action:'UPDATE_SETTINGS', settings:{key:val}})` → `background.js` → `sanitizeSettingsPatch`. **Naya setting key `PUBLIC_SETTING_KEYS` mein add na ho to save nahi hota** (isi wajah se `bulkAutoRetry` pehle save nahi hoti thi).
- Side-panel settings: HTML mein `data-setting="key"` wala input/select `#tab-settings` ke andar ho to `initSettingsPanel()` khud sync/save karta hai.
- **Product rows** kai jagah hote hain (Library `MasterUIState.allRows`, `BulkState.results`, `TemuSheetRows`, stepper/studio queue). Image badalne ke liye hamesha `replaceProductImage(productId, idx, newUrl, expectedUrl)` use karein, aur `_productRowsById()` sab copies dhoondta hai.
- Flow ki images `flow-content.google` signed URLs hoti hain jo expire hoti hain → `FETCH_FLOW_IMAGE` (base64) → background mein `uploadImageToPublicHost()` (freeimage.host) se public link.
- Temu Export modal: `#temuModal`, tabs `data-ttab` / panes `data-tpane` (upload, settings, categories, history). Store/template: `temuStores()`, `temuActiveStoreName()`, `temuUpdateTplStatus()`.

---

## 3. Is session (v9.10.2 → v9.11.0) mein kya kya badla

### 3.1 Google Flow auto: tez kiya
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

---

## 4. Test kaise kiya / kya test nahi hua

- Syntax: `node --check sidepanel.js flow_automation.js background.js`.
- UI: Playwright + Chromium mein `sidepanel.html` ko `file://` se khol kar, `window.chrome` stub karke, screenshots (Edit Studio, Temu tabs, header). Extension ko headless mein asli load karna kaam nahi kiya (service worker nahi mila).
- **Asli Google Flow par test NAHI hua** (login chahiye): Paste in Flow, Flow se lo, Enter-first generate, clipboard permission. **Bulk hunt speed** asli tabs par test nahi hui. Agar user in mein masla bataye to pehle yahi check karein.
- Flow DOM selectors (`Q` object, `flow_automation.js`) Sep 2026 ke real DOM se hain. Flow UI badle to yahan update karein.

## 5. Maaloom limitations / aage ke ideas

- Browser clipboard mein ek waqt **ek hi image**. Isliye "sab images ek sath copy" nahi, "Paste in Flow" button hai.
- Flow mein 2 generations ek sath (parallel auto) nahi banaya, kyunke result ko sahi product se jorna pakka nahi.
- Auto Flow mein Enter kaam na kare to CDP click hota hai aur "debugging" patti thori der aati hai.
- Ideas: Studio mein price edit; pack ke sath price × N; Flow mein Agent mode khud off karna bina CDP ke.

## 6. Naya kaam shuru karne ka checklist (AI ke liye)

1. `unzip` karein, ye file + `.agents/AGENTS.md` + `CHANGELOG.md` parhein.
2. User ki baat samjhein. Screenshot ho to dekhein. Zaroori sawal multiple-choice mein poochein.
3. `grep` se exact jagah dhoondein, sirf woh hissa parhein aur badlein.
4. `node --check` chalayein, UI badla ho to screenshot se check karein.
5. `CHANGELOG.md` aur **is file** (section 3) mein naya kaam add karein. Version badlein to `manifest.json` bhi.
6. Folder zip karein aur bhejein. Chhota Roman Urdu summary: kya badla, kya test nahi hua.
