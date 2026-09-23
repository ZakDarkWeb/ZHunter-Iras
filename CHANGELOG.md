## v11.1.3 — Temu Export: polish pass (collapsed rows + minimize notice)
- Collapsed products ab thoda visually "quiet" hain (halka tinted bg), aur expand hote hi price/category/flags fade-up hote hain (pehle abrupt show/hide tha).
- Mini price/category badge ab halka "pop" ke saath andar aate hain jab row collapse hoti hai.
- Poori list ka "Minimize" notice bar ab baaki panel jaisa glass hover/lift effect + yellow dot rakhta hai, sirf plain dashed box nahi.
- Cleanup: v11.1.2 ka ek dead CSS rule hataya (row accent-bar color pehle se hi ek behtar system se handle ho raha tha — data-clean/data-warn ke zariye).

## v11.1.2 — Temu Export: minimize button ab poori list minimize karta hai
- v11.1.0/v11.1.1 mein "Minimize" button ko per-row "collapse all" bana diya tha, lekin jab saare products already clean (auto-collapsed) hon to click karne par kuch badalta nazar nahi aata tha aur list phir bhi lambi rehti thi.
- Ab yeh button poori Review list ko dikhata/chhupata hai (jagah bachane ke liye — "N products hidden" notice, click se wapas khulti hai) — bilkul alag, independent feature hai per-row collapse (chevron/row click) se, jo apni jagah kaam karta rehta hai.

## v11.1.0 — Temu Export: 2 real bugs fix (category dropdown + minimize)
- BUG FIX: Category ("Chips & Crisps" waghera) dropdown khulte hi poori white/light popup dikhti thi, hover par blue highlight -- kahin bhi `color-scheme` set nahi thi is liye Chrome apna default light popup render karta tha (box khud dark hota tha, sirf list light thi). Ab select + options dono dark/yellow theme follow karte hain.
- BUG FIX: "Minimize" button poori review list ko `[hidden]` kar deta tha, lekin notice ("N products hidden") state row visibility se out-of-sync ho jata tha -- kabhi list khud khuli reh jati, notice phir bhi "hidden" dikhata. Ab per-row collapse hai: koi row poori tarah DOM se gayab nahi hoti.
- New: "clean" (no warning/no error) products ab default collapsed (ek compact line -- thumbnail, title, price, category) dikhte hain; warning/blocked products khule rehte hain. Kisi bhi row par (ya uske chevron par) click kar ke khol/band kar sakte hain -- checkbox alag se hamesha kaam karta hai. Header ka "Minimize" button ab sab products ek saath collapse/expand karta hai (clear "Collapse all / Expand all").
- AI per-product title edit (row ka "AI" button) verify kiya -- already kaam karta hai, is pass mein nahi chheda.

## v11.0.4 — Temu Export: lively pass (motion + richer rows)
- Head: neeche bahti hui yellow→red light line, icon breathing glow; pane ke cards stagger entrance; compact bar par sheen.
- Review title ke neeche animated gradient underline. Rows: ek-ek kar ke fade-up entrance, left accent stripe (yellow / warn amber / red / clean green) jo hover par glow karti hai, hover par row glow + thumbnail zoom; unchecked rows dim.
- Custom yellow checkbox (tick + pop), price box yellow highlight, category pill, AI button yellow outline; "blocked" flag halka pulse.
- Dock: Upload button glow pulse + sheen, Selected count pill; Filters/Tools panel slide-down; pipeline step complete par pop.
- Performance mode on ho to ye sab band.

## v11.0.3 — Temu Export modal poora theme + Dense view rows fix
- Temu modal ab baqi panel jaisa: mesh background (yellow/red glow), glass head, solid yellow active tab (spring pop), har card par glass + gradient border, compact bar / price preview par brand tint, store pills / template button, dock glass + yellow Upload, tier-2 buttons glass. (Wajah: style.css ke `#temuModal …` rules theme se zyada specific the — ab Temu rules `#temuModal` ke saath boost.)
- Dense view rows toot rahi thi (title 0px, price/weight/category ek doosre par) — ab ek line: title grow, AI, price 56, weight 40 (spinner hidden), category 82; `$`/`lb` labels aur char-count dense mein chhupe.

## v11.0.2 — Fix: click par tab/pill right ko phail jata tha
- Ripple span tab buttons / pills ke andar absolute nahi tha (sirf `.btn` par tha) → 0.6s ke liye layout push. Ab har jagah absolute + overflow hidden.

