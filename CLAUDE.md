# Triple Three (emoji)

Single-file Triple Three clone: 6x6 board, place the "next" item, 3+ orthogonally connected identical items merge into the next tier on the tapped tile, bears wander and get trapped into tombstones -> churches. Plain HTML/CSS/JS, no framework, no runtime deps, installable PWA. Spec: `docs/TRIPLE_THREE_BRIEF.md`.

## Layout
- `src/logic.js` - pure game logic (UMD: `require` in Node, global `TT` in the browser). State is plain JSON: `{grid[36], cur, next, hold, score, turn, over, rng, seed, undo}`. `place(state, idx)` -> `{state, events}` or `null`; `swap`, `undo`, `validate`, `wouldMerge`. Everything is deterministic from `seed` (mulberry32; its state lives in the game state so undo/replay is exact).
- Codes: 0 empty, 1-8 grass/bush/tree/hut/house/mansion/castle/grand castle (final), 9 bear, 10 tombstone, 11 church, 12 cathedral (final), 13 crystal.
- `src/game.js` - UI: tap-to-place, swap slot, one-level undo, hints toggle, animations driven by the `events` list, localStorage save (`tt-save`) and best score (`tt-best`). `#seed=N` in the URL forces a reproducible game. `window.ttDebug` is a read-only hook for tests.
- `src/style.css`, `src/index.html` - templates with `/*INLINE_...*/` placeholders.
- `build.js` - inlines everything into `dist/index.html`, writes manifest + service worker (cache name = content hash).
- `gen/icons.js` - PWA icons into `dist/` (pure Node PNG writer, no Pillow).
- `test/test.js` - logic tests + 400-game random fuzz (state valid after every turn, games terminate).
- `test/ui_test.py` - Playwright mobile-viewport test: PWA checks, plays seeded random turns (with swaps/undos) to game over, asserts valid state and DOM == state after every action.

## Commands (run from the project root)
```
node test/test.js          # must print "OK: N logic tests passed"
node build.js              # dist/index.html (self-contained) + manifest + sw.js
node gen/icons.js          # icons into dist/ (run after build)
python test/ui_test.py     # needs: pip install playwright && python -m playwright install chromium
```
Serve `dist/` over https or localhost for the service worker (`python -m http.server -d dist`); opening the file directly also works but skips the PWA parts.

## Rules when changing things
- Changing logic: `node test/test.js`, rebuild, `python test/ui_test.py`. Keep `validate()` in sync with any new invariant.
- All randomness must go through the state's `rng` (never `Math.random` in logic) or replays/undo break.
- Decisions the brief left open: crystal acts as the best building tier that merges where dropped, otherwise stays as an inert item; castle trio -> grand castle (final tier); bears come only from the item queue; one-level undo; swap is a free action.
