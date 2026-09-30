# ZHunter PRO — CHANGELOG

## v9.11.0 (2026-09-29) — Manual Board, Pack, tez auto Flow
- **✨ Edit Studio (manual):** "Edit Images" par pehle choose: Manual studio / Auto. Studio mein ek waqt ek product (‹ Prev / Next ›, ← → keys, progress bar): title edit (x/180), Pack chips Single·2·3·4·5·6·8·10·12 → title ke aage "2 Pack - ", Image prompt / Pack prompt (editable) + Copy. Sirf selected images (+ "Sab images" toggle); har image: 📋 Copy, result slot (Ctrl+V = selected slot, agla slot khud select), ⬇ Flow se lo (Flow ki nayi image, jo pehle use na hui ho), ↩ Undo.
- **⚡ Paste in Flow:** tick ki hui images (+ prompt, optional) Flow ke prompt box mein lag jati hain — generate aap khud dabate hain.
- **📦 Make Pack:** title ke aage "N Pack - ", phir **Edit Studio (manual)** khulta hai — auto nahi chalta, debugger banner nahi aata.
- Studio: **✨ AI rewrite** title button (pack prefix aage hi rehta hai); Pack size naya segmented selector (1 · 2× · 3× · 4× · 6× · 8× · 10× · 12×).
- Manual "Paste in Flow" kabhi debugger (CDP) use nahi karta. Auto mein Generate ke liye pehle Enter try hota hai; Flow na maane tab hi CDP click (banner sirf tab).
- **Speed setting (Safe / Normal / Fast):** sirf images ke beech ka gap badalta hai; ek waqt mein ek hi generation. "Unusual activity" aaye to khud Safe par aa jata hai.
- **Tez auto:** Generate par pehle asli (CDP) click (pehle ~8s zaya hote the), result 0.7s / side panel 1.5s scan, agli image generate ke dauran pehle se download, replace foran local copy se (Temu link background mein).

## v9.10.1 (2026-09-29) — Flow: "Generate click ke baad generation shuru nahi hui" fix
- Flow ab JavaScript (synthetic) click ko Generate par ignore karta hai. Ab order: page click → **asli (CDP) mouse click** (click ke foran baad debugger detach) → Enter key. Har qadam ke baad start confirm.
- Start confirm mein naya signal: prompt box (image chip + text) khali ho jaye = Flow ne submit le liya.
- **Asal wajah:** Agent mode ON account mein Flow ka normal prompt box gayab ho kar Agent chat panel ("Untitled session") mein chala jata hai; extension image + prompt wahan daal deta tha, Agent chat generate nahi karta (confirm maangta hai). Ab: Agent panel band → "Agent" chip off → sirf normal prompt box use hota hai (Agent panel wala kabhi nahi).
- **Double-click bug:** har click do dafa ja raha tha (event + el.click()) — Settings panel khul kar foran band ho jata tha, is liye 1:1 aur x1 kabhi select nahi hote the. Ab ek hi click; har setting check hoti hai, na lage to asli (CDP) click; phir bhi na lage to saaf error.
- **Replace fix:** result tile ab "Reuse prompt" button par depend nahi (naye Flow UI mein nahi hota); upload wali reference image kabhi result nahi maani jati. Result message ke saath storage se bhi side panel tak jata hai; current step ka result kabhi chup-chaap ignore nahi hota (duplicate se bachao).
- **Result watchdog:** step ke dauran har 2.5s storage se Flow job check — message na bhi pohanche to result khud lag jata hai. Flow tab mein result ab image-URL scan se bhi pakda jata hai (har Flow build mein chalta hai).
- **Manual fallback:** stepper mein paste box (Ctrl+V / file drop) + "⬇ Flow se latest" button + "Paste & Next" ab Flow ke liye bhi. Isi product image ki jagah lagti hai, phir agla step khud.
- **Pacing:** har kamiyab image ke baad 4–9s random pause (bot jaisa lagatar generate nahi), ek waqt mein sirf ek job.
- **Auto replace (side panel poller):** generation shuru hote hi Flow tab un images ki list bhejta hai jo pehle se thin; side panel har 4s Flow grid scan karta hai ("Flow se latest" wala tareeqa, jo har Flow build pe chalta hai) aur nayi generated image milte hi usi product slot mein laga deta hai. Phir Flow tab ko "done" bata deta hai taake agla job foran chale (3 min atakna khatam).
- **Auto replace, Flow message ke baghair:** bhejne se pehle side panel Flow grid ki list (snapshot) le leta hai; phir har 4s khud nayi generated image dhoondta hai (upload "zhunter_*.jpg" skip). Flow tab ka message na bhi aaye to image lag jati hai aur agla product khud shuru.
- Side panel console mein har Flow message ka log (`[ZHunter] Flow msg …`).
- Library (storage) wale products mein replace ab save bhi hota hai.
- Fail hone par console mein Generate button ki state log hoti hai.

