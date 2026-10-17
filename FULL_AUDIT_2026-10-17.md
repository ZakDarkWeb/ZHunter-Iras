# ZHunter Iras v9.15.0 — Mukammal Audit (17 Oct 2026)

Sirf parha aur check kiya. **Koi code tabdeel nahi hua.** Asli Temu / Flow / Gemini / ChatGPT / Groq par live test nahi hua — sab findings code parh kar aur ek test copy (fake Chrome data) se hain.

Kya dekha: `manifest.json`, `background.js`, `content.js` (scrapers + Temu upload + Fix drafts + page frame), `flow_automation.js`, `gemini_automation.js`, `gpt_automation.js`, `temu_net_hook.js`, `temu_store_copy.js`, `ctx_capture.js`, `product_url_gate.js`, `audit_storage.js`, `sourcing_sync.js`, `sourcing_panel.js`, `sidepanel-shell.js`, `integrations/google_sourcing/Code.gs`, `sidepanel.js` ke ahem hisse (Library save, hunt, Temu export/upload/history/drafts, pricing), `style.css` / `sidepanel.html` (UI).

Severity: 🔴 Critical (data/paisa/galat listing) · 🟠 High (feature kaam nahi karta) · 🟡 Medium · ⚪ Low / UX

---

## A. 🔴 Critical — pehle yeh theek hon

> **Status (17 Oct, baad mein):** A1–A8 sab theek kar diye gaye (CHANGELOG "9.15.1 fixes"). Line numbers neeche purani files ke hain. A1 ke liye store switch ab DOM ke mutabiq banaya gaya — asli Temu par live test baqi.

| # | Masla | Jagah | Kya hota hai |
|---|---|---|---|
| A1 | **"Temu store follow" feature mara hua hai** | `sidepanel.js:13943` | Side panel Temu tab ko `TEMU_GET_STORE` bhejta hai, lekin **kisi bhi content script mein iska jawab dene wala code nahi**. Is liye "extension Temu mein khula store follow karta hai" (CHANGELOG v9.15) kabhi kaam nahi karta. CHANGELOG ka "upload se pehle store khud switch (header menu → Switch)" wala code bhi folder mein **mojood hi nahi** — lagta hai kisi aur editor (Codex?) ne purani `content.js` se overwrite kar diya. |
| A2 | **Upload ka store check foran fail ho sakta hai** | `content.js:2849`, `3269` | Mall name page load hote hi parha jata hai (koi wait nahi). Temu late render kare to "Store name unavailable — upload blocked" aata hai. |
| A3 | **Errors ke bawajood sab products "accepted" mark ho sakte hain** | `sidepanel.js:14264-14281`, `14525` | Temu "N errors" bataye to extension "View failed details" parhta hai. Agar woh popup na khule / tab na mile / sirf pehla page parha jaye, to failed list khaali rehti hai aur **saare products listed mark** ho jate hain → agli export mein skip, kabhi upload nahi honge. |
| A4 | **Fix drafts kamyab = poora purana upload "listed"** | `sidepanel.js:14434-14443` | Fix drafts ke baad History ka **sab se pehla** unfixed upload record utha kar uske tamam products listed mark kar diye jate hain — chahe woh record is draft se mutalliq na ho, aur chahe Temu ne submit qabool na kiya ho. |
| A5 | **Fix drafts ghalat/ghadhe hue attributes bharta hai** | `content.js:3178-3193`, `3223` | Koi value na mile to fallback: Material "Other", Age "14 Years+", Care "Hand Wash Only", Blade "Stainless Steel"… Label na mile to har dropdown ko "Surface Finishing Type = Polishing" samjha jata hai. `product-action` page par **har field required** maan li jati hai. Temu policy / ghalat listing ka khatra. |
| A6 | **Library 300 se zyada = purane products khud delete** | `sidepanel.js:6229`, `9754-9757` | Naya hunt 300 se upar le jaye to sab se purane products (starred / un-exported bhi) **pakke delete** — sirf ek toast. |
| A7 | **Partial → complete hone par Library ka data update nahi hota** | `sidepanel.js:9703-9718` | Recovery mein behtar result aaye to row ka status "ok" ho jata hai lekin **images, title, bullets, description purane (khaali) hi rehte hain**. Library "complete" dikhata hai magar images 0. (Live confirm karna hai.) |
| A8 | **Failed upload ka bhi Google Sheet record ban jata hai** | `background.js:1313`, `1356-1358` | Sourcing record upload shuru hote hi queue hota hai aur aakhir mein sync hota hai — upload fail ho tab bhi. Sheet mein woh products aa jate hain jo list hi nahi huay. |