## v11.0.1 — Theme bold pass (pehla v11 bohat halka tha)
- Background: layered mesh (yellow upar-right, red neeche-left) + halka grid + 3 drifting light orbs (theme.js) — pure black khatam.
- Cards: saaf glass (lighter surface), gradient hairline border (yellow→red), top highlight, hover par lift + glow; section banner par brand gradient + sheen sweep; Temu CTA card red tint.
- Stat tiles rangdaar glass (yellow / green / red), bare numbers; Library tiles alag rang.
- Active tab / active chips ab solid yellow (dark text) + glow, tab switch par spring pop; Temu modal tabs same.
- Primary buttons ka text dark (pehle grey tha), disabled state saaf grey (muddy gradient nahi). Temu modal background mesh, activity/report line calm.

## v11.0.0 — Naya design system: "Premium glass" (brand: yellow · red · black)
- Nayi file `theme.css` (style.css ke baad load) + `theme.js`: ek token set (`--zh-yellow #FFD500`, `--zh-red #FF1F1F`, black), glass surfaces (blur + soft gradient), ek jaisi radius/shadow/motion tokens. Purane amber/cyan/pink/purple accents sab brand palette par — style.css ke 150+ cyan rang bhi yellow par map kiye.
- Header: gradient wordmark, logo glow breath, red PRO badge. Tab nav: glass pill, active tab yellow glow, pane switch fade-up. Cards/stat tiles stagger entrance, hover lift; stat numbers badalne par "bump".
- Buttons: primary yellow→amber gradient + glow + moving sheen (sirf enabled), danger red glow, ghost calm; har button/pill/tab par ripple (theme.js). Inputs/selects yellow focus ring; switches yellow gradient; scrollbars thin.
- Bulk progress modal: ring gradient yellow→red, hero/rows/beacon brand par. Toasts glass. Temu modal + review card same tokens (glass).
- Performance mode ab default OFF (Settings → on karein to blur/glows/entrance band, `html[data-fx="off"]`); `prefers-reduced-motion` bhi respect hota hai.
- Files: `theme.css`, `theme.js` naye; `sidepanel.html` (links + ring gradient), `style.css` (cyan → brand), version bump.

## v10.3.5 — Bulk tab: "tabs at a time" ek hi jagah
- Bulk tab par tabs-at-a-time ka control 3 jagah tha (upar Hunt Speed pills, Advanced ke andar "Hunt Concurrency" select, queue card ka "1 tab" select) — sab ek hi setting (`queueParallel`) badalte the. Ab sirf upar wale **Hunt Speed** pills (Safe 1 / Balanced 2 / Turbo 3) dikhte hain; dono selects UI se hata diye (JS sync ke liye hidden).

