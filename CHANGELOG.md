# ZHunter Iras — CHANGELOG

## 9.20.9 (2026-10-21) — candy "for Piñata Fillers" is no piñata; Fix drafts fills the age group
- HQ- 4 SHOP: 2 SOUR PATCH KIDS candy packs got the category "Home & Kitchen / … / Piñatas" because the title says "for Piñata Fillers Party Favors"; Temu then wanted "Applicable Age Group" and kept them as drafts. Use words ("for Piñata Fillers", "Party Favors", "Goodie / Treat Bags", "Stocking Stuffers" …) are now left out when the category is picked (`temuUseFree`). A real piñata ("Unicorn Piñata …") keeps its words.
- Fix drafts: "Applicable Age Group" on candy / snacks or party-supply categories is filled with "3 Years+" when the title names no age (before: "NEEDS YOU").
- Fix drafts report: product names were shown as ".beast-core-ellipsis-1{…}" (a <style> tag in the cell) — now the visible name.
- Fix drafts waits up to 45 s (was 20 s) for the Temu page that "Complete product information" opens.

## 9.20.8 (2026-10-21) — your own page size
- The "25 / 50 / 100 / 200 per page" list is now a small number box: type any page size from 1 to 500 (e.g. 10, 15, 30) and press Enter. Remembered. Checked: 57 products at 10 per page → 6 pages (‹ 1 2 … 6 ›), page 6 holds the last 7.

## 9.20.7 (2026-10-21) — pages in the product list, like Temu
- The product list shows one page at a time: "☐ This page   ‹ 1 2 3 ›   [25 / page]" (25 / 50 / 100 / 200, remembered). Long lists no longer need endless scrolling. A filter or search starts again at page 1.
- "This page" ticks / unticks only the products of the current page (✓ when all are ticked, – when some are). Products on other pages keep their tick and still go to upload; the page is only a view. Shift+click ranges stay inside the page.
- Checked with 57 sample cards: page 1 = 1–25, page 3 = 51–57, "This page" unticked only the 7 on page 3, paging works together with the "Not listed" filter.

## 9.20.6 (2026-10-21) — safer picking: Invert on the whole list, "Only new", warning before a 2nd store
- 27 of the 30 products uploaded to Chroma Haus went to Cloverhill too (same email). "⇄ Invert" only swapped the products the filter showed at that moment, so its result depended on the filter and was hard to predict. Invert now swaps the tick of EVERY product, the filter goes back to "All" (you see the result), and the toast warns "⚠ N of the ticked are already live on a store".
- New "✚ Only new" button next to Invert: ticks only the products that are listed on no store yet and unticks all others, whatever filter is on.
- Upload sheet: "⚠ Pehle se live — 27 · Chroma Haus par" when ticked products are already live, with one button "Sirf naye bhejo — 27 untick karo". Nothing is blocked: Upload still sends what you ticked.
- Checked with today's numbers (57 products, 24 on Charmhouse, 30 on Chroma Haus): Invert → the other 27 (0 of the Chroma Haus ones) + warning "24 already live"; Only new → the 3 products listed nowhere.

## 9.20.5 (2026-10-21) — fresh SKU for imported Temu files too
- Hunted / Library products and sheets made by this extension already got a new SKU code on every upload (since 9.18.0). A Temu file imported "as-is" (any other Temu template file) still went up with its old SKU. Now its Contribution Goods (`listing_id`) and Contribution SKU (`seller_sku`) get a fresh 4-letter code on every upload and on "Export file only" (an older code is replaced). Titles, prices and everything else in the file stay as they are. Checked on the real built-in Temu template: `CH-SAMSCLUB-20203019292-Multipack` → `CH-SAMSCLUB-20203019292-VLDD-Multipack`, `…-K7Q2-…` → `…-VLDD-…`.

## 9.20.4 (2026-10-21) — the filter decides what is uploaded
- Filter "Not listed" showed 33 products, but the upload sheet said "Jayenge 57 products": the filter only hid the others, their ticks stayed. Now products the filter / search hides count as unticked — "N selected", the ready row, AI titles and the upload use only the ticked products you can SEE (`temuRvOff`). Back to "All" → the hidden ones count again with their own tick. The "Unticked" view is only for looking and changes nothing.

## 9.20.3 (2026-10-21) — one toolbar line
- The product count ("57 products" / "33 of 57") is shown faintly inside the search box (right side, stays while you type) instead of next to it.
- Search · Filter · Tools · Collapse now stay on ONE line (Collapse no longer drops to a second line).

## 9.20.2 (2026-10-21) — more room for the products
- The filter bar under the chips keeps only "N shown · 🗑 Delete shown" — "Select for images", "Unselect" and "Learn category again" are removed (the ticks / Tick first / Invert already do this).
- The filter chips fold up again after you pick one (the chosen filter stays on the Filter button).
- The product list uses the panel's height (it stopped at 62 % of the screen, leaving empty space below), and the search box no longer shrinks to "Searc".

## 9.20.1 (2026-10-21) — hide the toolbar rows above the product list
- New "Hide" button next to Filter / Collapse: folds away the "Tick first … Apply / Invert" row, the filter chips and the filter buttons, so the products are not squeezed under a tall sticky toolbar. Press "Tools" to show them again. Remembered (per browser). The top row may wrap on a narrow panel instead of overflowing.

## 9.20.0 (2026-10-21) — simple: the tick decides
- No automatic skip and no questions any more: every ticked product is uploaded. Already-listed products are never left out or blocked (the "Skip them / Upload anyway / Fix duplicates" rows and the Settings switch "Pehle se listed product dobara nahi" are gone). Every file still gets a fresh SKU, so Temu's "SKU duplicated" does not come back.
- Filters: "✓ Listed" and "Not listed" come first (a Temu-rejected product counts as Not listed). The "Duplicate" filter and the "Fix duplicates" / "Unmark listed" buttons are removed.
- Card label: only a green "Listed" (store + date in the tooltip).
- The source line only notes "N ticked products are already listed — they will be uploaded again".

## 9.19.2 (2026-10-21) — separate choice for listed and duplicate products; "Fix duplicates" works
- The ready row has one line per kind, each with its own buttons: "24 listed on Charmhouse — [Skip] [Upload again]" and "6 duplicate on Charmhouse — [Skip] [Upload again] [Fix duplicates]". Click a chosen button again to undo. Only a kind you have not decided yet stops the upload. The source line follows each kind ("— skip honge" / "— upload honge" / "— faisla baqi"). Checked with 57 sample products: skip/skip → 27 go, skip/again → 33, again/skip → 51, again/again → 57.
- "Fix duplicates" said "No duplicate products in the list" when the list was collapsed (it looked at the drawn cards). It now works on the product data: ticks only the duplicates, sets them to "Upload again" and starts the AI title rewrite.

## 9.19.1 (2026-10-21) — one rule, one count, with the store name
- On Cloverhill the ready row said "30 already listed … on this store" while the source line said "24 already listed · 6 duplicate" — two different rules, and the products were on Charmhouse, not Cloverhill. Now ONE function (`temuListedWhere`) decides for the export, the ready row, the source line and the card label, on the same (ticked) products: "24 listed on Charmhouse · 6 duplicate on Charmhouse" (checked with 57 sample products, on Cloverhill and on Charmhouse).
- Ready row question: "Upload these products again? [Skip them] [Upload anyway] [Fix duplicates]".

## 9.19.0 (2026-10-21) — simpler: two labels and one "Fix duplicates" button
- Product cards show only two labels: green "Listed" (store + date in the tooltip) and red "Duplicate" (Temu rejected it in this store: "Contribution SKU duplicated"). The "✓ Charmhouse · 10-21" / "✗ Charmhouse · duplicate" store labels are gone.
- Filters renamed to match: "✓ Listed" and "Duplicate".
- New "Fix duplicates" button (in the ready row when duplicates are ticked, and in the filter bar): ticks ONLY the duplicate products, lets them through ("Upload anyway"), and starts the AI title rewrite (Title Optimizer, GPT / Gemini) for them. The SKU is new anyway (every file gets a fresh code). Then press Upload.

## 9.18.9 (2026-10-21) — "24 already listed · 6 duplicate", not "30 already listed"
- The marks were right after "Upload errors" (24 uploaded, 6 duplicate) but the ready row and the source line counted both as "30 already listed". Duplicates now have their own red chip "6 duplicate (old listing in store)" and the source line says "24 already listed · 6 duplicate". Skip them / Upload anyway still apply to both.

