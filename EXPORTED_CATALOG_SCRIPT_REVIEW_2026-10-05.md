# Exported catalog script review — 2026-10-05

Branch: fix/core-bugs. Not merged. Updated after the separately authorized standalone-helper fix.

## Diff summary

Previous escaping commit (0423061):
- Doubled template-source escapes for the literal dot and question mark in extFromSrc; generated regex is valid.
- Doubled the whitespace escape in collectAllImages; generated /\s+/g replaces whitespace instead of the letter s.
- Moved the title-copy listener into the combined main script after confirming safe parsing.

Current helper commit:
- Added safeDecode INSIDE the exported HTML script: base64 bytes decoded as UTF-8 with TextDecoder, then JSON.parse. Extension's own safeDecode remains unchanged.
- Added a small standalone toast helper INSIDE that script. It creates a text-only accessible status notice using existing catalog theme variables.
- Existing missing-JSZip guard now explains that ZIP is unavailable and suggests Individual downloads followed by local compression.
- No library embedded, no new network requests, no extension behavior changes. style.css, manifest.json and background.js untouched.

## Complete template escape scan

The generated HTML template and its interpolated card templates were reviewed. Two broken literal-script escapes were found and fixed in 0423061; no other broken sequences found. The closing <\/script> intentionally becomes </script>. Title/notes newline and carriage-return replacements, YouTube regexes, and quote escaping in button-building expressions execute in generator code, not emitted script literals, and remain correct. Added helpers contain no template-sensitive backslash sequences.

## Real Chrome tests

Ran tests/exported-catalog-browser.test.cjs against the actual output of exportLinksAsHtml, saved to tmp/exported-catalog-browser.html and opened by file:// in isolated headless Chrome. Chrome DevTools Protocol monitored runtime exceptions, console errors and browser log errors. Extension API stubs used only to load the generator were removed before navigating to the exported file. Exported page had no helper or clipboard mocks.

Products: Men's Shoes Storage and Urdu title اردو کتاب, with two PNG fixture image URLs each. Copy controls clicked with Chrome mouse input; actual browser clipboard contents read back. Download filenames isolated per test run; waited for completed files, rejected .crdownload files, and compared every saved file's bytes against the fixture.

| Control / check | Result | Evidence |
|---|---|---|
| Console on load and after controls | PASS | Zero SyntaxError, ReferenceError, runtime exceptions, console errors or browser error-log entries |
| Copy title | PASS | Apostrophe and Urdu titles exactly preserved in actual clipboard |
| Filtering | PASS | Search and folder selection hide/show correct cards |
| Image switching | PASS | Thumbnail click updates main image URL |
| Remove | PASS | Selected card removed after animation |
| Individual image download | PASS | Both files completed and bytes verified; button reports Done 2 images |
| ZIP download (archive creation) | FAIL / unavailable | No embedded JSZip, as anticipated by scope; no archive created |
| ZIP unavailable-state handling | PASS | Click shows explicit guidance; no exception, network request or library insertion |
| Save All Images | PASS | Two additional files completed and bytes verified; shared URLs deduplicated |
| UTF-8 decoding helper | PASS | Unicode JSON and URL query characters decoded correctly |
| Extension regex and whitespace filenames | PASS | Query/fragment boundaries, literal dot and preserved letter s checked |

Four completed files verified this run: men-s-shoes-storage-1.jpg, men-s-shoes-storage-2.jpg, Mens_Shoes_Storage_img1.png, product_img1.png. Existing Individual filename logic defaults data-image URLs to .jpg even though fixture content is PNG; no filename logic changed in this helper-only task.

Additional checks: node --check sidepanel.js PASS. tests/core-bugs-browser.test.cjs PASS for apostrophes, quotes, backslashes, LF/CRLF, Urdu/Unicode and HTML characters.

## ZIP requirement and options

The extension includes lib/jszip.min.js, but the exported file does not embed or load it. An extension-local library is unavailable to a standalone HTML file opened elsewhere. No library was added under the user's restriction.

Options requiring a separate decision:
1. Use working Individual downloads and compress images locally (no code change).
2. Approve distributing JSZip as a companion local file and loading it locally from the catalog. No CDN needed, but the catalog is no longer one self-contained file.
3. Approve embedding JSZip for a self-contained offline catalog; larger HTML files.

## Image-host limitations

Controlled data-image fixtures avoid third-party CORS, expired URLs and blocking; no host failure occurred in this test. Remote Amazon/Walmart image hosts were not tested. The existing fetch/download fallback was left unchanged. Host-specific failures, if encountered with real supplier URLs, remain separate from these helper fixes; no new host workaround added.

Raw current browser results: tmp/exported-catalog-browser-results.json. Actual exported fixture: tmp/exported-catalog-browser.html.