## v10.3.4 — Performance: content script sirf shopping sites par, frame pause, Performance mode
- Content script (content.js + JSZip, ~415 KB) ab sirf shopping hosts par load hoti hai (Amazon sab TLDs, Walmart, Sam's, eBay, Etsy, Alibaba/AliExpress, Temu, Target, Costco, Home Depot, Best Buy, Daraz, Lazada, Flipkart, Noon, Shein, Shopify stores, golf shops) — Gmail/YouTube/baqi pages par extension ka koi code load nahi hota. Kisi aur site par hunt chalayen to extension khud script inject kar deti hai (JSZip ke saath).
- Page frame: tab background mein jaate hi animation pause (`zh-paused`), check interval 1.5s → 4s.
- Settings → **Performance mode** (default ON): side panel ke backdrop blur, ghoomte glows/shimmer band (`html[data-fx="off"]`, `zhReduceFx`). Kaam par koi asar nahi.
- On-demand inject paths ab `lib/jszip.min.js` bhi inject karte hain (page ka ZIP button unlisted sites par bhi chalta hai).

## v10.3.3 — Pre-upload review: compact header, ek sync engine, professional restyle
- Review header ab sirf 2 rows: (1) title + live summary + Cards/Dense + minimize, (2) search + All/None + **Filters ▾** + **Tools ▾**. Filter chips, Hide-clean switch, legend, Auto-fix → Filters panel; Strip brands / Find & replace / Remove word / Select clean-heavy / AI studio-rewrite-specs / AI prompt → Tools panel. Panel state yaad rehti hai (`tckPanelOpen`).
- Ek sync engine `temuCheckSync()`: checkbox / filter / search / hide-clean / minimize / edit / AI — har change ke baad ek hi hisab se rows (`row.hidden`), chip counts, summary, status line ("Showing 1 of 59 · 58 clean hidden · Show all"), Filters badge, dock `Selected N/M`, `Upload (N)`. Pehle 4 alag hide-mechanisms (display/hidden/class, duplicate chip handlers) ek doosre ko overwrite karte the → "59 ready lekin 58 hidden" jaisi mismatch khatam.
- All / None ab sirf dikh rahe (filtered) products par lagta hai.
- Restyle: neutral dark surface tokens (`--tck-*`), ek accent (amber) sirf Upload par, semantic rang sirf status par (left border: green clean / amber warn / red blocked), emoji hata kar SVG icons, segmented controls, consistent 26–30px heights, light mode tokens. Dock/Export menu/tier-2 same family.

## v10.3.2 — Temu Export: review mode compact, single scroll, asli Stop, Export ▾
- Review (Pre-Upload) khulte hi upar ke store / template / pricing cards ek line mein simat jate hain ("● Store · template ✓ · Price ×5 · source · Badlo") — products foran upar dikhte hain. "Badlo" se cards wapas.
- Products list ka andar wala scroll (48vh) hata diya — poore modal ka ek scroll; search + filter chips upar sticky, Upload dock neeche sticky. Page ab "sticky"/double-scroll nahi.
- Fix: "Last bulk hunt results" select ho aur bulk khali ho to chupke se poori Library nahi uthti — saaf message "Bulk hunt khali — Library select karein".
- Dock mein tier-2 row: Fix Drafts · Errors · Open Temu review ke doran bhi dikhte hain (Library se Temu upload par bhi).
- Dock ka "Excel File" ab "Export ▾" menu: (1) Temu template sheet — wahi .xlsx jo Temu par upload hoti hai, upload nahi karega; (2) ZHunter simple sheet — title / link / price wali normal sheet. Dono selected products + review ki edits ke saath.
- Asli Stop: pipeline header mein 🛑 Stop (Excel banne se upload tak har phase). Background `TEMU_ABORT_UPLOAD`: file abhi attach nahi hui → Temu tab band; Temu ne file utha li (processing) → tab saamne + message "Temu par Cancel khud dabayein". Content `TEMU_ABORT` sab waits foran khatam karta hai.

## v10.3.1 — BUG FIX: Amazon variations ki images mix
- Amazon par jis product ki variations hoti hain (Color: White / Yellow / …) us ke page script mein sab variants ki images hoti hain; extension sab utha leti thi → har variant ko ek jaisi images. Ab sirf us page ke selected variant ('initial') wali images li jati hain.
- Sanity check: page ki main image script wali list mein na mile to DOM gallery (thumbnails) se images li jati hain.
- options.html/js/css folder se delete.
## v10.3.0 — Alag Settings page khatam
- Side panel ka Settings tab hi ab poori settings hai (Bulk, Images, Data, Shortcuts, Page frame, Export folder, Tabs). Header ka gear icon ab wahi tab kholta hai; alag options.html page hata di (manifest se).
- Settings → Data mein "Wipe everything" add (pehle sirf options page ke Danger zone mein tha). Reset Library pehle se hai.
- options.html / options.js / options.css folder mein hain lekin ab use nahi hote — chahen to delete kar dein.

## v10.2.3 — temu.com CSP error fix + tabs hide
- temu.com product page par `__init_data__` ab background (chrome.scripting, MAIN world) se parha jata hai — "Executing inline script violates CSP" error khatam, Temu page ki images/price ab sahi milti hain.
- Settings → "Tabs dikhao / chhupao": Hunt aur Library tab ko chhupa sakte hain (Bulk/Settings hamesha). Chhupe tab par auto-switch nahi hota.

## v10.2.2 — Store Copy: links seedha queue mein
- Import ke baad Temu links khud Bulk queue mein add hote hain (pehle paste modal ke andar chhupe rehte the).

## v10.2.1 — Store Copy: exact copy via Temu live page
- Import ki hui Temu export sheet ke Goods ID se ab temu.com ka live product page hunt hota hai (aap ki edited images/title/description) — Amazon/Walmart sirf fallback.

## v10.2.0 — Store Copy (ek store ki listings doosre store par)
- Temu Seller → Manage products → products select → **Download** (Product_data_export.xlsx). Ye file doosri Chrome profile mein Temu Export → "Import sheet…" (ya Bulk → Import links sheet) se import karein.
- Extension Contribution Goods se source product pehchan leti hai (B0… = Amazon, numeric = Walmart, warna Temu goods page) aur Bulk tab mein links bhar deti hai → tabs kholo / hunt (images, description) → Temu Export.
- Hunt ke doran Temu sheet ka **title, base price (as-is), variation (Color), category** override hota hai — sheet Excel mein edit kar ke import karein to wahi lagega.
- Bulk tab mein "Store Copy: title se ye words hatao" box (import ke baad dikhta hai).
- Source page fail ho jaye (bot check) to bhi product partial (title/price) ke sath rehta hai — images Fix drafts/khud.

## v10.1.1 — Complete product infomation: retry + link fallback
- "Complete product details" page 8s mein na khule to button dobara dabaya jata hai; agar button link (href) hai to extension khud tab kholti hai (Chrome popup block ka tor).
- Fail par button ka HTML debug ke liye save hota hai (temuDebugCompleteBtn).

## v10.1.0 — ZHunter Export folder
- Extension ki har download (Temu sheet, zip, images, videos) ab Downloads → **ZHunter Export → YYYY-MM-DD** folder mein jaati hai — roz ka alag folder, purani files apni jagah rehti hain.
- Settings → "Export folder — ZHunter Export" toggle (default ON). Off karne par pehle jaisa seedha Downloads mein.
- Note: Chrome extension sirf Downloads ke andar folder bana sakti hai (Chrome ki pabandi), Downloads se bahar (e.g. Desktop/D:) nahi.

## v10.0.2 — Rainbow frame on product pages + temu.com goods.html
- Product pages (Walmart, Amazon, eBay, temu.com...) par frame ab colorful rainbow conic gradient hai jo aahista (12s) ghoomta rehta hai; working par tez. Temu Seller pages par store ka apna rang barqarar (ghalat store ki pehchaan).
- temu.com ka `goods.html?goods_id=...` product URL bhi ab product page mana jata hai (pehle sirf `-g-NNN.html`).

## v10.0.1 — Page frame on product pages + conic gradient
- Product pages (Walmart /ip/, Amazon /dp/, eBay /itm/, Sam's Club, Target, etc.) ab idle state mein bhi gradient frame dikhate hain — har platform ka apna rang (Walmart blue, Amazon amber, eBay purple, Temu orange...). Badge ab bhi sirf working/done par.
- Frame gradient ab conic (ghoomta hua) hai: idle par 16s slow rotation, working par 3.2s tez + thora mota + glow pulse; andar ki taraf halki white hairline (glass edge).
- SPA sites (Walmart) par frame gum ho jaye to 1.5s poll usay wapas laata hai.

# ZHunter PRO — CHANGELOG

## v10.0.0 (2026-09-07) — Neon Edge design
- Naya final design layer (style.css end): ek gradient system (cyan→indigo→emerald) — har button par gradient border, primary buttons gradient fill + glow, cards/inputs/tabs/rows par halki gradient edge, header + modal head gradient line, brand name gradient, switches/progress/stepper gradient. Dark + Light. Header ki "Ultimate Product Hunter" line hata di (store badge se overlap hoti thi).
- Page frame ab gradient border (store color → lighter) + andar glow; working par gradient behta hai + glow pulse.

## v9.16.0 (2026-09-07)
- Temu Export compact: store + template set hon to bara card chhup kar ek line bar "● HQ 5 SHOP · template ✓ · Temu tab ✓ · badlo" — click par poora card. Roz ka kaam: sirf Products + Export button.
- Bulk tab Open tabs: har product tab se image + price (content `PEEK`: og:image / sab se bari image, platform price reader) — thumbnail + green price pill; click par lightbox. Tab object par cache.

## v9.15.3 (2026-09-07)
- Page frame sirf in pages par: seller.temu.com ke upload-goods-multiple / products-excel-multiple-edit / product-action; temu.com product page (-g-NNN.html); Amazon /dp/, Walmart /ip/, Sam's /p/, eBay /itm/ waghera product pages. Manage products aur baqi seller pages par nahi. SPA URL change par dobara check.

## v9.15.2 (2026-09-07)
- Page frame badge wapas — sirf working/done ke doran (idle par sirf border).
- Upload tab buttons simplify: "Drafts fix karo" + "Attributes bharo" → ek "Temu par complete karo" (pehle Complete product details, phir Missing attributes). Attributes button hidden (pipeline/retry internally use). Tooltips mein kab-use-karein likha.

## v9.15.1 (2026-09-07)
- Fix drafts (Complete product details) stuck: page par ab Material composition tables bhi aate hain — `temuFillComposition` reuse (Add material → material → 100%), har field par 8–9s limit, fallback chain rule → defaults → guess → '__first__'; dropdown fail par band karke aage.
- Page frame: badge hata diya (sirf border), patla 2px + gol corners + soft glow, palette se red/pink nikal diye (red sirf error), sirf e-commerce hosts + seller.temu.com par.

## v9.15.0 (2026-09-07) — Page frame
- New: TobyFlow-style rangdaar border (content.js `zhFrame`): Temu seller pages par har store ka apna rang (naam se hash) + neeche-left badge "ZHunter · HQ 5 SHOP" — ghalat store ek nazar mein pata; product pages par hunt ke doran cyan pulse, done par green (6s), Temu upload/fix/attributes ke doran pulse. Settings tab → "Page frame" switch (chrome.storage.local `zhPageFrame`).

## v9.14.2 (2026-09-07)
- Attributes fill fixes: product name (CSS text aa raha tha) `.elli_outerWrapper` se; composition tables "No data" par pehle "Add material" dabao; har product Goods ID se dobara dhoonda jata hai (Submit ke baad React table re-render → stale rows se stuck); multi-select ke baad dropdown band; 2nd pass '__first__'; Submit reject detect. Jo field na bhare us par extension rukti nahi — aakhir mein "KHUD BHARO" list (product → fields), baqi rows submit hoti rehti hain.

## v9.14.1 (2026-09-07)
- Fix: extension Reload ke baad khule Temu tabs se "page se rabta nahi" → Drafts fix / Errors dekho / Complete product infomation tab skip kar dete the. Ab `temuEnsureTabReady()`: ping fail → tab khud reload → 30s ping → aage chalo (Fix drafts edit tab, upload tab candidates, sab jagah).

## v9.14.0 (2026-09-07) — Missing required attributes auto-fill
- New: Temu "Product action required → Missing required attributes" page (product-action.html?reform_type=excel_publish_complete_attributes) automation — content `TEMU_FILL_ATTRS`: har product row ke khali required dropdowns (Power Mode, Battery Properties, Material, Applicable Age Group, Indoor/Outdoor, Composition, Burn Time, Wireless, Voltage…) category profile attributes → draft defaults → smart guess (title se: corded → "Room electrical/hard wiring") → fallback candidates → dropdown ka pehla option; composition tables (Material/Cover/Filling) = material + 100%. Row Submit khud.
- Pipeline: errors > 0 par Fix drafts ke baad ye page khud khul kar bhar jata hai; Upload tab par naya button "Attributes bharo"; "Drafts fix karo" agar ye page saamne ho to isi ko bharta hai. Errors step ka Retry = attributes.
- Fix: late-confirm regex — history row ka "records processed from this upload: 74 … with errors: 15" format nahi parhta tha (stepper "0 errors" dikhata tha).
- temuPickSelectValue: candidates array + '__first__' support.

## v9.13.4 (2026-09-06)
- Fix (root cause, sab buttons): JS `addRipple` har click par button ke andar `<span class="ripple">` daalta tha lekin `.ripple` ka CSS tha hi nahi — span layout mein jagah le kar button ko 600ms ke liye chaura kar deta tha. Ab ripple absolute + fade animation, layout par koi asar nahi.
- Fix: `tabs.get` TypeError (resume pending hunt) — queue ke fake ids (`q_…`) par tabs.get call hota tha; ab sirf integer tabId.

## v9.13.3 (2026-09-06)
- Fix: Settings foot (Save settings / Unmark / Clear listed) — Save par "✓ Saved" message usi flex row mein aata tha, row wrap ho kar buttons phail/gayab hote the. Ab grid layout, buttons fixed size, message apni poori line par; inline messages kahin bhi row ko nahi phailate.

## v9.13.2 (2026-09-06)
- Fix: "Close tabs after hunt" on ho to aakhri product tab band hote hi Chrome poori window/profile band kar deta tha (side panel bhi). Ab `safeRemoveTab()`: window ka aakhri tab ho to pehle ek naya khali tab khulta hai, phir purana band — bulk hunt, queue workers, sab jagah.

## v9.13.1 (2026-09-06)
- UI stability layer (style.css end): hover/click par buttons/rows/tabs/cards ka har `transform` (uthna, sikurna, sarakna) off — click miss/jump khatam; queue/tab rows ka bhaari cyan glow hata kar halka highlight; focus ring sirf keyboard par.

## v9.13.0 (2026-09-06) — Sheet → Hunt → Temu
- New: Bulk → Paste links → "Import links sheet (.xlsx/.csv)": purane ZHunter ki simple sheet (#, Tital, Soursing link, Price) import — link column khud pehchan (sab se zyada http wala), title/price columns header ya content se; links textarea mein, title queue mein, price fallback (`zhunterSheetMeta`) agar page se price na mile.
- New: Queue hunt parallel — Bulk tab select "1/3/5/8/10 tabs" (default 5, setting `queueParallel`): N worker tabs shared queue se links uthate hain (stagger 400ms), sab end par band. 40 links ≈ 1–2 min (pehle 1 tab sequential).

## v9.12.3 (2026-09-06)
- Fix: Walmart price 100x (TaylorMade golf balls $51.99 → $5199 → Temu base $25,995.99 → "abnormal price" violation). Walmart price whole+cents alag spans mein hota hai, innerText "$5199" mein dot nahi tha; ab aisi 4+ digit bina-decimal value par cents alag kiye jate hain (sirf jab aria-label/content na ho).
- Guard: naya `price_max` (Settings → "Max source $", default 400): source price is se zyada = PRICE_ABSURD → check panel mein red "$X ghalat?" (default unselected); check panel band ho to export se bahar (skipped list mein wajah).

## v9.12.2 (2026-09-06)
- Change: brand guard se units-based flags (0 units red, <100 yellow) hata diye — units orders se kam hote hain, extension ka snapshot purana ho sakta hai; user Temu par khud dekhe. Category approval check (brand ✗ group) aur "approval?" (brand list mein nahi) barqarar. Units list mein info ke taur par rehte hain.

## v9.12.1 (2026-09-06)
- Fix: "Import from Temu" pehle se khule Brands & IP tab par atka rehta tha (extension reload ke baad us tab mein content script nahi hota). Ab 3s mein rabta na ho to tab khud reload → dobara try; status line har step batati hai.

## v9.12.0 (2026-09-06)
- New: "Import from Temu" (Settings → Brand approvals): Temu Brands & intellectual property page (Trademark tab) ke sab pages parh kar active store ki list khud banata aur save karta hai — sirf In Effect trademarks, har category ka group + remaining sellable units (`BRAND: kitchen(59), grocery(58)`). content `TEMU_READ_BRANDS` (rows/pagination DOM Sep 2026). Store mismatch par rokta hai.
- Brand rules ab per-category units (`cats`) — flag us group ke units par (e.g. Duracell electronics 65 / tools 6).

## v9.11.0 (2026-09-06)
- New: Brand approval guard (HQ TWO par 9 Great Value cleaning products "unauthorized trademark" se removed huay — approval sirf Home & Kitchen + Grocery thi). Per-store `brand_rules` (Settings → "Brand approvals": `BRAND: groups | units N`), profiles ko groups (sports/kitchen/grocery/household/baby/pets/beauty) map kiya. Pre-upload check: red = brand us group ke liye approved nahi ya remaining units 0 (Callaway, TaylorMade); yellow = brand list mein nahi ("approval?"), units < 100, ya category pata nahi. Defaults HQ TWO ki Brands & IP list se.

## v9.10.2 (2026-09-06)
- Fix (root cause): Temu ke `div[role=button]` buttons (Upload history **Refresh**, Complete product infomation) simple mousedown+click se register nahi hote the — table stale rehti thi, extension 5+ min "confirm kar raha hoon" par atki rehti thi, page khud refresh karne par foran confirm. Ab shared `temuClick()` (pointerdown/mousedown/pointerup/mouseup/click) har Temu button par.
- Late-confirm: 3 polls mein row na mile to Temu tab khud reload (2 min mein max ek baar), phir polling jari.

## v9.10.1 (2026-09-06)
- Fix: pipeline "Complete product infomation" dabata tha lekin Temu page nahi khulta tha ("30s mein nahi khula"). Ab upload tab pehle active hota hai (background tab se naya page block hota tha) aur button par poora pointer event sequence (pointerdown/mousedown/pointerup/mouseup/click), zaroorat par inner content par dobara; navigation detect kar ke report.

## v9.10.0 (2026-09-06) — UX restructure (logic same)
- Pipeline stepper (Temu Export → Upload): Export → Upload → Confirm → Errors → Fix drafts live states (run/ok/warn/bad/skip) + note; fail par step ke neeche Retry (sirf wo step dobara).
- Bulk tab "Agla step" card: hunt complete → "N products hunt ho gaye · Temu par bhejo"; upload confirm → "Upload ho gaya ✓ · agla batch".
- Header store badge: active store + aaj listed/target (e.g. "Chroma Haus · 26/50"); click → Temu Export.
- Store auto-detect: khule Temu tabs se mall name (content `TEMU_GET_MALL`). Modal open par line dikhti hai (match / mismatch / unknown); Export+Upload par agar Temu tab ka store extension ke stores mein hai to auto-switch, warna rok kar "+ Add" bolta hai (naam prompt mein pre-filled).
- Setup card (Upload tab top): store/template na ho to 2-step guide, complete hone par chhup jata hai.
- Hints → (?) button label ke saath; default hidden.
- Buttons rename + icons: "Sirf file banao", "Drafts complete karo", "Errors dekho", "Listed mark karo (N)".
- Bulk tab par "Fast mode" toggle (Settings ke sath sync).

## v9.9.2 (2026-09-06)
- Fix: "✗ Upload history section nahi mili" (Cloverhill: upload Temu par Completed 29/29 tha, lekin pipeline/late-confirm ruk gaya). Wajah: Temu page reload/naya tab hamesha "Add products by categories" tab par khulta hai — general template section aur uski Upload history DOM mein hoti hi nahi. Ab Failed details / Complete product infomation / late-confirm se pehle general template tab select karke section ka 8s wait hota hai; header th "Date uploaded, Upload ID" se fallback pehchaan bhi.

## v9.9.1 (2026-09-06)
- Fix: Temu Export sheet mein body clip ho rahi thi (flex min-height) — Pre-upload check ka "Upload N to Temu" button aadha neeche kat jata tha, click nahi hota tha. Ab body scroll hoti hai aur Cancel/Upload buttons sticky neeche rehte hain.
- Change: "$xxx high" red flag hata di — zyada price koi masla nahi (Temu apni price deta hai). Ab sirf: no images / no price (red), <3 images / bahut kam price / no category (yellow). Info (brand, default weight, listed elsewhere) chhoti grey text mein.
- Check panel compact: chhoti rows, flags title ke neeche ek line, legend hata di.

## v9.9.0 (2026-09-06)
- New: Daily dashboard (Temu Export → History tab, sab se upar): aaj kitne products listed (sab stores mila kar, per-store chips), kitni uploads, kitne errors, rozana target (default 50, wahin edit; chrome.storage.local `temuDailyTarget`) ke saath progress bar aur "Baqi", plus pichhle 7 din ki listed strip. Data listed-history (temuListed `d`) aur upload history se — koi naya storage format nahi.

## v9.8.4 (2026-09-06)
- UI polish (style.css append layer): rainbow/neon borders off (Hunt rows par calm accent bar), glows halke, Temu Export ab full-height sheet (peeche dhundla UI nahi), action buttons barabar grid, activity log 40vh. Logic untouched.
- (v9.8.3 ke fixes neeche — ek saath ship.)

## v9.8.3 (2026-09-06)
- Fix: Temu upload confirm time-out (90s file accept / 200s processing) ke baad extension "confirm nahi hua" keh kar ruk jati thi, jabke Temu par upload chalta rehta tha (HQ TWO: 28 processed, 26 added, 2 errors). Ab side panel 10 min tak har 15s Upload history row (Upload ID se) check karta hai — Completed/Action required milte hi late-confirm: listed-history save, Failed details, aur auto pipeline (Complete product infomation → Fix drafts) chalti hai.
- Fix: "Fix drafts on Temu" — "Complete product details" page khula na ho to pehle sirf upload page khol kar ruk jata tha ("Add products by categories" par). Ab khud Upload history row (aakhri upload ID, warna sab se nayi row) par "Complete product infomation" dabata hai, edit page ka wait karta hai, phir Fix drafts chalata hai; upload tab na ho to khol kar load ka wait karta hai.
- content.js: naya `TEMU_CHECK_UPLOAD` (Refresh → row by ID → "N processed, N added, N errors" / "Processing NN%"). background: uploadId/beforeSig result mein forward.

## v9.8.2 (2026-09-06)
- **Pipeline fix**: Upload history mein nayi row na milne ki asal wajah — Refresh ke baad Temu table dobara banata hai aur purana node stale ho jata tha (rows 0). Ab har poll par fresh section; phir bhi na mile to Temu tab reload kar ke ek baar dobara (Failed details + Complete product infomation dono).
- **Pre-upload check compact**: sirf red/yellow flagged products dikhte hain, saaf products "N saaf products dikhao" par; agar kisi par flag hi na ho to panel skip kar ke seedha upload.
- **Min price**: Settings → Pricing → "Min price $" (default 60) — base price is se kam nahi jati (x.99); Price × waisa hi. 0 = off.
- **Fast mode** (Settings tab → Bulk hunt): images download na karo — sirf URLs; hunt 3–4x tez. Aur image batch mein pehli image fail ho to baaki par 12s × 7 intezar nahi.
- 7 aur category profiles (Disposable Napkins, Box Tissues, Personal Cleansing Wipes, Baked/Kidney/Pinto/Black Beans, Sauces) — Temu file se; napkins/tissues ab Bounty paper towels se pehle match hote hain.

## v9.8.1 (2026-09-05)
- Bulk hunt: agar sirf images ka DOWNLOAD (ZIP ke liye base64) fail ho lekin title/price/image-URLs mil gaye hon to product ab "partial" nahi — "ok" rehta hai, row par "N img URLs · download ✗" aur summary mein count. (Pehle 25/28 Walmart products isi wajah se partial dikh rahe the; export mein sab 28 theek the.)
- Walmart brand: asal brand link `a[data-seo-id=brand-name]` pehle; footer ka "Brand Shop Directory" / sponsored carousel ke brands ab nahi uthte; cleanBrand junk (Brand Shop Directory, Shop all…) reject.
- 27 naye built-in category profiles (household / grocery / baby) — Temu ki category template (GoodsLevelMode + Valid Values) se: category keyword = Temu leaf name, REQUIRED attributes (Material / Applicable Age Group / Major Material / Composition / Food Ingredient List) Temu ki valid list ki values ke saath. Pehla match jeet-ta hai (swim diapers → diapers, disinfectant wipes → baby wipes...).
- Har category mein Individually packed / Total packaging quantity / Packaging unit REQUIRED hain (Settings → Packaging bharein).
- Food categories: Allergen Information product-specific hai — khud nahi bharte; Fix drafts khali chhod kar report karega.

## v9.8.0 (2026-09-05)
- **Pre-upload check panel**: "Export + Upload" par pehle har product ki row — flags (no images / <3 img, price high/low, no category, no brand, default weight, doosre store mein listed), price aur category wahin edit, unselect, "Clean only". Red-flag products default unselected. Phir "Upload N to Temu". Checkbox "Upload se pehle products check karo" se off ho sakta hai.
- Naye built-in category profiles: `trash_bags` (Trash Bags), `diapers` (Baby Diapers). Built-in profiles ab saved config ke saath merge hote hain (naye profiles khud aa jate hain).
- **One-click pipeline**: confirmed upload ke baad (added > 0) extension Upload history ki us row par "Complete product infomation" khud dabati hai, "Complete product details" page ka intezar karti hai (nayi/same tab) aur phir Fix drafts chalati hai. Settings → Behaviour → "Upload ke baad drafts khud complete karo" (default ON). Content action `TEMU_OPEN_COMPLETE`.
- **Packaging columns** (Settings → Packaging): SKU_type / Individually_packed / Total_packaging_quantity / Packaging_unit — values Temu template ki valid list se; khali = column khali. Temu ki golf-balls category file (GoodsLevelMode) ke mutabiq Individually packed / Total packaging quantity / Packaging unit REQUIRED hain.
- Look: refined structure par ZHunter character wapas — gradient header, logo glow, primary button glow, hunt rows par thin gradient ring, colored stat tiles.
- UI refresh ("Refined"): naya calm palette (Dark + Light), flat cards, segmented tab bar, grid background / rainbow borders / neon glow hataye, saaf buttons, inputs, switches, Temu modal aur toasts. Sirf `style.css` ke end par override layer — koi logic nahi badli.

## v9.7.6 (2026-09-05)
- Temu export: `reference_link` column ab khali jati hai (sourcing link nahi) — Temu us link se kam price suggest karta tha.
- Temu file as-is import: purani exported file mein bhi reference_link values khali kar di jati hain (Activity mein count dikhta hai).
- Confirm: Temu ke sirf product links (temu.com/...-g-<id>.html, goods.html) hunt/export hote hain; Seller Center (seller.temu.com) ke pages hunt mein nahi aate aur export mein "not a product (Temu page)" keh kar skip hote hain.

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
