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
EMOJI = ['', '🌱', '🌿', '🌳', '🏕️', '🛖', '🏠', '🏘️', '🏫', '🏥', '🏬', '💵', '🐻', '🪦', '⛪', '🕌', '💎', '💰', '🦊', '🐻', '🐻', '']
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
    assert tools[:3] == ['1', '2', '3'] and tools[-6:] == ['16', 'trap', 'hammer', 'move', 'bridge', 'pond'], f'{where}: shop items {tools}'
    assert len(tools) == max(3, st['top']) + 6, f'{where}: one button per unlocked tier + crystal + trap + hammer + mover + bridge + pond, got {tools}'
    for tool in tools:
        want = f"×{5 - len(st['bridges'])}" if tool == 'bridge' else f"×{16 - len(st['ponds'])}" if tool == 'pond' else f"×{max(0, st['stock'][tool])}"
        assert page.inner_text(f'.tool[data-tool="{tool}"] .tb') == want, f'{where}: badge {tool}'
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


def open_shop(page):
    """The shop is a pop-up sheet on phones: open it (a no-op when it is already open)."""
    if page.locator('#shopSheet').is_hidden():
        page.tap('#shopBtn')
    assert page.locator('#shopSheet').is_visible(), 'the shop sheet opens'


def shop_tap(page, selector):
    """Tap something inside the shop (tools, land, items). Every shop action closes the sheet again."""
    open_shop(page)
    page.tap(selector)


