# Day / white mode audit - 5 October 2026

Scope: source review plus local headless Chrome renders at 360 and 500 pixels. Actual applyTheme('light') used on both roots. No source code, user settings, accounts, version or ZIP changed. Screenshots are in tmp/day-audit-*.png. Screens are local fixtures; account-connected/populated/error states need additional verification. Suspect color counts are diagnostic hints, not a measured bug count.

## Confirmed root causes

1. Dark-only rules bypass shared surface/ink/accent tokens. Semi-transparent black over white creates dirty grey panels rather than a deliberate light surface.
2. Light --ink-4 is #CBD5E1, used for real small text, subtitles, placeholders and counters. It is too pale for readable text on white. It needs a separate text token from decorative disabled/border colors.
3. Referenced --text-dim and --line-3 lack definitions in the main stylesheet. Declarations may fall back to inheritance or drop, so hints and borders differ between components.
4. Hardcoded white foregrounds, pale lavender foregrounds and electric cyan remain in legacy styles and inline HTML. Changing only body colors cannot fix them.
5. Repeated late rules and !important declarations override earlier theme-aware styles. Fixes must inspect final computed styles rather than adding another broad blanket override.
6. Older screenshot scripts toggled body.light-mode only, while Temu header uses html[data-theme=light]. Their dark-looking Temu header was a test mismatch. Actual theme function sets both correctly; do not report that header as broken based on older screenshots.

## Each main tab

| Area | Findings | Required treatment |
|---|---|---|
| Shared header | Temu Export pill label appears white/faint on very pale cyan; intense glow. At 360 px header is crowded and branding/action controls are compressed. | Use readable accent ink, bounded glow, responsive control spacing; retain existing identity. |
| Hunt | Images/Videos segmented container stays grey. Empty image panel is dark grey with white heading and muted blue-grey help text. | Tokenized segmented track and empty state; clear selected/disabled distinction. |
| Bulk | Base layout uses tokens, but progress modal overrides dark backgrounds and neon status colors. Selected export-column label is fixed white. | Correct selected labels and progress/running/done/warning/cancel states. |
| Library | Base surfaces mostly use tokens. Recent hunt age, export section text and separators use pale ink-4. Populated cards, selection, source badges and footer need fixture coverage. | Strengthen functional metadata contrast; review selected/hover cards, recent filter and sticky footer with real-length titles. |
| Settings | Base appearance is close to light theme; helper text/metadata can be too faint. Groq test output has inline translucent-white border/background. Frame color swatches are intentional product colors, not theme defects. | Tokenize test panel; check folded/open settings, toggles, saved/error states. Preserve color swatches. |

## Temu Export tabs

| Area | Findings | Required treatment |
|---|---|---|
| Upload | First-time setup stays charcoal grey; source selector also grey. Step text and disabled instructions blend into background. Batch placeholder/counter almost disappear. Main upload action retains vivid neon gradient/glow rather than consistent light action treatment. | Light setup/step/source surfaces, proper readable disabled state, consistent primary action, usable narrow-width review header/count. |
| Settings | Folded card surfaces mostly correct. Small hints inherit faint colors. All expanded pricing/specs/content/rules/sourcing cards need checking throughout their scroll extent, not just first screen. | Shared label/input/help/validation styles; consistent summary arrows, focus rings and disabled controls. |
| Categories | Card foundation is token-based after previous fixes. Primary action white text can be correct on a solid accent background; do not blindly replace every white color. Empty/search/edit states and attribute/keyword tags require coverage. | Measure actual foreground/background pairs, review long names and editor layout. |
| History | Card foundation mostly correct. Delete hover sets white on a faint red background in older !important rules; verify final cascade. Small metadata and purple remaining indicator need stronger light contrast. | Theme error tokens, legible status badges and charts; populated success/error/file/search/no-result states. |

## Studios and dialogs

- **Image mode chooser:** confirmed white-on-white heading; Manual option title/subtitle are too pale on lavender; Auto tile uses grey dark-mode overlay and white text. Highest priority.
- **Manual Image Studio:** confirmed white heading on light surface; section backgrounds, title/prompt fields, pack chips, navigation and paste controls contain hardcoded dark colors. Image previews may intentionally use neutral dark backdrops, but surrounding text/controls must be light-themed.
- **AI image stepper:** remains a dark modal in day mode. Some helper text inherits dark ink against its dark surface, making it nearly invisible. Inline white text/neon status and mixed light buttons create an inconsistent result. Tokenize both HTML inline styles and CSS.
- **Content Studio:** basic layout uses tokens, but header subtitle, position/generate labels and counters use ink-4; description icon uses #c4b5fd. Undefined line-3 affects hover borders. Focus shadow is fixed neon cyan. Review collapsed/expanded bullets/description, current/selected saves, generation/stop/errors and original comparison.
- **Flow batch dialog:** input/select/option rules force color-scheme:dark and dark colors, independently of day mode.
- **Bulk progress:** dark hero and white success headline, fixed neon ETA/active rows, themed status colors not fully shared. Review running, done, warning, cancel, filters and retry controls.
- **Edit/import/preview/catalog/Gemini/shortcuts/confirmation:** shared modal base is theme-aware; remaining local/inline rules need focused checks with populated and error fixtures. Static preview alone does not prove interactive states correct.
- **Image lightbox:** dark photo-viewing canvas may be intentional. Close button uses theme ink on a dark overlay, so light-mode dark ink can lose contrast; controls should use explicit foreground suitable for their surface.
- **Toasts:** deliberately dark light-mode toasts exist. This is not automatically a bug, but heavy neon glow and progress stripe are inconsistent with quieter day surfaces. Choose one coherent toast treatment.

## Fix plan awaiting user approval

1. In style.css define coherent readable light text, AI-purple, border and status tokens; resolve undefined aliases. Keep cyan brand and purple AI accents with darker accessible light variants.
2. Convert the specific Hunt/Bulk/Library/Settings and Temu component overrides to tokens; adjust narrow header/control layouts without changing workflows.
3. Replace dark-only inline styles in sidepanel.html and dynamically generated UI where needed. Bring Image Studio, Content Studio, stepper and Flow batch onto the same theme system.
4. Extend local visual fixtures to populated lists, long titles, checked/unchecked/disabled/hover/focus/errors, all accordion sections and modal states at 360/500 px. Check contrast and overflow after animations settle; retest dark mode.
5. Update existing files and GitHub after verification. Manifest remains 9.12.13; no ZIP/version bump.

Not claimed: every live account-dependent state reproduced, every text contrast ratio measured, or every dynamic dialog exercised. No live AI, supplier, Temu upload or Sheets operation performed.

## Additional rendered findings
- Bulk and Library empty-state panels also share the dirty grey background, not only Hunt.
- Content Studio selected Titles/Bullets/Description chips show white text on pale cyan; product position, rewrite label and character count are barely visible. Its basic title editor and collapsed bullet surface are otherwise consistent.
- At 360 px Library search text is cramped, the view toggle retains a dark track, and the platform filter row exceeds available width; verify intentional scrolling and discoverability before treating that as accidental overflow.