## B. 🟠 High — features jo ghalat chalte hain

> **Status:** B1–B8 theek kar diye gaye (CHANGELOG "9.15.1 fixes round 2").

| # | Masla | Jagah | Detail |
|---|---|---|---|
| B1 | **Kai sites ke products export se "invalid product url" ho kar nikal jate hain** | `sidepanel.js:13176-13183`, `13624` | ID sirf Amazon `/dp/`, Walmart `/ip/`, Temu aur "/123456/" wale links se nikalti hai. **Amazon `/gp/product/…`, Sam's Club `…/prod12345`, AliExpress `item/123.html`, Target `A-123…`** ka ID nahi milta → product chup chaap skip. |
| B2 | **Library mein pehle se mojood link dobara hunt nahi hota** | `sidepanel.js:7703-7716`, `7995` | Partial/failed product bhi "already in Library" ho kar skip. A7 ke sath mil kar: partial product theek karne ka koi raasta nahi (sirf Library se Re-hunt). |
| B3 | **Pack products ka weight 1 unit ka** | `sidepanel.js:13697-13707` | "6 Pack - …" ki price source × 6 hoti hai lekin weight/size 1 unit ki. 8 lb wala rule bypass, shipping ghalat. |
| B4 | **Pricing settings ka asar nahi** | `sidepanel.js:13001`, `13574` | Default strategy "gap" hai aur UI mein "legacy" chunne ka koi option nahi. Is liye **Price ×, Min/Max, Department pricing table, Category Price ×, .99 rounding** sab bekaar hain — UI phir bhi "Price × 5" chip dikhata hai. |
| B5 | **Hunt ke rows sirf memory mein "safe"** | `sidepanel.js:8024-8038`, `8063-8070` | Library save fail ho to rows memory mein rakhe jate hain; panel band = rows gaye. "Product changed elsewhere" jaisi error par loop har 2 sec hamesha chalta rehta hai. |
| B6 | **Keepalive aapas mein takrate hain** | `background.js:97-124`, `1312`, `1361` | Ek hi global timer: side panel ka port band hote hi upload ka keepalive bhi ruk jata hai; max 15 min jabke late-confirm 25 min tak chalta hai. |
| B7 | **Auto-capture queue** | `background.js:1919-1958` | Lock ke baghair likhta hai (doosre writes se race), URL normalize nahi karta (duplicates), aur queue ko **500 par kaat deta hai** jabke baqi jagah 2000 limit hai → purane queued links gum. |
| B8 | **Upload job hamesha ke liye lock ho sakta hai** | `background.js:1299-1300` | Service worker upload ke beech band ho jaye to job "running" reh jata hai; har naya upload "Previous upload needs verification" deta hai jab tak confirm dialog na dabayen. |

## C. 🟡 Medium

> **Status:** C1–C10 sab theek (C1 UI round A mein, baqi CHANGELOG "9.15.1 fixes round 3"). C3 ke saath naya bug bhi mila aur theek hua: Temu ke naye "Processing results" popup mein naam nahi hote, is liye failed details pehle kabhi parhe hi nahi jate the.