## v9.10.0 (2026-09-29) — Bulk hunt: koi link skip nahi + naya popup motion
- **Complete = title + price.** Is se kam data wala link "partial" hai aur dobara hunt hota hai (dono modes: open tabs + background queue).
- **Koi link skip nahi:** pehle pass mein jo link jawab na de ya adhoora aaye woh baqi hunt nahi rokta; sab ke baad **3 auto-recovery rounds** (1: reload · 2: hard reload / fresh tab, lamba intezaar · 3: tab saamne la kar, content script dobara). Har round ke baad sab se behtar data rakha jata hai — retry ka kharab jawab achhe data ko nahi mitata.
- **Pending links + Retry:** rounds ke baad bhi adhoore links result popup mein "N links abhi complete nahi" list mein — har link pe **↻ Retry** aur **↗ Open**, upar **Retry all**. Retry ke baad Library khud update.
- **Library upsert (bug fix):** pehle partial row save hone ke baad isi URL ka poora data ignore ho jata tha; ab behtar data aane par wahi row update hota hai (aapke labelCost/listPrice waisay hi).
- **Queue fix:** naya link kholte waqt pichhle page ke "complete" status pe scrape ho jata tha (ghalat/adhoora data); ab asal navigation shuru → khatam hone ka intezaar + thora settle time.
- Queue items: partial ab "Needs retry" (wajah ke saath), complete sirf jab title + price mile.
- **Popup animations:** phase rang (Hunting cyan → Recovering amber → Downloading purple → Done green), count-up numbers, ring ripple, active row scan + auto-scroll, status icon pop, rows stagger, completion burst; "reduce motion" par animations band.
- **Flow fix:** Walmart ki AVIF images Flow reject karta tha ("Unsupported file type") aur automation atak jati thi — ab image pehle JPEG/PNG mein convert hoti hai, aur Flow ka upload error foran pakad kar saaf wajah dikhati hai.

## v9.9.0 (2026-09-29) — Google Flow image studio: sahi order, sahi product
- **Flow automation dobara likhi (flow_automation.js):** har image ek "job" hai aur steps is order mein, har step verify ho kar: Agent mode OFF → settings Nano Banana 2 · 1:1 · x1 → pichhla prompt/image clear → product image prompt box mein **ingredient** ke taur par attach (chip ready hone tak intezaar; paste → drop → upload + "Add to prompt" fallback) → prompt paste → Generate (trusted CDP click, start confirm) → sirf woh **naya** tile jiske paas "Reuse prompt" ho (generated; upload kabhi nahi) wapas ZHunter ko.
- Fix: upload hoti hui product image ko "generated" samajh kar wapas bhej dena aur agla product shuru kar dena (asal bug).
- Fix: Generate kabhi click nahi hota tha — `chrome.tabs.getCurrent` content script mein nahi chalta, `ZH_CDP_CLICK` whitelist mein nahi tha, CDP `mousePressed` ka `clickCount` 0 tha.
- **Job ID + slot guard:** result sirf usi product aur usi image number (1st/2nd/3rd) mein lagta hai jahan se bheja gaya; purana/late result ignore; agar us jagah image pehle hi badal chuki ho to overwrite nahi.
- **Temu link:** Flow ki image (link ~1 ghante mein expire) download → JPEG → freeimage.host; export bhi bache hue Flow links re-host karta hai.
- **Alag "✨ Edit images" selection:** har product card pe ✨ checkbox (upload checkbox se alag), "Select all" / "None", live counter "✨ N products · M images". Default: koi product select nahi.
- Stepper: error par ruk kar "Send Again" / "Skip"; Close = session band (late result kuch overwrite nahi karta); aakhir mein summary (replaced / skipped).
- Naya default AI image prompt (e-commerce lifestyle scene); purana saved prompt ek dafa naye se replace.
- Lightbox "Flow" button (product page) ab background se reject nahi hota.

