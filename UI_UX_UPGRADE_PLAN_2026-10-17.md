# ZHunter Iras — UI/UX upgrade proposal (17 Oct 2026)

Aap ke 9 screenshots (Temu Export, review cards, Content Studio, image mode chooser, Image batch setup, Bulk tab) + code ko dekh kar. **Sirf proposal — koi code nahi badla.** Har point ke saath: masla (screenshot mein kya dikha) → upgrade.

---

## A. Sab se zyada farq dalne wale (bara asar)

### A1. Review list ki row — title nazar hi nahi aata
- **Masla (screenshot 3):** ek row mein 2 checkbox + thumbnail + title + ⚠ + "$14.11 → 4.6×" + "$64.50" + 🗑 + ⌄ — title sirf **"M."** ya **"Mem…"** dikhta hai. Asal cheez (kaunsa product) hi nahi parhi jati.
- **Upgrade:** 2-line card: upar **poora title (2 lines)**, neeche chhoti line: `$14.11 → $64.50 (4.6×) · Chicken ⚠ · 6 img`. Delete/expand ek "⋯" menu mein. Width 360px par bhi saaf.

### A2. Do checkbox per row (Upload + ✨ image edit) — uljhan
- **Masla:** har row mein do checkbox; kaunsa kis kaam ka, yaad rakhna parta hai.
- **Upgrade:** ek hi selection (tick = "ye products"). Neeche **sticky action bar**: `12 selected · ✨ Edit images · ⚡ AI titles · ⬆ Upload`. Image edit, titles, upload — sab selected products par.

### A3. Temu Export ek "modal" hai jo poora kaam karta hai
- **Masla (sab screenshots):** panel ke upar ek window, us ke andar apna scroll, us ke andar review list ka apna scroll (scroll ke andar scroll). Upar wali row "32 products" toolbar ke neeche aadhi chhup jati hai (screenshot 3).
- **Upgrade:** Temu ko **main tab** banana (Bulk · Library · **Temu** · ⚙). Ek hi scroll; header aur action bar sticky. Modal sirf chhoti cheezon ke liye.

### A4. Ek "Workflow" patti — kahan khare hain
- **Upgrade:** Temu tab ke upar 4 steps: **① Products → ② Titles → ③ Images → ④ Upload**, har step par ginti/✓ (jaise "Images: 8/12 done"). Click = us hisse par jao. Naye aur purane dono users ko pata rahe agla kaam kya hai.

### A5. Product detail = list ke andar khulna (lamba scroll)
- **Masla (screenshot 4–5):** ek card khulte hi list itni lambi ho jati hai ke baqi products kho jate hain.
- **Upgrade:** card par click → **side drawer / full sheet** khule (Title · Pack · Category · Price · Images), upar ‹ › se agla/pichla product, ✕ se wapas list wahi jagah.

---

## B. Temu Export ke chhote lekin zaroori sudhaar

| # | Masla (screenshot) | Upgrade |
|---|---|---|
| B1 | "Last hunt" khaali (0) lekin Library mein 32 — phir bhi Last hunt select (1) | Last hunt khaali ho to khud **Library** chuno, chip par "Library selected (last hunt is empty)" |
| B2 | Store ke saath **laal dot** jab ke "built-in · ready" (1–2) — laal = khatra lagta hai | Dot ka matlab saaf: ✓ hara = Temu tab mein yahi store khula; ⚪ = Temu tab band; laal sirf ghalat store par. Tooltip ke saath |
| B3 | "32 products in the list · store: …" **monospace** font, baqi sab normal | Ek hi font; info line ko Ready checklist mein mila do (dohri baat) |
| B4 | Har row par **do price chip** ("$14.11 → 4.6×" + "$64.50") | Ek chip: `$64.50 · 4.6×` (rang = floor se upar/neeche) |
| B5 | Category "Chicken ⚠ check" — "Change category…" dropdown + alag paste box | Ek **search wala category picker**: type karo → suggestions (aap ki categories + pasted Temu path), ⚠ wajah saath likhi ("frozen product, non-frozen category") |
| B6 | Title field single line, kata hua (4) | 2–3 line textarea + counter rang (60/120/180 limits) |
| B7 | Images ke neeche chhote icons ★ 🔍 🗑 + "Main" (5) | Bari thumbnails, **drag se order / main image**, edited image par "✨ edited" badge, hover/press par Before/After |
| B8 | Batch name "Members Mark Frozen" pichli dafa ka reh jata hai | Upload ke baad khaali + "pichla naam" chip |
| B9 | List mein dhoondna mushkil (32+ products) | Review list ke upar **search + filter chips**: All · ⚠ Category · Too heavy · No image · Edited · Title changed |

## C. Content Studio (screenshot 6)

| # | Masla | Upgrade |
|---|---|---|
| C1 | Bullets ek textarea — "1 point" mein saari baatein jud gayi | **Har bullet alag field** (6 tak) apne counter ke saath; "+ Add point"; drag order |
| C2 | Upar header + 3 chips + bara button + 2 dropdown — content tak 40% screen ke baad pohanchte hain | Toolbar ko 1 line mein: `[Titles][Bullets][Desc]  ✨ Rewrite (32)  ⋯` |
| C3 | Save buttons neeche disabled — kya badla pata nahi | Badle hue fields par dot + "3 unsaved changes" bar, `Ctrl+S` |
| C4 | "Compare with original" chhupa hua | Side-by-side / diff (pehle vs naya), ek click "Undo this field" |

