# Exported catalog script review — 2026-10-05

Branch: fix/core-bugs. No merge. Only sidepanel.js source changed.

## Changes and escape scan
- sidepanel.js:2642: doubled the template-source backslashes before the literal dot and question mark. Generated HTML now contains `/\.(jpg|jpeg|png|webp|gif|avif)(?:\?|#|$)/i` and parses correctly.
- sidepanel.js:2624: doubled the whitespace escape. Previously the template silently emitted `/s+/g`, replacing letters s rather than whitespace in Save All filenames. It now emits `/\s+/g`.
- Reviewed the complete generated HTML template (including interpolated cards). No other broken backslash sequences found. The closing `<\/script>` intentionally becomes `</script>`. The newline/carriage-return escaping in title data attributes and notes executes in generator expressions, not emitted script literals, and is correct. YouTube regexes and quote escapes in button-building strings likewise execute in the generator; no changes needed.
- Removed the split between the title-copy script and remaining main script at sidepanel.js:2454. Safe after repairing syntax: the real exported file loads the combined script, and special-character title regression tests pass.

## Real Chrome browser results
Generated through actual exportLinksAsHtml, wrote tmp/exported-catalog-browser.html, then navigated isolated headless Chrome to its file:// URL. Used Chrome DevTools Protocol exception events and real clipboard reads; no clipboard mock. Two products: Men's Shoes Storage and Urdu title اردو کتاب.

| Check | Result |
|---|---|
| Initial script parsing / console exceptions | PASS — no SyntaxError or exceptions on load |
| Copy title | PASS — real clipboard preserved both titles |
| Search and folder filtering | PASS |
| Image switching | PASS |
| Remove | PASS |
| Individual image download | FAIL — safeDecode is absent from exported page |
| ZIP image download | FAIL — safeDecode is absent from exported page |
| Save All | Partial — ran without exception; a PNG saved, another remained .crdownload when inspected; do not treat UI's saved count as proof of completed downloads |
| Extension detection and whitespace filenames | PASS — query/fragment handling and literal dot checked |

Required completely clean console after all controls is NOT achieved: both per-card download buttons throw ReferenceError: safeDecode is not defined. Their handlers refer to the extension helper at sidepanel.js:145, which is not exported. ZIP additionally depends on JSZip and toast, neither included in this standalone template (source references around sidepanel.js:2548–2604). These are outside the authorized escape-only changes. Asked user whether to expand scope; left unchanged pending response.

Validation: node --check sidepanel.js passed. tests/core-bugs-browser.test.cjs passed apostrophes, quotes, backslashes, LF/CRLF, Urdu/Unicode and HTML characters. tests/exported-catalog-browser.test.cjs intentionally fails its clean-console assertion on the existing missing helper; it records actual browser output in tmp/exported-catalog-browser-results.json.

Diff: removed two script-boundary lines; changed two regex lines to double-escaped template-source backslashes. No style.css, manifest.json or background.js changes.