## v9.8.0 (2026-09-15) — Compact UI, Groq AI Engine & Temu Resilience
- **Option A (Compact Mode & Problems Filter):** Library tab mein naya "🗜️ Compact" toggle (card height ~50% kam, narrow sidepanel ke mutabiq) aur "⚠️ Problems (N)" filter chip (sirf warning, missing price/image ya error wale items filter karne ke liye).
- **Option B (Groq AI Studio):** Direct Groq API integration (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`). Inline AI Prompt Bar: custom prompt likhein ya 1-click quick actions dabayein (🧹 Clean Brand, 🎯 SEO Title, ✨ Title Case, 📦 Temu Polish) with live progress bar aur ↺ Undo support. Settings tab mein Groq Key save karne ka option.
- **Option D (Temu Automation Resilience):** Temu draft fixer mein resilient DOM selectors aur expanded attribute fallbacks (Pattern, Theme, Target Audience, Care Instructions, Power supply).
- **Temu AI Title Studio:** Temu Export modal ke andar direct AI Title Optimizer + collapsible product list (thumbnails, live title inputs, character count badges <=60). Bulk hunt result par direct "AI Titles" shortcut button.

## v9.7.5 (2026-09-04)
- Failed details: Upload history Refresh 25s tak dohrata hai (nayi row der se aati hai) aur Temu ka koi popup upar ho to pehle band karta hai.

## v9.7.4 (2026-09-04)
- Library selection bar se extra "Export" button hataya (neeche wala Export menu hi kaafi hai).
- Temu Export info line ab "Skip already listed" checkbox ko live parhti hai (export ki tarah); OFF ho to warning "skip OFF — dobara jayenge!".

## v9.7.3 (2026-09-04)
- Library → "All" ab sirf filter/search mein dikhne wale products select karta hai (pehle poori Library).

## v9.7.2 (2026-09-04)
- Temu Activity log ab save rehta hai (extension reload / panel band hone ke baad bhi wapas aata hai; "clear log" se hi mitta hai).
- History entries mein skipped products aur unki wajah ("List" mein neeche SKIPPED section).

## v9.7.1 (2026-09-04)
- "Import sheet…" ab **Temu wali file** (temu_upload.xlsx — general template, row-3 keys) bhi leta hai: as-is upload, koi conversion / listed-skip nahi; products SKU se parhe jate hain (listed-history mark SKU ke source id se). ZHunter simple sheet (Library export) pehle ki tarah convert ho kar jati hai.

## v9.7.0 (2026-09-04) — Sheet import + Upload history
- Temu Export → **"Import sheet…"**: extension ki export ki hui XLSX / CSV / JSON (Library export ya Master ZIP wali sheet) import karein → source "Imported sheet (N)" → store choose → Export + Upload. Library mein add nahi hoti, seedha Temu.
- Temu Export → naya **History** tab: har upload ka record (waqt, store, products, source, Upload ID, added/errors, confirmed ya nahi), "Export file only" aur manual "Mark as listed" bhi. "List" se products, "CSV" se us upload ki list download. Max 100 records.

## v9.6.4 (2026-09-04) — Variations: sab "White" nahi
- Smart variation: "White" ko ab asal color nahi maana jata (golf balls sab White the). Order ab: asal color (Yellow/Orange…) → Multipack / 1 Pack → **title keyword Style** (Tour, Soft, Distance, Premium, Special, New, Natural, Heavy Duty, Sensitive, Assorted) → profile default sirf agar `fixed: true` → rotation (Standard/Special/New/Classic, White ke bina).
- golf_balls profile: default "Color: White" hata diya; match words mein chrome tour / pro v1 / tp5 / avx / velocity / supersoft / tour response / speedsoft / warbird add.

## v9.6.3 (2026-09-04)
- Failed details: kai Temu upload tabs (alag stores) khule hon to us tab ko chunta hai jis ka mall name active store se match kare (ghalat store ka tab skip + report). Upload history Refresh ke baad 8s tak "View failed details" button ka intezaar (pehle 2s). Tab ko saamne bhi laata hai.

## v9.6.2 (2026-09-04)
- Fix: STEP-2 box mein purani upload ka result (Completed / Action required) pehle se dikh raha ho to extension usay nayi upload ka result samajh kar 1s mein "complete" keh deti thi aur products galat listed mark ho jate the. Ab result sirf NAYE Upload ID ke baad wale text se parha jata hai; phase 1 mein bhi stale result ignore.
- Settings → **"Unmark last upload"**: aakhri upload ke products ko us store ki listed-history se wapas nikaalo (reload ke baad bhi kaam karta hai).

## v9.6.1 (2026-09-04) — Library → Temu (kisi bhi store par)
- Library tab → Export menu → **"Upload to Temu store…"**: chune huay products (ya sab) Temu Export window mein aa jate hain (source "Library — selected (N)"). Wahan store select karein → Export + Upload. Listed-guard per-store hai, is liye wahi products dosre store par bhi upload ho sakte hain.

## v9.6.0 (2026-09-04) — Failed details reader
- Temu Export mein naya **"Failed details"** button, aur upload ke baad errors hon to **khud** chalta hai: Temu ke Upload history row ka "View failed details" popup parh kar har failed product ka naam + wajah Activity mein dikhata hai (popup phir band).
- "Contribution SKU duplicated with another product" wale products (store mein pehle se listed) listed-history mein auto-mark → agli export mein skip. Baqi wajahon ke liye hint.

## v9.5.3 (2026-09-04)
- Bulk tab mein "Hunt all open tabs" ke saath naya **"Temu"** button: Temu Export window (Fix drafts / Settings / Categories / export) ab bina hunt ke bhi khul jati hai.

## v9.5.2 (2026-09-04) — Fix drafts generic (DOM se)
- Fix drafts ab bina category rules ke bhi chalta hai. Har draft row mein sirf **khali required (*) fields** bharta hai: profile attributes → draft defaults → fallback (Material=Other, Applicable Age Group=14 Years+); bhare huay fields untouched. Row ki Temu category bhi rule-match aur report mein shamil.
- Agar koi required field phir bhi khali rahe to Submit nahi dabta — report batati hai kaun sa field profile mein likhna hai. Sab bhare hon to Submit.

## v9.5.1 (2026-09-04)
- Fix: bulk progress "42 / 40" — total ab is hunt ke tabs se (resume/override mein selectedIds alag ho sakti thi), done ab unique tabs; same tab ka dobara result purane ko replace karta hai (duplicate rows nahi).
- Fix: progress list mein har row "0 imgs" dikhati thi (download phase 2 mein hota hai) — ab scraped image URL count dikhta hai.

## v9.5.0 (2026-09-04) — "ZHunter" tab group
- Bulk tab mein naya toggle **"Keep product tabs in a 'ZHunter' tab group"** (default on). Hunt start par selected tabs ek cyan "ZHunter" group mein chale jate hain; jo bhi naya product tab (Amazon / Walmart / Sam's Club / Temu…) load ho, background usko khud group mein daal deta hai.
- Sirf ungrouped tabs ko chhua jata hai — user ke apne tab groups waise hi rehte hain. Pinned tabs skip. Group khali hone par Chrome usse khud hata deta hai. Toggle on karte hi abhi khule product tabs bhi group ho jate hain.
- Manifest: `tabGroups` permission add (Reload par Chrome ek baar nayi permission dikha sakta hai).

## v9.4.3 (2026-09-04) — Upload flow polish
- Temu upload ke doran side panel mein **live status line**: "File Temu par upload ho rahi hai · 12s" → "Temu ne file uthaa li · ID …579" → "Processing data 80% · 45s" → "result parh raha hoon". (content script → background → side panel, 1 msg / 2s.)
- Aakhir mein saaf summary: "Upload ho gaya: 28 products add huay, 0 errors"; error hone par hint (Temu tab → View processing results). Confirm na ho to "Mark as listed" ki yaad-dehani.
- Activity one-line status ab ⏳ lines bhi dikhata hai (running color).

## v9.4.2 (2026-09-04)
- Fix (DOM se confirm): Temu upload asal mein ho jata tha lekin extension "confirm nahi hua" kehti thi. Wajah: "Upload history" table STEP-2 section ke bahar hai aur upload ke doran refresh nahi hoti; naya Upload ID / "Processing data (NN%)" / "Completed + records count" STEP-2 section ke andar dikhta hai. Ab wahi block parha jata hai.
- Phase 1 wait 25s → 90s (4 MB file slow net par upload hone mein zyada waqt leti hai), phase 2 200s. Report ab Upload ID aur "N processed, N added, N errors" dikhati hai.
- Confirmed upload ke baad products khud listed mark hote hain (pehle "Mark N as listed" manually dabana parta tha).

## v9.4.1 (2026-09-04)
- Temu Export → Activity ab default mein band: sirf ek line ka status (e.g. "Upload ho gaya…") dikhta hai, "Details" par poora log; error par khud khul jata hai.
- Fix: "Mark N as listed" button upload ke baad bhi dikhta rehta tha (CSS `hidden` override) — ab theek.

## v9.4.0 (2026-09-04) — Bulk hunt popups redesign
- **Progress popup**: bara progress ring (%) + "9 / 11 products done", chips (images / videos / failed sirf jab ho / speed), saaf ETA ("About 40s left"), "Now: <product>" line, live list compact aur collapsible ("All tabs (11)"), spinner active row par. Emoji-titles hata kar saaf title + subtitle ("Hunting products — Reading product pages…", "Paused", "Downloading images").
- **Hunt complete popup**: title + subtitle ("11 products · 77 images · 33s"), 3 result tiles, failed list toggle, phir "What next?": **Temu upload** (primary) aur **Master ZIP** side-by-side, neeche Sheet only · PDF catalog · Images ZIP, aur Done.
- **"Images only — separate files" button hata diya.**

## v9.3.1 (2026-09-04)
- **Listed-history fix**: pehle "Export file only" par bhi products "listed" mark ho jate the (upload hua ya nahi) → agli baar "already listed" keh kar skip. Ab sirf **confirmed upload** ke baad mark hote hain. Export-only ke baad "Mark as listed" button aata hai (agar aap ne file khud upload ki ho).

## v9.3.0 (2026-09-04) — Temu Export modal redesign
- **3 saaf tabs**: Upload (store, template, products, Price ×, 1 bara button, Activity) · Settings (pricing/stock, default package, behaviour switches with hints, titles & variations) · Categories (cards + form).
- **Advanced settings JSON box hata diya** — har setting ka apna field.
- **Category add fix**: pehle natija sirf toast mein tha jo modal ke peeche chhup jata tha aur save-fail par kuch nahi dikhta tha. Ab form ke sath inline message ("✓ saved" / exact wajah), naam auto-normalize (Cat Food → cat_food), Edit mode highlight, Clear button, list mein turant update, tab par count badge.
- Save/settings failures ab wajah ke sath dikhte hain (`save failed`, `rate_limited`, `no active store`…); truthy-string bug fix (fail ko success na samjhe).
- Naye settings fields: List price ×, Qty min/max, Max weight (lb), category Exclude words.
- Upload tab par "N products ready · X already listed (skip) · store" line.
- Modal light theme header fix; footer ki jagah actions body mein (chhoti screens par kuch nahi katta).

## v9.2.0 (2026-09-04) — mixed-category fixes
- **Smart weight** (naya checkbox, default on): title se wazan — "24 oz" → 1.7 lb, "3.15 Lb Bag" → 3.5 lb, "2 oz, 6 Count" → 0.9 lb, "1 Gallon" → 9.5 lb (packaging +10%). Order: category profile → title → scraped (0.1–8 lb) → global default. **8 lb se zyada → product skip** (`max_weight_lb`, aap ki policy). Report mein har product ke sath `1.7lb(title)` / `(default)` likha aata hai; default wale par `DEFAULT_WEIGHT` warning.
- **Towels profile fix**: pehle "towel" word par match hota tha → "Paper Towel 15 rolls" ko "Bath Towels" category mil gayi. Ab sirf bath/hand/beach towel, washcloth, towel set; paper towel exclude. Profiles mein ab optional `exclude: [...]` support.
- **Fallback variation values** ab default `Standard, Special, New, Classic` — "White" sirf tab jab title/variant mein asli color ho (pasta sauce / cat food par "Color: White" nahi jayega). Modal ke "Variation values" box mein purani list saved ho to usay khud edit kar lein.

## v9.1.3 (2026-09-04)
- Export shuru hone se pehle rukne ki wajah (store ka template select nahi / hunt results khali) ab report box mein saaf likhi aati hai, sirf toast mein nahi.

## v9.1.2 (2026-09-04)
- Background mode ab: Temu tab saamne khulta hai, "Processing data (NN%)" **100%** ho kar Upload history mein row aane tak wahin rehta hai (Chrome background tabs ke timers throttle karta hai — isi liye peeche bhejte hi Temu ki processing bohat slow ho jati thi), **phir focus khud aap ke pichle tab par**. Raftaar wahi jo bina background option ke thi.
- Report mein ab "File uthaa li (Ns)" aur "Processing mukammal (Ns)" alag-alag dikhta hai.

## v9.1.1 (2026-09-04) — ASAL BUG FIX (DOM se mila)
- Temu upload page par **do** file inputs hain: "Add products by categories" (galat) aur "general template" (sahi). Purana code general box na milne par **aakhri input** utha leta tha → file categories wale box mein jati thi → wahan "records processed: 0" aur asli Upload history mein kuch nahi. Ab **sirf** general box (`importUploadBoxWrap`) accept hota hai; na mile to tab saamne la kar dobara dhoondta hai; phir bhi na mile to rukta hai (galat box mein kabhi nahi bhejta).
- General tab active na ho to dobara click.
- Upload confirm ab sirf general "Upload history" table se (categories wali "Spreadsheet upload status" ignore).
- Agar auto-upload fail/unconfirmed ho to products **listed-history se wapas hat jate hain** (pehle export ke waqt hi mark ho jate the, aur fail ke baad agli baar "already listed" keh kar skip ho jate the).

## v9.1.1 (2026-09-04)
- Console error fix: Temu product scraper ab Seller Center / non-product Temu pages par inline `__init_data__` script inject nahi karta (Temu CSP block karti thi → "Executing inline script violates CSP" errors). Behaviour par koi asar nahi.

## v9.1.0 (2026-09-04)
- **Background upload — naya design.** Upload ka poora control ab background service worker mein hai (side panel se azaad):
  - Temu tab **peeche (inactive)** khulta hai, file wahin attach hoti hai, aap ka tab kabhi nahi badalta.
  - Agar Temu ka page hidden tab mein upload box mount na kare, to content script `TEMU_NEED_VISIBLE` bhejta hai → tab 1-2 sec ke liye saamne aata hai, file attach hoti hai, focus khud wapas.
  - Report mein ab likha aata hai ke upload box background mein mila ya tab saamne lana pada (`visibility=`) — agli debugging is se hogi.
- Report `chrome.storage.local.temuLastUploadReport` mein bhi save hoti hai.

## v9.0.5 (2026-09-04)
- **Background upload asal mein fix**: v9.0.4 "Completed"/"Download processing results" ka intezaar karta tha — jo 1-2+ minute leta hai — is liye tab poora waqt foreground mein raha, background jaata hi nahi tha. Ab sirf itna dekha jata hai ke Temu ne file uthaa li (Upload history mein naya Upload ID aa gaya — 2-5 second mein ho jata hai, jaisa "Processing data (5%)" turant nazar aata hai), phir turant background. Baqi processing (5%→100%→Completed) Temu ke server par hoti hai — tab foreground ho ya background, farq nahi padta.

## v9.0.4 (2026-09-04)
- **Background upload theek** kiya: pehle tab attach ke foran baad peeche chala jata tha, aur Chrome hidden tabs ke timers throttle kar deta hai — is liye upload beech mein ruk jata tha. Ab extension Temu ki Upload history mein nayi entry aane ka intezaar karta hai (Refresh khud dabata hai, max 2 min), aur **tabhi** focus aap ke pichle tab par wapas karta hai. Confirm na ho to tab saamne hi rehta hai.
- Report box bara (240px) aur update par khud scroll ho kar dikhta hai — ab neeche ki lines chhupti nahi.

## v9.0.3 (2026-09-04)
- **Upload fix**: v9.0.2 ka hidden-tab upload kaam nahi karta tha — Temu ka page hidden tab mein render hi nahi hota (file input maujood nahi hota). Ab tab focused khulta hai, file attach hoti hai, aur focus khud aap ke pichle tab par wapas aa jata hai; Temu tab peeche upload complete karta rehta hai.
- **UI fix**: Temu modal ke footer buttons (Fix drafts / Export only / Export + Upload) ab wrap hote hain — "Export + Upload to Temu" ka text nahi katta.

## v9.0.2 (2026-09-04)
- **Upload in background**: "Export + Upload to Temu" ab Temu tab background mein kholta hai (focus nahi leta), file wahan attach ho jati hai. Modal mein checkbox (default on). Fail ho to tab khud saamne aa jata hai.

## v9.0.1 (2026-09-04)
- Smart variations ab **simple** hain (Temu par variation baad mein edit nahi hoti, is liye numbers/wazan nahi):
  - asli color → `Color: Black`
  - multi-pack (12 pk, 24 ct, dozen, multipack, bundle) → `Style: Multipack`
  - single / each → `Style: 1 Pack`
  - golf balls (koi color nahi) → `Color: White`
  - kuch na mile → modal ki "Variation values" list mein se ek (default: White, Special, New, Standard) — har product ko fixed value, sab ko White nahi.
- "12 Pack", "12 lb", "64 fl oz", "XL" jaisi values hata di gayi.
- Modal mein naya box: **Variation values** (comma separated, live-read at export, Save defaults se save).

## v9.0.0 (2026-09-04)
### Smart variations (big change)
- Temu export ab har product ki variation khud pehchanta hai (pehle sab `Color / White` jata tha):
  1. Scraped variant ya title mein asli color → `Color: Black`
  2. Pack count (12 pk, 24 ct, 12-pack, Pack of 6, 1 dozen, 24 rolls) → `Quantity: 12 Pack / 24 Count`
  3. Wazan / volume (12 lbs, 16 oz, 64 fl oz, 1 gallon, 500 ml) → `Weight: 12 lb` / `Capacity: 64 fl oz`
  4. Size (XL, 2XL, King/Queen, Size 4, Large) → `Size: XL`
  5. Kuch na mile → `Style: Standard` (config: `fallback_variation`)
- Golf balls profile: color pehle dekha jata hai, kuch na mile to `Color: White` (purana proven behaviour).
- Category profile mein optional `variation_priority` (e.g. `["color","pack","weight","size"]`) aur `default_variation`.
- Modal mein "Smart variations" checkbox (off karein to purana Color/White).
- SKU suffix ab variation value se banta hai: `CH-<id>-12Pack`, `CH-<id>-12lb`, `CH-<id>-Standard`.
- Fix: "Navy Blue" ab "Blue/Navy Blue" nahi banta.

### Fix drafts (new button)
- Temu modal footer mein "Fix drafts" button. Temu ke "Complete product details" page par (upload history → Complete product information)
  har draft ka Material / Applicable Age Group category profile se set karta hai aur Submit dabata hai.
- Rules category profiles se: `attributes: {"Material":"Rubber","Applicable Age Group":"14 Years+"}`,
  ya agar nahi likha to `keyword_attributes` ("Rubber, 14 Years+") se khud nikal leta hai.
- Config: `draft_default_attributes` (sab products ke liye), `draft_auto_submit` (default true).
- Note: Temu ka dropdown DOM live test nahi hua — pehli baar report dhyan se dekhein.

### Template
- Verified against Temu general template Sept-2026 (naye columns goods_id/sku_id/status/details, reference_id, Variation 2, market_price...). Purana row-3 key mapping wese hi chalta hai.

## v8.9.x
- Already-listed guard + clear history; banned-words title cleaner; skip-reason reporting; Temu product pages huntable.
## v8.8.x — multi-store. v8.7.x — auto-upload. v8.6.x — categories editor. v8.5.x — built-in Temu export.
