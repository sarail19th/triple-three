# Triple Three 🌱🌿🌳

A merge-puzzle game played in the browser, built from emoji. Place the next item on a 6x6 board, line up three of a kind and they merge into the next tier, while bears wander the board and get trapped into tombstones. It is a free hobby project inspired by the classic genre, with its own name, code and art.

Plain HTML, CSS and JavaScript. No framework, no runtime dependencies, no image files. It installs as a PWA and works offline.

**Play:** <https://sarail19th.github.io/triple-three/> (deployed from `main` by GitHub Pages)

## How to play

- Each turn you place the **next** item on an empty tile.
- **3 or more** orthogonally connected identical items merge into one item of the next tier, on the tile you tapped.
- Building chain: 🌱 → 🌿 → 🌳 → 🏕️ → 🛖 → 🏠 → 🏘️ → 🏫 → 🏥 → 🏬 → 💵 (cash, tap it to collect coins).
- 🐻 **Bears** wander one step a turn. A bear shut into a pocket with no empty tile becomes a 🪦 tombstone. Three tombstones merge into a ⛪ church, then a 🕌 cathedral.
- 🦊 **Foxes** warp to a random empty tile. A 💎 **crystal** stands in for whatever item completes a group.
- You have a reserve slot, a swap with the next item, and a one-level undo.
- The game ends when the board is full and you have no way out. Score is the sum of your merges, and your best is saved locally.

The in-game **How to play**, **Item guide** and first-run tour cover everything else.

## Features

- **Shop** paid with coins earned from merges: items, hammer, trap, mover, bridges, ponds, extra land, banks.
- **Wild bears** mode: bears that stay boxed in escalate, maul your buildings and breed.
- **Maps**: easy, standard, river, hard (random ponds), island, and highlands (mountains and holes).
- **World**: a 3x3 map of regions you unlock by building higher tiers, each with its own save, linked by a shared treasury.
- **Banks and loans**: banks pay income, loans lock buildings, and unpaid loans are seized. Treasury accounts carry coins between games.
- **Quests, achievements and titles** with gameplay perks.
- **Seasons**: spring, summer, autumn and winter change the colours, plants and animals.
- Deterministic and reproducible: every game comes from a seed (`#seed=123` in the URL).

## Run it locally

