# Triple Three - build brief

Single-file HTML game, (no framework, installable PWA, no image assets).

## Rules
- 6x6 grid (the player can buy up to four extra rows/columns, one per side). Each turn the player places the "next item" on an empty cell.
- 3+ orthogonally connected identical items merge into one of the next tier, placed on the cell just tapped.
- Tiers: grass, bush, tree, camp, hut, house, village, school, hospital, mall, then cash (collectible for coins).
- Bears wander one step randomly each turn into empty cells. Bears in a closed pocket with no empty cell left are trapped and become tombstones; bears sharing a pocket that still has room are safe, and the church forms on the cell just played. 3 connected tombstones merge into a church, then cathedral.
- Optional "Wild bears" difficulty (chosen per game): a bear boxed in for 3 turns (2 warning turns) mauls a neighbouring grass..hut one tier down, repeating every 3 turns.
- Item queue: mostly grass, sometimes bush/tree/bear, rare "crystal" that merges with anything (three crystals together make a treasure) and rare fox that warps to a random empty cell (only the trap item or a full board stops it). One swap/storage slot.
- Shop: items cost more once their stock is used up; higher tiers unlock once built; land can be bought.
- Game ends when the grid is full. Score = sum of merge values; keep a local best.

## Graphics (emoji, no files)
grass 🌱, bush 🌿, tree 🌳, camp 🏕️, hut 🛖, house 🏠, village 🏘️, school 🏫, hospital 🏥, mall 🏬, cash 💵, bear 🐻, fox 🦊, tombstone 🪦, church ⛪, cathedral 🕌, crystal 💎, treasure 💰. Small decorative critters wander around homes (🐇🐤) and graves (👻🐈‍⬛). Plain grass-field board (no checkerboard), pop animation on merge, shake when a bear is trapped.

## Build order
1. Pure logic module (grid, merge flood-fill, bear movement, scoring) with Node tests.
2. Seeded RNG so tests and bug reports are reproducible.
3. UI + animations, swap slot, undo.
4. Playwright mobile test: play 50 random turns, assert no invalid state, game over reached.
5. PWA manifest + service worker, as in `build.js`.