## D. AI Images (screenshot 7–8)

| # | Masla | Upgrade |
|---|---|---|
| D1 | Mode chooser ke texts purane: "You edit in **Flow**", "Auto … each image in **Flow**", speed sirf Flow ki | Text engine ke hisaab se (Gemini / Flow / Auto = Gemini → Flow); speed sirf Flow chuna ho to dikhe |
| D2 | Batch setup header "Gemini · 1:1 · x1" — Gemini par ratio lagu nahi | Engine ke hisaab se: "Gemini · new chat every 5 images" / "Flow · Nano Banana 2.1 · 1:1" |
| D3 | "0 selected" lekin neeche "2/2 images" — selection ka matlab unclear | "Pick a task → tap products → Apply" ko 1-2-3 steps; ya default: task chuno = sab par lagu, products ko alag se badlo |
| D4 | Koi andaza nahi kitna waqt lagega | "12 images · ~18 generations · ~10–15 min · Gemini limit warning" |
| D5 | Run ke dauran sirf text status | Har image ka chhota thumbnail grid: ⏳ / ✓ / ✗ + Before/After; ✗ par Retry |

## E. Main panel (screenshot 9) aur aam cheezein

| # | Masla | Upgrade |
|---|---|---|
| E1 | Bulk khaali: "No product tabs open in this window" + bara band button | Empty state mein 2 kaam: "📋 Paste links" (khula hua) aur "🕘 Last hunt: 32 products → Temu" |
| E2 | Header "32" layers button ka matlab saaf nahi | Label/tooltip "Library 32" ya hata do (Library tab mein ginti) |
| E3 | Settings tab chhupa hua, sirf ⚙ | ⚙ = Settings sheet; sab tabs ka order: Bulk · Library · Temu |
| E4 | Toasts kabhi modal ke peeche, kabhi upar | Ek jagah: neeche Jobs patti ke upar, modal ho to modal ke andar |
| E5 | Font sizes / button sizes mixed (10–14px, kai styles) | 3 text sizes, 3 button types (primary / secondary / ghost), 1 radius (6px) — ek design system file |
| E6 | Chhote icon buttons (🗑, ★, ⌄ ~20px) — touchpad par mushkil | Kam az kam 28px tap area, tooltip |
| E7 | 300 products par list bhaari | Long list "virtual" render (sirf dikhne wale cards bante hain) — tez scroll |
| E8 | Keyboard | `↑↓` product, `Space` tick, `E` edit images, `/` search, `Ctrl+Enter` upload |

---

## G. Library + Recent hunts (screenshot 10–11)

| # | Masla | Upgrade |
|---|---|---|
| G1 | **Recent hunts ko delete karne ka koi option nahi** (code mein bhi nahi — sirf "Filter" button) | Har hunt card par "⋯" menu: **Remove from history** (products Library mein rehte hain) aur **Delete hunt + its N products** (confirm + 7s Undo). Upar "Clear history" |
| G2 | Header par "32" lekin list mein sirf 2 products — hunt filter laga hua hai lekin kahin likha nahi (dobara "Filter" dabane se hatta hai) | List ke upar patti: `Showing hunt Oct 16 · 2 of 32 products  ✕ Clear`; active hunt card par "Filtered ✓" |
| G3 | Sirf pehle 20 hunts dikhte hain, purane gayab | "Show older (N)" + hunt search (naam / date / site) |
| G4 | Card ke left par rangeen dot / star — matlab nahi likha | Site ka chhota logo/initials (AM / WM / SC) ya dot hata do — site tag pehle se hai |
| G5 | "Filter" button sab cards par ek jaisa, bara | Poora card click = filter; button ki jagah "⋯" menu (Filter · Rename · Remove · Delete with products · Export this hunt) |
| G6 | Status line "Local · **246.4 MB**" — extension storage bohat bhaari (Chrome slow) | Settings → Data mein **Storage** card: kya kitni jagah le raha hai (Library, edited images, journal, history files) + "Clean up" (purane edited images / history files / imported sheet) |
| G7 | Products aur hunts ek hi lamba scroll | Library ke andar 2 segment: **Products · Hunts** |

## F. Suggested order (rounds)

1. **Round 1 (sab se zyada asar, kam khatra):** A1 row layout, A2 single selection + action bar, B1, B2, B4, B6, B8, B9, D1, D2, **G1 hunt delete, G2 filter patti**.
2. **Round 2:** A3 Temu main tab, A4 workflow patti, A5 product drawer, B5 category picker, B7 images.
3. **Round 3:** Content Studio C1–C4, AI run grid D3–D5.
4. **Round 4 (polish):** E1–E8 design system, keyboard, virtual list.

Har round ke baad screenshots + aap ka OK. Version / ZIP wahi; GitHub push har round ke baad.
