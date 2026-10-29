node build.js         # builds dist/index.html, manifest and service worker
node gen/icons.js     # PWA icons into dist/ (run after build)
python -m http.server -d dist
```

Then open <http://localhost:8000>. Opening `dist/index.html` directly also works but skips the PWA parts.

Browser test (Playwright, mobile viewport, plays seeded games to game over):

```bash
pip install playwright && python -m playwright install chromium
python test/ui_test.py
```

## Project layout

| Path | What it is |
| --- | --- |
| `src/logic.js` | Pure, deterministic game logic. State is plain JSON and all randomness goes through a seeded RNG stored in the state, so undo and replays are exact. |
| `src/game.js` | UI, animations, saves in `localStorage`, shop, quests, world. |
| `src/style.css`, `src/index.html` | Templates inlined by the build. |
| `build.js` | Inlines everything into a self-contained `dist/index.html` and writes the manifest and service worker. |
| `gen/icons.js` | Pure Node PNG writer for the PWA icons. |
| `test/` | Node logic tests and the Playwright UI test. |
| `docs/GAME_BRIEF.md` | The game spec. |
| `docs/IDEAS.md` | Roadmap notes. |
| `CLAUDE.md` | Detailed design notes and rules for working on the code. |

## Deploying

Pushing to `main` runs `.github/workflows/pages.yml`: tests, build, icons, then publish `dist/` to GitHub Pages. The service worker loads pages network-first, so players get a new version on their next visit. The ☰ Menu has an **Update** button that fetches the latest build without touching saves.

## Contributing

Run `node test/test.js` and `python test/ui_test.py` before a change. When changing the logic, keep `validate()` in sync with any new invariant, and never use `Math.random` in the logic. `CLAUDE.md` lists the rest of the rules.