| # | Masla | Jagah |
|---|---|---|
| C1 | Page frame error par bhi **hara** glow dikhata hai (`zh-done` class error ko bhi lagti hai) aur status rang (working/done/error) custom rang ke neeche dab jate hain | `content.js:5396-5397` |
| C2 | Age ka andaza ghalat: "2 Year Warranty" → "2 Years+"; Material: "Cotton Candy" → Cotton, "Iron Man" → Metal | `content.js:3238-3246`, `sidepanel.js:14294-14308` |
| C3 | Failed-details sirf pehla page parhta hai (Temu "Total N" zyada ho to baqi ignore) | `content.js:3429-3431` |
| C4 | `temuReadFailed` duplicate products ko **abhi active store** par mark karta hai (upload wale store par nahi) | `sidepanel.js:14537` |
| C5 | Upload History / Listed map ke writes mein race (late-confirm + naya upload saath) | `sidepanel.js:14587-14600` |
| C6 | In-page image card "✓ downloaded" turant dikhata hai; background fail ho to har image ke liye **naya tab khulta** hai | `content.js:3945-3959`, `5050-5077` |
| C7 | ChatGPT script ab bhi `selectAll` use karta hai (focus na ho to poora page select) — Gemini mein yeh pehle theek ho chuka | `gpt_automation.js:206`, `215` |
| C8 | Gemini/ChatGPT HUD: har message ka 6s timer purane message ke sath HUD hata deta hai (busy hote hue bhi gayab) | `gemini_automation.js:45`, `gpt_automation.js:44` |
| C9 | Har `FETCH_BASE64` poora Library data (`getData`) parhta hai — bulk hunt slow | `background.js:1494` |
| C10 | `content.js` ka harvest cache SPA navigation par reset nahi hota (pushState hook isolated world mein hai, page ka asli pushState nahi pakadta) | `content.js:39-52` |

## D. ⚪ UI / UX

1. **Har shopping page par animation**: in-page image card (rainbow border, 3 infinite spin) + full-screen page frame (infinite pulse + drop-shadow filter). Side panel ki animations CPU ke liye band ki gayi thin, lekin yeh har Amazon/Walmart tab mein chalti hain — 30–50 tabs ke bulk hunt mein CPU/GPU load. `content.js:4025, 4075, 4084, 5353-5357`.
2. **Har product tab khud "ZHunter" group mein** (default ON) — aam browsing ke tabs bhi group ho jate hain. `background.js:1929`.
3. Temu Export: **"Export + Upload" button 0 products / store na hone par bhi active**; "Select a Temu template" step ab bhi dikhta hai halanke built-in template hai.
4. "Price × 5" chip gumrah karta hai (B4).
5. Status bar "Synced 03:58 PM" — cloud sync hai hi nahi; "Local" likhna behtar.
6. `style.css`: 309 `!important`, 71 keyframes (50 infinite), 60+ version-patch blocks; `sidepanel.html` mein 85 inline styles — light mode ke masle baar baar wapas aane ki yahi wajah (DAY_MODE_AUDIT).
7. `sidepanel.js` 20,000+ lines, 225 khaali `catch(_){}` — error chhup jate hain, debugging mushkil.
8. Header comments purane: `background.js` "v9.7.5", `content.js` "v9.8.0", `.agents/AGENTS.md` "ZHunter PRO", `PROJECT_HANDOFF.md` mein purana folder path aur "Groq keys sidepanel.js mein hain" (ab nahi hain).

## E. Achi cheezein (jo theek hain)

- Library writes ab background `MASTER_COMMIT` se baseline-check ke sath (purane "stale overwrite" wala masla zyada tar khatam).
- Unticked products export mein nahi jate (`TemuReviewExcluded` filter) — purana A01 theek.
- Template ke purane rows saaf hote hain, required columns check hote hain.
- Edited image upload fail ho to export ruk jata hai (original ghalti se nahi jata).
- Groq keys code se hata di gayi hain (koi key file mein nahi mili).
- Message allowlist, rate limit, CSP, sourcing connector (lock, dedupe, formula-escape) mazboot hain.
- Sab message actions ke handlers mojood hain — sirf `TEMU_GET_STORE` missing (A1).

## F. Test kaise kiya

- Har file manually parhi; message actions ka automatic cross-check (sirf A1 missing nikla).
- Test copy (scratchpad, fake Chrome stub) mein side panel khola: Bulk, Library, Settings, Temu Export (dark + light) — console mein koi error nahi.
- Node is computer par install nahi, is liye `node --check` / repo ke tests nahi chal sake.
- **Live test nahi hua**: Temu upload/drafts, Flow, Gemini, ChatGPT, Groq, Google Sheet.
