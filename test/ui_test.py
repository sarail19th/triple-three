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
EMOJI = ['', '🌱', '🌿', '🌳', '🛖', '🏠', '🏛️', '🏰', '🏯', '🐻', '🪦', '⛪', '🕌', '💎', '💰']
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
    assert len(dom['cells']) == 36, f'{where}: board must have 36 cells'
    assert dom['cells'] == [EMOJI[v] for v in st['grid']], f'{where}: DOM board differs from state'
    assert dom['score'] == str(st['score']), f'{where}: score text'
    assert dom['coins'] == str(st['coins']), f'{where}: coins text'
    assert dom['cur'] == EMOJI[st['cur']] and dom['next'] == EMOJI[st['next']], f'{where}: queue display'
    assert dom['hold'] == (EMOJI[st['hold']] if st['hold'] else '·'), f'{where}: hold display'
    assert dom['undoDisabled'] == (st['undo'] is None or st['undo']['coins'] < 5), f'{where}: undo button state'
    for tool in ['1', '2', '3', '13', 'trap', 'hammer']:
        assert page.inner_text(f'.tool[data-tool="{tool}"] .tb') == f"×{st['stock'][tool]}", f'{where}: stock badge {tool}'
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
    browser = p.chromium.launch()
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
    turns = swaps = undos = merges = pops = buys = hammers = 0
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
            tool = rng.choice(['1', '2', '3', '13'])
            btn = page.locator(f'.tool[data-tool="{tool}"]')
            if btn.is_enabled():
                btn.tap(); buys += 1
                after = check_consistent(page, f'buy@{turns}')
                assert after['cur'] == int(tool) and after['next'] == st['cur'] and after['turn'] == st['turn'], 'buy replaces current, free'
                assert after['coins'] < st['coins'] and after['stock'][tool] == st['stock'][tool] - 1, 'buying costs coins and stock'
            else:
                assert st['coins'] < {'1': 6, '2': 15, '3': 35, '13': 50}[tool] or st['stock'][tool] == 0 or st['cur'] == int(tool) or 0 not in st['grid'], 'tool disabled only when unaffordable/sold out/useless'
            continue
        empties = [i for i, v in enumerate(st['grid']) if v == 0]
        hammer_btn = page.locator('#hammerBtn')
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
        s = {'grid': grid, 'cur': 1, 'next': 2, 'hold': 0, 'score': 0, 'coins': 30, 'turn': 3, 'over': False, 'rng': 77, 'seed': 77, 'undo': None}
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
    g[14] = 9; g[8] = 10; g[9] = 10
    load(g)
    assert page.locator('#trapBtn').is_enabled()
    page.tap('#trapBtn')
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'true'
    page.tap('#board .cell[data-i="0"]')  # not a bear: ignored
    assert state(page)['grid'] == g
    tap_cell(page, 14, True)
    after = check_consistent(page, 'trap')
    assert after['grid'][14] == 11 and after['grid'][8] == 0 and after['coins'] == 30 - 12 + 20 and after['turn'] == 3, 'trapped bear becomes a tombstone (here completing a church), free action'
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'false' and page.locator('#trapBtn').is_disabled(), 'no bear left'
    load(g)
    page.tap('#trapBtn')
    page.hover('#board .cell[data-i="14"]')
    page.click('#board .cell[data-i="14"]')
    after = check_consistent(page, 'trap by mouse')
    assert after['grid'][14] == 11 and after['turn'] == 3

    # ---- treasure: one tap opens it for coins (no confirmation), free action
    g = [0] * 36
    g[14] = 14
    load(g, coins=5)
    page.tap('#board .cell[data-i="14"]')
    after = check_consistent(page, 'treasure')
    assert after['grid'][14] == 0 and after['coins'] == 5 + 250 and after['turn'] == 3, 'treasure opens for coins'

    # ---- item guide lists both merge chains
    page.tap('#guideLink')
    assert page.locator('#guide').is_visible()
    guide = page.inner_text('#guideBody')
    for e in ['🌱', '🏯', '🐻', '🪦', '⛪', '🕌', '💰', '💎']:
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
      f'{pops} with pop animation, {buys} purchases, {hammers} hammers), final score {final["score"]}')
server.shutdown()
