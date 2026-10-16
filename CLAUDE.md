# Triple Three (emoji)

Single-file merge-puzzle game (a free hobby project inspired by the classic genre, with its own name, code and emoji art): 6x6 board, place the "next" item, 3+ orthogonally connected identical items merge into the next tier on the tapped tile, bears wander and get trapped into tombstones -> churches. Plain HTML/CSS/JS, no framework, no runtime deps, installable PWA. Spec: `docs/GAME_BRIEF.md`.

## Layout
- `src/logic.js` - pure game logic (UMD: `require` in Node, global `TT` in the browser). State is plain JSON: `{grid[36], cur, next, hold, score, coins, stock, milestone, turn, over, rng, seed, undo}`. `place(state, idx)` -> `{state, events}` or `null`; `swap`, `undo`, `validate`, `wouldMerge`, `preview` (pure what-if for a placement), shop: `buy(state, item)` -> state, `hammer(state, idx)` and `trap(state, idx)` (kills a bear into a tombstone) -> `{state, events}` (both free actions, cost coins; prices/earnings in `PRICE`/`COIN`). Everything is deterministic from `seed` (mulberry32; its state lives in the game state so undo/replay is exact).
- Codes: 0 empty, 1-8 grass/bush/tree/hut/house/mansion/castle/grand castle (final), 9 bear, 10 tombstone, 11 church, 12 cathedral, 13 crystal, 14 treasure (final; tap to open for coins via `open(state, idx)`).
- `src/game.js` - UI: placement (Preview toggle, `tt-preview`; mouse: hover previews and ONE click places; touch: tap to preview, tap again to confirm), reserve tray (top-left, the swap slot), shop row, hammer mode, one-level undo, hints toggle, animations driven by the `events` list, localStorage save (`tt-save`) and best score (`tt-best`). `#seed=N` in the URL forces a reproducible game. `window.ttDebug` is a read-only hook for tests.
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
- Decisions the brief left open: crystal acts as the best item kind that merges where dropped, otherwise waits as a wildcard; castle trio -> grand castle (final tier); bears come only from the item queue; one-level undo (costs coins); swap is a free action.
- Shop/coins: merges pay `(group-2)*COIN[tier]`; `buy` makes the item current and pushes the old current to `next` (old next is dropped); `hammer` clears any tile. `buy` refuses a purchase that would leave a full board unrescuable.
- Crystal: a crystal that cannot merge when placed stays as a wildcard and is re-checked after every placement (`settleCrystals`); `validate` asserts no crystal is left that could merge. A group of 4+ merges all its members into ONE next-tier item (only points/coins scale with size).
- Shop limits: `stock` per item (`START_STOCK`; crystal starts at 0), each purchase/hammer/trap uses one; score milestones (`MILESTONES`, `milestoneScore(n)`) add `RESTOCK` and emit an `unlock` event. Game over = full board and no usable hammer (coins >= price AND stock > 0). Undo costs `UNDO_COST` coins, taken from the restored snapshot (`canUndo`). Old saves are upgraded by `migrate()`.
- Crystal can stand in for the bear chain too (cathedral > church > tombstone, then castle..grass); it is re-checked after placements, bear moves and traps.
- Name: the game is called Triple Three (renamed from เกมสามหมี / Three Bears at the owner's request). Keep the name consistent in UI, manifest, docs, comments and the service-worker cache name; do not use the name of the original game it is inspired by.
- Service worker is cache-first; the page reloads once when a new version takes over. After a rebuild, hard-refresh (Ctrl+Shift+R) to see changes.
- Mansion icon is 🏛️ (🏡 looked too much like the house 🏠).