## 9.18.8 (2026-10-21) — checked live on Temu (read only): Upload errors finds the right history
- Tested in the user's Chrome without uploading or submitting: Bulky Candies "Processing results" → 30 lines, 24 Added, 6 duplicates (lines 8, 11, 24, 29, 31, 34), one page, complete — the reader gets all of it. "View failed details" names now read correctly ("HERSHEY'S Sweets Mix…"; the old code got ".beast-core-ellipsis-2{…").
- Found live: the plain `upload-goods-multiple.html` link opens the "Add products by categories" tab, whose Upload history holds other, old files (September) — the upload was "not found". "Upload errors" now switches to "Add products via general template" first.
- The page keeps the hidden tab's history block too; the history finder now takes the VISIBLE block first (a hidden one could be picked because its text still matched). The same finder is used to spot a new upload, so this also protects auto upload.

## 9.18.7 (2026-10-21) — review of today's changes: 4 more mistakes fixed
- Categories tab: a category you deleted came back — since 9.17.5 every store's categories are shared, but the delete removed it from the active store only. It is now removed from every store.
- History "listed today" number and the daily chart counted Temu-rejected duplicates as listed. They are left out now.
- Learn categories: after a 75 s time-out the old typing could still run in the Temu page while the next try typed into the same box. The page is reloaded before trying again.
- After an upload the "already listed — skip / upload again" source line kept the old choice until something else changed. It is refreshed when the upload ends.

## 9.18.6 (2026-10-21) — source line follows "Upload anyway"
- After choosing "Upload anyway" the source line still said "6 already listed — skip honge" (it only looked at the Settings checkbox). It now follows the choice in the ready row: "6 already listed — dobara upload honge (aap ka faisla)" / "skip honge".

## 9.18.5 (2026-10-21) — "✓ Uploaded" shows what Temu really added
- Bulky Candies: "✓ Uploaded" showed the 6 products Temu REJECTED (duplicates were marked like uploaded products) and none of the 24 it added (that upload ended "nothing marked" because the result list was not read completely).
- Duplicates get their own mark: red "✗ Charmhouse · duplicate" label, counted under "✗ Temu rejected" and "Not uploaded yet" — never under "✓ Uploaded" (they are still skipped / asked about on the next upload, since an older listing is in that store).
- Reading Temu's processing results ("Upload errors" or after an upload) now also marks the products Temu ADDED as uploaded — only when every line was read and matched.

## 9.18.4 (2026-10-21) — you choose: skip already-listed products or upload them anyway
- Ticked products that are already listed (this store, or another store of this Chrome) no longer just block the button ("Fix first · 6 already listed"). The ready row asks: "Some products are already listed on this store: [Skip them] [Upload anyway]".
- Skip them → they are left out, the others are uploaded. Upload anyway → they go to the store again (with the fresh SKU of 9.18.0). Undo → asks again. The choice is for one upload only (reset afterwards); the Settings checkbox stays the default.

## 9.18.3 (2026-10-21) — "Upload errors" reconnects to the Temu tab
- After reloading the extension, "Upload errors" said "Tab …: cannot reach the page (reload it)" and 'Store "Charmhouse" has no "Add products via upload" tab' although that page was open. It now reconnects to the tab by itself (script injected again / page refreshed), the same way "Fix drafts" does.

## 9.18.2 (2026-10-21) — "Upload errors" knows which products Temu rejected
- More tools → "Upload errors" read Temu's rows but said "Line 8 (no product of this export)" for every one: it had no product list (only the last export in memory, empty after a reload). It now takes the newest upload of the active store from History — its product list and Upload ID — so every line is matched to its product (marked, and shown by "✗ Temu rejected").
- The older "failed details" popup gave ".beast-core-ellipsis-2{-webkit-line-clamp…" as product name (a <style> tag inside the cell). The name is now read as visible text.

## 9.18.1 (2026-10-21) — upload only the products Temu rejected
- When Temu's failed details are read (automatically after an upload, or History → errors button), the products Temu did NOT add are saved in that History record (`failedIds`). The History errors button now uses THAT upload's products (before: the last export in memory, which could be another file).
- New filter "✗ Temu rejected": products Temu did not add in an upload to the active store (and did not accept later).
- New button in the filter bar: "↺ Unmark listed" — forgets that the shown products were uploaded to the active store, so "Skip already listed" lets them through again. Workflow: History → read errors → Filter "✗ Temu rejected" → ↺ Unmark listed → Tick first N / Select all → upload (fresh SKUs since 9.18.0).

## 9.18.0 (2026-10-21) — a fresh SKU for every file
- Temu spots a product it already has by its Contribution SKU, which was always the same for a source product (`CH-SAMSCLUB-20203019292-Multipack`). Now every new file gets its own 4-letter code after the source id: `CH-SAMSCLUB-20203019292-K7Q2-Multipack` (Contribution Goods the same, without the variant). "Store export" (ZC-) no longer copies the exact Temu Goods ID either: `ZC-610054921121032-K7Q2-Std`.
- The source id stays in its place, so "Import sheet" in the other Chrome still finds the product (checked). On by default (`sku_fresh: false` in the store config turns it off).
- The extension's own "Skip already listed" check is unchanged (it works on the source link, not the SKU) — switch it off in Settings when you want to upload a product to the same store again.

## 9.17.9 (2026-10-21) — "Contribution SKU duplicated" shown as what it is, not as drafts
- Bulky Candies on Charmhouse: 24 added, 6 "drafts". Temu's "View failed details" said for all 6: "Contribution SKU duplicated with another product (Goods ID …)" — those products were already listed in that store. "Fix drafts" had nothing to fill and only pressed Submit.
- After an upload with errors ZHunter reads Temu's failed details (once more after 6 s if the popup was not complete), marks every "SKU duplicated" product as listed in that store (skipped next time) and saves the count + the most common other reason in the History record (`dups`, `failWhy`).
- Result card: "N already in store" number and a plain reason line; those are no longer counted as drafts. "Fix drafts" shows / runs automatically only for real drafts — not when every error was a duplicate.

## 9.17.8 (2026-10-21) — "Fix drafts" presses Temu's Submit again
- "No Submit button could be pressed": Temu renamed the bottom bar's class (`.flexCenter-2dxu4` → `.btn_wrapper-3JoSo`). The page's Submit is now found by its text (last visible, enabled "Submit" outside the table) — checked on the saved "Complete product details" page.
- "12 drafts" for 6 products: every variant (SKU) line was counted and listed as its own draft. Now the products are counted; a variant line is still checked but shown only when it needs something.
- When nothing was submitted the report no longer says "Drafts submitted" — it says to press Submit on the Temu page by hand.

## 9.17.7 (2026-10-21) — "Fix drafts" finds the page it just opened
- "Fix drafts" pressed "Complete product information" on Temu's upload history, but then said '"Product action required" or "Complete product details" page is not open' — the click opens `products-excel-multiple-edit.html` in a new tab, and only `product-action.html` was looked for, for 2.5 s. Now both pages are looked for, up to 20 s, the newest tab first.

## 9.17.6 (2026-10-21) — product count in the file name, "⇄ Invert" ticks
- Every exported / uploaded sheet has its product count in the name: `temu_upload_Bulky_Candies_30.xlsx` (download, Temu upload and History copy).
- New "⇄ Invert" button next to "Tick first … ✓ Apply": the ticked products of the list become unticked and the others ticked — 30 done on Charmhouse → one click → the other 27 for Cloverhill.

## 9.17.5 (2026-10-21) — learned categories follow the product (other store, other Chrome, new title)
- One category list for ALL stores of this Chrome: categories made in any store, every per-product choice and every learned title are shared (`temuCatShared` in settings; built once from what each store had saved). A category learned on Charmhouse is known on Cloverhill.
- A category that Temu or you picked for a product is remembered for that product (by its source link / SKU) and is never marked ⚠ again — also after "AI titles" gave it a new title (`cat_trusted`). "Learn category again" forgets it as before.
- Import sheet in the other Chrome: the category written in a sheet made by this extension is now used as that product's category (no ⚠, no "Learn categories" needed). If the store does not have that category yet it is added. A category you already chose for that product in this Chrome stays.

## 9.17.4 (2026-10-21) — tick 20 / 30 products in one go
- New row above the product list: "Tick first [30] of 57 ✓ Apply" (Enter works too). The first N products the list shows (after filter / search) are ticked, all others unticked — so exactly N go to upload / AI titles. The number is remembered.
- Shift+click a tick: every shown product between the last clicked tick and this one gets the same tick (tick or untick a whole range).

## 9.17.3 (2026-10-21) — "Learn categories" no longer gets stuck while opening the Temu pages
- It sat at "Opening 2 Temu 'Add new product' pages…" with an empty Product name box: the small 2nd window covered the 1st Temu page, and a covered page never answers. Now the two pages take turns at the front (like the Gemini tabs): the page whose title is pasted comes forward with its window, Temu's suggestions are read, then the other page gets its turn.
- Every Chrome step has a time limit (open page 15 s, page load 20 s, paste + read 75 s); a page that does not answer is tried again, and a 2nd page that cannot be opened is simply left out. Live status: "Opening Temu page 2 of 2…", "Waiting for the Temu pages to load…".
- ✕ stops the run at once and closes the pages it opened; "Learn categories" can be started again right away. The counter starts at "0 / N" (it showed the old "1 / 1").

## 9.17.2 (2026-10-21) — "Learn categories" no longer says "good category" for ⚠ products
- "Learn categories" gave 4 ⚠ products a smart guess (e.g. Mars Fun Size Fruity Candy → Coated Fruits) and then said "All products already have a good category ✓", while the list still showed ⚠. A smart guess is now used only when the list would NOT mark it ⚠; otherwise Temu is asked for that product.
- "All products already have a good category" shows only when nothing was guessed. "pcs / ct / oz / lbs / qty" no longer count as matching words.

## 9.17.1 (2026-10-21) — smart category: fewer wrong guesses
- Wrong picks like "Mars Halloween Variety Pack Mini & Fun Size → Coated Fruits", "Airheads Spooky Mix → Candy Mints" and "Swiss Miss Hot Cocoa Single Serve → Coffee Capsules & Pods": the match was made on size / pack / form words. Words such as mini, fun size, single serve, flavored, assorted, count, pack, original, spooky, king size no longer count — neither in titles nor in the category name.
- A long title now needs about a third of its product words to match a learned product (2 shared words were enough before). Unsure → no smart guess; Temu suggests the category instead.

## 9.17.0 (2026-10-21) — split one product list over several stores
- Every product card on the Upload tab shows where it already went: "✓ Charmhouse · 10-21" in that store's page-frame colour (tooltip: store, date, accepted). The label appears right after an upload and goes away after "Unmark last upload".
- Two new filters: "Not uploaded yet" and "✓ Uploaded". Workflow for 2 stores: tick the half you want → upload to store 1 → switch store → filter "Not uploaded yet" → Select All → upload.
- One product goes to ONE store: while "Skip already listed" is on, a product that already went to another store is skipped too ("already on Charmhouse (date)"), and the source line counts it as already listed.

## 9.16.3 (2026-10-21) — daily counter is plain text, not a round chip
- The "TODAY [25 Gemini #1]" pill under AI Image Studio looked like a round button. It is now one plain line: "Made today: 25 images · Gemini account 1" (amber / red text only near or at a real limit). Same counter, same tooltip.
- No round buttons or pill-shaped labels left: filter chips, source counts, preset chips, History / bulk badges, step numbers, image tags, the lightbox close button and the category search clear button now have small square corners (override block at the end of `ui_polish.css`). Tiny status dots, spinners, switch knobs and progress bars stay round.

## 9.16.2 (2026-10-21) — Gemini / ChatGPT tabs take turns at the front (user's idea)
- Instead of moving every Gemini / ChatGPT tab into its own window (9.16.1), the tabs stay in one window and take turns: the tab whose image + prompt go in is brought to the front, the image is attached, the prompt typed and Send pressed while it is visible, then the next tab gets the front (`zhFrontTurn`). Waiting for the picture happens in the background (a tab that has been in front once keeps working, as the user saw). ChatGPT keeps the front ~20 s after its send. Flow keeps its own windows.

## 9.16.1 (2026-10-21) — AI tabs really work together, no false limit warning
- 4 Gemini tabs: only the front tab worked, the others showed "press Send in this Gemini tab" until you clicked them. Chrome never draws a tab that sits behind another tab of the same window (even with the background switches), and Gemini / ChatGPT need a drawn page to finish the upload and Send. Now every Gemini / ChatGPT / Flow slot is the front tab of its OWN window: the first stays where it is, every other one that shares a window is moved to a new small window beside it (`zhSlotOwnWindow`). Keep those windows open (not minimized). Flow's "one window in background mode" is undone for the same reason.
- "⚠ … left today (usual limit ~20)" appeared although Gemini never showed a limit: ~20 was only a built-in guess. The warning (and the amber "near ~N" chip) now shows only after Gemini / Flow really showed a limit on this or another account (`zhDailyReal`).

## 9.16.0 (2026-10-21) — version bump
- manifest.json 9.15.0 → 9.16.0 (the side panel header shows it). Covers everything below since 9.15.0: error log, parallel AI tabs (Gemini / ChatGPT / Flow), screen-lock pause, smart categories, Title Optimizer tabs + Gemini titles, filters + bulk bar, Content Studio redesign, Settings / History / Upload upgrades, page frame labels. From now on every change round bumps the version (user's wish).
- Products source buttons: label + count stay on one line ("Import sheet 40" wrapped to 2 lines).

## Export + Upload button names the store (2026-10-21, same manifest version)
- The main button now says "Export + Upload to HQ- 4 SHOP" (the active store; "… to Temu" when no store is set) and changes as soon as the store changes. While uploading it still says "Processing...". A long store name is cut with "…".

## Temu Export mockup redesign — wapas liya (2026-10-21)
- User ko pasand nahi aaya; Upload + Settings tab pichli haalat (5 upgrades + Settings/History) par wapas. `View on Temu` → products.html fix rakha.

## Temu Export → Upload tab: 5 upgrades (2026-10-21, same manifest version)
- **Store naam ek dafa:** sirf setup card mein. "N products in the list · store: …" aur Upload ke upar wali row se hataya; woh row ab sirf "Ready to upload / Fix first / No store" + "N of M ready" + issue chips.
- **Products source ek line:** "📚 Library · 40 products · avg 2.4× (lowest 2.0×)" (Last hunt / Library (selected) / Imported sheet; "last hunt khaali" jab khud Library chuni). "N already listed — skip honge / skip OFF: dobara jayenge!" warning wahi (amber, usi line ke neeche). Purani 3 alag lines chhupa di.
- **Upload se pehle confirm:** "Export + Upload to Temu" (aur list ka ⬆ Upload) pehle ek chhoti sheet kholta hai: **Store naam bara**, "Jayenge N products", "Bahar rahenge M" (no category / too heavy … ginti ke saath), batch name (yahin badal sakte hain). **Upload** = purana upload flow chalta hai, **Cancel** / Esc = kuch nahi.
- **Batch name suggestions:** box ke neeche "Pichle:" chips — aakhri 5 batch names (`zhTemuBatchRecent`, purana `zhTemuBatchLast` bhi shamil). Click = box bhar jata hai. Naam upload shuru hote waqt save hota hai. Purana "↺ Last" chip chhupa diya.
- **Result card:** Upload button ke neeche: upload ke dauran "⏳ Uploading…", Temu processing ke waqt "⏳ Temu processing…", mukammal par "✓ Sab upload ho gaya" ya "⚠ kuch kaam baqi" + **38 added · 2 drafts · 0 failed (· skipped)**. Buttons: **Fix drafts** (sirf drafts hon to; wahi temuFixDrafts), **View on Temu** (Temu ka Upload history page), **Details** (Activity log khol kar wahan scroll), ✕. Numbers history record se aate hain, is liye late-confirm / failed-read / draft fix ke baad card khud update hota hai.

## Temu Export: Settings aasaan + History naya (2026-10-20, same manifest version)
- **Settings → Price & stock (pehli dafa khula):** 4 numbered steps Roman Urdu mein: ① Price kaise banegi (Cost + gap / Multiplier), ② **Misaal** — live: "Source $10 → $61.74 (6.2×)", $20, $45, $100 aur Frozen $20 (kati hui price tooltip mein); jo number likhein foran yahan dikhta hai, save se pehle bhi, ③ Gap ki **table** ("Cost $10 tak → +$50 … $120 se zyada → +40%") + gap list box aur Frozen extra (Multiplier wale par: Price ×, kam se kam, zyada se zyada), ④ Stock min / max. List price × "Advanced" mein. Description & bullets: "Mana lafz" box "Advanced" mein band. Package, Automatic kaam, Title ke lafz, Listed history — saaf Roman Urdu naam / hint; kam badalne wale cards "ADVANCED" heading ke neeche. Settings ka matlab aur storage keys wahi (sirf labels / tarteeb). Jab tak aap ne koi card khola/band nahi kiya, "Price & stock" khula rehta hai.
- **History (poora naya):** "Aaj" card — Target / din, 4 tiles (Listed · Uploads · Errors · Baqi), bar (target poora = hara), **Pichle 7 din** chhote bars asli ginti ke saath (dashed line = target, target poora din = hara, tooltip mein uploads). "Upload history": search (title, SKU, upload ID, batch, file) + store, **segmented filter** All / Uploaded / Needs fix / Files ginti ke saath. Har record ek **card**: status (Uploaded / N need fix / Sent — check / Not uploaded / File banai / Listed), waqt, batch / file naam, store · source, chips (products, +added, errors, skipped, **Upload ID — click = copy**), "Products (N) · Skipped (N)" kholo = list (skipped ki wajah ke saath). Buttons: ✓ Mark listed, **Read errors** (Temu se is Upload ID ke failed products — Upload tab ki Activity mein), ⬇ File, CSV, 🗑 delete. Khaali / filter mein kuch nahi = saaf empty state + "Show all". Export all (CSV), Manage → Clear all.

## Content Studio (Open Studio) redesign (2026-10-20, same manifest version)
- **Kam scroll:** upar ka hissa ab chhota: patla header ("Content Studio" + 1/40 + ✕), ek product row (‹ list ›), aur **ek hi toolbar line**: [Title | Bullets | Desc] chips + violet **"Rewrite 40"** + ⚙ **Options**. Options (default band) mein: "Rewrite this product only", "Products to rewrite", "Instructions". Instructions likhi hon / custom mode on ho / kuch products untick hon to Options par violet dot. Status line patli. Title box pehle se kaafi upar aata hai.
- **Temu Export jaisa look:** wahi cards (surface-2, line-2, 10px corners), segmented chips jaise Temu tabs, cyan save / violet sirf AI (Rewrite, Rewrite title, this product only), same buttons, fonts aur counters (mono, bina pill ke).
- **Light mode:** cards safed par halki shadow ke saath, editor ka background alag, counters / chips / meta / compare boxes sab parhne layak.
- **Bullets:** har point ka number badge (cyan), poori chaudai ka box, neeche counter aur "Remove" (pehle chhota ×), points ke beech zyada jagah, "+ Add point  3 / 6" poori chaudai ka dashed button.
- Logic wahi: zhTextDecode / zhTextSplitBullets / zhTextSnapshotRaw / zhTextSnapshot, saare ids aur handlers (rewrite, compare, undo, save this/selected, Ctrl+S, unsaved patti). Narrow panel (≤440px) par footer 2 lines mein.

## AI Image Studio "Select All" follows the list filter (2026-10-20, same manifest version)
- With a filter / search on the product list (e.g. "Mars" + Not edited = 2 shown), AI Image Studio's "✓ Select All" ticked all 57 products. Now it ticks ONLY the products the filter shows (toast says so), and "✕ Clear" clears only those; with no filter both work on the whole list as before.

## Store switch follows everywhere + Content Studio text fixes (2026-10-20, same manifest version)
- After switching the store on Temu (e.g. HQ TWO → HQ- 4 SHOP) the setup card changed, but "40 products in the list · store: HQ TWO" and the store row above Upload kept the old name (one switch path never refreshed them). Now every store save (temuSaveStores) refreshes both.
- Content Studio showed shop HTML codes ("Easy to store &amp; keep fresh") and one long bullet that holds all features in one box. The Studio now shows decoded text (& ' " …) and splits such a run-on bullet into separate points (at "• |", sentence ends, and CAPS headings like "JUST BLACK TASTING NOTES:"; max 6). Saved edits are still matched against the stored text (raw + cleaned), so nothing earlier is lost. Export already decoded "&amp;".

## Smart category v2: fewer wrong guesses, guesses never spread, Undo + "Learn again" (2026-10-20, same manifest version)
- The user's list showed wrong guesses (Mars chocolate → "Candy & Chocolate Coated Fruits", Fruit Strips → Coated Fruits): "candy" / "chocolate" are in the name of every Temu candy category, so they matched everything. Now a word that appears in 2+ different learned categories never counts; a category-name word counts only when the title has ≥ 60 % of that name's own words ("Coated Fruits" needs both). Same samples now: Mars, Hershey's, Fruit Strips, Fruit by the Foot → asked Temu; Butterfinger → Gifts, Blow Pops / Dum Dums → Lollipops, "Chocolate Coated Dried Fruit" → Coated Fruits.
- A smart pick is now only a guess for that one product (category override): it is NOT learned (no examples, no ledger, not used for more guesses), so one wrong guess never spreads to other products.
- "↶ Undo N smart picks" button above Details after a run takes the run's guesses back.
- Filter bar: new "🔁 Learn category again" — forgets the saved category (override, learned examples, ledger) of the products shown and asks Temu for them again (no replay, no guess). Use it with a search ("Mars", "Hershey", "Fruit") to fix the earlier wrong ones.

## Learn categories: no more "stuck at Opening tabs" (2026-10-20, same manifest version)
- The 2nd Temu "Add new product" tab opened behind the first one in the same window; Temu only shows category suggestions on a page that is really on screen, so that tab waited — and the window kept saying "Opening 2 Temu tabs…" while it worked, so it looked frozen. Now: tab 1 = your Temu tab (brought to the front), every extra tab = its own small window (focused: false) beside it; 1 product = 1 tab only; while learning the window shows what each tab is doing ("Tab 1: 🤖 pasting "…" — waiting for Temu", "no suggestion — reopening the page…", "short pause…"). Extra windows close at the end as before.

## Temu review list: bulk actions for the filtered products (2026-10-20, same manifest version)
- While a filter or search is on, a bar under the chips shows "N shown:" with ✨ Select for images · ✕ Unselect · 🗑 Delete shown. They work ONLY on the products the filter shows (hidden ones are never touched). Select skips products without pictures; Delete asks first and removes the products from the list and the Library (same as the single 🗑). The bar is hidden when the filter is "All" with no search.

## Temu review list: "Images edited" / "Not edited" filters (2026-10-20, same manifest version)
- Two new chips under Filter: 🖼 Images edited (at least one picture of the product was edited with AI — edit journal) and 🖼 Not edited (has pictures, none edited yet) — to find the products still to do in a long list.

## Flow 2 tabs: one window in background mode (2026-10-20, same manifest version)
- Each extra Flow tab used to open in its own new window (needed in normal Chrome, where hidden tabs sleep). In background mode (lock-pause setting OFF, Chrome with the background switches) the extra Flow tab now opens as a tab in the same window as the other Flow tab (a window is only made when no Flow tab exists at all). Normal Chrome keeps the separate windows.

## Gemini / ChatGPT tabs really work together + Gemini "no picture" → new chat (2026-10-20, same manifest version)
- With 3 Gemini tabs in one window only one moved: the runner brought each tab to the front in turn ("opening the Gemini tab for a moment so it keeps working…", every 30 s) and switched to a tab before every send — needed for normal Chrome, where hidden tabs sleep. With the background switches this is not needed: when Settings → "AI images: pause when the screen is locked" is OFF ("background mode", `zhBgMode`) tabs are never brought to the front / switched, so all tabs work at the same time. ON = the old behaviour (normal Chrome).
- Gemini sometimes finishes its answer with NO picture (text only / nothing) — the run waited up to 9 min. Now: answer finished (no Stop button, nothing loading) and quiet for ~25 s without a picture → "Gemini answered without a picture", and the same image is sent again in a NEW chat.
- Not tested on the live Gemini page.

## Gemini: finished picture read at once (2026-10-20, same manifest version)
- Errors page showed "[ZHunter Gemini] image found but could not be read" (lh3.googleusercontent.com …=s1024-rj): the Gemini page may not read that picture (CORS; the canvas way is blocked too), so it kept retrying until a later try worked — that was the slow "replace" step. Now the picture is fetched by the extension worker with your Google sign-in first (new message `FETCH_GEMINI_IMAGE`, only from gemini.google.com and only for googleusercontent.com), the old ways stay as fallback.
- Not tested on the live Gemini page yet.

## Setting: pause image runs on a locked screen — on / off (2026-10-20, same manifest version)
- Settings → "AI images: pause when the screen is locked" (`zhLockPause`, default ON). Turn it OFF when Chrome is started with the background switches (--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling): then Chrome keeps the AI pages running while the window is minimized / covered / the screen is locked, and the run should not pause.

## Image runs: locked screen pauses, Flow never stays stuck (2026-10-20, same manifest version)
- Windows lock (Win+L): Chrome treats all windows as hidden and stops drawing the Gemini / ChatGPT / Flow pages → Gemini stopped, Flow's Generate click did nothing ("Generation did not start"), images timed out as failed. Now (new permission `idle`): when the screen locks the run pauses by itself (status "🔒 Screen locked — paused"), on unlock it resumes; an image that failed during the lock goes back in the line (2-tab runner) instead of counting as failed.
- Flow single-tab run: after a Flow error (e.g. "Generation did not start after clicking Generate") it used to wait for you — 37 min stuck. Now it sends the same image again after 20 s (2×, waits while paused), then marks it failed and goes on ("Retry failed" later). Unusual activity keeps its own handling (wait + new project).
- Note: a Flow run started BEFORE the 2-tab update still runs single-tab — reload the extension and start the run again for 2 tabs.

## Flow: 2 tabs at once (2026-10-20, same manifest version) — user's choice
- Auto image editing with engine Flow used ONE tab (one image at a time — the old rule against "unusual activity" and wrong-product results). Now a Flow run with 2+ images uses the 2-tab runner (like ChatGPT / Gemini): tab A = your open Flow tab, tab B = a second Flow window (own window, so Chrome does not throttle it). Each tab works in its own project, one image at a time, ~3–9 s pause between images. `FLOW_TABS = 2`.
- No wrong product: each image is sent straight to its tab (`ZH_FLOW_RUN_DIRECT`) and its result comes back under its own job id (storage `zhFlowRes_<id>`) — the single-tab `pendingFlowAction` record is not used by these jobs. Pack → Background stages, edit journal, daily counter, Stop and Retry failed work as in the 2-tab runner.
- "Unusual activity" in a tab: that tab waits 60 s, opens a new project and tries the same image again; max `FLOW_NP_MAX` (2) per run, then the run stops with a message (finished images are kept).
- Learn categories: the extra "Add new product" tabs the extension opened are closed when learning ends (your own Temu tabs stay open).
- Files parse; NOT tested on the real Flow / Temu pages — first try with 3–4 images.

## Learn categories: 2 Temu tabs at once + smart category by similar titles (2026-10-20, same manifest version)
- Was: one Temu "Add new product" tab, every title pasted / typed one after the other (38 candies = 38 rounds), and after some titles Temu stopped suggesting. Each pick only remembered that exact title, so "Skittles" never got the category already picked for "Tootsie Pops".
- Smart category (user's rule): each title's product words are compared with every product learned before (your earlier picks + this run). Brand, sizes / counts and filler words (Halloween, bulk, wrapped, variety, gift, party …) are left out. ≥ 2 shared words = same category; a short title (≤ 3 product words) needs 1 strong word = a word of the category name ("Dum Dums Lollipops" → Lollipops). Two categories fitting equally = not guessed (Temu is asked). Runs before Temu and again after every new pick, so one candy pick covers the rest. The list of smart picks is shown in Details to check.
- 2 Temu tabs (`TLC_TABS = 2`, user's choice) learn at the same time; each waits 2–5 s between titles; a tab where Temu stops suggesting leaves to the seller home and comes back once. The window still shows one result at a time (first suggestion auto-accepted after 2 s). Titles Temu gave nothing for are done at the end the old way (your own categories → you paste in Temu).
- Tested the matcher on sample titles: Hershey's / Mars / Brach's → Candy & Chocolate Assortments, Blow Pops / Dum Dums → Lollipops, Callaway → Golf Balls; "Candy Thermometer" and coffee → asked Temu. 2-tab run NOT tested on real Temu.

## Title Optimizer: Gemini next to ChatGPT (2026-10-20, same manifest version)
- The chat tab is now "💬 GPT / Gemini" with a ChatGPT | Gemini switch (remembered). "Send to Gemini" sends the ticked titles to your open Gemini chat (or a new chat + the title prompt first), waits until the answer stops changing, reads the numbered list and shows the same preview → "Apply titles". Titles still land only on the products of that list (same batch ids as before).
- gemini_automation.js: new titles job (`ZH_GEM_TITLES_START`, same `zhGptTitlesJob` / `zhGptTitlesResult` keys with `engine: 'gemini'`): turns "Create image" off in that chat, types → sends (or asks you to press Send) → reads the answer list; a new Gemini tab picks the job up by itself; stops with a message on a Gemini limit. A Gemini tab that the image runner is using is never taken. gpt_automation.js ignores Gemini jobs.
- Manual copy/paste texts are now for both chats. NOT tested on the real Gemini page — first try with 3–5 titles.

## Title Optimizer: one way at a time — 3 tabs (2026-10-20, same manifest version)
- The section showed 5 ways at once (AI rewrite, own-prompt edit, Shorten / Remove brand, custom instructions, a long ChatGPT copy/paste block) — big and confusing. Now 3 tabs, each with one line of help and one main button:
  - ⚡ AI rewrite — "AI Title Rewrite (N)"; below it the quick "Shorten Title / Remove Brand"; "+ Extra wish" (old custom instructions) folded.
  - ✏️ My prompt — your instruction box → "AI Edit with my prompt"; saved prompts under it.
  - 💬 ChatGPT — chat choice + "Send to ChatGPT" (Auto); the answer preview + "Apply titles" right there; the manual copy/paste (3 numbered steps) and the prompt editor folded under "Manual".
- Progress / Stop / Undo are shared under the tabs. The last tab you used is remembered. All element ids are the same, so every button works as before.
- Checked on a local copy with the real CSS: tabs switch, only one way visible. NOT tested in the extension.

## Workflow strip: ✓ only when a step is really finished (2026-10-20, same manifest version)
- "① Products ✓ 57" and "④ Upload ✓ 54" looked as if the products had been uploaded — the ✓ only meant "found" / "ready". Now: Products = cyan "57 found", Upload = cyan "54 ready" (tooltip: not uploaded yet), and Upload turns ✓ "N uploaded" only after Temu accepted products (counted when they are marked 'accepted', kept 30 min). New state `ready` in ui_polish.css.

## Side panel: hidden errors now visible — Error log (2026-10-19, same manifest version)
- New `error_log.js` (loaded before sidepanel.js). 326 places swallowed every error silently (`catch (_) {}`, `.catch(() => {})`), so real code bugs were never seen. They now call `zhQuiet(err)`, which keeps ONLY programming bugs (TypeError, ReferenceError, RangeError …) and ignores normal failures (closed tab, page not ready, cancelled, network, rate limit …). Also recorded: uncaught errors, unhandled promise rejections, `console.error`, and `console.warn` calls that carry an Error. Deduplicated (×count), file:line of our code, last 200, storage `zhErrorLog`.
- Settings → Data → "Error log": count, list (newest first), Copy (to send to the developer) and Clear.
- Files: sidepanel.js (253 + 8 + 57 + 8 catches), text_studio.js (1), temu_workspace_ui.js (2). The guard `typeof zhQuiet === 'function' &&` keeps code that runs inside web pages (executeScript) safe. Behaviour of the catches is unchanged (same return values).
- Checked: all 6 main JS files parse; log test — TypeError recorded (×2 dedup), "No tab with id" and "Failed to fetch" ignored, unhandled ReferenceError + console.error recorded. NOT run inside the real extension yet.
- GitHub push from this computer's terminal failed (no GitHub login here) — push from GitHub Desktop ("Push origin").

## Page frame Auto colours: really one colour per store / site (2026-10-19, same manifest version)
- All Temu stores had the same colour: the frame was drawn before Temu showed the store name, so every store got the "Temu" colour and it was never updated. Now the frame watches the store name (and a store switch) and redraws; until the name is there it is grey.
- Each store gets its own colour from a 16-colour list and keeps it (saved in `zhStoreColors`) — the first store the first colour, the next store the next free one, so two stores never share a colour (the old hash could).
- Site colours made clearly different: Amazon orange, Walmart deep blue, Sam's Club violet, eBay yellow … (Walmart and Sam's were both light blue). None uses the cyan / green / red status colours.
- Tested on a local copy (real content.js, fake Temu header): Charmhouse orange → Cloverhill violet → HQ TWO pink → Charmhouse orange again. NOT tested on the real Temu page.

## Page frame: status labels, progress colour, Auto / My colour, Breathe, live preview (2026-10-19, same manifest version)
- Labels on the page while ZHunter works: "ZHunter · Hunting…" → "ZHunter · Hunted ✓ · 13 img" / "Hunt failed ✗"; on Temu "ZHunter · Uploading to Temu…" → "Uploading · Temu received the file" → "Uploading to Temu · 45%" (live from Temu's "Processing data %") → "Upload done ✓" / "Upload failed ✗". A thin progress bar fills inside the label.
- Auto colour (new default, Settings → "Border Shine Color" → Auto): each site its own colour (Amazon amber, Walmart blue, Sam's sky…), each Temu store its own colour, cyan → green while a job runs (follows the %), green when done, red on error. "My colour": tap a preset / the picker (or the "My colour" button) → the border always keeps your colour, the status shows in the label + dot. Off = the "Page frame" switch (no border, no label). Setting `zhFrameColorMode` ('auto' | 'custom').
- New moving style "Breathe": the border softly fades in and out (opacity only — the lightest animation).
- Settings → Page frame: live preview box (Idle / Hunting / Uploading / Done) with your colour, style, speed, corners and thickness — no need to open a shopping page to see a change.
- Changing any frame setting now redraws the page in its current state (before it always re-applied your colour, even while ZHunter showed a status).
- Tested on a local copy of a Sam's page (real content.js): upload label + 54 % bar + mixed colour, Wave / Breathe running endlessly, My colour → purple, Auto back, card ring follows Moving; preview box rotates. NOT tested on real Amazon / Walmart / Temu pages.

## Page frame: "Moving / Animated Border" moves again (2026-10-19, same manifest version)
- The UI round had cut the moving border to ONE sweep (and the working pulse / dot to a few beats) to save CPU, so with "Moving / Animated Border" on it looked like it did not work. Since that switch is your own opt-in, the border now keeps moving (Laser / Dual / Wave, your speed), the working pulse and dot run while ZHunter works. It pauses in hidden tabs; off = still frame as before.
- The floating image card follows the same switch: spinning ring + glow on the round button and a moving edge on the open card when it is on, calm when it is off.

## AI images: photo line v2 (2026-10-19, same manifest version)
- The line is now: "Photo quality: the product is in sharp focus edge to edge, with crisp outlines and fine texture detail. All printed text, logos and labels on the pack stay exactly the same, sharp and readable. True-to-life colours, clean even lighting without harsh glare, no motion blur, no AI smoothing or plastic look, no artefacts — high-resolution, professional e-commerce photo." It protects label text and colours, and drops "studio lighting / no depth-of-field" so scene backgrounds are not flattened.

## AI images: sharp photo line in every prompt (2026-10-19, same manifest version)
- Every image prompt now ends with "Photo quality: sharp focus, shot on 50mm lens, f/8 aperture, clean studio lighting, high texture detail, crisp edges, no motion blur, no depth of field blur." — auto runs (Gemini / ChatGPT / Flow), manual "Paste in …", Edit Studio "Paste in Flow" and every "Copy prompt". Added once (never twice). Tick "Sharp photo line" in the Edit Images mode chooser turns it off/on (storage `zhImgQualityOn`, default on). The prompt shown in the boxes stays as you wrote it; the line is added when it is sent / copied.

## Bulk hunt: same product open twice (2026-10-19, same manifest version)
- The skip message said "12 tabs skipped — already in your Library" also for products that were simply open in two tabs (only one copy is hunted). Now it says which: "N already in your Library · M opened twice (same product — only one copy hunted)". The tab list marks the second copy with a "2×" badge and does not pre-select it; duplicates inside one hunt are now skipped even when the Library is empty.

## Bulk tab list: "already in Library" uses the same check as the hunt (2026-10-19, same manifest version)
- The tab list marked a tab 🔁 / unticked it only when its URL was exactly the saved one; the hunt compares the product ID (Amazon ASIN, Walmart / Sam's item id …) and only counts complete Library products. So products saved under a slightly different link showed as new and stayed ticked in the list, and only at "Hunt" did the toast say "12 skipped — already in your Library" (the progress then counted just the rest). Now the list uses the hunt's rule: those tabs get the 🔁 badge, are not pre-selected, and the "N tabs selected" count is what will really be hunted.

## Temu "Processing results" with one page (2026-10-19, same manifest version)
- Upload with errors (e.g. 26 products, 24 added, 2 "Saved as draft — Re-check the trademark or brand information") said "Temu reported 2 error(s) but ZHunter could read only 2 failed product(s) — NO product was marked". Cause (user's DOM, 19 Oct): when the list fits on one page Temu shows no pagination and no "Total N items", so the read was treated as incomplete. Now a single page with all result filters on counts as the complete list → the 24 added products are marked, the 2 drafts are listed with their reason and "Fix drafts" runs.

## AI titles without a Groq key (2026-10-19, same manifest version)
- With no Groq key saved, "AI titles" tried every product, each failed with "AI keys are cleared" and each one was written to Chrome's Errors page. Now it checks once at the start: one message (toast + Details) pointing to Settings → Groq API Keys, nothing is changed and nothing is logged. If the key disappears mid-run, the rest is skipped instead of failing one by one.

## Temu Export: Cancel button (2026-10-19, same manifest version)
- While "Export + Upload to Temu" runs, a red "✕ Cancel" button shows under it. Before the file reaches Temu (image upload, file build, Temu tab loading, store check) Cancel stops everything, closes the Temu tab it opened and says "nothing was sent". If the file was already handed to the Temu page, Temu keeps processing it (can't be taken back): the panel stops waiting, says so, and shows "Mark as listed" for after Temu confirms. Background message `TEMU_UPLOAD_CANCEL`; job state 'cancelled'.

## Temu review list: filter chips folded away (2026-10-19, same manifest version)
- The 6 filter chips (All · ⚠ Category · No image · Unticked · ✨ For images · AI titles) are now behind a "Filter" button next to Collapse (closed by default), so the list gets the space. The button shows the active filter's name and turns cyan when a filter other than All is on.

## Hunt: "title not found" on titles starting with "Cart…" (2026-10-19, same manifest version)
- The filter for Amazon's temporary "Adding to Cart…" / "Loading…" titles matched any title that only STARTED with those words, so "Cartoon Design Urethane Golf Balls" (and e.g. "Loading Ramp…", "Processing Tray…") was wiped → "title not found". Now only the whole temporary text is rejected (content.js scrapeAmazon + final title check, sidepanel.js fallback).

## Bulk hunt "Tabs at once" fix (2026-10-19, same manifest version)
- "Tabs at once" = 1 still hunted 3 tabs together: the limit only applied to sleeping/loading tabs, already-loaded tabs ran up to 3 per site (8 total). Now the setting is the hard cap for every tab. Note: default 3 is now really 3 (before loaded tabs could run up to 8).

## UI/UX round 2 (2026-10-18, same manifest version)
- **Workflow patti (Temu Export → Upload, sab se upar):** ① Products → ② Titles → ③ Images → ④ Upload, har step par ginti: Products = tick kiye products, Titles = jin ka title badla (AI ya aap ne, `zhTextEdits`), Images = ✨ products jin ki koi image edit hui (`zhImgEdits`) / ✨ products, Upload = ready ginti (masla ho to laal "!" aur tooltip mein wajah). Rang: hara ✓ = mukammal, amber = aadha, laal = upload ruka. Step click = list khol kar us hisse par scroll + halki chamak (Titles/Images ka collapsible khud khulta hai).
- **Product drawer:** review list mein product par click = poori Temu window par ek sheet khulti hai (Title · Pack · Category · Price · Images, sab purane buttons ke saath). Upar ‹ › = pichla/agla product (← → keys, filter ke hisaab se), "List" / ✕ / Esc = wapas list, usi jagah (card halka chamakta hai). List ke andar card ab lamba nahi khulta. Image "Main" / delete / undo ke baad sheet naye data ke saath khuli rehti hai; sheet se product delete = sheet band.
- **Category picker (search wala):** "Change category…" dropdown aur alag paste box ki jagah ek hi box: khaali par "Suggested" (is product ke liye best 5), likhne par aap ki categories mein dhoond (naam + path), poora Temu path paste karein (A / B / C) to "↳ Use pasted Temu path". ↑ ↓ Enter / click se chunein. Save pehle jaisa (sirf is product ka override + title example yaad). ⚠ ke saath ab wajah likhi hoti hai: "frozen product, non-frozen category", "could also be …", "no category matched this title" waghera.
- **Product images (drawer):** bari thumbnails (2 column grid), upar kone mein "Main" / number, buttons ab 28px (aasaan click). **Drag se order badlein**: image ko kheench kar dusri image ke aage/peeche chhorein, pehle number par chhorein = naya Main. Save safe tareeqe se (har copy + Library ka fresh patch, `zhLibPatch` — kabhi poori purani list nahi), per-image "AI" tick usi tasveer ke saath move hota hai. Edit hui image par **"✨ edited"** badge (`zhImgEdits` journal se, order badalne ke baad bhi).
- **Content Studio:** har bullet ka **alag box** (6 tak), har box ka apna counter (x/200), × se hatao, "+ Add point". Badle hue field ke label par amber dot. Neeche patti **"N unsaved changes"** + **Ctrl+S** = save (selected; warna yahi product). Har field par **Compare** = Original aur New saath saath (hataye lafz laal/kate, naye hare, likhte waqt live) aur **↶ Undo** = sirf us field ki unsaved tabdeeli wapas. Save/validation pehle jaisi (claims rule waghera).
- **AI image run (stepper) → Results:** list ki jagah **thumbnail grid**: har image ka tile, kone mein ⏳ waiting / ⚙ working / ✓ done / ✗ failed. **Before | After** button (sab tiles par original ya nayi image), tile daba kar rakhein = dusri version. Failed tile par **↻ Retry** (sirf wahi image dobara). Upar **andaza**: "12 images · 18 generations · ~5–9 min left" (Gemini ~25–45s, Flow ~20–40s + speed wala pause, har generation; aakhir mein "took ~N min"). Tap = select (Redo / Revert / Replace pehle jaise).
- **Shopping pages (Amazon / Walmart … `content.js`) — 8 endless animations band:** card ka rainbow ring, minimize button ke 2 ghoomte ring (ab static), loading skeleton (ab 4 sweep phir ruk), download button shine (hover par ek dafa), page frame ki "Moving" beam (ab frame aate waqt 1 chakkar, ZHunter kaam shuru par 2, done/error par 1), working pulse (4 dafa), status dot (5 dafa). Moving mode mein full-screen `drop-shadow` + `brightness` filter hataya (sirf box-shadow glow). Rang / status (cyan working, hara done, laal error) wahi.
- **Aaj ki AI images ka counter:** AI Image Studio mein "TODAY" patti: har engine / Gemini account ki aaj ki ginti (Gemini #1, Gemini #2 …, ChatGPT, Flow). Roz khud reset (`zhAiDaily`). Limit aaye to us account par laal "limit", aur woh number yaad (`zhAiLimitSeen`) = agle din ka "usual limit"; jab tak koi limit nahi dekhi, andaza Gemini/ChatGPT ~20, Flow ~100. 80% par amber "near ~N". Edit Images shuru karte waqt agar run ko us se zyada images chahiye jitni aaj baqi hain → warning toast + stepper ke andaze mein "⚠ limit". Ginti tab hoti hai jab AI se image wapas aaye (2-tab Gemini/ChatGPT runner aur Flow result).
- **Settings → Data → Storage card:** dikhata hai kya kitni jagah le raha hai (patli bar ke saath): 🔒 Library products (kabhi saaf nahi), Edited images & text records, Upload history files (.xlsx, IndexedDB), Imported sheet, Finished job leftovers (Flow / AI / reports), 🔒 Settings & baqi. Har saaf hone wali cheez ke saath "−KB". **Clean up…** → confirm (kya hatega, kitna khali, "Library aur starred nahi chhuye jayenge") → sirf: un products ke edit records jo ab Library / last hunt / sheet kahin nahi (1 din se purane), purani history files (naye 10 rehte hain, History list wahi), imported sheet (sirf tick karne par, default off), mukammal jobs ke leftovers (chalta Flow job / chalti image queue kabhi nahi). Library products / starred kabhi delete nahi.
- **Kya asli par test NAHI hua:** sab kuch local test page par chrome-stub ke saath chala (Library, review list, drawer, category save, image drag + Library patch, Content Studio save + Ctrl+S, stepper grid, counter, storage clean). Asli Temu upload, Gemini / Flow / ChatGPT run (counter ki ginti aur limit), Amazon/Walmart page frame (`content.js`) aur asli extension storage par test nahi hua — pehli dafa 2–3 products se check karein.

## UI polish: refined colours + micro-animations (2026-10-18, same manifest version)
- New `ui_polish.css` (loaded after style.css; remove its `<link>` in sidepanel.html to undo). Refined cyan: neon #00E5FF → softer #22D3EE everywhere in style.css, deeper navy surfaces, less glow. AI buttons (Content Studio rewrite, bulk AI titles) are violet so they stand apart from save/upload (cyan). Light mode: readable small/meta text (--ink-4), defined --line-3 / --text-dim.
- Short event-only motion is always on now (before, zhFx 'off' set every transition to 0 ms): button hover/press, tab switch fade, row/card hover lift, image thumb zoom, switch knob spring, modal open/close, toast slide-in/out, progress bar easing. Zero idle CPU — endless decorative loops (empty-state bob, button glow/shimmer, blinking dots) are off unless zhFx = 'full'.
- prefers-reduced-motion (Windows "Animation effects" off) turns all animation and transitions off.
- Temu Export → Upload: the two red "✗ No store / ✗ 0 of 0 ready" chips + red "⛔ …" line above the upload button are now one slim full-width row: store name (or "No store") on the left, "N of M ready" on the right. A thin left border shows the state (green ready, amber store/products missing, red products block the upload); the reason is the row's and the upload button's tooltip. Issue chips (red dot = blocks upload, amber = left out; click = jump to product) show under the row only when there are issues.

## 9.15.1 UI/UX round 1 follow-up (2026-10-18)
- The separate ✨ image-edit checkbox on every product row is back (user's choice): the upload tick and the ✨ tick are independent again, as before Round 1. "Select All / Clear" for images are back; choosing a pack, Studio or an image "AI" tick marks the product ✨ again.
- Action bar shows "✨ Images (N)" = the ✨ selected products; new filter chip "✨ For images".
- AI Image Studio progress title said "ChatGPT" while Gemini was working (the 2-tab runner serves both engines); it now names the real engine. Same for the failure toast and the Redo "queued" message.
- sidepanel.js on disk had been replaced by an older copy (the 17 Oct commit 293cb90) — the Round 1 version was put back first.

## 9.15.1 UI/UX round 1 (2026-10-17, same manifest version) — see UI_UX_UPGRADE_PLAN_2026-10-17.md
- Library → Recent Hunts: every hunt card has a "⋯" menu — **Remove from history** (products stay in the Library) and **Delete hunt + its products** (asks first, Undo for a few seconds). "Clear history" button above the list (asks first, Undo). Before there was no way to delete a hunt.
- Library: when a hunt filter is on, a bar above the list says "Showing hunt Oct 16 · … — 2 of 32 products  ✕ Show all"; the active hunt's button says "Filtered ✓" (before the filter was invisible and the list looked half empty).
- Temu review list: new 2-line row — the whole title (2 lines) is readable, below it ONE price chip "$64.50 | 4.6×" (red under the floor), category name (⚠ when doubtful) and image count. Bigger delete button.
- ONE selection: the second "✨" tick per row is gone. The ticked products are used for upload, AI titles AND image editing ("Select All / Clear" for images are hidden; choosing a pack, Studio or an image tick also ticks the product).
- Sticky action bar under the list: "N selected · ✨ Images · ⚡ Titles · ⬆ Upload" (presses the same buttons as before; a disabled one shows its reason).
- Search box + filter chips over the list: All · ⚠ Category · No image · Unticked · ✨ AI updated ("2 of 32" count).
- Title field is a 3-line box (whole title visible; Enter does not add a line break).
- Source: when "Last hunt" is empty and the Library has products (and you have not picked a source yourself), the Library is chosen with a note "Library selected (last hunt is empty)"; a new hunt switches back.
- Store dot: green = a Temu tab shows this store, grey = no Temu tab open, amber = Temu shows another store (switched at upload), red only when no store is set. It used to be red even when the store was set (it was checked once before the name had loaded).
- Batch name is cleared after a clean, Temu-confirmed upload; "↺ Last: name" chip puts it back with one click.
- Image mode chooser: texts follow the engine (Gemini / Flow / Auto = Gemini → Flow); the speed choice shows only for Flow / Auto. Manual studio with engine Auto starts in Gemini (was ChatGPT). Image batch setup header per engine ("Gemini · fresh chat every few images …", "Flow · newest Nano Banana · 1:1 · x1").
- Tested in the stubbed panel at 380 px, dark + light: hunt menu remove / delete + Undo / clear history, filter bar, rows, search, chips, action bar count, mode chooser texts, last batch chip. NOT tested live on Temu (store dot colours, batch name after a real upload).

## 9.15.1 AI images: Gemini + Flow (2026-10-17, same manifest version)
- Flow model: always the NEWEST "Nano Banana" in Flow's menu (now 2.1; later versions automatically), never a "Lite" one (before, "Nano Banana 2.1 Lite" counted as correct and "2" could be picked over "2.1"). If the menu cannot be read, the job goes on with the selected model and shows a warning instead of failing. The status line names the model used.
- Flow: the multi-MB image of each job is removed from extension storage as soon as the Flow tab has taken it.
- Gemini finish: the same honest summary as the other engines — "N replaced · N failed (press Retry failed)", the window stays open when something failed (before: it closed at once and always said "All selected images processed successfully!").
- Auto engine = Gemini → Flow (ChatGPT stays as its own engine, not in Auto). Auto's Gemini step now uses the full Gemini runner (new chat every few images, account switch on a limit, CAPTCHA stop, retry on "I encountered an error", wake-up of a background tab, safe image download).
- Gemini limit: first the next signed-in Google account (as before); when every account is at its limit, the images that are not done yet continue in Flow by themselves ("Gemini limit — N continue in Flow"). A Google CAPTCHA still stops the run (solve it yourself).
- "ZHunter AI" window: Gemini / ChatGPT / Flow tabs now work in their own Chrome window, so your own window never loses its tab during a run. Keep that window visible (side by side or on a 2nd screen) — Chrome slows down tabs of a minimized / fully covered window. A window's last tab is never moved out.
- "Paste & Next": one path for every engine (edit journal, counters, pack label and stages handled; the old Gemini-only branch skipped them).
- UI labels: "Nano Banana (newest)", Auto option "Auto (Gemini → Flow)".
- Tested in the stubbed panel: model choice from a menu (2 / 2.1 / 2.1 Lite / Veo / Imagen → 2.1; Lite rejected), Gemini limit → 3 of 4 images handed to Flow, Gemini summary with a failure, AI window moves / new tabs / last-tab guard. NOT tested live on Gemini or Flow — first run with 3–4 images.

## 9.15.1 fixes round 3 (2026-10-17, same manifest version) — audit C2–C10 + Temu "Processing results"
- Temu upload results (C3 + new bug): Temu now shows "View processing results" (a text button) and a "Processing results" window with Line · Goods ID/SKU ID · Status · Failure reason and NO product names. The extension never found that button (it pressed "Complete product infomation") and matched failures by name, so failed details were never read. Now: the right button is pressed, EVERY page of the window is read (next page until the end), and each "Line" is matched to the product of the uploaded file (line 5 = first product). Only "Added" products are marked accepted; duplicates ("SKU duplicated … Goods ID") are marked listed in the store the file was uploaded to (C4); drafts / failed are not marked and their reason is shown. If not every line could be read, nothing is marked (as before). Also: when the page has two "Upload history" blocks, the one with real uploads is used.
- Ages / materials (C2): an age is read only with an age / child word ("Ages 3+", "Kids", "5 years old", "8+ years"); warranty, supply, anniversary and aged-food numbers are ignored ("2 Year Warranty", "12 Year Old Scotch", "Cheddar Aged 2 Years"). "Cotton Candy", "Iron Man", "Glass Cleaner", "Plastic-free", "Shaving Foam" … no longer give a material. Same rules in the export and in Fix drafts.
- Upload History writes wait for each other (C5): a late confirmation and a new upload no longer overwrite each other's record.
- In-page image card (C6): shows the real result ("N downloaded · N failed") and never opens one new tab per failed image (a single-image download may still open the picture); downloaded files get the right extension.
- ChatGPT (C7): clears only its own message box (never the whole page). Gemini / ChatGPT (C8): the on-page status box no longer disappears in the middle of a run.
- Background (C9): image downloads use settings kept in memory instead of reading all stored data for every image.
- Page scraping (C10): after Walmart / Temu change the product without reloading, old image / video data is no longer reused.
- Tested: syntax of all changed files; the reader on your saved Temu pages (right button, right history block, 30 rows on page 1, a simulated page 2 → 50 / 50, duplicate + failed rows); Line → product matching and marking (complete / incomplete); 16 age and 8 material sample titles. Not live-tested on Temu, ChatGPT or Gemini.

## 9.15.1 UI round, part C (2026-10-17, same manifest version) — Jobs, language, light mode
- Jobs patti in the bottom status line: a running hunt ("🔎 Hunting 12/30"), Temu upload ("⬆ Temu processing 45%", also while ZHunter keeps watching a slow upload) and image edit ("🖼 Gemini 3/10") are shown together; click one to open its window. With no job the line shows the Library count as before. "Synced" → "Updated" (there is no cloud sync).
- Language: buttons / tabs / labels stay short English; help lines are now Roman Urdu (all Settings rows, Temu Settings hints, pricing / weight tips, empty screens). Two Roman Urdu buttons became English ("Latest from Flow", "Image from device"). Broken characters fixed ("No hunts yet", AI model list).
- Light mode: Library's selected filter chip ("All") was white on white — now cyan with white text; Hunt "N images" badge count readable; Image batch setup inputs, selects and task chips follow the light theme (were always dark); its header/help text darker. Mode chooser, Edit Studio, AI image stepper, Content Studio and Temu Export were measured and are already fine in light mode.
- Tested in the stubbed panel: automatic contrast scan of the main tabs and windows in light mode, Jobs patti with a fake hunt + image run, syntax check.

## 9.15.1 UI round, part B (2026-10-17, same manifest version) — Temu Export window
- Ready checklist above "Export + Upload": store, "N of M ready", and chips for what needs you — red = would stop the upload (already listed / no image / no or suspicious price), amber = left out while the rest goes on (no category / too heavy / not usable). It is a dry run of the same export rules on the ticked products. Click a chip → the product list opens at that product.
- "Export + Upload" stays off while there is no store, no product or a red item; the reason is shown under the checklist (and the button no longer says "Processing…" when it is only waiting for you).
- Under the pricing chip: "Price vs source: avg N× · lowest N×" for the ready products.
- Upload steps above the report: File → Store → Processing (%) → Result, each green / amber / red with a short note (also for late confirmation and failed-details checks). The full text report is now under "Details". Source line says "N products in the list" (not "ready").
- Tested in the stubbed panel at 360 / 420 px, dark and light: checklist counts, button guard, chip jump, untick → ready again, steps.

## 9.15.1 UI round, part A (2026-10-17, same manifest version) — calmer pages
- Page frame on shopping / Temu pages: thin (3 px default) and still — no pulse, glow animation or full-screen drop-shadow unless "Moving / Animated Border" is on. While ZHunter works on the page it is cyan, green when done and RED on an error (before, an error also glowed green; your custom colour hid the status colours).
- In-page image card: the spinning rainbow border and the two spinning rings of the small button are replaced by a plain cyan border (these ran in every open product tab).
- Tab group: product tabs are no longer grouped while you just browse; only the hunted tabs are grouped when a hunt starts (setting renamed "Group hunted tabs into a ZHunter tab group").
- Tested on a sample product page: no endless animation left on the frame or the card; working = cyan, error = red.

## 9.15.1 fixes round 2 (2026-10-17, same manifest version) — audit B1–B8
- Export no longer drops these links as "invalid product url": Amazon /gp/product/…, Sam's Club …/prod12345678, AliExpress /item/….html, Target …/A-12345678. (Amazon /dp/ and Walmart ids are unchanged.)
- Hunt: Library products that are partial / failed (no images or no real title) are hunted again; only complete ones are skipped as "already in your Library".
- Weight: your own "N Pack - " titles (Pack buttons) now ship N × the weight (price already used source × N); the 8 lb limit is checked on the pack weight. Source titles like "Pack of 6" are not changed.
- Pricing strategy selector (Temu Settings → Pricing): "Cost + gap (tiers)" (default, same as before) or "Multiplier (Price ×, Min / Max, Department)". Only the chosen strategy's boxes are shown; the Upload-tab chip shows the active one ("Pricing: Cost + gap" / "Price × 5"); review prices follow it at once.
- Hunt rows that cannot be saved to the Library are also kept in storage and saved automatically when the panel opens again; after 8 failures the retry slows down (15 s) instead of looping every 2 s, and stops when the hunt is over.
- Background keepalive: every task has its own keepalive (side panel, hunt, upload). Closing the panel no longer stops a running upload's keepalive; uploads are kept alive up to 30 min.
- Auto-capture queue: uses the same locked, de-duplicated path as everything else, limit 2000 (was cut to 500, older queued links were lost). A full queue keeps the newest link.
- Interrupted upload: the message now says which upload (file, store, time, minutes ago); older than 30 min → clear "I checked it, continue" question.
- Tested in the stubbed panel: product ids for all link forms, pack weight (×6, too-heavy skip), both pricing strategies + selector/chip, partial re-hunt split, unsaved-row keep/restore. Not live-tested: background keepalive / auto-capture (service worker).

## 9.15.1 fixes (2026-10-17, same manifest version) — audit A1–A8 (see FULL_AUDIT_2026-10-17.md)
- Temu store follow works again: the Temu tab now answers "which store is open" (header store name, waits up to 15 s while the page loads). The missing handler was the reason the extension never followed the Temu store.
- Upload auto store switch: if Temu shows another store, the extension switches ONCE (hover store name → Switch → the card with EXACTLY the same name; only letter case / extra spaces ignored, so "HQ TWO" ≠ "HQ - TWO"), waits for Temu's reload, opens the upload page again and checks the name again. Not found / menu did not open / still wrong → upload stops, nothing is sent. Fix drafts never switches stores (it stops with a message).
- Upload / Fix drafts / failed details: the store name is waited for (no more instant "Store name unavailable").
- Errors on Temu: products are marked as listed only when Temu's COMPLETE failed list was read; otherwise nothing is marked and "Mark as listed" is shown.
- Fix drafts no longer marks any upload record / products as listed (Submit ≠ accepted). Check Temu, then use "Mark as listed".
- Fix drafts: no guessed values any more ("Other", "14 Years+", "Hand Wash Only", "Stainless Steel", golf → Rubber, unlabeled dropdown → "Polishing"). Only title / category / your own rules & defaults; the rest is listed as "NEEDS YOU". Fields count as required only when Temu marks them required. "No battery" options are picked only when the title has no battery/electric words.
- Library above 300: you are asked first (once per hunt); starred products are never deleted; Cancel keeps everything.
- A partial product that later hunts complete now gets its missing title / images / bullets / description (your own edits are never replaced).
- Google Sheet sourcing record is written only for products Temu confirmed (not at upload start, never for a failed upload).
- Tested: syntax of content/background/sidepanel; store switch logic on the saved Temu "Switch stores" page (exact-name pick, current store, unknown store); Library cap + partial upgrade + confirmed-marking cases with a stubbed panel. NOT tested live on Temu (hover menu, reload after switch) — try with 2–3 products first.

## 9.15.0 (2026-10-07) — Hunt rework: product-only links, verification hold, reliable images
- Categories: new fallback matcher that needs several words of the title (never one word) to agree with a category. A product with no category no longer blocks Export/Upload — it is left out and the error is shown; the rest goes on. Export no longer opens Temu to learn categories by itself.
- Learn categories: when Temu gives no suggestion, the extension picks the best match from your own categories (Categories tab) by itself and saves it; only products with no match wait for your paste.
- Learn categories: auto tries at most 2 times (paste, type); if Temu shows no category it stops auto for the rest and waits for you (paste the category from another login). Manual wait before skipping is now 2 min.
- Learn categories: new "paste the Temu category here" box + Use button — when Temu stops suggesting, copy the category from another Temu login and paste it; it is saved and remembered like a normal pick.
- Learn categories: every category you pick is also written to its own ledger (title → Temu path) at once; after a reload, a store switch or a new run those products are re-applied silently and never asked again.
- AI image editing: the plan of a run (images, engine, prompts) is saved when it starts. After a reload / shutdown a bar 'Continue (N left)' appears above the product list; images already edited are kept and only the unfinished ones run again. 'Discard' clears it.
- Learn categories: if Temu gives no category within ~40 s the product is skipped and the next one starts; skipped ones are listed at the end.
- Export: an edited image that fails to upload is retried (3 more rounds); if it still fails the export STOPS with a clear message instead of sending the ORIGINAL picture by mistake.
- Learn categories: no longer hangs when Temu picks a category by itself and shows no suggestion list — the extension presses 'Reselect' (twice at most) to open the list, and if there is still none it shows Temu's own pick with a note so you can Skip.
- AI image Engine list: Gemini is now first and the default for a fresh start (your last choice is still remembered). Flow is last — it runs one image at a time and stalls when its tab is in the background.
- Gemini: 'image found but could not be read' fixed — if the direct read of the generated image fails, it is now read with login cookies, then through the extension's background fetch, before the canvas fallback.
- AI images (ChatGPT / Gemini): new 'Auto' tab count (default) — up to 10 images use 1 tab, 11–25 use 2 tabs, more than 25 use 3 tabs. Picking a number by hand still overrides it.
- Gemini: the 'improve image' prompt is now a stronger scene-style prompt when the engine is Gemini (ChatGPT keeps its own prompt).
- Gemini automation: Chrome freezes a Gemini tab that stays in the background, so images got stuck until the tab was opened. Now, if an image takes longer than ~25 s (or attaching takes >20 s), the extension brings that Gemini tab forward for ~3 s, then returns you to the tab you were on (one tab at a time, every 30 s at most).
- Temu Export list: replacing/changing an image no longer collapses all product cards — expanded cards and scroll position are kept; only 'Collapse All' closes them.
- Hunt: products already in the Library are skipped before any tab is opened (queue and open tabs), with a message.
- Library cap: max 300 products; above that the OLDEST are removed with a warning (the extension gets slow with more).
- Gemini: when an account hits its limit, the tab moves to the next signed-in Google account (/u/N) and the same image is sent again.
- Gemini results: large PNG results are saved as high-quality JPEG (0.95, up to 4096px) to save memory.
- Temu store sync (reversed): the extension now FOLLOWS the store open in Temu — on Export/Upload and whenever a Temu seller tab is opened/loaded/focused it reads the store name and switches its active store to the same one (if added). If no Temu tab is open, the old fallback (switch Temu to the extension's store) still applies.
- Temu upload: if the store open in Temu is not the extension's store, the extension switches it automatically (header menu → Switch → store card), checks the name, reopens the upload page and goes on; it stops with a clear message if the store is not in the account.
- Export + Upload: products already listed on the active store now stop the upload with a warning (list shown) instead of being skipped silently.
- Export: products with no category now start "Learn categories" automatically (Temu's first suggestion is taken), then the export continues.
- Temu Export: the "Import sheet" button always opens the file window, even when a sheet is already loaded.
- Temu Export: when a sheet is loaded, "Choose another sheet" and "Remove loaded sheet" buttons appear under Products source (the Import sheet tab only switched back to the old sheet).
- Temu upload: if Temu does not react to the file in a background tab, the tab is brought forward after 12 s and the file is chosen once more after 35 s (before giving up at 90 s).
- Pricing: products with a copied store price (not recalculated before) are now raised to the 2× / Frozen 3× floor of their source price, in the list and in the export; a price you type yourself is never changed. Source→multiple chip works on them too.
- Temu Export: every product row shows "$source → N.N×" (green = at/above the 2× floor, 3× Frozen; red = below).
- Pricing: the 2× floor also applies to the list price; Frozen items use a 3× floor (`price_floor_frozen_x`, default 3).
- Pricing: selling price is never below 2× the source price (any category, incl. N Pack = source × N). Setting `price_floor_x` (default 2).
- Edit Studio Copy: when the background cannot download the image (asleep / over 6 MB), the side panel now downloads it itself — fixes "image could not be downloaded".
- Edit Studio: image Copy made reliable (3 fallbacks, shows the real error) and right-click on any studio image now copies it.

- **Count text missing after the first image:** the short follow-up message ("New product image.") made Gemini drop the count text. For ⭐ Multipack with count the follow-up now repeats the count rule, and the full prompt is re-sent every 5 images (was 10).
- **Square buttons:** no pill / round buttons — the new batch-setup task buttons and the older pill chips (filters, chips, category buttons) are now rectangular with small corners.
- **Image batch setup — redesign:** tasks are now one-tap buttons (Improve · Background · Pack · Pack + Background · Skip · ⭐ Multipack with count) instead of dropdowns; clear step-1 card for "apply to many"; bigger thumbnails with the current task and "N images of this product"; bigger Apply / Start buttons.
- **Image batch setup window for every engine** (Flow, ChatGPT and now Gemini too — pack number, PACK label etc.). **Ticked = runs:** if you tick some images in that window, ONLY those run (before, unticked ones were processed too); nothing ticked = all run as before.
- **All prompts in the dropdown:** Improve image only · Background only · Pack only · Pack → Background · ⭐ Multipack with count. Picking a task there makes it the default in "Image batch setup" (pack numbers are still set there per product). "Old prompt" and "Background only" were the same job and are now one ("Background only (new background)").
- Removed the "Multipack — plain, no text" prompt (library now: Old prompt + ⭐ Multipack with count).
- Prompt names: "⭐ Multipack with count" (full pile + count text on every image) and "Multipack — plain, no text".
- **Count text on every image:** the star prompt no longer alternates plain / count — every image now gets the count text on top. The duplicate "with count text" prompt was merged into it; "plain, no text" stays as the second choice.
- **Same image uploaded 4–10 times:** the Gemini/ChatGPT scripts were injected again whenever a tab was slow to answer, and every copy handled every message. Now an old copy is removed first, a busy tab refuses a second attach, and upload methods no longer stack on each other.
- **Google "I'm not a robot" page:** the run now stops at once with a clear message (it never touches the CAPTCHA and no longer keeps reloading/opening tabs). Solve it yourself, wait a few minutes, then Retry failed.
- **Gemini upload failures — real causes:** (1) Gemini refuses a 2nd file with the same name in one chat ("You've already uploaded a file named zhunter_1.png") → every upload now has a unique name. (2) A new account shows "Creating content from images and files — Agree" once: the extension waits and tells you to press Agree (it never accepts terms for you), then continues.
- **Gemini failed-upload fix (from the saved page):** the remove button of an attachment is labelled "close <file>" — it was never clicked, so a failed file stayed and blocked Send. Now it is removed, and failed uploads are recognised by Gemini's own markers (has-error / error icon).
- **Gemini upload failed (red "!" on the attachment):** detected — the failed file is removed and uploaded again (up to 3 tries), also if it fails after the prompt was typed; if it keeps failing the item fails with a clear message instead of waiting for you to press Send.
- **Use the open tab:** ChatGPT / Gemini — if a tab is already open, the run keeps working in its current chat (no new chat first; rules are sent once at the start). A new tab + new chat is created only when no tab is open. Flow already worked this way (an open project tab is reused).
- **Less CPU:** the panel's endless decorative animations (grid, glow, scan line, shimmer — 47 of them) are now OFF by default (measured ~7% CPU idle → ~0.2%). Can be restored with the `zhFx` setting ('full' / 'subtle').
- **Chrome slowdown fix:** the per-second timers (attaching / saving seconds) no longer rebuild the results list (it holds big images) every second — only the status text changes.
- **Faster Gemini run:** replacing an image no longer waits for the big Library write (it runs in the background; the edit is already kept in the small journal) — was ~29 s per image. If Gemini answers "I encountered an error", the same message is sent again (max 3 tries) instead of waiting forever.
- **Gemini 2nd image stuck on "attaching image…":** the tab line now counts the seconds, Gemini's HUD shows each step (attached → typing → sending), and if the Gemini tab does not answer in 120 s the item fails with a clear message (F5 + Retry failed) so the run moves on.
- **Gemini/ChatGPT tab in another window:** the run now prefers tabs of the window where the side panel is, and moves a tab from another Chrome window into this one so you can see it.
- **Gemini multi-account fix:** new chats now open on the SAME Google account the tab uses (`/u/1/app` stays account #2, no fallback to `/app`); all tabs of a run use one account. When Gemini says the image limit is reached, the run stops at once with "Gemini limit reached on this account — switch account, then Retry failed" instead of waiting.
- Gemini diagnostics: the tab line now says what is happening ("image received (KB) — saving… Ns"), Gemini shows "image found ✓", and the page is polled every 8 s. Tested the finder on your saved Gemini page: it finds the image there.

- Gemini FIX (real cause found in the saved page): the whole chat sits inside Gemini's <side-navigation-v2> element, and my "ignore the side menu" rule ignored every picture. Only the real menu is ignored now, so the finished image is found and replaced.

- Faster replace after the AI image arrives: big PNGs are shrunk to JPEG before saving, the product list is redrawn after a short delay instead of blocking each image, and each tab line now shows timing ("AI 40s · save 2s").

- Gemini: a failed try no longer leaves its image in the box (the next product's image used to be added to it and both were sent in one message). Old waiting files are removed before each attach; attach check waits up to 15 s and uses several signals.

- Gemini result detection rewritten: any big picture in the chat (not your upload, not the side menu) is taken once it stays unchanged for a moment — no dependence on Gemini's changing class names. Fixes "No generated image found in Gemini" / timeouts.

- Gemini no longer selects the whole page text when typing the prompt; fewer than 5 images → only 1 tab is used (ChatGPT and Gemini); ChatGPT chat archiving is switched off.

- Gemini: the new image is now found by its POSITION (after the message just sent), not only by a list of old images; console log "[ZHunter Gemini] waiting for image" helps debugging.

- Gemini Auto fixes: the finished image is now detected (Gemini keeps an empty "loader" element in finished images — it was read as "still working"), and the "Tabs" setting now works for Gemini too (each tab = its own Gemini chat, several images at the same time).

- Gemini Auto is now fully automatic: image + prompt go in, Send is pressed when ready (after the upload finishes), the NEW generated image is taken and applied, then the next one starts. Long prompts are typed line by line if Gemini cuts them. If Send cannot be clicked, press it yourself and the image is still taken.

- Prompt names made clear: "Old prompt — new background" vs "NEW Full pile — alternate / plain / with count text".

- Abundance prompts are sent ONCE per chat (with the first image); next images in the same ChatGPT/Gemini chat go as image only ("New product image."), and the full prompt is sent again every 10 images. ChatGPT chats with these prompts hold 10 images before a new chat. Gemini auto now puts the image (+ prompt) in via the new attach code. Flow still gets the full prompt every time.

- Prompt library: new "Prompt" picker in AI Image Studio (Scene default, Abundance pile — alternate / no text / with count text, plus your own saved prompts with 💾 Save / 🗑 Delete). Works in Auto (Flow, ChatGPT, Gemini: pick "✨ Prompt: …" per image in the batch setup, default = the chosen prompt) and in the manual Edit Studio ("📚 Library" picker per product). "Alternate" gives no-text / count-text on every other product.

- Edit Studio "Paste in ChatGPT/Gemini/Flow" is faster: product images are downloaded in the background as soon as the product opens (and the next one), and big images are shrunk (max 1600px) before going to ChatGPT/Gemini.

- Gemini manual mode reworked: attaches ALL chosen images (not just 1) through Gemini's hidden upload input (paste/drop fallbacks), turns on "Create image", types the prompt, you press Send; "Take from Gemini" now reads the real generated image (waits while it is still rendering, ignores your uploaded previews).
- Manual studio: a pasted / taken image shows AT ONCE; saving to the Library and the public link run in the background (one at a time).
- Fix: "Hunt + close tabs" no longer closes the browser window — when the last tab of a window would be closed, a New Tab is opened first.
- Bulk hunt: the page being hunted comes back to the front even if you switched to another tab (the front is no longer "held" by a tab that is not actually in front).
- Fix: "Import sheet" with a sheet made by this extension (CH-AMAZON/CH-WALMART/CH-SAMSCLUB SKUs) now shows the products as review cards (title, images, category, price) instead of only a report.
- Manual studio: pasted images are shrunk (1500px JPEG) before saving, so Paste is much faster.
- Manual studio: "Replace" is now "Paste image" (copy the image in ChatGPT/Gemini, press it) and it can read the clipboard through the ChatGPT/Gemini tab, not only Flow.
- Fix: Manual studio now opens with the engine you picked (ChatGPT / Gemini / Flow) instead of always remembering Flow.
- Fix: hunted products are no longer lost when the Library save hits "message port closed" — saving retries up to 5 times and keeps the rows until saved.
- Fix (root cause): Amazon title was read from a hidden "Adding to Cart..." label, so every Amazon product became "title not found". #productTitle is now read first.
- Fix: Learn categories no longer skips products that Export reports as NO_CATEGORY_PROFILE.
- Fix: ⚠ no longer appears just because a title says "frozen"/"canned"/"dried" when you already taught that Temu category with such a title.
- Fix: a title you taught in Learn categories no longer keeps the ⚠ mark (taught title is matched in raw and cleaned form).
- Fix: Learn categories now checks only products that show the ⚠ mark (same test as the list), not every product.
- Learn categories: Temu gets the COMPLETE title (1: paste, 2: type letter by letter, 3: manual); the first Temu suggestion is accepted automatically after 2 seconds (you can change it before that).
- Fix: reading the Library no longer shows "message channel closed" — it retries up to 4 times.
- Fix: Amazon hunt — real product pages on odd addresses are no longer called "redirected away", and Amazon pages get 15s (not 4s) to be read before "timeout".
- Fix: Amazon hunt "title not found" — title is now also read from hidden spans, other layouts, product data and the tab title.
- Fix: Library save after replace no longer fails with "message port closed" — it wakes the background and retries up to 4 times.
- Categories: smart multi-word matching — all words of a title count together (rare words weigh more, word pairs count extra, at least 2 words must agree); learned from your taught titles, never from single words.
- Learn categories: AUTO mode first (the extension types the title itself); if Temu shows no suggestions it falls back to MANUAL (title copied, you paste) — after 3 auto failures it stays manual. Match-word rules are gone completely: only whole titles are learned (up to 6000 examples).
- Archive safety: a ChatGPT chat is archived only if every message in it is one of our own prompts. When every image is done (no failed ones) the image window closes by itself after 3 s; failed count is fixed after manual replace.
- Image studio: when the run is over the green button becomes "✔ Close & continue" (closes the window, refreshes the review list).
- ChatGPT: finished image is now also found as a new generated image after our message, so the run no longer hangs on "working" when the answer block is not recognised.
- Image studio: "🔁 Retry failed (n)" button in the Results list runs every failed / skipped image again (uses all chosen ChatGPT tabs).
- Image studio: "ChatGPT tabs" select (1–4 tabs working together, remembered).
- ChatGPT "Create image": the + menu rows are plain buttons — now found, pressed and checked (up to 3 tries, never closes the open menu). Group chips are square and use the extension theme. Image studio window scrolls and fits small panels; Redo/Revert stay disabled until an image is selected.
- Bulk Hunt: group chips (Chrome tab groups) above the tab list — pick one group and only its tabs are shown and hunted.
- Google Sheet sync: built-in connection (sourcing_default.js, private, not in GitHub) — a new Chrome profile connects by itself, no manual setup.
- Pricing strategy: price = source cost + a gap that depends on the cost (tiers 10:50, 25:45, 60:40, 120:60, then 40%; cost 10 = ~60), Frozen +35 extra (~95). Random stable cents (67.94, 43.48), never only .99. Tiers editable in Settings.
- Learn categories: the chosen category is applied to that product at once and the product cards refresh immediately (⚠ marks go away; taught titles are never marked doubtful).
- Image studio: manual tools now have an engine select (Flow / ChatGPT / Gemini) in "More options" and in Edit Studio; buttons follow the engine ("Paste in …", "Latest from …", "Open …").
- Image studio: ⏹ Stop and 🔄 Replace buttons; a Results list (before → after, status) with Redo, Revert and Replace per image; the window stays open after the run.
- Categories: learning now remembers whole titles (similar titles → same category); single-word match rules are no longer written; commas split match words.
- Image editing: new engines — **ChatGPT (auto)**: 2 ChatGPT tabs work at the same time; each tab re-uses its chat (new chat after every 5 images, each message says "new image, ignore the previous ones"); attach image → "Create image" + prompt → send → result read and put back automatically (same stages as Flow). **Auto** engine: ChatGPT first; on error/limit → Flow; then Gemini (manual paste). New batch task **Improve image only** (simple prompt, no background/pack change). Engine choice is remembered.
- ChatGPT image engine: when a run finishes, the chats ZHunter created are **archived** (never deleted; only chats it made itself; "Close" does not archive).
- ChatGPT image engine fixes: finished image was never seen (image-only answers have no message key → now found via the "ChatGPT said:" block); tab B is reserved/opened before the run (both workers used the same tab); the step window shows the current product image/title; batch-setup controls fit the side panel and unused ones are hidden.
- ChatGPT archive fix: the chat menu button is the header "More" button (sidebar "Chat actions" as fallback).
- History: every Export / Upload now keeps its Temu xlsx (XLSX button on the history card, newest 50 kept, stored in IndexedDB so Chrome stays fast). Imported-sheet autosave also moved to IndexedDB with compressed images.
- Image upload to the public host: 3 tries with longer waits and smaller image on retries (fixes "Public image upload error: DOMException" timeouts); ChatGPT "first reply not DONE" note is now only a console log.
- Imported sheet (Store sheet / Imported sheet) is saved automatically and restored after Reload or closing the panel (titles, edited images, categories kept).
- Export: an edited image whose Flow link has expired no longer stops the whole export — the original is used (main image) or the image is skipped, with a warning.
- Learn categories: the suggested "Match words" is now the product type from the start of the title (e.g. "biscuit rollup") instead of one generic word like "breakfast" that matched everything.
- Learn categories: now also reviews products whose category shows the ⚠ check mark (not only products with no category) using Temu's own suggestions.
- Store export / imported store sheets: category is now matched from the product title (your category list) instead of trusting the old listing category (often wrong, e.g. "Ice Cream Sandwiches"); the copied one is only a fallback.
- Store export: the sheet category now uses a keyword from your category list (exact path match, else best match for the title) because Temu only auto-picks categories that exist in its current list; a note tells you when it was replaced.
- Review thumbnails that fail to load are fetched once through the background (Referer fallback) and shown from memory.
- Store export: picks the exact "Copy listing" menu item (not "Copy Goods ID"), presses it with full mouse events, and asks you to refresh the Temu page if the page helper is not loaded yet.
- Store export: also captures copy links opened through a link click (Incomplete products), uses the tab Temu opens itself as a fallback, and the error now lists the menu items found.
- Hunt (open tabs): a product page with 2 images is now accepted as complete on the first look (no more "fewer than 3 images" retry for it).
- Hunt recovery: tabs that are already open and loaded are no longer refreshed (only sleeping or unloaded tabs are reloaded) — fixes pages breaking (e.g. Temu "sold out") after a retry.
- ChatGPT Auto: ignores the hidden "ChatGPT said:" line (fixes count mismatch).
- ChatGPT Auto: reads the answer with the new ChatGPT page markup (assistant/user message selectors).

- ChatGPT auto: updated selectors for the current ChatGPT page (Send button, message box) + form-submit fallback. Title Optimizer: "AI title edit" and "ChatGPT optimizer" are now collapsible sections.

- Titles via ChatGPT — Auto: "Auto: send to ChatGPT" sends all checked titles in ONE message to your open ChatGPT chat (or a new chat, sending the saved prompt first), waits for the answer, reads it back and shows the preview. If ChatGPT ignores the scripted Send click, press Send yourself — the answer is still read automatically (no debugger).

- AI Image Studio bar: removed the old "Pack" dropdown and "Make Pack" button (pack is now set per product in the review card, Edit Studio and Flow batch setup). The Speed setting moved into the Auto-mode dialog where it applies.

- Prompts: new default background prompt (keeps pack count/badge corner, store style); new pack prompt that keeps the original background (old white-background pack prompt stays as "Purana"). Pack label can be extension-stamped (default), or none.
- Flow batch setup + Edit Studio: per-product "PACK label" tick and per-product pack prompt switch (New / Old white bg). Edit Studio: "🏷 N PACK" button adds the label to an existing image later (undo with ◀).

- Images: ◀ ▶ buttons on every review image = undo / redo through up to 5 earlier versions (original → pack → background edit). The shown version is the one uploaded.
- Titles: "ChatGPT se titles" box in the Title Optimizer — saved prompt + Prompt copy, numbered Titles copy, paste ChatGPT's list back, Preview (old → new, count check, warning if a title looks unrelated), Apply. Product IDs are remembered at copy time so titles can never land on another product.

- Image Studio: live timer (total time + average per image) while Flow edits run; summary shown at the end.
- Header "Temu Export" button hidden; the window opens from Settings tab → "Open Temu Export" (still in the XLSX dropdown too).

- Flow: Generate click is now human-like (random spot inside the button, random mouse path, 0.3–1.2 s hesitation, random press length). Gaps between images are random (Safe 8–20 s / Normal 4–10 s / Fast 1.5–4 s) plus a short random break every 6–20 images (10–60 s).
- **Edit Studio**: new tick "PACK label" — choose whether the red-and-black "N PACK" label is written on pack images (also stamped when you take a pack image from Flow). Remembered.
- **Pack label**: the red-and-black "N PACK" label is now stamped in the TOP-RIGHT corner, and the background/scene prompt tells the AI to keep that label untouched.
- **Titles**: source site names (Amazon, Walmart, eBay, Etsy, BJ's Wholesale Club, Costco, Target, Temu …) are removed from listing titles (prefix "Amazon.com:", suffix "| BJ's Wholesale Club", "at Walmart").
- **Paste category**: Review card now has a "paste the Temu category" box (path from another profile) — creates/uses that category for the product and remembers it.
- **BJ's** scraper bug fixed: a missing helper made price + images always come back empty.
- **BJ's** link hunt (queue): no longer marks partial early — waits up to 90 s for price + photos to appear.
- **BJ's** slow/VPN loading: hunt now waits up to ~75 s for page load and ~44 s for price + gallery before reading (other sites unchanged).
- **BJ's** hunt: waits until price + gallery have loaded before reading (fixes "price + images not found"); price now read from the main product only.
- **BJ's** right-click "Add" on product links now works (bjs.com added to background host list).
- **BJ's** (bjs.com) product pages now show in Bulk "Open tabs" and can be hunted (added to platform list, auto-scrape list and product-URL gate).
- **Store export / import**: on Temu "Manage products" tick products → Upload page → More tools → "Store export". Each product's copy page opens in a background tab (read-only, auto-closed), full details are saved as a Temu bulk sheet. In another Chrome, "Import sheet" loads it into editable review cards (title, images, category, price kept as-is). New files: temu_store_copy.js, temu_net_hook.js (manifest content_scripts).









- Fix drafts auto-submit: one product with an empty required field (e.g. Battery Properties) no longer blocks Submit for ALL others - complete products are submitted one by one, the rest are listed. Draft values are now smarter: Age Group/Material/Power Supply come from the title first (Toys default '3 Years+' instead of the old '14 Years+'), and battery/power dropdowns pick a 'no battery / none' option from the real list (or print the options so we can add it).
- Smart attributes: export now fills the Keyword Attributes column with the right Temu option words per product (Applicable Age Group from the title e.g. 'Ages 4-8' -> '4 Years+', Material from the title, Power Supply 'Use Without Electricity', plus anything learned for that category). New 'Learn attributes' button (More tools) reads Temu's 'Product action required' page: remembers each category's required attributes + values, adds unknown categories (by full path) and remembers product types.
- Upload page tidier: Export file only / Learn categories / Fix drafts on Temu / Upload errors now sit in a collapsible 'More tools' section (Mark as listed stays visible when it appears); the Store/Template card returns to one line when you click elsewhere.
- One built-in Temu general template (temu_template.xlsx, same for every store - only the hidden brand list differed): adding a store no longer asks for a template file; a store's own .xlsx is optional ('Use own .xlsx'). Brands still come from the extension's own brand/trademark settings.
- Categories tab: new 'Import templates' button - pick one or many Temu bulk-listing template .xlsx files; the hidden 'Category Name' sheet (id + full path) is read and every new category is added (no Temu page, no typing). The extension also LEARNS from your 'Change category' choices (product-type words like 'breakfast bowl', 'waffles') and uses them for later products.
- Fixed: exported files were saved with a random UUID name (batch name lost). Blob downloads now keep their real name (e.g. temu_upload_<batch>.xlsx) inside ZHunter Export/<date>/.
- Review card 'Change category' now lists the 3 best guesses first ("Suggested for this product"); Doubtful also when a frozen/canned/dried title sits in a non-frozen/canned/dried category or a non-mix title in a Mix category.
- Smart categories: 234 new official Temu categories (id + full path, from the sheets in 'Categories template', ~406 total) with product-type words (sausage, waffles, breakfast bowl…); the matcher now SCORES every category (more words, side-by-side words, context like frozen/deli/canned) instead of first-match; Review card marks 'Doubtful' when two categories score about equal. Size/weight of new categories is set per department (editable in Categories tab).
- Learn categories is now semi-manual: the extension copies the title, YOU paste it in Temu's Product name box, and the extension (read-only) picks up Temu's suggestions the moment they appear. No robotic typing, no page refresh loops.
- Learn categories: takes Temu's suggestions the moment they appear while typing (after 3+ words) instead of finishing the title; never leaves the name box (so Temu cannot auto-pick a wrong category); clicks "Reselect" first if Temu had auto-picked one.
- Learn categories: the title is now typed letter by letter with uneven speed (not pasted in one go), so Temu's category suggestion is triggered like a real user.
- Learn categories recovery now behaves like a person: after the rest, it opens another Temu page (seller home), scrolls a little, waits, then returns to "Add new product" and tries again.
- Learn categories: slower, calmer pacing (6-12 s between titles; on no suggestion rest 30-60 s, refresh once, retry once) so Temu does not throttle the suggestions.
- AI: Google Gemini keys (AIza… / AQ.…) can be saved next to Groq / OpenRouter keys; they use Gemini Flash (free tier) via the OpenAI-compatible endpoint, with model fallback and daily-limit parking. Key test supports Gemini.
- AI: OpenRouter keys (sk-or-…) can be saved next to Groq keys (Settings → AI keys). They use OpenRouter's free models (auto-switch if one is unavailable); a daily-limit hit parks that key for an hour. Key test also checks OpenRouter keys.
- Title rewrite progress bar + Stop button re-laid out (full-width bar, count left, clear red Stop right).
- Batch name is now remembered (saved as you type, restored when the panel opens).
- Learn categories: match words are now the product type taken from the Temu category you pick (e.g. "breakfast bowl") — no more brand / first-3-words ("jimmy dean frozen"); updates when you change the option, and you can still edit it.
- Learn categories: when Temu gives no suggestion, the extension refreshes the Temu page itself and retries (up to 2 times) instead of stopping.
- Content Studio: Titles-only (or Titles + others) now writes the TITLE with your own title format/rules (same engine as the Rewrite title button); only ticked fields go to AI.
- Export: bullets/description that were not rewritten by AI keep the sourcing text with avoid-words removed and a light re-order (e.g. 1st bullet moves to 2nd place) so they are not identical to the source.
- Light theme: Edit Studio (manual) and AI Image Studio (auto stepper) restyled for light mode — panels, inputs, pack chips, buttons, image cards were grey/white-on-white.
- Light theme: Temu Upload tab (Title Optimizer, AI Image Studio selects/labels) text was white-on-white because some colour variables had only dark fallbacks; now defined for light mode.
- Manual Studio: pack prompt now rebuilds for the chosen pack count (3, 4, 6…) — it was stuck on the 2-pack text; ⚡ Paste in Flow pastes exactly the prompt tab that is selected (Image / Pack).
- Right-click add (all sites): new ctx_capture.js remembers product links around the click, so clicking a card's price/badge/empty area (page menu) or a sponsored/redirect link still adds the right product; several products under one click → asks to click the title/picture. Queue also ignores tracking/variant parameters on Walmart/Amazon/eBay/Etsy/AliExpress/Sam's (no duplicates).
- Batch name (Upload tab) is now used: it goes into the exported/uploaded file name (temu_upload_<name>.xlsx) and shows as a chip on every History record.
- Suspicious source price limit raised to $300 (cfg.max_source_price).
- Pricing: products below the floor get a stable random price between the floor and 299.99 (cfg.price_rand_max); the max (999) now allows up to 999.99.
- Review cards show each product's category (⚠ when its name shares no word with the title) with a "Change category…" dropdown; the choice is saved per product and used by the export.
- Pricing: products below the price floor no longer all get the same price (floor + a little by cost + a stable per-product bit, never below the floor); "N Pack - …" titles are priced and sheet-logged on source × N; a source price over $100 (Settings value max_source_price) blocks export with PRICE_SUSPICIOUS so a wrong scraped price is not listed or written to the sheet.
- Upload: if Temu is still processing after 200s, ZHunter keeps watching the upload (every ~10s, up to 25 min) and marks products + updates History only after Temu says Completed. With errors/Action required: reads failures, marks duplicates as listed, runs Fix drafts automatically, never marks products that failed.
- Settings: "Flow: auto Generate click" switch (default ON = as before). OFF = Chrome debugger is never used; image + prompt are filled and you press Generate yourself.
- Hunt (queue) now acts more like a person: irregular 1.5–4s gaps (sometimes longer), a short look-around scroll before reading a page, a 20–60s rest every 12–20 links, and a warning at 150 / 300 links per day.
- Temu Export: "Learn categories" — for products with no category, the title is pasted into Temu's Add-product page (name box only, nothing submitted), Temu's suggested categories are shown, you pick one and it is saved as a category profile.
- Flow: the page script (content.js) no longer runs on flow.google.com, so the page is not modified by ZHunter while you work by hand (Flow automation is separate and unchanged).
- Auto image popup: Pause/Resume and Done (stop here) buttons.
- Pack images: strict per-count prompt (exact N units, no AI text); extension stamps the correct "N PACK" label itself on the final image.
- Flow automation: random human-like pauses (1-3s / 2-6s, occasional extra) between attach image, paste prompt and send.
- Fix: hunt popup kept showing "Incomplete links are being hunted again" during the image download; it now shows "Saving pictures…".
- Fix: "Unsupported settings: queueParallelTabs" when changing Links at once (setting added to the allowed list).
- Right-click add: on-page toast now always shows (added / already in queue / not supported), bigger and longer, even with the side panel closed.
- Right-click "add to queue": sponsored/tracking links (Walmart /sp/track?...&rd=) are unwrapped to the real product link.
- Temu History: honest statuses — Uploaded / N need fix / Sent — check Temu / Not uploaded / Fixed & listed (after 'Fix drafts on Temu' succeeds the record's errors are cleared and its products are added to the Listed history, so they are skipped in the next export); filter 'Errors' renamed 'Needs fix' and now includes everything not yet listed.
- Edit Studio: Original and Result shown big side-by-side (click original to zoom), image buttons in a tidy grid, 'auto next' option (moves to the next product after its last picked image is replaced), clearer Prompt fold.
- Temu Review cards: one-click Pack buttons (1×–12×) set the title, mark the product for image edit, and a '✨ Studio' button opens Edit Studio for that product; Flow batch setup now defaults packed products' main image to 'Pack → Background' with the pack qty.
- Temu Export: header subtitle removed; Review card full-width title field, larger image thumbs with tidy 3-column tool grid, clearer delete icon, Save bar no longer overlaps settings.
- Header: subtitle hidden on narrow panel (no overlap with Temu Export button); Hunt images banner calm cyan (no rainbow); Bulk stats and banners compact.
- Edit Studio: Prompt section folds (remembers open/closed), Paste in Flow bar sticks to the bottom; Flow batch setup: Qty only shows for pack tasks, tidier toolbar.
- Image Studio: Universal Multi-Pack Master Prompt ([PACK COUNT] filled in) used in Manual studio AND Auto (Pack only / Pack → Background; the Background step keeps the 'N PACK' label); Auto popup redesigned: step badge + progress bar, main buttons (Skip / Send again / Paste & Next) up front, manual tools in a collapsible 'More options'.
- Settings: fold-able groups (state remembered), search box, Restore backup button next to Backup.
- Library Compact mode: one clean line per product (price, store, title), rows no longer overlap.
- Library: filter chips wrap to a second line instead of hiding (works at any panel width); chips/status pills are rectangular (no round buttons).
- Library: filter chips no longer hidden behind Problems/Compact (grid + fade); compact stats, rounded chips, tidier rows and Recent Hunts cards.
- Library: filter chips + Problems/Compact on one line; sticky selection bar with 'Temu upload'; Undo (7s) after deleting products; Reset Library removed from Library tab (still in Settings → Data).
- Bulk Hunt / Queue UI: 'Tabs at once' and 'Links at once' selectors right above the Hunt buttons (synced with Settings); queue rows show site favicon + platform and a coloured status chip (Done / Needs retry / Loading); light-mode row polish.
- UI: main tabs (Hunt/Bulk/Library/Settings) and Temu Export tabs (Upload/Settings/Categories/History) now use the same segmented-button look as "Last hunt / Library / Import sheet" (dark + light).
- Sourcing sync runs silently in the background (the Google Sheet tab is no longer opened/focused after upload; use "Open sheet" when you want to see it).
- Light mode: bulk hunt progress + result popup (title, hero card, filter bar, result tiles, Done / Temu upload buttons) fixed.
- Sourcing: one sheet for all Chrome profiles — "Copy connection code" / "Paste connection code" (URL + sheet + key) connects another Chrome in one paste; each store still gets its own tab automatically. Sheet link can be typed in step 1.
- Sourcing records quick setup: use open Google Sheet → copy ready script (key + sheet id inside) → paste Web app URL, connects by itself. Manual fields kept under Advanced.
- Light mode: Hunt Images/Videos switch, empty states, Temu export setup/steps/source switch, Settings border panel + small switches, header Temu pill and theme (sun) button no longer dark/blank. All main action buttons now use the Temu "Export + Upload" cyan style.
- Products with only 1–2 images are no longer retried forever: queue accepts them once the page finished loading and the count stayed the same; open-tabs mode accepts them on the second look.
- Queue hunt speed: scraping starts the moment the page loads and re-checks every 0.3s until title+price+3 images are found (no fixed settle wait); a page that is still loading is never reloaded; after the 35s limit it is scraped as-is and, if incomplete, retried at the end. New setting "Queue links at once" (1-4, default 2); the loading link is brought to the front tab and your own tab is restored at the end.
- Floating image card only on single product pages (store/mall pages like temu.com/mall.html no longer match; shared ZhGate used).
- Fix drafts: waits for Temu to render the attribute fields (was submitting before Material appeared), tries rule/default/golf→Rubber/fallback values against the real option list, human-like clicks and pauses; on-page status label (right-bottom) for fixing/uploading/checking.
- Free AI title prompt: "Your own prompt" box + "AI Edit with my prompt" (bulk, with Stop/Undo, saved prompts) in Title Optimizer; checkbox in Content Studio Instructions to use own prompt for titles.

- Temu export: titles with only a golf brand/model (TaylorMade, Titleist, Warbird, TP5, Pro V1...) now use the golf category profile instead of failing with NO_CATEGORY_PROFILE.

- UI: no round buttons/chips anywhere (pills, chips, close/nav buttons, page lightbox) - rectangular; number badges (Last hunt/Library counts, tab counts, review count) resized so the number fits.

- Content Studio layout: toolbar re-aligned (equal Titles/Bullets/Description chips, full-width Rewrite + This product only, Products/Instructions side by side), equal footer buttons.

- Title rewrite: progress bar, Stop button and "Undo last rewrite"; review card delete now needs a second click (3s); AI Image Studio bar restyled with the theme accent and a 2-column layout; hunt result tick visible again, filter buttons rectangular.

- UI: Hunting card rebuilt (stat tiles, filled hero, fixed All/Complete/Pending pills); result/cancelled screen wording unified ("2/3 complete", "Not hunted" tile, "Hunt remaining"); Edit Studio + Content Studio purple replaced by the extension accent (cyan).

- Hunt: a problem link is opened ONCE in a brand-new tab and the old/stuck tab is closed (queue mode and open-tabs mode) instead of retrying in the same tab.

- Hunt speed: queue waits cut to the old v9 values (settle 0.5-1s, pre-scrape 0.3-0.8s, link gap 0.5-1.5s, breather every 15-20 links); removed the Temu tab reload ("clean link") in tab mode; late verification boxes now pause the hunt.

- Hunt v9.15: fixed Temu tab-hunt crash ("page did not respond"); Temu price + gallery read from the page DOM; Temu tracking/spec params removed from links; Hunt + result cards restyled to the extension theme; remaining mixed-language labels translated.

- DOM-verified scraper fixes (saved Ecom DOMs): Walmart/Sam's Club price no longer read from recommendation tiles; Amazon image order (landing image first, no duplicates); Temu gallery-only images (no swatches); Temu price read from #goods_price (was picking the rating 4.8); 'Rs.' currency kept.
- **Product links only (all sites):** new shared `product_url_gate.js`. Home, store/mall, search, category, cart, login and seller pages are rejected when adding to the queue (single, paste, import, auto-capture), when starting a hunt, and in the Hunt tab auto-scan.
- **Bot verification / login:** one global hold. Every worker stops; hunting continues only after you press "▶ Solved — Resume" (no timeout, no auto-resume). The product link is then opened again.
- **Not found / sold-out page after verification:** the link is retried (2x with a pause, then recovery rounds). Redirects away from the product are retried once.
- **No skipped links:** failed links are no longer retried immediately; every other link is hunted first, then the recovery rounds retry them. Result strip now reads "N/M complete · X need retry · Y not tried"; "Partial" renamed "Incomplete".
- **Images:** each picture is downloaded with up to 3 attempts (only failed ones repeat), extra fetch strategies in the background, a final retry pass, and Retry on an image-only failure re-downloads pictures without re-hunting.
- **Temu first image:** gallery pictures are taken from the page data with swatch/recommendation/layout images excluded; og:image is last resort; queue mode now uses the same scraper as open-tabs mode.
- Backup: branch `backup/2026-10-07-before-hunt`, tag `backup-2026-10-07-before-hunt`.


## Unreleased (2026-10-07) — Open Studio redesign, 500-char titles, English UI
- **Title limit:** Temu allows 500 characters. All counters, limits and AI prompts now use 500 as the hard maximum and aim for under 240 (green up to 240, amber up to 500, red above). Title rules avoid violation words.
- **Open Studio (Content Studio):** Redesigned with SVG icons, theme tokens (dark/light), a violet accent for AI actions and cyan for save, a single product picker, one primary rewrite button, collapsible bullets/description with previews, a Fit-to-500 title tool, and clear disabled-state tooltips.
- **English everywhere:** Remaining Roman Urdu UI text, status messages and tooltips translated to English across sidepanel, content, background, Flow/Gemini/GPT scripts and title rules.
- **Backup:** git branch `backup/2026-10-07-before-studio-english`, tag `backup-2026-10-07-before-studio-english`, and folder copy in `tmp/`. No version bump, no ZIP.

## v9.12.13 (2026-10-04) — Robust Table-Row Multi-Tier Detection & Submit Safety
- **Recent Hunt filter fix:** Library rows retain batch IDs; older batches recover only with matching timestamps/counts. Hunt selection clears conflicting searches, repeated clicks reset the filter, and unmatched hunts keep the current list visible.
- **Compact History records:** Reduced card spacing, top-right CSV/Delete actions, and one metadata line for date/item count.
- **History alignment:** Full-width store selector, equal segmented filters, consistent record action row, and balanced footer controls matching extension themes.
- **Settings and History workspace:** Collapsible settings/department pricing with remembered fold state, compact upload cards and folded metadata/week view, aligned filters/actions, shared dark/light theme colours.
- **Categories theme:** Shared surface/accent tokens replace fixed dark, purple and neon chip colours; category cards, filters, buttons and edit inputs match dark/light extension themes and fit narrow panels.
- **Google sourcing records:** Durable upload snapshots include exact exported titles, original supplier links/prices and list price, including failed Temu items. Per-store tabs, authenticated Apps Script connection, offline retry and duplicate prevention; one-time deployment required. Destination is the approved sourcing workbook. Same version, no ZIP.
- **Compact Studio editor:** Smaller title box and panels, aligned footer, clearer AI Rewrite label, and current-title Rewrite/Shorten/Remove Brand toolbar; previews still require Save.
- **Title actions restored:** AI Title Rewrite uses the shared user format; separate Shorten Title (60 max) and Remove Brand actions edit checked products without sticky presets. Content Studio uses existing extension background/button theme.
- **Workspace visual polish:** Cyan themed gradients, SVG studio mark, selectable option cards, product preview card and styled collapsible editors; existing generation/save behavior retained.
- **Cleaner Content Studio:** Product dropdown, one Generate action, optional instructions, and collapsible bullet/description editors. Title Optimizer now has named style options and explicit brand/use controls; legacy presets migrate and Short respects 60 characters. Version remains 9.12.13; no new ZIP.
- **Bulk Content Studio:** Checked products ke titles, up to 6 bullet points aur description ke AI drafts, original comparison, manual editing, Stop, per-product / checked Save aur restore. Sirf edited text fields Library aur export queue mein persist hoti hain.
- **Shared copy rules:** Title format aur all six contextual avoid-word categories ek shared source se single/bulk/image Studio/content Studio mein apply hoti hain. Factual Green/USB/LED specs preserve; claims/unsupported restricted details validated before accepting AI output. Export description/bullets bhi same contextual filter use karte hain.
- **Image editing:** Edited main image stays first; original main moves to second. Repeated edits do not add another original. Secondary edits replace their own slot; Library save, edit recovery, queues and Studio undo preserve ordering.
- **Temu connection recovery:** Fix drafts automatically reconnects the content script, then refreshes once and retries when needed.
- **Temu store card:** Professional SVG store icon; “Failed details” renamed to “Upload errors” to clarify its purpose. No version bump or new ZIP for these small updates.
- **🛡️ Multi-Tier Attribute Detection (`product-action.html`):** Modern Temu table rows mein dropdown selectors (`.ST_outerWrapper`, `data-testid="beast-core-select"`) ko direct fallback tier se detect kiya jata hai taake koi bhi missing attribute miss na ho.
- **🏷️ Accurate Product Title Extraction:** Title extraction ko update kiya gaya taake checkbox cell ke bajaye actual product title (`13PC Knife Set...`) parha jaye.
- **🛑 Auto-Submit Safety Lock:** Agar dropdown unselected ho ya page par koi required field khali reh jaye, to extension Temu ka Submit button nahi dabayegi aur alert degi taake Temu ka red validation error na aaye.

## v9.12.12 (2026-10-04) — Modern Temu product-action.html Dropdown Precision & Option Stem Matching
- **🎯 Precise Dropdown & Options Matching:** `product-action.html` par Beast Core form-items ki 4x duplicate counting fix ki (ek control par do martaba click se popup foran band hone ka masla hal). Dropdown listbox items (`li[role="option"]`, `.ST_dropdownPanel_123 li`, `.cIL_item_123`) ko correctly parh kar option click kiya jata hai.
- **✨ Polishing vs Polished Value Alignment:** Temu dropdown ki actual option value `Polishing` hai. Category profile `block_knife_sets` aur fallback matching mein `Polishing` set kiya gaya aur `polish` stem-matching add ki gayi, taake missing required attributes 100% select ho kar page submit ho sake.

## v9.12.11 (2026-10-04) — Modern Temu "Product action required" (product-action.html) Auto-Fix & Block Knife Sets Profile
- **🛠️ Product Action Required (product-action.html) Auto-Fix:** Temu ka modern "Missing required attributes" page (`product-action.html`) ab "Fix drafts on Temu" button se fully integrated hai. Extension khule huye table rows mein unselected required attributes (`*Surface Finishing Type`, `Material`, etc.) ko detect kar ke safe value (`Polished` ya pehla valid option) select karti hai aur neechay wala `Submit` button auto-click karti hai.
- **🔪 Block Knife Sets Category Profile:** `temu_categories.js` aur `TEMU_DRAFT_FALLBACKS` mein Knife Sets ke liye `Surface Finishing Type: Polished`, `Blade Material: Stainless Steel`, `Handle Material: Stainless Steel` add kar diya gaya hai taake export sheet mein yeh attributes pehle se hi fill hon aur Temu par koi missing attribute error na aaye.

## v9.12.10 (2026-10-04) — Zero-Tolerance Temu Restricted Words (AI Titles, Description & Bullets)
- **🚫 Complete Anti-Violation Protection (Description & Bullets):** `TEMU_DESC_AVOID_DEFAULT` aur `temuScrubText` mein Temu ki 6 high-risk restricted categories shamil: Health & Medical (`medical`, `cure`, `healing`, `treatment`, `therapy`, `pain relief`, `anti-inflammatory`, `infection`, `antibacterial`, `antiviral`, `orthopedic`), Allergy (`hypoallergenic`, `allergy-free`, `allergen-free`), Environmental (`eco-friendly`, `sustainable`, `biodegradable`, `non-toxic`, `chemical-free`), Safety & Performance (`100% safe`, `harmless`, `guaranteed`, `risk-free`, `100% effective`, `professional-grade`), Certification (`FDA approved`, `CE certified`, `doctor recommended`, `clinically tested`). Description ya bullets mein se koi bhi restricted claim wala jumla khud drop ho jata hai.
- **✨ AI Title Optimizer Engine Integration:** AI Title Rewrite prompt (`getTemuOptimizerInstruction`) mein user ka standardized prompt aur restricted content rules integrate kar diye gaye hain. AI ab product titles generate karte waqt in restricted categories se mukammal parhez karega aur factual keyword structure follow karega.

## v9.12.9 (2026-10-04) — Fast image export, bullet points & description extraction, Temu failed details fix
- **⚡ Fast Image Export:** Temu export mein edited/base64 images canvas ke zariye 1500px HD resolution par 0.92 JPEG mein auto-compress hoti hain (6MB PNG → ~200KB, visual quality 100% barkarar bina pixel loss). Uploads ab 4-concurrency parallel chunking ke sath 10-15 seconds mein mukammal hoti hain (15s abort timeout ke sath jo kabhi hang nahi hota).
- **📝 Bullet Points & Description Extractor:** Walmart, Sam's Club, Amazon aur generic stores se description aur bullet points dono extract hote hain (`__NEXT_DATA__` keyFeatures/detailedDescription + modern DOM fallbacks). Agar bullet list khali ho to description ke clean jumlon ko 4–6 bullets mein tabdeel kiya jata hai taake sheet mein `bullets=0` ya `NO_BULLETS` na aaye.
- **🔄 Temu Failed Details & Spinner:** Temu ke naye button texts ("View processing results", "Complete product information", "Download processing result") auto-detect hote hain. Report mein `⏳ Failed details parh raha hoon…` spinner khatam ho kar mukammal status dikhata hai.

## v9.12.8 (2026-10-02) — Edit hui images kabhi wapas purani nahi hongi
- **Bug:** auto edit mein 5 images badal kar error aaya to woh 5 bhi wapas purani ho gayin. Wajah: (1) `replaceProductImage` purani in-memory Library (`MasterUIState.allRows`) poori storage par likh deta tha; (2) do saves ek saath (pichhli image ka Temu link background mein + agla step) purani copy parh kar likhte the → doosra pehle wale ko mita deta tha.
- **Fix:** Library mein ab sirf usi product ki usi image ko fresh parh kar badla jata hai, aur saves ek ke baad ek (`zhLibPatch`, serialized).
- **Edit record (`zhImgEdits` storage):** har badli hui image ka record (product id/url, image #, original, naya). `temuGetQueuedRows()` (review, export, agla Edit Images, sab sources: Last hunt / Library / Sheet) yeh record laga deta hai — error, stepper band, side panel reload ke baad bhi badli hui images wapis. ↩ Undo se original par wapas = record khatam. 30 din / 600 records ke baad purane saaf.
- Stepper band karne par: "N badli hui images save hain ✓".

## v9.12.7 (2026-10-02) — Flow: Errors page par ghalat alarm band
- Flow ki aam nakami ("unusual activity", policy, timeout) ab `console.log` mein jati hai, `console.warn` mein nahi — Chrome extensions ke **Errors** page par lal error nahi banta. Side panel ka countdown / naya project / manual waise hi. Sirf asal unexpected code errors warn hote hain.

## v9.12.6 (2026-10-02) — Flow "unusual activity": khud naya project + manual tools
- **Auto naya project:** auto image edit mein Google "unusual activity" kahe to stepper 60s countdown dikhata hai, phir Flow tab ko home par le ja kar "+ New project" banata hai aur **wahi image (wahi step)** dobara bhejta hai. Ek run mein zyada se zyada 2 dafa; teesri dafa auto ruk jata hai aur manual row chamakti hai. Speed khud Safe. Countdown ke dauran Skip / Send Again / Close / koi manual button dabane se countdown ruk jata hai.
- **Stepper mein ✋ Manual row:** 📋 Image (isi step ki image clipboard mein → Flow mein Ctrl+V), 📝 Prompt copy, ⚡ Paste in Flow (image + prompt khule Flow project mein, Generate aap dabayein; result "⬇ Flow se latest" ya Ctrl+V se), ✋ Manual Studio (auto band, Edit Studio **isi product se** khulta hai).

## v9.12.5 (2026-10-02) — AI title rewrite ke baad list chhoti rahe
- Bulk "Rewrite Checked Titles" ab har card **nahi kholta** (pehle har card title + price + images ke saath khul jata tha, list bohot lambi).
- **"Title changes" panel** list ke upar: "✨ 5 titles updated · 1 same" — **Compare ▾** se chhoti list (naya title + kata hua purana, apna scroll). Row click = us card par jao (chamakta hai, compare khul jata hai). ✕ se band. Activity ab khud nahi khulti.
- Card par "✨ Updated ▾" click = sirf us card ke neeche Naya/Pehle (card band rehta hai). Title par hover = dono title.
- Review list ab apne box mein scroll hoti hai (screen ka ~60%), "Export + Upload" button tak pohanchna aasaan. Upar sticky patti: "✨ Sirf updated" filter, "▴ Sab band".

## v9.12.4 (2026-10-02) — Recovery ke baad tabs band, behtar hunt popup
- **Tabs ab band hote hain:** pehle sirf pehle round mein complete tab band hota tha. Ab auto-recovery rounds, ↻ Retry aur Retry all mein bhi link complete hote hi tab band (`huntCloseTab`, "Auto-close tabs" ON ho to). Jo tabs extension ne khud dobara khole, woh aakhir mein band (↗ se phir khul jate hain). Aap ke apne khole hue jo links abhi bhi incomplete hain woh khule rehte hain.
- Queue mode: sab link pehle hi complete hon to worker tab ab band hota hai (pehle khula reh jata tha).
- **Recovery card:** recovery ke dauran ghalat "100% · Finishing up · DONE" ki jagah amber card — round dots (1/2/3), "Link 1/2", abhi wala link, bar, "✓ theek hue / baqi". Ring ab sirf complete links ginti hai.
- Retry wale links list mein sab se upar aa jate hain. Filter: All · Complete · Baqi/retry. Band hue tab ki row par "tab ✕".
- **Result popup:** "✓ 28/28 links hunt hue · 0 skip · N tabs band" patti (koi link skip nahi, yeh saboot). Har link ki list result mein bhi (band, kholein). Tile click = list usi filter par. 0 wali tiles dhundli. Check-mark draw animation, confetti (sab complete par), buttons ki entrance, Temu upload par shine. Repeat images/time line hata di.

## v9.12.3 (2026-10-02) — AI title rewrite: saaf nazar aaye, pakka save ho
- **Card par saaf farq:** rewrite ke baad har card par "✨ Updated" (ya "= Same" jab AI wahi title de) badge, card khud khulta hai, neeche **Naya:** poora naya title (hara) aur **Pehle:** purana title (kata hua). Pehle sirf shuru ke ~30 akshar dikhte the, jo AI format ("1 Pack, …") ki wajah se same lagte the.
- **Activity report:** har product: purana → naya; phir verify: "✓ Upload file mein naye titles: 4/4" aur "✓ Library mein save: 4/4" (save na ho to ✗).
- **Message sach bataye:** "3 titles updated · 1 same · 0 failed" — pehle har dafa "4 updated" aata tha.
- **Safe save (`temuSaveTitles`):** naya title Library storage se fresh parh kar sirf usi product (id, warna url) par likha jata hai — purani in-memory Library copy se overwrite/khaali hone ka khatra khatam. Bulk rewrite, card ka ⚡ AI, haath se title edit aur 📦 Make Pack sab isi se save hote hain.
- **Double-run fix:** Temu window har dafa kholne par Review ke buttons par ek aur click-listener lag jata tha (Rewrite 2–3 dafa chalta, Groq limit jaldi khatam; Prompt/list toggles ulat jate). Ab sirf ek dafa; Rewrite chalte waqt dobara click ignore.

## v9.12.2 (2026-10-02) — Naya naam: ZHunter Iras
- Extension ka naam "ZHunter PRO" se **"ZHunter Iras"** (Chrome extensions list, toolbar, shortcut, side panel header badge "IRAS", PDF/Excel/HTML catalog exports). Data/settings waise hi.

## v9.12.1 (2026-10-02) — Auto-pilot hataya (baad mein dobara)
- v9.12.0 ka Auto-pilot ("Agle steps" card, Studio "Done → Upload", auto-start toggle) live kaam nahi kiya, isliye poora hata diya. Hunt complete popup, Edit Studio aur Temu upload bilkul pehle jaise.
- Description + bullets aur Department pricing waise hi hain.

## v9.12.0 (2026-10-02) — Description + Bullets, Department pricing
- **📝 Description + bullet points:** Temu file ke `item_note` ×6 (max 700) aur `item_description` (max 2000) ab bharte hain — hunt ke bullets se (bullets na hon to description ke jumlon se). Saaf: links, emojis, 【】 headers → "Header: text", "Add to cart"/"Make sure this fits" jaisi web lines, store names (Amazon/Walmart/Sam's/Costco/eBay) wale jumle, brand na mila ho to us ka naam. Bullet max ~200 chars, description ~900.
- **Avoid words (Settings → Description & Bullet Points):** jis jumle mein ye lafz ho woh poora jumla hat jata hai (Best Seller, Guaranteed, FDA approved, Cure, Antibacterial, Free shipping…). "↺ Default list" button. On/off toggle. Report mein `bullets=N`, warning `NO_BULLETS`.
- **💲 Department pricing:** Settings → Pricing mein table (Grocery, Home & Kitchen, Toys…): Price × / Min $ / Max $; khali = store default. Categories tab → Edit → **Price ×** aur **Min $** (sirf us category ka). Order: Category → Department → Store. Report mein `×7 (Grocery & Gourmet Food)`; review cards ki price bhi isi hisaab se.
- (Auto-pilot bhi isi version mein tha — v9.12.1 mein hata diya.)

## v9.11.4 (2026-10-02) — Temu Structure Enforcement & Junk Filtering
- **🚫 "Add to cart" & Website Junk Filter:** Product features aur title se web UI ke alfaaz (`Add to cart`, `Add to list`, `Free shipping`, `In stock`, `Buy now`, etc.) mukammal filter kiye gaye.
- **📐 Strict Temu Structure Format:** AI prompt ko explicit comma-separated template diya gaya: `[Quantifier/Pack] + [Core Product] + [Key Features] + [Target Audience/Use] + [Size/Color/Quantity] + [Product Category]` (130-165 chars).
- **🔄 Fresh Title Application:** Title rewrite par "already valid / skip" logic khatam ki gayi taake har checked product par naya Temu title apply ho.

## v9.11.3 (2026-10-02) — AI Title Optimizer & Groq Keys Fix
- **🧪 Test Keys Tool (Settings):** Settings tab mein naya "🧪 Test Keys" button — har Groq key ko foran verify karta hai (Active 200 OK vs Invalid 401). Sath hi "🗑️ Remove Dead Keys" button jo expired keys ko 1-click mein saaf kar deta hai.
- **⚡ Fast & Resilient Title Rewrite:** Heavy double-LLM review judge aur JSON candidate loop ko streamline kiya. Direct, high-quality 1-call prompt se Temu optimized title generate hota hai.
- **🛡️ Graceful Title Length & Format:** Agar title 115 ya 165 characters ka ho to fatal error throw nahi karta; 180 limit ke andar safely format aur trim hota hai.
- **⏱️ Rate Limit Pacing:** Bulk rewrite mein har product ke beech 500ms ka waqfa taake Groq burst limit kabhi trigger na ho. User keys expire hon to automatic working fallback.

## v9.11.0 (2026-09-29) — Manual Board, Pack, tez auto Flow
- **✨ Edit Studio (manual):** "Edit Images" par pehle choose: Manual studio / Auto. Studio mein ek waqt ek product (‹ Prev / Next ›, ← → keys, progress bar): title edit (x/180), Pack chips Single·2·3·4·5·6·8·10·12 → title ke aage "2 Pack - ", Image prompt / Pack prompt (editable) + Copy. Sirf selected images (+ "Sab images" toggle); har image: 📋 Copy, result slot (Ctrl+V = selected slot, agla slot khud select), ⬇ Flow se lo (Flow ki nayi image, jo pehle use na hui ho), ↩ Undo.
- **⚡ Paste in Flow:** tick ki hui images (+ prompt, optional) Flow ke prompt box mein lag jati hain — generate aap khud dabate hain.
- **📦 Make Pack:** title ke aage "N Pack - ", phir **Edit Studio (manual)** khulta hai — auto nahi chalta, debugger banner nahi aata.
- Studio: **✨ AI rewrite** title button (pack prefix aage hi rehta hai); Pack size naya segmented selector (1 · 2× · 3× · 4× · 6× · 8× · 10× · 12×).
- Manual "Paste in Flow" kabhi debugger (CDP) use nahi karta. Auto mein Generate ke liye pehle Enter try hota hai; Flow na maane tab hi CDP click (banner sirf tab).
- **Bulk hunt tez:** soye hue tabs sirf EK dafa reload hote hain aur poora load hone tak intezaar (pehle 2s ke baad fail → 3–4 reloads). Pehle se khule tabs foran scrape; soye hue tabs ek sath kitne jagein — Settings → Bulk hunt → "Tabs ek sath hunt" (default 3). Hunt ke dauran Chrome tabs ko dobara nahi sulata. "Auto-retry" setting ab save bhi hoti hai.
- **Temu Export:** setup mukammal ho to ek patti (store · template · Test · Change); Products source ab 3 buttons (Last hunt / Library / Import sheet); Price × chip Settings kholta hai (Upload se duplicate multiplier hataya); Title Optimizer aur AI Image Studio collapse (aakhri haalat yaad); Settings auto-save; Package specs layout; History/Categories search icon fix, empty states, department pills wrap. Bulk tab ka neeche wala "Temu" button hataya. Header ka Temu Export button rounded-rect, Bulk tab count badge cyan theme.
- **PROJECT_HANDOFF.md:** poori project detail — nayi chat mein zip ke sath do, wahin se kaam shuru.
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

## 2026-10-05 - Audit safeguards (same v9.12.13)
- Selected-only exports, source-price preservation, conflict-aware Library saves, truthful upload marking, strict store/template checks and interrupted-upload review.
- Backup/reset fixes, profile-only AI credentials, supplier-scoped IDs, fact checks, larger content budgets, persisted settings and independent sourcing retries.
- Local storage and headless browser regression fixtures; live integration checks remain pending. See EXTENSION_AUDIT_2026-10-04.md.
