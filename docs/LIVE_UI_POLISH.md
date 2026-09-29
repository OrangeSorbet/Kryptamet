# /live UI polish — Phase 6H (2026-09-29)

This doc is the reference for the Snek-inspired polish pass on `/live`. It **supersedes the "/live UI
architecture" file list in `ARCHITECTURE.md`** wherever the two differ. Kryptamet is still vanilla JS with
no build step (a final decision), and it is always dark.

## Why

A browser review at 1440×900 and 390×844 found these problems:
- The navbar speed slider was cut off.
- The poly-grid's 16th column stretched about 3× wide.
- The KaTeX popup overflowed the grid.
- On phone the grid fell apart and the minimap was cut off.
- The flowchart was a plain card grid.
- Five chapters had only 1 step.
- Errors used `alert()`, and the Run button gave no feedback.

## What changed (by item)

1. **Snake flowchart** (`js/flowchart.js`, `css/flowchart.css`) — port of Snek's `PhaseFlowchart`:
   - Layout: 5 boxes on the top row, then 4 running right→left; one column on phone.
   - Arrow connectors turn green and show a moving dot once the chapter they leave is done.
   - The chart is built at a fixed pixel size and scaled to fit with a `ResizeObserver`.
   - Boxes animate in with a stagger, but only right after a run.
2. **Box states and real summaries.** Box states are done (✓, green), last-visited (gold glow) and
   disabled. Each box shows a one-line caption from `CHAPTERS[i].summary(result, deepDive)` in
   `chapter_registry.js`, always computed from the real run.
3. **Speed dial** (`js/speed_dial.js`, `css/speed_dial.css`):
   - Moved from the navbar into the Scrubber as a ⚡ button.
   - Opens on hover or focus, stays open when clicked, and supports arrow keys.
   - Speed (1..10) is saved in `localStorage` under `kryptamet.speed`.
   - The "Restart animation" navbar button became a ↺ button in the Scrubber. Restart also replays
     poly-grid animations in chapters you've already finished (`forceReplay`).
4. **Intro cards** (`js/intro_card.js`, `js/chapter_intros.js`, `css/intro_card.css`) — port of Snek's
   `IntroCard`:
   - Shown the first time you open each chapter and the flowchart; seen state is stored in
     `localStorage` under `kryptamet.introSeen.<id>`.
   - Reopen with the "?" button. Close with Esc, ✕, the backdrop or "Got it".
   - The text is fixed factual description, not per-run values.
5. **Glossary tooltips** (`js/glossary.js`) — port of Snek's `linkTerms`. The first occurrence of a term
   in each step gets a dotted underline and a native `title` tooltip. The explanation grid is now 2×2
   (what/why/formal/next) with 3-line clamps, and each cell's `title` holds its full text.
6. **Transitions:**
   - The zoom blurs both layers, and the destination is laid out before it's built.
   - Each step fades in, and so do the dock and chrome.
   - The Run button shows a spinner and reports errors inline.
7. **Real multi-step chapters:**
   - Key: 2 steps. CKKS params and keys come from the new `ckks_params` response field; the second step
     is the transport key.
   - Encryption: 2 steps, `load_plaintext` (previously unused) and `ckks_encrypt`.
   - Decryption: 2 steps, decrypt and then a sigmoid curve with your score plotted.
   - Result: 2 steps. The first compares scores using the new `plaintext_equivalent_score` and
     `scores_match` fields; the second compares labels.
   - Benchmarks: 1 step per row of `results.json`, rendered from `window.BENCHMARKS`.
   - TF-IDF: 1 overview step plus 1 step per non-zero word, with bars.
   - Computation: a ledger of recent terms plus the running sum.
   - Transport direction fixed: the wrapped result travels Server→You, and on unwrap it has "arrived"
     instead of travelling back.
8. **Overview:**
   - Example-input chips, labeled fields, and Ctrl+Enter to run.
   - Navbar: logo, run-info text, and a "New input" button that goes back to the overview with the model
     and text pre-filled. Added an inline SVG favicon.
9. **Phone:**
   - Flowchart in one column.
   - Explanation grid becomes tabs (What/Why/Formal/Next).
   - Poly-grid scrolls sideways inside its box.
   - Minimap shows dots only.

**Also:**
- **Poly-grid fix:** columns use `minmax(0,1fr)` and the equation is a single floating overlay.
  `renderPolyGrid` returns a Promise, and Scrubber autoplay waits for it. The reveal stops if the grid is
  detached. Delay per cell is `300ms·0.6^(speed−1)`, with the first row 4× slower.
- **Step slider:** it only seeks when the index changes (before, dragging re-rendered the same step), and
  it has a 16px hit area.
- **Minimap:** dots are clickable to jump chapters, and the minimap sits top-center.
- **Keyboard:** Space, ←/→, Home/End and Esc. Shortcuts are ignored while typing in inputs or while an
  intro card is open.
- **Security:** `escapeHtml` wraps every string that goes into `innerHTML`.
- **Fetch code:** `runPipeline`/`fetchCkksDeepDive` moved into `js/pipeline_api.js` and return
  `{ok, error}`.
- **Cleanup:**
  - Removed the duplicated second half of `components.css`.
  - Moved the navbar's inline `<style>` into `navbar.css` (fixes a rules.md #2 violation).
  - Deleted the unused `templates/components/benchmark_table.html`.
  - Removed the duplicate `input_text` key in `app.py`.

## Extending /live

- **New step:** return `{what, why, formal, next, renderVisual(el)}` from the chapter's `buildXSteps`.
  `what` and `formal` must be computed from real data. `renderVisual` may return a Promise.
- **New chapter:** add an entry to `CHAPTERS` (with a `summary`), add text in `CHAPTER_INTROS[id]`, and
  add the steps builder in `scene_renderers.js`.
- **New glossary term:** add it to `GLOSSARY`. Longer terms match first.
- **New CSS or component:** put it in its own file and link it from `scenes.html`. Script order matters
  because the scripts share plain globals.

## Verification

Headless Chrome (Playwright, run ephemerally, not a project dependency) drove every chapter for both
models at desktop and phone widths, with no console errors. Scripted assertions passed for:
- inline error on empty input
- Ctrl+Enter to run
- intro card shown once
- ← → keyboard stepping
- passphrase re-lock (the flowchart caption changes to PBKDF2+AES)
- typing in an input doesn't trigger shortcuts
- minimap jump
- Space play/pause
- restart replays the poly-grid
- speed dial keyboard control
- "New input" pre-fills the form

`tests.test_transport_roundtrip` passes. `tests.test_he_inference` needs `data/raw/`, which is gitignored
and absent from the worktree, so it wasn't re-run; `he_infer.py` is unchanged.

## Known limitations

- SMS Spam's Computation chapter has about 500 steps, most of them zero-input terms. Every term is a real
  event, so none were cut. Upgrade: a "skip zero terms" band.
- `ARCHITECTURE.md`'s "/live UI architecture" file list predates this pass; this doc is authoritative.
