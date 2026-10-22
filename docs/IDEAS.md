# Ideas / next steps (not built yet)

## Bank 🏦 (BUILT: stage A calendar + bank item with monthly income, stage B loans / interest / default / speed control; this section is the original spec)
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

Owner's answers (confirmed)
- Time follows turns (about 10 turns = 1 month, 120 = 1 year), with a pause / 1x / 2x / 3x speed control.
- After a default, paying the debt returns the tile (empty; the building is gone).
- Loan size left to us: half of the collateral's shop value.
- The mover (free action, 60 coins = 3x the hammer, limited stock) is already built.

Recommendations given
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

## Bear breeding (owner's idea, undecided)
"If 2 bears are trapped together for several turns, should they produce 1 more bear?" Advice given:
- Good fit with the pocket rule (bears sharing a pocket with room are safe): safety gets a time limit. A pen of 2 bears + 1 free tile
  fills itself with a cub, seals, and the 3 bears become tombstones (a church).
- Do it chance-based with the seeded rng (about 10% per turn for each pocket holding 2+ bears and a free tile): no per-bear ids or
  turn counters in the state, deterministic, easy to test. "Several turns" then emerges statistically.
- Limits are needed or it becomes a tombstone farm / fills the open board: only in pockets of at most about 6 cells (never on the
  open board), cubs only into free tiles of that pocket, a cap on total bears on the board (about 8), foxes never breed.
- Open question: which tile resolves the tombstone merge when a cub seals the pen (the cub's tile is the natural choice).

## Bear pens: mauling (built) and breeding (still open)
Owner's answers for mauling: only 🌱🌿🌳🏕️🛖 can be mauled; one tier down; every 3 turns while the bear still cannot move;
2 warning turns, maul on turn 3; a mauled 🌱 leaves an escape hole; offered as an extra-difficulty option ("Wild bears"), not in
every game. Built as the per-game `wild` flag. Breeding (see above) is not built; if it is, it should probably also live under
Wild bears, since both act on bears waiting in a pocket.

## Bear breeding (built, Wild bears only) and maps (built)
Owner's rule: breeding needs at least 2 empty tiles in the pen (so a pen is at least 4 tiles with 2 bears): 2 bears + 2 free tiles ->
2 bears + 1 cub with 1 free tile left. Built with a 10% chance per turn, pens of at most 6 tiles, at most 8 bears.
Maps built: easy / standard / medium (river) / hard (ponds). Water is the first "dead tile".

Next on the map side (owner's plan): a **bridge** item for the river, and a bridge earns money when people cross it. Water tiles
are currently walls, so a bridge would be a buildable replacement on a water tile (new code, new shop item, income per turn or per
crossing animal; the calendar from the bank plan would fit). The bank's "locked / dead tiles" can reuse the water idea.

## Bridges (built) and what is next for them
Built as the owner described: a bridge must join two banks (land on both opposite sides, never a map corner or the middle of wide water),
limit 5 per game, dearer every time, and bears can cross. Implementation notes are in CLAUDE.md.
Still open from the owner's earlier plan: a bridge **earns money when animals cross it** (per crossing, or per turn while something walks over it).
Natural hook: `moveBears` already moves bears and foxes onto a bridge tile; count crossings there and pay coins in `place`.
