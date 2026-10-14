# ZHunter Iras — CHANGELOG

## 9.15.0 (2026-10-07) — Hunt rework: product-only links, verification hold, reliable images
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
