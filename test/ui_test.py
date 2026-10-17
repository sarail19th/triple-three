"""Mobile-viewport end-to-end test for Triple Three (needs `pip install playwright` + `playwright install chromium`).

Serves dist/ over http://localhost (so the service worker can register), then:
  - checks PWA bits (manifest, icons, service worker controls the page),
  - plays random turns (swap / undo / shop purchases / hammer / preview on+off mixed in) on a seeded game, asserting after EVERY action that the game state
    is valid and the DOM mirrors it,
  - keeps playing until the board is full, checks the game-over screen, new game, and reload-resume.

Usage: python test/ui_test.py [--seed N] [--shots DIR]
"""
import argparse, functools, http.server, json, os, random, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
EMOJI = ['', '🌱', '🌿', '🌳', '🏕️', '🛖', '🏠', '🏘️', '🏫', '🏥', '🏬', '💵', '🐻', '🪦', '⛪', '🕌', '💎', '💰', '🦊']
BEAR, TOMB, CHURCH, CRYSTAL, TREASURE, FOX = 12, 13, 14, 16, 17, 18
LAND_PRICE = [150, 400, 1000, 2500]
MIN_TURNS = 50   # random turns that must be played
MAX_TURNS = 600  # safety cap: a full board must be reached long before this

ap = argparse.ArgumentParser()
ap.add_argument('--seed', type=int, default=20240607)
ap.add_argument('--shots', default=os.path.join(tempfile.gettempdir(), 'triple-three-shots'))
args = ap.parse_args()
os.makedirs(args.shots, exist_ok=True)

if not os.path.exists(os.path.join(DIST, 'index.html')):
    sys.exit('dist/index.html missing - run `node build.js` first')


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://localhost:{server.server_address[1]}/index.html'

rng = random.Random(args.seed)


def state(page):
    return page.evaluate('window.ttDebug.state()')


def check_consistent(page, where):
    """Logic state is valid and the DOM shows exactly that state."""
    st = state(page)
    problems = page.evaluate('window.ttDebug.validate()')
    assert problems == [], f'{where}: invalid state {problems}'
    dom = page.evaluate("""() => ({
        cells: [...document.querySelectorAll('#board .cell')].map(c => c.textContent),
        score: document.getElementById('score').textContent,
        cur: document.getElementById('curItem').textContent,
        next: document.getElementById('nextItem').textContent,
        hold: document.getElementById('holdItem').textContent,
        coins: document.getElementById('coins').textContent,
        undoDisabled: document.getElementById('undoBtn').disabled })""")
    assert len(dom['cells']) == st['w'] * st['h'] == len(st['grid']), f'{where}: board must have w*h cells'
    assert dom['cells'] == [EMOJI[v] for v in st['grid']], f'{where}: DOM board differs from state'
    assert dom['score'] == str(st['score']), f'{where}: score text'
    assert dom['coins'] == str(st['coins']), f'{where}: coins text'
    assert dom['cur'] == EMOJI[st['cur']] and dom['next'] == EMOJI[st['next']], f'{where}: queue display'
    assert dom['hold'] == (EMOJI[st['hold']] if st['hold'] else '·'), f'{where}: hold display'
    assert dom['undoDisabled'] == (st['undo'] is None or st['undo']['coins'] < 5), f'{where}: undo button state'
    tools = page.evaluate("[...document.querySelectorAll('.tool[data-tool]')].map(b => b.dataset.tool)")
    assert tools[:3] == ['1', '2', '3'] and tools[-4:] == ['16', 'trap', 'hammer', 'move'], f'{where}: shop items {tools}'
    assert len(tools) == max(3, st['top']) + 4, f'{where}: one button per unlocked tier + crystal + trap + hammer + mover, got {tools}'
    for tool in tools:
        assert page.inner_text(f'.tool[data-tool="{tool}"] .tb') == f"×{max(0, st['stock'][tool])}", f'{where}: stock badge {tool}'
    return st


