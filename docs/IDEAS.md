# Ideas / next steps (not built yet)

## Bank 🏦 (owner's spec, to be built later)
Intent: a bank is a **dead tile** on the map that makes the game harder, like the original genre's maps with a pond in the middle
(play only on the border tiles). Think of "blocked tile" as a generic primitive: a bank, a tile locked as loan collateral, a seized
tile and a pond/rock on a map are all cells that cannot hold, merge, move or lose an item.

Owner's rules
- Bought in the shop and placed like an item; expensive; cannot go into the reserve; max 3 banks.
- Generates money by itself. Destroyed only by items (hammer), or 3 banks together form collectible 💵 cash.
- Tap a bank to borrow (4 times max). Each loan locks the most expensive building touching one of the bank's four sides.
  While locked that building (and the bank) cannot merge, move or be deleted. Tap the bank again to repay.
- Interest 15%. A year without repaying: the construction and its tile are lost, the bank stops earning and is a dead end until paid.
- A 2nd bank doubles the previous bank's rate (15% -> 30% -> 60%).
- A game clock with a speed control.

Recommendations given (to confirm with the owner)
- Time follows turns (about 10 turns = 1 month, 120 = 1 year); the "speed timer" is a pause / 1x / 2x / 3x button that calls a pure
  `advance(state, ticks)` on an interval, pausing when the tab is hidden. Keeps replay, undo and tests deterministic.
- Loan = half the collateral's shop value; interest simple, charged monthly; repay per loan.
- After a default the tile stays seized until the debt is paid, then returns empty (otherwise a small board can soft-lock).
- At most 3 banks on the board, price rising per bank placed; 3 banks merge only when all are debt-free.
- Locked tiles must be excluded from merge groups (`group()`), validation and game over. A full board of locked tiles makes the
  hammer useless, so repaying a loan has to count as an escape in `isOver`.
- Build in stages: (1) locked tiles + calendar + speed control, (2) bank placement / income / hammer / 3-bank merge,
  (3) loans, interest, default. Each stage should ship and be tested on its own.

## Smaller ideas
- Pond-style maps: start a game with some dead tiles (needs the locked-tile primitive above).
- A new app icon (the PWA icon is still the original house and tree).
