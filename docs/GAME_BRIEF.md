# Triple Three - build brief

Single-file HTML game, (no framework, installable PWA, no image assets).

## Rules
- 6x6 grid (the player can buy up to four extra rows/columns, one per side). Maps chosen at the start: easy (plain field), standard (a few random plants), medium (a river across the field), hard (random ponds); blue water tiles are dead tiles. Each turn the player places the "next item" on an empty cell.
- 3+ orthogonally connected identical items merge into one of the next tier, placed on the cell just tapped.
- Tiers: grass, bush, tree, camp, hut, house, village, school, hospital, mall, then cash (collectible for coins).
- Bears wander one step randomly each turn into empty cells. Bears in a closed pocket with no empty cell left are trapped and become tombstones; bears sharing a pocket that still has room are safe, and the church forms on the cell just played. 3 connected tombstones merge into a church, then cathedral.
- Optional "Wild bears" difficulty (chosen per game): a bear boxed in for 3 turns (2 warning turns) mauls a neighbouring grass..hut one tier down, repeating every 3 turns. Bears also breed in small pens (4-6 tiles, 2 bears, 2 free tiles).
- Item queue: mostly grass, sometimes bush/tree/bear, and (lucky drops, by map) a free camp/hut/house once you have built a higher tier, rare "crystal" that merges with anything (three crystals together make a treasure) and rare fox that warps to a random empty cell (walls or a filled box trap it like a bear, as does the trap item). One swap/storage slot, and the next item can be swapped with the current one.
- Phone layout: controls above the map, the map low on the screen (thumb reach), the shop as a pop-up sheet from a Shop button under the map.
- Shop: items cost more once their stock is used up; higher tiers unlock once built; land can be bought. On maps with water, up to 5 bridges can be built (each dearer than the last) on a water tile that has land on both sides; bears can walk over them, nothing can be built on them.
- Game ends when the grid is full. Score = sum of merge values; keep a local best.

## Graphics (emoji, no files)
grass 🌱, bush 🌿, tree 🌳, camp 🏕️, hut 🛖, house 🏠, village 🏘️, school 🏫, hospital 🏥, mall 🏬, cash 💵, bear 🐻, fox 🦊, tombstone 🪦, church ⛪, cathedral 🕌, crystal 💎, treasure 💰. Small decorative critters wander around homes (🐇🐤), graves (👻🐈‍⬛) and on the water (🦢🐟). Water is drawn as smooth rivers and ponds with soft banks. Plain grass-field board (no checkerboard), pop animation on merge, shake when a bear is trapped.

## Build order
1. Pure logic module (grid, merge flood-fill, bear movement, scoring) with Node tests.
2. Seeded RNG so tests and bug reports are reproducible.
3. UI + animations, swap slot, undo.
4. Playwright mobile test: play 50 random turns, assert no invalid state, game over reached.
5. PWA manifest + service worker, as in `build.js`.