def tap_cell(page, idx, preview_on):
    """Preview on: the first tap only previews (state unchanged), the second commits."""
    sel = f'#board .cell[data-i="{idx}"]'
    if preview_on:
        before = state(page)
        page.tap(sel)
        mid = state(page)
        assert mid['grid'] == before['grid'] and mid['turn'] == before['turn'] and mid['coins'] == before['coins'], 'first tap must only preview'
        assert page.locator('#board .cell.pv, #board .cell.target').count() == 1, 'exactly one previewed tile'
    page.tap(sel)


with sync_playwright() as p:
    browser = p.chromium.launch(**({'executable_path': os.environ['TT_CHROMIUM']} if os.environ.get('TT_CHROMIUM') else {}))
    ctx = browser.new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('dialog', lambda d: d.accept())

    # ---- load a reproducible game and check the PWA plumbing
    page.goto(URL + '#seed=12345')
    page.wait_for_selector('#board .cell')
    assert page.title() == 'Triple Three'
    assert page.locator('#board .cell').count() == 36
    assert page.locator('#help').is_visible(), 'help shows on first launch'
    page.click('#helpClose')
    assert page.locator('#help').is_hidden()
    page.evaluate('navigator.serviceWorker.ready')
    page.reload()
    page.wait_for_selector('#board .cell')
    assert page.evaluate('navigator.serviceWorker.controller !== null'), 'service worker should control the page after reload'
    manifest = page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    assert manifest['display'] == 'standalone' and manifest['start_url'] == './'
    for icon in manifest['icons']:
        ok = page.evaluate("src => fetch(src).then(r => r.ok && r.headers.get('content-type'))", icon['src'])
        assert ok and 'png' in ok, f"icon {icon['src']} not served as png ({ok})"
    assert page.evaluate("document.querySelector('link[rel=manifest]') !== null")
    # no horizontal overflow on a phone
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal scroll on mobile'
    st = check_consistent(page, 'initial')
    assert st['turn'] == 0 and st['seed'] == 12345 and st['grid'] == [0] * 36 and st['coins'] == 10
    # board is large on a phone and the reserve tray sits at the top-left, above the board
    box = page.evaluate("""() => { const b = document.getElementById('board').getBoundingClientRect(), t = document.getElementById('holdBtn').getBoundingClientRect();
        return { w: b.width, bt: b.top, tl: t.left, tt: t.top, tb: t.bottom } }""")
    assert box['w'] >= 380, f"board too small: {box['w']}"
    assert box['tl'] < 20 and box['tb'] <= box['bt'] + 1 and box['tt'] < box['bt'], f'reserve tray should be top-left: {box}'
    assert page.locator('#undoBtn').is_disabled()
    page.screenshot(path=os.path.join(args.shots, '1_start.png'))

    # ---- play random turns until game over
    turns = swaps = undos = merges = pops = buys = hammers = lands = moves = 0
    preview_on = True
    assert page.get_attribute('#previewBtn', 'aria-pressed') == 'true'
    prev = st
    while not state(page)['over']:
        assert turns < MAX_TURNS, f'no game over after {MAX_TURNS} turns'
        st = state(page)
        roll = rng.random()
        if roll < 0.04:
            page.tap('#previewBtn'); preview_on = not preview_on
            assert (page.get_attribute('#previewBtn', 'aria-pressed') == 'true') == preview_on
            continue
        if roll < 0.10:
            page.tap('#holdBtn'); swaps += 1
            after = check_consistent(page, f'swap@{turns}')
            assert after['turn'] == st['turn'], 'swap must be free'
            assert sorted([after['cur'], after['hold']]) == sorted([st['cur'], st['hold']]) or st['hold'] == 0, 'swap exchanges items'
            continue
        if roll < 0.14 and st['undo'] is not None and not page.locator('#undoBtn').is_disabled():
            before_turn = st['turn']
            page.tap('#undoBtn'); undos += 1
            after = check_consistent(page, f'undo@{turns}')
            assert after['coins'] == st['undo']['coins'] - 5, 'undo costs coins'
            assert after['turn'] == before_turn - 1, 'undo reverts one turn'
            assert after['undo'] is None and page.locator('#undoBtn').is_disabled(), 'single-level undo'
            continue
        if roll < 0.20:  # shop: buy grass / bush / tree if enabled
            tool = rng.choice([t for t in page.evaluate("[...document.querySelectorAll('.tool[data-tool]')].map(b => b.dataset.tool)") if t not in ('trap', 'hammer', 'move')])
            btn = page.locator(f'.tool[data-tool="{tool}"]')
            price = page.evaluate('([s, t]) => TT.priceOf(s, +t)', [st, tool])
            if btn.is_enabled():
                btn.tap(); buys += 1
                after = check_consistent(page, f'buy@{turns}')
                assert after['cur'] == int(tool) and after['next'] == st['cur'] and after['turn'] == st['turn'], 'buy replaces current, free'
                assert after['coins'] == st['coins'] - price and after['stock'][tool] == st['stock'][tool] - 1, 'buying costs the shown price and one stock'
            else:
                locked = tool == '16' and st['milestone'] == 0
                assert st['coins'] < price or locked or st['cur'] == int(tool) or 0 not in st['grid'], 'tool disabled only when unaffordable/locked/useless'
            continue
        empties = [i for i, v in enumerate(st['grid']) if v == 0]
        hammer_btn = page.locator('#hammerBtn')
        if not empties and hammer_btn.is_disabled():  # full board, no hammer: buying land is the only way out
            side = page.evaluate("[...document.querySelectorAll('.land')].filter(b => !b.disabled).map(b => b.dataset.land)")
            assert side, 'full board but not over means the hammer or land must be usable'
            page.tap(f'.land[data-land="{side[0]}"]')
            after = check_consistent(page, f'land@{turns}')
            assert after['coins'] == st['coins'] - LAND_PRICE[len(st['land'])] and after['turn'] == st['turn'] and len(after['land']) == len(st['land']) + 1, 'land costs coins, free action'
            assert 0 in after['grid'], 'land adds empty tiles'
            lands += 1
            continue
        if not empties or (roll < 0.26 and hammer_btn.is_enabled()):  # hammer (forced when the board is full but affordable)
            assert hammer_btn.is_enabled(), 'full board but not over means the hammer must be usable'
            occ = [i for i, v in enumerate(st['grid']) if v != 0]
            hammer_btn.tap()
            assert hammer_btn.get_attribute('aria-pressed') == 'true'
            idx = rng.choice(occ)
            tap_cell(page, idx, preview_on)
            after = check_consistent(page, f'hammer@{turns}')
            assert after['grid'][idx] == 0 and after['coins'] == st['coins'] - 20 and after['turn'] == st['turn'], 'hammer clears the tile, free action'
            assert hammer_btn.get_attribute('aria-pressed') == 'false', 'hammer disarms after use'
            hammers += 1
            continue
        move_btn = page.locator('#moveBtn')
        if roll < 0.30 and move_btn.is_enabled():  # mover: pick up a random non-animal item, drop it on a random empty tile
            movable = [i for i, v in enumerate(st['grid']) if v not in (0, BEAR, FOX)]
            if movable:
                src, dst = rng.choice(movable), rng.choice(empties)
                move_btn.tap()
                assert move_btn.get_attribute('aria-pressed') == 'true'
                page.tap(f'#board .cell[data-i="{src}"]')
                assert page.locator('#board .cell.pick').count() == 1, 'picked-up tile is highlighted'
                tap_cell(page, dst, preview_on)
                after = check_consistent(page, f'move@{turns}')
                assert after['coins'] >= st['coins'] - 60 and after['stock']['move'] == st['stock']['move'] - 1 and after['turn'] == st['turn'], 'mover costs coins and one stock, free action'
                assert after['grid'][src] == 0 and move_btn.get_attribute('aria-pressed') == 'false', 'source is empty, mover disarms'
                moves += 1
                continue
        idx = rng.choice(empties)
        tap_cell(page, idx, preview_on)
        turns += 1
        after = check_consistent(page, f'turn {turns}')
        assert after['turn'] == st['turn'] + 1, 'a confirmed tap on an empty tile plays exactly one turn'
        if after['score'] > st['score']:
            merges += 1
            assert after['coins'] > st['coins'], 'merges pay coins'
            if page.locator('#board .cell.pop').count(): pops += 1
        if turns == 8: page.screenshot(path=os.path.join(args.shots, '2_midgame.png'))
        # tapping an occupied tile must be a no-op
        occ = [i for i, v in enumerate(after['grid']) if v != 0]
        if occ and not after['over'] and rng.random() < 0.15:
            page.tap(f'#board .cell[data-i="{rng.choice(occ)}"]')
            same = state(page)
            assert same['grid'] == after['grid'] and same['turn'] == after['turn'], 'tapping an occupied tile must do nothing'

    final = check_consistent(page, 'final')
    assert final['over'] and 0 not in final['grid'] and (final['coins'] < 20 or final['stock']['hammer'] == 0), 'game over means a full board and no usable hammer'
    assert len(final['land']) == 4 or final['coins'] < LAND_PRICE[len(final['land'])], 'game over also means no land left to buy'
    assert turns >= MIN_TURNS, f'only {turns} random turns before game over (want >= {MIN_TURNS})'
    assert page.locator('#overlay').is_visible(), 'game-over overlay'
    assert str(final['score']) in page.inner_text('#overText')
    best = page.evaluate("JSON.parse(localStorage.getItem('tt-best'))")
    assert best >= final['score'], 'best score persisted'
    page.screenshot(path=os.path.join(args.shots, '3_gameover.png'))
    # a move after game over must be impossible
    page.evaluate("document.getElementById('overlay').classList.add('hidden')")
    page.tap('#board .cell[data-i="0"]')
    assert state(page)['turn'] == final['turn'], 'no moves after game over'
    page.evaluate("document.getElementById('overlay').classList.remove('hidden')")

    # ---- new game and reload resume
    page.tap('#againBtn')
    fresh = check_consistent(page, 'new game')
    assert fresh['turn'] == 0 and fresh['grid'] == [0] * 36 and not fresh['over'] and page.locator('#overlay').is_hidden()
    tap_cell(page, 14, page.get_attribute('#previewBtn', 'aria-pressed') == 'true')
    mid = check_consistent(page, 'one move')
    page.goto(URL)  # no seed in hash -> resume saved game
    page.wait_for_selector('#board .cell')
    resumed = check_consistent(page, 'resume')
    assert resumed['grid'] == mid['grid'] and resumed['turn'] == mid['turn'] and resumed['rng'] == mid['rng'], 'saved game resumes'
    # ---- mouse: hover previews, ONE click places (touch needs preview + confirm, covered above)
    def load(grid, **kw):
        s = {'ver': 2, 'w': 6, 'h': 6, 'land': [], 'top': 3, 'grid': grid, 'cur': 1, 'next': 2, 'hold': 0, 'score': 0, 'coins': 30, 'turn': 3, 'over': False, 'rng': 77, 'seed': 77, 'undo': None}
        s.update(kw)
        page.evaluate('s => localStorage.setItem("tt-save", JSON.stringify(s))', s)
        page.goto(URL + '#')
        page.reload()
        page.wait_for_selector('#board .cell')

    g = [0] * 36
    g[13] = 1; g[15] = 1
    load(g)
    if page.get_attribute('#previewBtn', 'aria-pressed') != 'true': page.tap('#previewBtn')
    page.hover('#board .cell[data-i="14"]')
    assert page.locator('#board .cell.pv').count() == 1 and page.locator('#board .cell.eat').count() == 2, 'hover previews the merge'
    assert state(page)['turn'] == 3
    page.click('#board .cell[data-i="14"]')
    after = check_consistent(page, 'mouse click')
    assert after['turn'] == 4 and after['grid'][14] == 2, 'a single mouse click places (and merges)'

    # ---- bear trap: kills a bear on the spot into a tombstone; mouse = one click, touch = preview + confirm
    g = [0] * 36
    g[14] = BEAR; g[8] = TOMB; g[9] = TOMB
    load(g)
    assert page.locator('#trapBtn').is_enabled()
    page.tap('#trapBtn')
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'true'
    page.tap('#board .cell[data-i="0"]')  # not a bear: ignored
    assert state(page)['grid'] == g
    tap_cell(page, 14, True)
    after = check_consistent(page, 'trap')
    assert after['grid'][14] == CHURCH and after['grid'][8] == 0 and after['coins'] == 30 - 12 + 20 and after['turn'] == 3, 'trapped bear becomes a tombstone (here completing a church), free action'
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'false' and page.locator('#trapBtn').is_disabled(), 'no bear left'
    load(g)
    page.tap('#trapBtn')
    page.hover('#board .cell[data-i="14"]')
    page.click('#board .cell[data-i="14"]')
    after = check_consistent(page, 'trap by mouse')
    assert after['grid'][14] == CHURCH and after['turn'] == 3

    # ---- treasure: one tap opens it for coins (no confirmation), free action
    g = [0] * 36
    g[14] = TREASURE
    load(g, coins=5)
    page.tap('#board .cell[data-i="14"]')
    after = check_consistent(page, 'treasure')
    assert after['grid'][14] == 0 and after['coins'] == 5 + 250 and after['turn'] == 3, 'treasure opens for coins'
    g = [0] * 36
    g[14] = 11  # cash, the last building tier
    load(g, coins=5)
    page.tap('#board .cell[data-i="14"]')
    after = check_consistent(page, 'cash')
    assert after['grid'][14] == 0 and after['coins'] == 5 + 5000 and after['turn'] == 3, 'cash is collected for coins'

    # ---- fox: shows up in the trap flow like a bear (trap button enabled, tap kills it into a tombstone)
    g = [0] * 36
    g[20] = FOX
    load(g)
    assert page.locator('#trapBtn').is_enabled(), 'trap works on a fox'
    page.tap('#trapBtn')
    tap_cell(page, 20, True)
    after = check_consistent(page, 'trap fox')
    assert after['grid'][20] == TOMB and after['turn'] == 3 and after['coins'] == 30 - 12, 'trapped fox becomes a tombstone'

    # ---- mover: pick up, preview the drop, confirm; animals cannot be picked up; picking twice cancels
    g = [0] * 36
    g[0] = 1; g[2] = 1; g[21] = 1; g[30] = BEAR
    load(g, coins=100)
    assert page.locator('#moveBtn').is_enabled() and page.inner_text('#moveBtn .tp') == '🪙60'
    page.tap('#moveBtn')
    assert page.get_attribute('#moveBtn', 'aria-pressed') == 'true'
    page.tap('#board .cell[data-i="30"]')  # a bear: ignored
    assert page.locator('#board .cell.pick').count() == 0, 'animals cannot be picked up'
    page.tap('#board .cell[data-i="21"]'); assert page.locator('#board .cell.pick').count() == 1
    page.tap('#board .cell[data-i="21"]'); assert page.locator('#board .cell.pick').count() == 0, 'second tap puts it back'
    page.tap('#board .cell[data-i="21"]')
    page.tap('#board .cell[data-i="1"]')  # first tap on the destination only previews the merge
    assert state(page)['grid'] == g and page.locator('#board .cell.pv').count() == 1 and page.locator('#board .cell.eat').count() == 2
    assert 'merge' in page.inner_text('#note').lower()
    page.tap('#board .cell[data-i="1"]')
    after = check_consistent(page, 'mover')
    assert after['grid'][1] == 2 and after['grid'][0] == after['grid'][2] == after['grid'][21] == 0 and after['grid'][30] == BEAR
    assert after['coins'] == 100 - 60 + 2 and after['turn'] == 3 and after['stock']['move'] == 0, 'merged on the drop tile, free action, stock used'
    assert page.locator('#moveBtn').is_disabled() and page.get_attribute('#moveBtn', 'aria-pressed') == 'false'

    # ---- fox walled in on every side becomes a tombstone when the next item is placed
    g = [0] * 36
    g[14] = FOX; g[8] = 5; g[20] = 6; g[13] = 7; g[15] = 8
    load(g)
    tap_cell(page, 0, True)
    after = check_consistent(page, 'fox walled in')
    assert after['grid'][14] == TOMB and FOX not in after['grid'], 'a walled-in fox becomes a tombstone'

    # ---- shop: higher tiers unlock once built; stock runs out -> price doubles (shown on the button)
    load([0] * 36, coins=500)
    assert page.locator('.tool[data-tool="4"]').count() == 0, 'camp is locked at the start'
    load([0] * 36, coins=500, top=6)
    for t in ['4', '5', '6']:
        assert page.locator(f'.tool[data-tool="{t}"]').count() == 1, f'tier {t} unlocked'
    assert page.locator('.tool[data-tool="7"]').count() == 0
    load([0] * 36, coins=500, cur=2, next=2, stock={'1': 0, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '10': 1, '16': 0, 'hammer': 2, 'trap': 2})
    assert page.inner_text('.tool[data-tool="1"] .tp') == '🪙12', 'sold-out grass costs double (6 -> 12)'
    page.tap('.tool[data-tool="1"]')
    after = check_consistent(page, 'surcharge buy')
    assert after['coins'] == 500 - 12 and after['stock']['1'] == -1 and after['cur'] == 1
    assert page.inner_text('.tool[data-tool="1"] .tp') == '🪙24' or page.locator('.tool[data-tool="1"]').is_disabled(), 'price keeps doubling'

    # ---- land: a new row/column on the chosen side, each side once, board and DOM grow
    g = [0] * 36
    g[0] = 1
    load(g, coins=5000)
    page.tap('.land[data-land="top"]')
    after = check_consistent(page, 'land top')
    assert after['h'] == 7 and after['w'] == 6 and after['grid'][6] == 1 and after['coins'] == 5000 - 150 and after['turn'] == 3
    assert page.locator('.land[data-land="top"]').is_disabled(), 'each side only once'
    assert page.inner_text('#landNote').startswith('Land 1/4')
    page.tap('.land[data-land="left"]')
    after = check_consistent(page, 'land left')
    assert after['w'] == 7 and after['h'] == 7 and after['grid'][7 + 1] == 1
    box = page.evaluate("() => { const b = document.getElementById('board').getBoundingClientRect(), w = document.getElementById('boardWrap').getBoundingClientRect(); return { bw: b.width, ww: w.width, bh: b.height } }")
    assert abs(box['bw'] - box['ww'] * 7 / 7) < 2 and box['bw'] <= box['ww'] + 1, f'7x7 board fits its square wrap: {box}'
    page.tap('.land[data-land="right"]'); page.tap('.land[data-land="bottom"]')
    after = check_consistent(page, 'land all')
    assert after['w'] == 8 and after['h'] == 8 and len(after['land']) == 4 and page.locator('#board .cell').count() == 64
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal scroll with the biggest board'
    # play on the biggest board: a merge across the new columns, via the DOM
    page.evaluate('s => localStorage.setItem("tt-save", JSON.stringify(s))', dict(after, grid=[1 if i in (8 * 3 + 5, 8 * 3 + 7) else 0 for i in range(64)], cur=1, coins=0))
    page.reload(); page.wait_for_selector('#board .cell')
    tap_cell(page, 8 * 3 + 6, True)
    after = check_consistent(page, 'merge on 8x8')
    assert after['grid'][8 * 3 + 6] == 2 and after['turn'] == 4, 'merge works on the grown board'
    page.screenshot(path=os.path.join(args.shots, '5_land.png'))

    # ---- an old (version 1) save is upgraded, not thrown away: codes remap and the four old grand castles merge
    old_grid = [0] * 36
    for i in (14, 15, 16, 21): old_grid[i] = 8        # grand castles (final tier before the update)
    old_grid[0] = 9; old_grid[1] = 10; old_grid[2] = 14  # bear, tombstone, treasure in the old numbering
    page.evaluate('s => localStorage.setItem("tt-save", JSON.stringify(s))', {'grid': old_grid, 'cur': 9, 'next': 4, 'hold': 0, 'score': 5000, 'coins': 77, 'stock': {'1': 1, '2': 1, '3': 1, '13': 1, 'hammer': 1, 'trap': 1}, 'milestone': 3, 'turn': 40, 'over': False, 'rng': 9, 'seed': 9, 'undo': None})
    page.reload(); page.wait_for_selector('#board .cell')
    up = check_consistent(page, 'v1 save')
    assert up['ver'] == 2 and up['turn'] == 40 and up['cur'] == BEAR and up['next'] == 5, 'old items renumbered'
    assert up['grid'][0] == BEAR and up['grid'][1] == TOMB and up['grid'][2] == TREASURE
    assert up['grid'].count(9) == 0 and up['grid'].count(10) == 1, 'grand castles merged into one mall'

    # ---- ambient critters wander around homes and graves, and never intercept a tap
    g = [0] * 36
    g[7] = 5; g[8] = 6; g[13] = 6; g[14] = 5  # huts and houses (alternating, so nothing merges): residential
    g[21] = TOMB; g[22] = CHURCH; g[27] = 15; g[28] = TOMB  # graveyard: tombstones, a church and a cathedral (no 3 equal neighbours)
    load(g)
    page.wait_for_timeout(300)
    crit = page.evaluate('window.ttDebug.critters()')
    assert set(crit) == {'🐇', '🐤', '👻', '🐈\u200d⬛'}, f'critters: {crit}'
    assert page.locator('#critters .crit').count() == len(crit) and page.locator('#board .cell').count() == 36
    inside_js = """() => { const homes = window.ttDebug.critterHomes(), els = [...document.querySelectorAll('#critters .crit')];
        return els.map((el, i) => { const r = el.getBoundingClientRect(), c = document.querySelector('#board .cell[data-i="' + homes[i].cell + '"]').getBoundingClientRect(),
            x = r.left + r.width / 2, y = r.top + r.height / 2;
            return x >= c.left - 1 && x <= c.right + 1 && y >= c.top - 1 && y <= c.bottom + 1; }); }"""
    homes0 = page.evaluate('window.ttDebug.critterHomes()')
    area = {'🐇': (4, 5, 6, 7), '🐤': (4, 5, 6, 7), '👻': (13, 14, 15), '🐈\u200d⬛': (13, 14, 15)}
    assert all(h['code'] in area[h['kind']] for h in homes0), f'every critter lives on a tile of its own area: {homes0}'
    for _ in range(8):  # they keep hopping, but never leave their own tile
        assert all(page.evaluate(inside_js)), 'a critter strayed outside its own tile'
        page.wait_for_timeout(700)
    assert page.evaluate('window.ttDebug.critterHomes()') == homes0, 'critters keep their tile while it exists'
    # smash a home tile: critters that lived there move house (snap), the rest stay put
    gone = homes0[0]['cell']
    page.tap('#hammerBtn'); tap_cell(page, gone, True)
    homes1 = page.evaluate('window.ttDebug.critterHomes()')
    assert all(h['code'] in area[h['kind']] and h['cell'] != gone for h in homes1), f'critters re-homed after their tile vanished: {homes1}'
    page.wait_for_timeout(300)
    assert all(page.evaluate(inside_js))
    load(g)
    page.wait_for_timeout(200)
    tap_cell(page, 0, True)
    assert state(page)['turn'] == 4, 'critters never block a tap'
    load([0] * 36)
    assert page.evaluate('window.ttDebug.critters()') == [], 'no homes or graves, no critters'


    # ---- item guide lists both merge chains
    page.tap('#guideLink')
    assert page.locator('#guide').is_visible()
    guide = page.inner_text('#guideBody')
    for e in ['🌱', '🏕️', '🏘️', '🏫', '🏥', '🏬', '💵', '🐻', '🪦', '⛪', '🕌', '💰', '💎', '🦊']:
        assert e in guide, f'guide misses {e}'
    page.screenshot(path=os.path.join(args.shots, '4_guide.png'))
    page.tap('#guideClose')
    assert page.locator('#guide').is_hidden()

    # corrupt save is ignored, not crashed on
    page.evaluate("localStorage.setItem('tt-save', JSON.stringify({grid:[1,2,3]}))")
    page.reload()
    page.wait_for_selector('#board .cell')
    assert check_consistent(page, 'corrupt save')['turn'] == 0

    assert not errors, f'console errors: {errors}'
    browser.close()

print(f'OK: random game reached game over after {turns} turns (+{swaps} swaps, {undos} undos, {merges} scoring turns, '
      f'{pops} with pop animation, {buys} purchases, {hammers} hammers, {moves} moves, {lands} land), final score {final["score"]}')
server.shutdown()
