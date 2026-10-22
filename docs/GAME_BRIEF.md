# Triple Three - build brief

Single-file HTML game, (no framework, installable PWA, no image assets).

## Rules
- 6x6 grid (the player can buy up to four extra rows/columns, one per side). Maps chosen at the start: easy (plain field), standard (a few random plants), medium (a river across the field), hard (random ponds); blue water tiles are dead tiles. Each turn the player places the "next item" on an empty cell.
- 3+ orthogonally connected identical items merge into one of the next tier, placed on the cell just tapped.
- Tiers: grass, bush, tree, camp, hut, house, village, school, hospital, mall, then cash (collectible for coins).
- Bears wander one step randomly each turn into empty cells. Bears in a closed pocket with no empty cell left are trapped and become tombstones; bears sharing a pocket that still has room are safe, and the church forms on the cell just played. 3 connected tombstones merge into a church, then cathedral.
- Optional "Wild bears" difficulty (chosen per game): a bear boxed in for 3 turns (2 warning turns) mauls a neighbouring grass..hut one tier down, repeating every 3 turns. Bears also breed in small pens (4-6 tiles, 2 bears, 2 free tiles).
- Calm mode: bears and foxes can each be switched off in the New game dialog (both off = nothing interrupts you, no trap tool); those games keep their own best score.
- Item queue: mostly grass, sometimes bush/tree/bear, and (lucky drops, by map) a free camp/hut/house once you have built a higher tier, rare "crystal" that merges with anything (three crystals together make a treasure) and rare fox that warps to a random empty cell (walls or a filled box trap it like a bear, as does the trap item). One swap/storage slot, and the next item can be swapped with the current one.
- First-time players get a guided tour that spotlights every button and shop tool and explains it (repeatable from How to play).
- Phone layout: New game top-left, turn / rules / guide / haptics line at the top, Reserve / Place / swap / Next in one row right above the map, the map low on the screen, Shop / Preview / Undo in a row under it (thumb reach), the shop as a pop-up sheet.
- Shop: items cost more once their stock is used up; higher tiers unlock once built; land can be bought (water on the edge carries on into the new row or column). On maps with water, up to 5 bridges can be built (each dearer than the last) on a water tile that has land on both sides; bears can walk over them, nothing can be built on them.
- Ponds: a shop tool that digs a permanent pond on an empty tile; each pays points every turn, dearer every time (up to 16). Lake quests: complete a 2x2, 3x3 and 4x4 block of water for one-off bonuses of coins and points; the next quest is always shown near the top of the screen. The first pond costs 60 coins. The Bridge button only appears where a bridge can be placed.
- Calendar and banks: every turn is a tick of the game clock (10 turns = a month, 12 months = a year, shown at the top). Once a village is built the shop sells banks (at most 3, dearer each): a dead tile that pays coins every month, cannot go in the reserve, is broken only by the hammer, and three connected banks merge into cash. Tap a bank to borrow half the shop price of the dearest building next to it (locked until repaid; 15% a year at the first bank, 30% at the second, 60% at the third); a year unpaid and that building's tile is seized and the bank stops paying. A clock speed control (paused / 1x / 2x / 3x) sets how fast the calendar, income and interest run.
- Game ends when the grid is full. Score = sum of merge values; keep a local best.

## Graphics (emoji, no files)
grass 🌱, bush 🌿, tree 🌳, camp 🏕️, hut 🛖, house 🏠, village 🏘️, school 🏫, hospital 🏥, mall 🏬, cash 💵, bear 🐻, fox 🦊, tombstone 🪦, church ⛪, cathedral 🕌, crystal 💎, treasure 💰. Small decorative critters wander around homes (🐇🐤), graves (👻🐈‍⬛) and on the water (🦢🐟). Water is drawn as smooth rivers and ponds with soft banks. Plain grass-field board (no checkerboard; seasonal colour themes: spring, summer, autumn, winter, auto by calendar; the grass / bush / tree icons and the little critters change with the season too), pop animation on merge, shake when a bear is trapped.

## Build order
1. Pure logic module (grid, merge flood-fill, bear movement, scoring) with Node tests.
2. Seeded RNG so tests and bug reports are reproducible.
3. UI + animations, swap slot, undo.
4. Playwright mobile test: play 50 random turns, assert no invalid state, game over reached.
5. PWA manifest + service worker, as in `build.js`.