with sync_playwright() as p:
    browser = p.chromium.launch(**({'executable_path': os.environ['TT_CHROMIUM']} if os.environ.get('TT_CHROMIUM') else {}))
    ctx = browser.new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script("if (!localStorage.getItem('tt-season')) localStorage.setItem('tt-season', '\"summer\"');")  # the real default is Auto (by month): pin the look the tests expect
    ctx.add_init_script("window.__vib = []; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { window.__vib.push(ms); return true; } });")
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
    # ---- first launch: the guided tour. Walk through all of it: every step has a card inside the screen, spotlights its control, opens the shop
    # sheet for the shop steps, Back works, and finishing remembers that it was seen.
    assert page.locator('#tour').is_visible() and page.locator('#help').is_hidden(), 'the guided tour shows on first launch'
    assert page.evaluate("localStorage.getItem('tt-seen-help')") is None
    steps = []
    sheet_steps = {'🏠 Buy an item', '🪤 Trap', '🔨 Hammer', '🚚 Mover', '💧 Pond', '⬆️⬇️⬅️➡️ Land'}
    while page.locator('#tour').is_visible():
        page.wait_for_timeout(380)
        title = page.inner_text('#tourTitle'); steps.append(title)
        geo = page.evaluate("""() => { const c = document.getElementById('tourCard').getBoundingClientRect(), h = document.getElementById('tourHole').getBoundingClientRect(),
            noHole = document.getElementById('tour').classList.contains('nohole');
            return { card: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, noHole, hole: h.width > 0 && h.height > 0 && h.right > 0 && h.bottom > 0 && h.left < innerWidth && h.top < innerHeight } }""")
        assert geo['card'], f'tour card off screen at {title}'
        assert geo['noHole'] or geo['hole'], f'no spotlight at {title}'
        assert page.locator('#shopSheet').is_visible() == (title in sheet_steps), f'the shop sheet is open exactly for the shop steps ({title})'
        if len(steps) == 3:   # Back and forth
            page.tap('#tourBack'); page.wait_for_timeout(100); assert page.inner_text('#tourStep').lower().startswith('step 2 of')
            page.tap('#tourNext'); page.wait_for_timeout(100); assert page.inner_text('#tourStep').lower().startswith('step 3 of')
        page.tap('#tourNext')
    assert len(steps) >= 15, steps
    for need in ['🗺️ The map', '🌱 Place and Next', '📦 Reserve', '↶ Undo', '👁 Preview', '⟳ New game', '📋 Turn, rules and settings', '🛒 Shop', '🪤 Trap', '🔨 Hammer', '🚚 Mover', '💧 Pond', '⬆️⬇️⬅️➡️ Land']:
        assert need in steps, f'the tour misses {need}: {steps}'
    assert page.locator('#shopSheet').is_hidden() and page.evaluate("localStorage.getItem('tt-seen-help')") == '1', 'the tour ends with the shop closed and remembered'
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
    # board is large on a phone; the New game button sits at the top-left, and the Reserve slot is in the same row as Place and Next
    box = page.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect(), b = r('#board'), sh = r('#newBtn'), h = r('#holdBtn'), p = r('.slot.current'), n = r('#nextBtn');
        return { w: b.width, bt: b.top, shl: sh.left, shb: sh.bottom, holdTop: h.top, holdRight: h.right, placeTop: p.top, placeLeft: p.left, nextTop: n.top } }""")
    assert box['w'] >= 380, f"board too small: {box['w']}"
    assert box['shl'] < 20 and box['shb'] <= box['bt'] + 1, f'the New game button should be top-left: {box}'
    assert abs(box['holdTop'] - box['placeTop']) < 3 and abs(box['holdTop'] - box['nextTop']) < 3 and box['holdRight'] <= box['placeLeft'] + 1, f'Reserve shares the Place / Next row: {box}'
    # phone layout: turn / rules line at the top, Place / Next above the map, Shop / Preview / Undo below it, the map in the lower half (thumb reach), the shop closed
    lay = page.evaluate("""() => { const r = id => document.getElementById(id).getBoundingClientRect(), b = r('board');
        return { boardTop: b.top, boardBottom: b.bottom, undoTop: r('undoBtn').top, previewTop: r('previewBtn').top, shopTop: r('shopBtn').top, turnBottom: r('turn').bottom, helpBottom: r('helpLink').bottom, hapticBottom: r('hapticLink').bottom, placeBottom: document.querySelector('.panel').getBoundingClientRect().bottom,
                 vh: innerHeight, sheetHidden: document.getElementById('shopSheet').classList.contains('hidden') } }""")
    assert lay['placeBottom'] <= lay['boardTop'] + 1, f'Place / Next above the map: {lay}'
    assert min(lay['undoTop'], lay['previewTop'], lay['shopTop']) >= lay['boardBottom'], f'Undo, Preview and Shop below the map: {lay}'
    assert max(lay['turnBottom'], lay['helpBottom']) <= lay['placeBottom'] and lay['hapticBottom'] <= lay['placeBottom'], f'turn and rules links at the top: {lay}'
    assert (lay['boardTop'] + lay['boardBottom']) / 2 >= lay['vh'] * 0.55, f'the map sits in the lower half of the screen: {lay}'
    assert lay['sheetHidden'] and page.locator('#shopSheet').is_hidden(), 'the shop starts closed'
    # the shop pops up, shows coins, closes with its X, with a tap outside and with Escape
    page.tap('#shopBtn'); assert page.locator('#shopSheet').is_visible() and page.inner_text('#sheetCoins') == '10'
    page.tap('#shopClose'); assert page.locator('#shopSheet').is_hidden()
    page.tap('#shopBtn'); page.mouse.click(200, 60); assert page.locator('#shopSheet').is_hidden(), 'a tap on the dimmed background closes it'
    page.tap('#shopBtn'); page.keyboard.press('Escape'); assert page.locator('#shopSheet').is_hidden()
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
            tool = rng.choice([t for t in page.evaluate("[...document.querySelectorAll('.tool[data-tool]')].map(b => b.dataset.tool)") if t not in ('trap', 'hammer', 'move', 'bridge', 'pond')])
            btn = page.locator(f'.tool[data-tool="{tool}"]')
            price = page.evaluate('([s, t]) => TT.priceOf(s, +t)', [st, tool])
            if btn.is_enabled():
                open_shop(page); btn.tap(); buys += 1
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
            shop_tap(page, f'.land[data-land="{side[0]}"]')
            after = check_consistent(page, f'land@{turns}')
            assert after['coins'] == st['coins'] - LAND_PRICE[len(st['land'])] and after['turn'] == st['turn'] and len(after['land']) == len(st['land']) + 1, 'land costs coins, free action'
            assert 0 in after['grid'], 'land adds empty tiles'
            lands += 1
            continue
        if not empties or (roll < 0.26 and hammer_btn.is_enabled()):  # hammer (forced when the board is full but affordable)
            assert hammer_btn.is_enabled(), 'full board but not over means the hammer must be usable'
            occ = [i for i, v in enumerate(st['grid']) if v != 0]
            open_shop(page); hammer_btn.tap()
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
                open_shop(page); move_btn.tap()
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
        s = {'ver': 2, 'wild': False, 'bridges': [], 'w': 6, 'h': 6, 'land': [], 'top': 3, 'grid': grid, 'cur': 1, 'next': 2, 'hold': 0, 'score': 0, 'coins': 30, 'turn': 3, 'over': False, 'rng': 77, 'seed': 77, 'undo': None}
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
    shop_tap(page, '#trapBtn')
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'true'
    page.tap('#board .cell[data-i="0"]')  # not a bear: ignored
    assert state(page)['grid'] == g
    tap_cell(page, 14, True)
    after = check_consistent(page, 'trap')
    assert after['grid'][14] == CHURCH and after['grid'][8] == 0 and after['coins'] == 30 - 12 + 20 and after['turn'] == 3, 'trapped bear becomes a tombstone (here completing a church), free action'
    assert page.get_attribute('#trapBtn', 'aria-pressed') == 'false' and page.locator('#trapBtn').is_disabled(), 'no bear left'
    load(g)
    shop_tap(page, '#trapBtn')
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
    shop_tap(page, '#trapBtn')
    tap_cell(page, 20, True)
    after = check_consistent(page, 'trap fox')
    assert after['grid'][20] == TOMB and after['turn'] == 3 and after['coins'] == 30 - 12, 'trapped fox becomes a tombstone'

    # ---- haptic feedback can be switched off (and back on), and the choice is remembered
    g = [0] * 36
    load(g, cur=1, next=1)
    assert page.locator('#hapticLink').is_visible() and 'on' in page.inner_text('#hapticLink')
    page.evaluate('window.__vib.length = 0')
    tap_cell(page, 3, True)
    assert page.evaluate('window.__vib.length') >= 1, 'placing buzzes while haptics are on'
    page.tap('#hapticLink')
    assert 'off' in page.inner_text('#hapticLink') and page.evaluate("JSON.parse(localStorage.getItem('tt-haptics'))") is False
    page.evaluate('window.__vib.length = 0')
    tap_cell(page, 5, True)
    assert page.evaluate('window.__vib.length') == 0, 'no buzzing once haptics are off'
    page.reload(); page.wait_for_selector('#board .cell')
    assert 'off' in page.inner_text('#hapticLink'), 'the choice survives a reload'
    page.tap('#hapticLink')
    assert 'on' in page.inner_text('#hapticLink') and page.evaluate('window.__vib.length') >= 1, 'switching it on gives a sample buzz'
    page.evaluate('window.__vib.length = 0')
    tap_cell(page, 7, True)
    assert page.evaluate('window.__vib.length') >= 1

    # ---- tapping Next swaps it with Place: free, as often as you like
    g = [0] * 36
    load(g, cur=2, next=3, hold=0)
    page.tap('#nextBtn')
    after = check_consistent(page, 'swap next')
    assert after['cur'] == 3 and after['next'] == 2 and after['turn'] == 3 and after['rng'] == 77, 'Place and Next are swapped, no turn passes'
    assert page.inner_text('#curItem') == EMOJI[3] and page.inner_text('#nextItem') == EMOJI[2]
    page.tap('#nextBtn')
    assert check_consistent(page, 'swap next back')['cur'] == 2, 'swapping again puts them back'
    page.tap('#swapBtn')                              # the ⇄ button between the two items does the same
    after = check_consistent(page, 'swap button')
    assert after['cur'] == 3 and after['next'] == 2 and after['turn'] == 3
    bar = page.evaluate("""() => { const r = id => document.getElementById(id).getBoundingClientRect(), a = document.querySelector('.slot.current').getBoundingClientRect(), s = r('swapBtn'), n = r('nextBtn');
        return a.right <= s.left + 1 && s.right <= n.left + 1 && s.width >= 40 && s.height >= 40 }""")
    assert bar, 'the swap button sits between Place and Next and is big enough to tap'
    page.tap('#swapBtn'); page.tap('#nextBtn'); tap_cell(page, 14, True)   # (swapped twice, then via Next) the item in Place is the one that gets placed
    after = check_consistent(page, 'place swapped item')
    assert after['grid'][14] == 3 and after['turn'] == 4

    # ---- an armed tool is shown next to the Shop button and can be put away without reopening the shop
    g = [0] * 36
    g[14] = 5
    load(g, coins=100)
    assert page.locator('#toolCancel').is_hidden()
    top_before = page.evaluate("document.getElementById('board').getBoundingClientRect().top")
    shop_tap(page, '#hammerBtn')
    assert page.locator('#shopSheet').is_hidden(), 'arming a tool closes the shop'
    assert page.locator('#toolCancel').is_visible() and 'Hammer' in page.inner_text('#toolCancel')
    assert page.evaluate("document.getElementById('board').getBoundingClientRect().top") == top_before, 'arming a tool must not move the map'
    page.tap('#toolCancel')
    assert page.locator('#toolCancel').is_hidden() and page.get_attribute('#hammerBtn', 'aria-pressed') == 'false'

    # ---- mover: pick up, preview the drop, confirm; animals cannot be picked up; picking twice cancels
    g = [0] * 36
    g[0] = 1; g[2] = 1; g[21] = 1; g[30] = BEAR
    load(g, coins=100)
    assert page.locator('#moveBtn').is_enabled() and page.inner_text('#moveBtn .tp') == '🪙60'
    shop_tap(page, '#moveBtn')
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

    # ---- three gems merge into a treasure (no points / coins), shown in the preview note and the hint
    g = [0] * 36
    g[13] = CRYSTAL; g[15] = CRYSTAL
    load(g, cur=CRYSTAL, next=1, coins=30)
    page.tap('#board .cell[data-i="14"]')
    assert page.locator('#board .cell.pv').count() == 1 and page.locator('#board .cell.eat').count() == 2
    assert 'treasure' in page.inner_text('#note') and '+0' not in page.inner_text('#note'), page.inner_text('#note')
    page.tap('#board .cell[data-i="14"]')
    after = check_consistent(page, 'gem trio')
    assert after['grid'][14] == TREASURE and after['grid'][13] == after['grid'][15] == 0 and after['score'] == 0 and after['coins'] == 30, 'three gems -> one treasure'

    # ---- fox walled in on every side becomes a tombstone when the next item is placed
    g = [0] * 36
    g[14] = FOX; g[8] = 5; g[20] = 6; g[13] = 7; g[15] = 8
    load(g)
    tap_cell(page, 0, True)
    after = check_consistent(page, 'fox walled in')
    assert after['grid'][14] == TOMB and FOX not in after['grid'], 'a walled-in fox becomes a tombstone'

    # ---- Wild bears: the New game dialog picks the mode; boxed-in bears escalate (growl) and then maul a low-tier building
    page.tap('#newBtn')
    assert page.locator('#newGame').is_visible()
    cur = state(page)
    assert cur['turn'] > 0 and page.locator('#newWarn').is_visible(), 'a game in progress gets a warning before New'
    warn = page.inner_text('#newWarn')
    assert 'lost' in warn and f"turn {cur['turn']}" in warn and f"score {cur['score']}" in warn, warn
    assert page.inner_text('#newStart') == 'Erase game & start' and 'danger' in page.get_attribute('#newStart', 'class')
    page.tap('#newCancel'); assert page.locator('#newGame').is_hidden()
    page.tap('#newBtn'); page.tap('.opt[data-bears="wild"]'); page.tap('#newStart')
    wild = check_consistent(page, 'new wild game')
    assert wild['wild'] is True and wild['turn'] == 0 and 'wild bears' in page.inner_text('#seed')
    assert page.evaluate("JSON.parse(localStorage.getItem('tt-wild'))") is True, 'the mode pick is remembered'
    g = [0] * 36
    g[0] = BEAR; g[6] = FOX; g[1] = 6       # a calm bear boxed in by a house and a fox (the fox keeps its box open)
    load(g, wild=True, cur=2, next=2)
    tap_cell(page, 35, True)
    after = check_consistent(page, 'growl')
    assert after['grid'][0] == 19 and after['grid'][1] == 6, 'turn 1 boxed in: the bear growls'
    g = [0] * 36
    g[0] = 20; g[6] = FOX; g[1] = 5         # an angry bear boxed in by a hut and a fox
    load(g, wild=True, cur=2, next=2, score=150)
    assert page.evaluate("getComputedStyle(document.querySelector('#board .cell[data-i=\"0\"] .e')).animationName") == 'grumble', 'angry bears look angry'
    tap_cell(page, 35, True)
    after = check_consistent(page, 'maul')
    assert after['grid'][1] == 4 and after['grid'][0] == BEAR, 'turn 3 boxed in: the hut is mauled down to a camp and the bear starts over'
    assert page.evaluate("JSON.parse(localStorage.getItem('tt-best-wild'))") == 150, 'wild games keep their own best score'
    assert page.evaluate("JSON.parse(localStorage.getItem('tt-best'))") != 150, 'and leave the classic best alone'
    assert page.evaluate("document.getElementById('seed').textContent").endswith('wild bears')
    page.tap('#newBtn'); page.tap('.opt[data-bears="classic"]'); page.tap('#newStart')
    classic = check_consistent(page, 'new classic game')
    assert classic['wild'] is False and 'wild' not in page.inner_text('#seed')

    # ---- seasons: the link cycles auto -> spring -> summer -> autumn -> winter, sets data-season, remembers the pick, the falling bits only exist when
    # there is something to fall, and the natural items (plants, critters) change with the season. The tests start pinned to summer (see add_init_script).
    sea = lambda: page.evaluate("document.documentElement.dataset.season")
    PLANTS = {'summer': ['🌱', '🌿', '🌳'], 'spring': ['🌱', '🌼', '🌸'], 'autumn': ['🌾', '🍂', '🍁'], 'winter': ['❄️', '🌲', '🎄']}
    HOME = {'summer': {'🐇', '🐤'}, 'spring': {'🐇', '🐤', '🦋'}, 'autumn': {'🐿️', '🦔'}, 'winter': {'🦌', '🐦'}}
    SKIN = {'summer': ('🐻', 'bear', '🦊', 'fox'), 'spring': ('🐻', 'bear', '🦊', 'fox'), 'autumn': ('🐗', 'boar', '🦝', 'raccoon'), 'winter': ('🐺', 'wolf', '🐇', 'rabbit')}
    WATER = {'summer': {'🦢', '🐟'}, 'spring': {'🦢', '🐸'}, 'autumn': {'🦆', '🐟'}, 'winter': {'🦢', '🦆'}}
    assert 'Summer' in page.inner_text('#seasonLink') and sea() == 'summer'
    g = [0] * 36
    for i in (12, 14, 16, 25, 27): g[i] = 5      # five huts (not touching, so they do not merge): rabbits / chicks / squirrels live here
    for i in (2, 8): g[i] = 21                   # a little water for the swans and fish
    g[30] = 1; g[31] = 2; g[32] = 3              # one of each plant tier on the board
    g[33] = 12; g[34] = 18; g[35] = 13           # a bear, a fox and a tombstone
    load(g, map='medium', coins=100)
    seen = {}
    for want in ['autumn', 'winter', 'auto', 'spring', 'summer']:
        page.tap('#seasonLink')
        cur = sea()
        assert (cur == want) if want != 'auto' else ('auto' in page.inner_text('#seasonLink') and cur in PLANTS), (cur, want)
        seen[cur] = page.evaluate("[document.querySelectorAll('#seasonFx i').length, [1, 2, 3].map(c => window.ttDebug.emoji(c))]")
        assert seen[cur][1] == PLANTS[cur], (cur, seen[cur])
        cells = page.evaluate("[30, 31, 32].map(i => document.querySelector('#board .cell[data-i=\"' + i + '\"]').firstChild.textContent)")
        assert cells == PLANTS[cur], f'the board shows the {cur} plants: {cells}'
        assert page.inner_text('#curItem') == page.evaluate('window.ttDebug.emoji(window.ttDebug.state().cur)')
        animals = page.evaluate("[33, 34].map(i => document.querySelector('#board .cell[data-i=\"' + i + '\"]').firstChild.textContent)")
        names = page.evaluate("[12, 19, 20, 18].map(c => window.ttDebug.name(c))")
        be, bn, fe, fn = SKIN[cur]
        assert animals == [be, fe], f'the {cur} animals on the board: {animals}'
        assert names == [bn, 'growling ' + bn, 'angry ' + bn, fn], names
        page.wait_for_timeout(150)
        kinds = set(page.evaluate('window.ttDebug.critters()'))
        assert kinds <= HOME[cur] | WATER[cur] and kinds & HOME[cur] and kinds & WATER[cur], f'{cur} critters: {kinds}'
        if want == 'winter':
            assert page.evaluate("JSON.parse(localStorage.getItem('tt-season'))") == 'winter'
            page.reload(); page.wait_for_selector('#board .cell'); page.wait_for_timeout(300)
            assert 'Winter' in page.inner_text('#seasonLink') and sea() == 'winter', 'the pick survives a reload'
    assert seen['summer'][0] == 0 and all(seen[k][0] > 0 for k in ('spring', 'autumn', 'winter')), seen
    assert page.evaluate("document.getElementById('guideBody').textContent.includes('🐇')"), 'the item guide follows the season too'
    assert 'Summer' in page.inner_text('#seasonLink') and sea() == 'summer'
    check_consistent(page, 'after the season tour')

    # ---- calm mode: No bears + No foxes. No animals ever show up, no trap tool, own best score, the picks are remembered
    page.tap('#newBtn'); page.tap('.opt[data-bears="off"]'); page.tap('.opt[data-foxes="off"]'); page.tap('#newStart')
    calm = check_consistent(page, 'new calm game')
    assert calm['bears'] is False and calm['foxes'] is False and 'calm' in page.inner_text('#seed')
    assert page.evaluate("JSON.parse(localStorage.getItem('tt-bears'))") is False and page.evaluate("JSON.parse(localStorage.getItem('tt-foxes'))") is False
    open_shop(page); assert page.locator('#trapBtn').is_hidden(), 'nothing to trap in a calm game'
    page.tap('#shopClose')
    for _ in range(40):
        st = state(page)
        if st['over']: break
        e = [i for i, v in enumerate(st['grid']) if v == 0]
        tap_cell(page, e[0], True)
        st = check_consistent(page, 'calm turn')
        assert not any(v in (12, 13, 14, 15, 18, 19, 20) for v in st['grid']) and st['cur'] not in (12, 18) and st['next'] not in (12, 18), 'no animals in a calm game'
    page.tap('#newBtn'); assert page.get_attribute('.opt[data-bears="off"]', 'aria-pressed') == 'true' and page.get_attribute('.opt[data-foxes="off"]', 'aria-pressed') == 'true', 'the dialog remembers the calm picks'
    page.tap('.opt[data-bears="classic"]'); page.tap('.opt[data-foxes="on"]'); page.tap('#newStart')
    back = check_consistent(page, 'bears and foxes back on')
    assert back['bears'] is True and back['foxes'] is True

    # ---- Maps: picked in the New game dialog; water tiles are blue, fixed and unusable
    page.tap('#newBtn')
    assert state(page)['turn'] == 0 and page.locator('#newWarn').is_hidden(), 'nothing to lose on a fresh game: no warning'
    assert page.inner_text('#newStart') == 'Start' and 'danger' not in page.get_attribute('#newStart', 'class')
    for m in ['easy', 'standard', 'medium', 'hard']:
        page.tap(f'.opt[data-map="{m}"]')
        assert page.get_attribute(f'.opt[data-map="{m}"]', 'aria-pressed') == 'true' and page.inner_text('#mapNote') != ''
    # sample maps: every card has a 6x6 thumbnail; the selected category lists examples (3 for the random maps, 1 for the fixed ones)
    cnt = lambda sel: page.evaluate("s => [...document.querySelectorAll(s)].map(e => e.children.length)", sel)
    assert cnt('#newGame .mapcard .mini') == [36] * 4, 'a 6x6 sample on each map card'
    assert page.evaluate("[...document.querySelectorAll('#newGame .mapcard')].map(c => c.querySelectorAll('.mini span.w').length)") == [0, 0, 7, page.evaluate("document.querySelectorAll('#newGame .mapcard[data-map=hard] .mini span.w').length")]
    waters = {}
    for m, n in [('easy', 1), ('standard', 3), ('medium', 1), ('hard', 3)]:
        page.tap(f'.opt[data-map="{m}"]')
        assert cnt('#mapSamples .mini') == [36] * n, (m, cnt('#mapSamples .mini'))
        waters[m] = page.evaluate("[...document.querySelectorAll('#mapSamples .mini')].map(e => e.querySelectorAll('span.w').length)")
    assert waters['easy'] == [0] and waters['standard'] == [0, 0, 0] and waters['medium'] == [7] and all(6 <= w <= 9 for w in waters['hard']), waters
    assert page.evaluate("new Set([...document.querySelectorAll('#mapSamples .mini')].map(e => e.textContent + [...e.children].map(c => c.className).join())).size") == 3, 'the hard samples differ'
    page.tap('.opt[data-map="standard"]'); page.tap('#newStart')
    std = check_consistent(page, 'standard map')
    assert std['map'] == 'standard' and sum(1 for v in std['grid'] if v) == 5 and 21 not in std['grid'] and 'standard map' in page.inner_text('#seed')
    page.tap('#newBtn'); page.tap('.opt[data-map="hard"]'); page.tap('#newStart')
    hard = check_consistent(page, 'hard map')
    assert hard['map'] == 'hard' and 6 <= hard['grid'].count(21) <= 9 and page.locator('#board .cell[data-c="21"]').count() == hard['grid'].count(21)
    page.tap('#newBtn'); page.tap('.opt[data-map="medium"]'); page.tap('.opt[data-bears="classic"]'); page.tap('#newStart')
    med = check_consistent(page, 'medium map')
    assert med['map'] == 'medium' and [i for i, v in enumerate(med['grid']) if v == 21] == [2, 8, 14, 15, 21, 27, 33]
    assert page.evaluate("JSON.parse(localStorage.getItem('tt-map'))") == 'medium', 'the map pick is remembered'
    assert page.locator('#board svg.water').count() == 1 and page.locator('#board svg.water #wcells rect').count() >= 7, 'water is one soft SVG layer under the tiles'
    assert page.evaluate("getComputedStyle(document.querySelector('#board .cell[data-i=\"2\"]')).backgroundImage") == 'none', 'the water tiles themselves are transparent'
    page.wait_for_timeout(400)
    swim = page.evaluate('window.ttDebug.critterHomes()')
    assert {h['kind'] for h in swim} == {'🦢', '🐟'} and all(h['code'] == 21 for h in swim), f'swans and fish live on the water: {swim}'
    water_inside = """() => { const homes = window.ttDebug.critterHomes(), els = [...document.querySelectorAll('#critters .crit')];
        return els.map((el, i) => { const r = el.getBoundingClientRect(), c = document.querySelector('#board .cell[data-i=\"' + homes[i].cell + '\"]').getBoundingClientRect(),
            x = r.left + r.width / 2, y = r.top + r.height / 2; return x >= c.left - 1 && x <= c.right + 1 && y >= c.top - 1 && y <= c.bottom + 1; }); }"""
    for _ in range(6):
        assert all(page.evaluate(water_inside)), 'a swan or fish left its own water tile'
        page.wait_for_timeout(700)
    tap_cell_before = state(page)
    page.tap('#board .cell[data-i="2"]')   # tapping water does nothing
    assert state(page)['grid'] == tap_cell_before['grid'] and state(page)['turn'] == 0
    g = [0] * 36
    for i in (2, 8, 14, 15, 21, 27, 33): g[i] = 21
    g[0] = 5
    load(g, map='medium', coins=100)
    shop_tap(page, '#hammerBtn')
    page.tap('#board .cell[data-i="8"]')   # the hammer cannot smash water: nothing is selected, nothing changes
    assert page.locator('#board .cell.target').count() == 0, f"water got a target highlight; note={page.inner_text('#note')}"
    assert state(page)['grid'] == g, f"grid changed: {[(i, v, g[i]) for i, v in enumerate(state(page)['grid']) if v != g[i]]} turn={state(page)['turn']}"
    tap_cell(page, 0, True)                # but it still smashes a hut
    assert check_consistent(page, 'hammer next to water')['grid'][0] == 0
    # ---- bridges: a tool for maps with water; glowing spots only where land is on both sides; limited, dearer every time
    g = [0] * 36
    for i in (2, 8, 14, 15, 21, 27, 33): g[i] = 21
    load(g, map='medium', coins=1000)
    open_shop(page)
    assert page.locator('#bridgeBtn').is_visible() and page.locator('#bridgeBtn').is_enabled()
    assert page.inner_text('#bridgeBtn .tp') == '🪙300' and page.inner_text('#bridgeBtn .tb') == '×5'
    shop_tap(page, '#bridgeBtn')
    assert page.get_attribute('#bridgeBtn', 'aria-pressed') == 'true' and page.locator('#board .cell.spot').count() == 5, 'five glowing spots on the river'
    page.tap('#board .cell[data-i="14"]')   # the middle of the double-wide river: not a spot
    assert state(page)['bridges'] == [] and state(page)['coins'] == 1000
    tap_cell(page, 8, True)
    after = check_consistent(page, 'bridge')
    assert after['bridges'] == [8] and after['grid'][8] == 0 and after['coins'] == 700 and after['turn'] == 3, 'a free action that costs the first price'
    assert page.locator('#board .cell.bridge').count() == 1 and page.locator('#board .cell.bridge.bh').count() == 1, 'planks laid left-right across the river'
    assert page.get_attribute('#bridgeBtn', 'aria-pressed') == 'false' and page.locator('#board svg.water').count() == 1, 'the river still runs under the bridge'
    page.tap('#board .cell[data-i="8"]'); page.tap('#board .cell[data-i="8"]')   # nothing can be built on a bridge
    assert state(page)['grid'][8] == 0 and state(page)['turn'] == 3
    assert page.inner_text('#bridgeBtn .tp') == '🪙700' and page.inner_text('#bridgeBtn .tb') == '×4', 'the next bridge costs more'


    # ---- ponds: dug on any empty tile, a free action; permanent, pay points each turn, lake quest shown in the shop
    g = [0] * 36; g[0] = 5
    load(g, coins=1000, top=4, score=0, milestone=0)
    open_shop(page)
    assert page.locator('#pondBtn').is_visible() and page.inner_text('#pondBtn .tp') == '🪙300' and page.inner_text('#pondBtn .tb') == '×16'
    assert 'Ponds 0/16' in page.inner_text('#pondNote') and '2×2' in page.inner_text('#pondNote')
    shop_tap(page, '#pondBtn')
    assert page.get_attribute('#pondBtn', 'aria-pressed') == 'true', page.get_attribute('#pondBtn', 'aria-pressed')
    assert 'pond' in page.inner_text('#note'), page.inner_text('#note')
    page.tap('#board .cell[data-i="0"]')                       # an occupied tile is not a target
    assert state(page)['ponds'] == [] and state(page)['coins'] == 1000
    tap_cell(page, 14, True)
    after = check_consistent(page, 'pond')
    assert after['ponds'] == [14] and after['grid'][14] == 21 and after['coins'] == 700 and after['turn'] == 3, 'a free action that costs the first price'
    assert page.locator('#board .cell.pond').count() == 1 and page.get_attribute('#board .cell[data-i="14"]', 'aria-label').endswith('water')
    assert page.get_attribute('#pondBtn', 'aria-pressed') == 'false' and page.locator('#board svg.water').count() == 1
    page.tap('#board .cell[data-i="14"]'); assert state(page)['turn'] == 3, 'nothing happens on a pond'
    open_shop(page); assert page.inner_text('#pondBtn .tp') == '🪙440' and page.inner_text('#pondBtn .tb') == '×15' and 'Ponds 1/16' in page.inner_text('#pondNote')
    page.tap('#shopClose')
    before = state(page)['score']
    tap_cell(page, 20, True)
    assert state(page)['score'] - before >= 4 * 0 + 14, 'the pond pays points every turn'   # ceil(BASE[4] / 20) = 14
    # a poor player cannot dig
    load(g, coins=100, top=4)
    open_shop(page); assert page.locator('#pondBtn').is_disabled(); page.tap('#shopClose')

    page.tap('#newBtn'); page.tap('.opt[data-map="easy"]'); page.tap('.opt[data-bears="classic"]'); page.tap('#newStart')
    easy = check_consistent(page, 'easy map')
    assert easy['map'] == 'easy' and easy['grid'] == [0] * 36 and 'map' not in page.inner_text('#seed')
    assert page.locator('#bridgeBtn').is_hidden(), 'no water, no bridge tool'
    assert page.locator('#board svg.water').count() == 0 and page.evaluate('window.ttDebug.critters()') == [], 'no water, no water layer and no swans'

    # ---- shop: higher tiers unlock once built; stock runs out -> price doubles (shown on the button)
    load([0] * 36, coins=500)
    assert page.locator('.tool[data-tool="4"]').count() == 0, 'camp is locked at the start'
    load([0] * 36, coins=500, top=6)
    for t in ['4', '5', '6']:
        assert page.locator(f'.tool[data-tool="{t}"]').count() == 1, f'tier {t} unlocked'
    assert page.locator('.tool[data-tool="7"]').count() == 0
    load([0] * 36, coins=500, cur=2, next=2, stock={'1': 0, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '10': 1, '16': 0, 'hammer': 2, 'trap': 2})
    assert page.inner_text('.tool[data-tool="1"] .tp') == '🪙12', 'sold-out grass costs double (6 -> 12)'
    shop_tap(page, '.tool[data-tool="1"]')
    after = check_consistent(page, 'surcharge buy')
    assert after['coins'] == 500 - 12 and after['stock']['1'] == -1 and after['cur'] == 1
    assert page.inner_text('.tool[data-tool="1"] .tp') == '🪙24' or page.locator('.tool[data-tool="1"]').is_disabled(), 'price keeps doubling'

    # ---- land: a new row/column on the chosen side, each side once, board and DOM grow
    g = [0] * 36
    g[0] = 1
    load(g, coins=5000)
    shop_tap(page, '.land[data-land="top"]')
    after = check_consistent(page, 'land top')
    assert after['h'] == 7 and after['w'] == 6 and after['grid'][6] == 1 and after['coins'] == 5000 - 150 and after['turn'] == 3
    assert page.locator('.land[data-land="top"]').is_disabled(), 'each side only once'
    assert page.inner_text('#landNote').startswith('Land 1/4')
    shop_tap(page, '.land[data-land="left"]')
    after = check_consistent(page, 'land left')
    assert after['w'] == 7 and after['h'] == 7 and after['grid'][7 + 1] == 1
    box = page.evaluate("() => { const b = document.getElementById('board').getBoundingClientRect(), w = document.getElementById('boardWrap').getBoundingClientRect(); return { bw: b.width, ww: w.width, bh: b.height } }")
    assert abs(box['bw'] - box['ww'] * 7 / 7) < 2 and box['bw'] <= box['ww'] + 1, f'7x7 board fits its square wrap: {box}'
    shop_tap(page, '.land[data-land="right"]'); shop_tap(page, '.land[data-land="bottom"]')
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
    shop_tap(page, '#hammerBtn'); tap_cell(page, gone, True)
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
    # the tour can be replayed from How to play, and skipped or escaped at any time
    page.tap('#helpLink'); assert page.locator('#help').is_visible()
    page.tap('#helpTour'); assert page.locator('#tour').is_visible() and page.locator('#help').is_hidden()
    page.tap('#tourNext'); page.tap('#tourSkip'); assert page.locator('#tour').is_hidden()
    page.tap('#helpLink'); page.tap('#helpTour'); page.keyboard.press('Escape'); assert page.locator('#tour').is_hidden()
    page.tap('#helpLink'); page.tap('#helpClose'); assert page.locator('#help').is_hidden()
    page.tap('#guideLink')
    assert page.locator('#guide').is_visible()
    guide = page.inner_text('#guideBody')
    for e in ['🌱', '🏕️', '🏘️', '🏫', '🏥', '🏬', '💵', '🐻', '🪦', '⛪', '🕌', '💰', '💎', '🦊']:
        assert e in guide, f'guide misses {e}'
    assert 'Lucky drops' in guide, 'guide explains lucky drops'
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
