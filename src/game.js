// Triple Three UI. Relies on global TT (logic.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var boardEl = $('board'), fxEl = $('fx'), wrapEl = $('boardWrap'), shopEl = $('shop'), critEl = $('critters');
  var state, hints = false;
  var previewOn = store.get('tt-preview', true) !== false;
  var sel = -1, hover = -1, mode = null, moveFrom = -1, lastPointer = 'touch'; // UI-only: tile awaiting confirmation, mouse hover, armed tool ('hammer'|'trap'|'move'), tile picked up by the mover, last input type
  var cells = [], bw = 0, bh = 0, shopKey = '';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function seedFromHash() {
    var m = /seed=(\d+)/.exec(location.hash);
    return m ? (parseInt(m[1], 10) >>> 0) || 1 : 0;
  }
  function randomSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }
  function fmt(n) { return n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }

  // best scores are kept per map and bear mode: harder games get their own board (easy + classic keeps the original key)
  function bestKey() { return (state && state.map && state.map !== 'easy' ? 'tt-best-' + state.map : 'tt-best') + (state && state.wild ? '-wild' : ''); }
  function wildPref() { return store.get('tt-wild', false) === true; } // the mode picked last in the New game dialog
  function mapPref() { var m = store.get('tt-map', 'easy'); return TT.MAPS.indexOf(m) >= 0 ? m : 'easy'; }
  function startNew(seed, wild, map) {
    if (wild === undefined) wild = wildPref();
    if (map === undefined) map = mapPref();
    state = TT.newGame(seed || randomSeed(), { wild: !!wild, map: map });
    sel = -1; hover = -1; mode = null; moveFrom = -1;
    $('overlay').classList.add('hidden');
    save();
    render([]);
  }
  function save() { store.set('tt-save', state); }

  function loadSaved() {
    var s = store.get('tt-save', null);
    try { if (s) TT.migrate(s); } catch (e) { return null; } // saves from before coins / stock / land / the new building chain
    try { if (s && TT.validate(s).length === 0 && typeof s.rng === 'number') return s; } catch (e) {}
    return null;
  }

  // ---- board construction (rebuilt whenever the land size changes)
  function buildBoard() {
    var w = state.w, h = state.h;
    boardEl.textContent = ''; cells = [];
    boardEl.style.setProperty('--cols', w); boardEl.style.setProperty('--rows', h);
    wrapEl.style.setProperty('--m', Math.max(w, h));
    for (var i = 0; i < w * h; i++) {
      var el = document.createElement('div');
      el.className = 'cell empty';
      el.dataset.i = i; el.dataset.c = 0; el.setAttribute('role', 'gridcell');
      var e = document.createElement('span'); e.className = 'e'; el.appendChild(e);
      boardEl.appendChild(el); cells.push(el);
    }
    bw = w; bh = h; sel = -1; hover = -1; moveFrom = -1;
    clearCritters();
  }
  boardEl.addEventListener('pointerdown', function (ev) { lastPointer = ev.pointerType || 'touch'; });
  boardEl.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.cell') : null;
    if (t) tap(+t.dataset.i);
  });
  // mouse hover shows the preview without clicking (touch uses tap-to-select, tap-again-to-confirm)
  boardEl.addEventListener('pointerover', function (ev) {
    if (ev.pointerType !== 'mouse') return;
    var t = ev.target.closest ? ev.target.closest('.cell') : null;
    var i = t ? +t.dataset.i : -1;
    if (i !== hover) { hover = i; updatePreview(); }
  });
  boardEl.addEventListener('pointerleave', function (ev) {
    if (ev.pointerType === 'mouse' && hover !== -1) { hover = -1; updatePreview(); }
  });

  function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  function isCollectible(v) { return v === TT.TREASURE || v === TT.CASH; }
  function isAnimal(v) { return TT.isBear(v) || v === TT.FOX; }
  // Is idx a legal target for the armed tool (or for placement when none is armed)?
  function targetOk(idx) {
    var v = state.grid[idx];
    if (mode === 'move') return TT.isMovable(v) || (v === 0 && moveFrom >= 0); // pick something up, then an empty tile to drop it on
    return mode === 'hammer' ? v !== 0 && v !== TT.WATER : mode === 'trap' ? isAnimal(v) : (v === 0 || isCollectible(v));
  }
  function doAction(idx) {
    return mode === 'hammer' ? TT.hammer(state, idx) : mode === 'trap' ? TT.trap(state, idx) : TT.place(state, idx);
  }

  // Mouse: hover already showed the preview, so one click commits. Touch: the first tap selects and previews
  // (when Preview is on), a second tap on the same tile commits.
  function tap(idx) {
    if (!state || state.over) return;
    if (!targetOk(idx)) { bump(idx); return; }
    if (mode === 'move') { tapMove(idx); return; }
    if (!mode && isCollectible(state.grid[idx])) { // collecting is always good news: no confirmation step
      var o = TT.open(state, idx);
      state = o.state; sel = -1; save(); render(o.events); vibrate(25);
      return;
    }
    if (previewOn && lastPointer !== 'mouse' && sel !== idx) { sel = idx; hover = -1; updatePreview(); return; }
    sel = -1;
    var r = doAction(idx);
    mode = null;
    if (!r) { bump(idx); render([]); return; }
    state = r.state;
    save();
    render(r.events);
    vibrate(r.events.some(function (e) { return e.type === 'merge'; }) ? 25 : 8);
  }
  // Mover: the first tap picks an item up (tap it again to put it down, tap another to switch); then an empty tile drops it
  // there (touch: tap to preview the merge, tap again to confirm; mouse: hover previews and one click drops).
  function tapMove(idx) {
    if (state.grid[idx] !== 0) { moveFrom = moveFrom === idx ? -1 : idx; sel = -1; updatePreview(); return; }
    if (previewOn && lastPointer !== 'mouse' && sel !== idx) { sel = idx; hover = -1; updatePreview(); return; }
    var from = moveFrom, r = TT.move(state, from, idx);
    sel = -1; mode = null; moveFrom = -1;
    if (!r) { bump(idx); render([]); return; }
    state = r.state; save(); render(r.events);
    vibrate(r.events.some(function (e) { return e.type === 'merge'; }) ? 25 : 8);
  }
  function bump(idx) { var c = cells[idx]; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }

  // ---- rendering
  function cellCenter(idx) {
    var c = cells[idx], b = fxEl.getBoundingClientRect(), r = c.getBoundingClientRect();
    return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, w: r.width, h: r.height };
  }
  function clearAnim() {
    cells.forEach(function (c) { c.classList.remove('drop', 'pop', 'shake', 'slide', 'warp'); });
  }

  // The shop row lists every unlocked building tier plus the crystal; it is rebuilt only when that list changes.
  function buildShop() {
    var items = [], k, fresh = shopKey !== '';
    for (k = 1; k <= TT.unlockedTop(state); k++) items.push(k);
    items.push(TT.CRYSTAL);
    var key = items.join(',');
    if (key === shopKey) return;
    var known = shopKey ? shopKey.split(',') : [];
    shopKey = key; shopEl.textContent = '';
    items.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tool' + (fresh && known.indexOf(String(t)) < 0 ? ' fresh' : '');
      b.dataset.tool = t; b.setAttribute('aria-label', 'Buy ' + TT.NAME[t]);
      b.innerHTML = '<span class="te">' + TT.EMOJI[t] + '</span><span class="tp"></span><span class="tb"></span>';
      b.addEventListener('click', function () {
        var s = TT.buy(state, t);
        if (s) { state = s; save(); render([]); }
      });
      shopEl.appendChild(b);
    });
  }

  function render(events) {
    if (state.w !== bw || state.h !== bh) buildBoard();
    clearAnim();
    var g = state.grid, w = state.w;
    cells.forEach(function (c, i) {
      var code = g[i];
      c.dataset.c = code;
      c.firstChild.textContent = TT.EMOJI[code];
      c.classList.toggle('empty', code === 0);
      c.classList.toggle('hint', hints && !state.over && TT.wouldMerge(state, i));
      c.setAttribute('aria-label', 'row ' + (((i / w) | 0) + 1) + ' column ' + ((i % w) + 1) + ' ' + TT.NAME[code]);
    });
    if (mode && (state.over || state.coins < TT.PRICE[mode] || !(state.stock[mode] > 0))) mode = null;
    if (mode !== 'move' || (moveFrom >= 0 && !TT.isMovable(g[moveFrom]))) moveFrom = -1;
    if (sel >= 0 && (state.over || !targetOk(sel))) sel = -1;
    $('score').textContent = state.score;
    $('coins').textContent = state.coins;
    var best = store.get(bestKey(), 0);
    if (state.score > best) { best = state.score; store.set(bestKey(), best); }
    $('best').textContent = best;
    $('curItem').textContent = TT.EMOJI[state.cur];
    $('curName').textContent = TT.NAME[state.cur];
    $('nextItem').textContent = TT.EMOJI[state.next];
    $('holdItem').textContent = state.hold ? TT.EMOJI[state.hold] : '·';
    $('undoBtn').disabled = !TT.canUndo(state);
    buildShop();
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
      var t = b.dataset.tool;
      if (t === 'hammer') {
        b.disabled = !TT.canHammer(state) || state.over || !g.some(function (v) { return v !== 0 && v !== TT.WATER; });
        b.setAttribute('aria-pressed', mode === 'hammer');
      } else if (t === 'move') {
        b.disabled = state.over || !TT.canMove(state) || !g.some(TT.isMovable) || TT.emptyCount(g) === 0;
        b.setAttribute('aria-pressed', mode === 'move');
      } else if (t === 'trap') {
        b.disabled = state.over || state.coins < TT.PRICE.trap || !(state.stock.trap > 0) || !g.some(isAnimal);
        b.setAttribute('aria-pressed', mode === 'trap');
      } else {
        b.disabled = !TT.buy(state, +t);
        b.querySelector('.tp').textContent = '🪙' + fmt(TT.priceOf(state, +t));
        b.classList.toggle('pricey', (state.stock[t] || 0) <= 0); // out of stock: the price has doubled (or more)
      }
      b.querySelector('.tb').textContent = '×' + Math.max(0, state.stock[t] || 0);
    });
    var lp = TT.landPrice(state);
    document.querySelectorAll('.land').forEach(function (b) {
      var owned = state.land.indexOf(b.dataset.land) >= 0;
      b.disabled = state.over || owned || !TT.canLand(state);
      b.querySelector('.tp').textContent = owned ? '✓' : '🪙' + fmt(lp);
    });
    $('landNote').textContent = 'Land ' + state.land.length + '/' + TT.MAX_LAND + (lp ? ' · next side 🪙' + lp : ' · all bought');
    var nextAt = TT.milestoneScore(state.milestone), gifts = [];
    [1, 2, 3, TT.CRYSTAL].forEach(function (c) { gifts.push('+' + TT.RESTOCK[c] + TT.EMOJI[c]); });
    $('unlock').textContent = 'Shop restocks at score ' + nextAt + ' (' + (nextAt - state.score) + ' to go): ' + gifts.join(' ') +
      (TT.unlockedTop(state) > 3 ? ' +1 each higher tier' : '') + ' +1🪤 +1🔨';
    $('undoBtn').textContent = '↶ Undo 🪙' + TT.UNDO_COST;
    $('turn').textContent = 'Turn ' + state.turn;
    $('seed').textContent = 'seed ' + state.seed + (state.map !== 'easy' ? ' · ' + state.map + ' map' : '') + (state.wild ? ' · wild bears' : '');
    animate(events);
    updatePreview();
    syncCritters();
    if (state.over) showOver();
  }

  // ---- move preview: ghost of the resulting item, merged tiles outlined, plus a one-line explanation
  function updatePreview() {
    cells.forEach(function (c) {
      c.classList.remove('pv', 'eat', 'target', 'pick');
      if (c.hasAttribute('data-pv')) c.removeAttribute('data-pv');
    });
    var note = '', hot = false, pi = sel >= 0 ? sel : (previewOn ? hover : -1), p;
    if (state.over) note = '';
    else if (mode === 'trap') {
      if (pi >= 0 && isAnimal(state.grid[pi])) {
        cells[pi].classList.add('target');
        var tr = TT.trap(state, pi);
        var res = tr ? tr.state.grid[pi] : TT.TOMB;
        note = (sel === pi ? 'Tap again to trap' : 'Trap') + ' the ' + TT.NAME[state.grid[pi]] + ' -> ' + TT.NAME[res] + ' (-' + TT.PRICE.trap + ' coins)';
        hot = sel === pi;
      } else note = '🪤 Tap a bear or fox to kill it';
    } else if (mode === 'move') {
      if (moveFrom < 0) {
        if (pi >= 0 && TT.isMovable(state.grid[pi])) { cells[pi].classList.add('target'); note = '🚚 Pick up the ' + TT.NAME[state.grid[pi]]; }
        else note = '🚚 Tap an item to pick it up (-' + TT.PRICE.move + ' coins when you drop it)';
      } else {
        cells[moveFrom].classList.add('pick');
        if (pi >= 0 && state.grid[pi] === 0 && (p = TT.previewMove(state, moveFrom, pi))) {
          cells[pi].classList.add('pv'); cells[pi].setAttribute('data-pv', TT.EMOJI[p.final]);
          p.eaten.forEach(function (i) { cells[i].classList.add('eat'); });
          var mv = sel === pi ? 'Tap again to ' : '';
          note = p.merged
            ? (mv ? mv + 'move and merge' : 'Moves and merges') + ' into ' + TT.NAME[p.final] + gain(p)
            : (mv ? mv + 'drop' : 'Drop') + ' the ' + TT.NAME[state.grid[moveFrom]] + ' here (-' + TT.PRICE.move + ' coins)';
          hot = sel === pi;
        } else note = '🚚 Tap an empty tile to drop the ' + TT.NAME[state.grid[moveFrom]] + ' (tap it again to put it down)';
      }
    } else if (mode === 'hammer') {
      if (pi >= 0 && state.grid[pi] !== 0 && state.grid[pi] !== TT.WATER) {
        cells[pi].classList.add('target');
        note = (lastPointer !== 'mouse' && sel === pi ? 'Tap again to smash ' : 'Smash ') + TT.NAME[state.grid[pi]] + ' (-' + TT.PRICE.hammer + ' coins)';
        hot = sel === pi;
      } else note = '🔨 Tap an item to remove it';
    } else if (pi >= 0 && isCollectible(state.grid[pi])) {
      var cash = state.grid[pi] === TT.CASH;
      note = (cash ? '💵 Click to collect the cash: +' + TT.CASH_COINS : '💰 Click to open the treasure: +' + TT.TREASURE_COINS) + ' coins'; hot = true;
    } else if (TT.emptyCount(state.grid) === 0) {
      note = 'Board full - use the 🔨 hammer (' + TT.PRICE.hammer + ' coins) or buy land'; hot = true;
    } else if (previewOn && pi >= 0 && (p = TT.preview(state, pi))) {
      cells[pi].classList.add('pv'); cells[pi].setAttribute('data-pv', TT.EMOJI[p.final]);
      p.eaten.forEach(function (i) { cells[i].classList.add('eat'); });
      var verb = sel === pi ? 'Tap again to ' : '';
      note = p.merged
        ? (verb ? verb + 'merge' : 'Merges') + ' into ' + TT.NAME[p.final] + gain(p)
        : (verb ? verb + 'place ' : 'Place ') + TT.NAME[state.cur] + ' here';
      hot = sel === pi;
    } else if (previewOn) note = 'Tap a tile to preview, tap again to place';
    $('note').textContent = note;
    $('note').classList.toggle('hot', hot);
  }

  // ' · +30 pts · +2 coins' for a merge; empty when it pays nothing (three gems -> treasure: the treasure is the prize)
  function gain(p) { return p.points || p.coins ? ' · +' + p.points + ' pts · +' + p.coins + ' coins' : ''; }
  function toast(text, yFrac) {
    var b = fxEl.getBoundingClientRect(), el = document.createElement('div');
    el.className = 'pts'; el.textContent = text; el.style.left = b.width / 2 + 'px'; el.style.top = b.height * (yFrac || 0.5) + 'px';
    fxEl.appendChild(el);
  }
  function floatAt(idx, text) {
    var c = cellCenter(idx), el = document.createElement('div');
    el.className = 'pts'; el.textContent = text; el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    fxEl.appendChild(el);
  }

  function animate(events) {
    fxEl.textContent = '';
    void boardEl.offsetWidth; // reflow so restarted animations play
    events.forEach(function (ev) {
      if (ev.type === 'place') cells[ev.at].classList.add('drop');
      else if (ev.type === 'merge') {
        var to = cellCenter(ev.at);
        cells[ev.at].classList.remove('drop', 'slide'); cells[ev.at].classList.add('pop');
        ev.cells.forEach(function (ci) {
          if (ci === ev.at) return;
          var f = cellCenter(ci), gh = document.createElement('div');
          gh.className = 'ghost'; gh.textContent = TT.EMOJI[ev.from];
          gh.style.cssText = 'left:' + (f.x - f.w / 2) + 'px;top:' + (f.y - f.h / 2) + 'px;width:' + f.w + 'px;height:' + f.h +
            'px;--dx:' + (to.x - f.x) + 'px;--dy:' + (to.y - f.y) + 'px';
          fxEl.appendChild(gh);
        });
        floatAt(ev.at, ev.points || ev.coins ? '+' + ev.points + (ev.coins ? ' · +' + ev.coins + '🪙' : '') : '💰');
      } else if (ev.type === 'bear') {
        var a = cellCenter(ev.from), b = cellCenter(ev.to), c = cells[ev.to];
        c.style.setProperty('--dx', (a.x - b.x) + 'px'); c.style.setProperty('--dy', (a.y - b.y) + 'px');
        c.classList.add('slide');
      } else if (ev.type === 'move') { // the item glides from where it was picked up
        var ma = cellCenter(ev.from), mb = cellCenter(ev.to), mc = cells[ev.to];
        mc.style.setProperty('--dx', (ma.x - mb.x) + 'px'); mc.style.setProperty('--dy', (ma.y - mb.y) + 'px');
        mc.classList.add('slide');
        floatAt(ev.to, '🚚 -' + TT.PRICE.move + '🪙');
      } else if (ev.type === 'fox') { // warps: a puff where it left, it spins in where it lands
        floatAt(ev.from, '💨');
        cells[ev.to].classList.add('warp');
      } else if (ev.type === 'trapped') {
        cells[ev.at].classList.add('shake');
      } else if (ev.type === 'cub') { // a bear cub is born in the pen
        cells[ev.at].classList.add('drop');
        floatAt(ev.at, '🍼');
      } else if (ev.type === 'growl') { // the boxed-in bear gets angrier
        cells[ev.at].classList.add('shake');
        floatAt(ev.at, ev.level === 1 ? '💢' : '💢💢');
      } else if (ev.type === 'maul') { // it takes it out on the building next to it
        cells[ev.at].classList.add('shake'); cells[ev.bear].classList.add('shake');
        floatAt(ev.at, '🐻💢 ' + TT.EMOJI[ev.from] + '→' + (ev.to ? TT.EMOJI[ev.to] : '💨'));
      } else if (ev.type === 'unlock') {
        toast('🛒 Shop restocked!');
      } else if (ev.type === 'tierunlock') {
        toast(TT.EMOJI[ev.tier] + ' ' + TT.NAME[ev.tier] + ' unlocked in the shop!', 0.35);
      } else if (ev.type === 'land') {
        toast('🏞️ New land!');
      } else if (ev.type === 'open') {
        floatAt(ev.at, (ev.item === TT.CASH ? '💵 +' : '💰 +') + ev.coins + '🪙');
      } else if (ev.type === 'trap') {
        floatAt(ev.at, '🪤 -' + TT.PRICE.trap + '🪙'); cells[ev.at].classList.add('shake');
      } else if (ev.type === 'hammer') {
        floatAt(ev.at, '🔨 -' + TT.PRICE.hammer + '🪙');
      }
    });
    setTimeout(function () { if (fxEl.childNodes.length) fxEl.textContent = ''; }, 1000);
  }

  // ---- ambient critters: purely decorative (never part of the game state). Rabbits and chicks live on the residential
  // tiles (camp .. village), ghosts and black cats on the tombstone / church / cathedral tiles. Each critter belongs to ONE
  // tile and only wanders inside it; if its tile goes away it is re-homed on another matching tile.
  var AREAS = [
    { codes: [4, 5, 6, 7], kinds: ['🐇', '🐤'] },
    { codes: [TT.TOMB, TT.CHURCH, TT.CATHEDRAL], kinds: ['👻', '🐈\u200d⬛'] }
  ];
  var critters = [];
  function areaCells(area) {
    var out = [];
    state.grid.forEach(function (v, i) { if (area.codes.indexOf(v) >= 0) out.push(i); });
    return out;
  }
  function clearCritters() { critters.forEach(function (c) { c.el.remove(); }); critters = []; }
  // wander to a random spot inside the critter's own tile (first: snap there without gliding)
  function hop(c, first) {
    var p = cellCenter(c.cell), s = p.w * 0.34;
    var x = p.x + (Math.random() - 0.5) * (p.w - s) * 0.9, y = p.y + (Math.random() - 0.5) * (p.h - s) * 0.9;
    if (first || Math.abs(x - c.x) > 1) c.dir = x < c.x ? -1 : 1; // face the way it is going (the flip lives in the same transform, so it never shifts the position)
    if (first) c.el.style.transition = 'none';
    c.el.style.transform = 'translate(' + (x - s / 2) + 'px,' + (y - s / 2) + 'px) scaleX(' + c.dir + ')';
    if (first) { void c.el.offsetWidth; c.el.style.transition = ''; }
    c.x = x; c.next = Date.now() + 1200 + Math.random() * 2000;
  }
  // a tile of the area with the fewest critters of this kind on it (so they spread over the town instead of piling up)
  function pickHome(list, kind) {
    var best = [], bestN = 1e9;
    list.forEach(function (i) {
      var n = critters.filter(function (c) { return c.kind === kind && c.cell === i; }).length;
      if (n < bestN) { bestN = n; best = [i]; } else if (n === bestN) best.push(i);
    });
    return best[Math.floor(Math.random() * best.length)];
  }
  function syncCritters() {
    if (reduceMotion) return;
    AREAS.forEach(function (area) {
      var list = areaCells(area), want = Math.min(3, Math.floor(list.length / 2));
      area.kinds.forEach(function (kind) {
        var mine = critters.filter(function (c) { return c.kind === kind; });
        while (mine.length > want) { var gone = mine.pop(); gone.el.remove(); critters.splice(critters.indexOf(gone), 1); }
        mine.forEach(function (c) { // its tile was merged away or changed into something else: move house
          if (area.codes.indexOf(state.grid[c.cell]) < 0) { c.cell = pickHome(list, kind); hop(c, true); }
        });
        while (mine.length < want) {
          var el = document.createElement('span');
          el.className = 'crit'; el.textContent = kind; el.setAttribute('aria-hidden', 'true');
          critEl.appendChild(el);
          var c = { el: el, kind: kind, area: area, cell: pickHome(list, kind), x: 0, dir: 1, next: 0 };
          critters.push(c); mine.push(c); hop(c, true);
        }
      });
    });
  }
  setInterval(function () {
    if (document.hidden || !state) return;
    var now = Date.now();
    critters.forEach(function (c) { if (now >= c.next) hop(c, false); });
  }, 500);
  window.addEventListener('resize', function () { critters.forEach(function (c) { hop(c, true); }); });

  function showOver() {
    var best = store.get(bestKey(), 0), newBest = state.score >= best && state.score > 0;
    $('overTitle').textContent = newBest ? 'New best!' : 'Town full!';
    $('overText').textContent = 'Score ' + state.score + ' in ' + state.turn + ' turns' + (newBest ? '' : ' · best ' + best);
    $('overlay').classList.remove('hidden');
  }

  // ---- controls
  $('holdBtn').addEventListener('click', function () {
    var s = TT.swap(state);
    if (s) { state = s; save(); render([]); }
  });
  document.querySelectorAll('.tool[data-tool]').forEach(function (b) { // trap, hammer and mover (the item shop is built in buildShop)
    var t = b.dataset.tool;
    b.querySelector('.tp').textContent = '🪙' + TT.PRICE[t];
    b.addEventListener('click', function () { mode = mode === t ? null : t; sel = -1; moveFrom = -1; render([]); });
  });
  document.querySelectorAll('.land').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = TT.buyLand(state, b.dataset.land);
      if (r) { state = r.state; sel = -1; hover = -1; save(); render(r.events); vibrate(15); }
    });
  });
  $('previewBtn').setAttribute('aria-pressed', previewOn);
  $('previewBtn').addEventListener('click', function () {
    previewOn = !previewOn; sel = -1; hover = -1;
    store.set('tt-preview', previewOn);
    this.setAttribute('aria-pressed', previewOn); updatePreview();
  });
  $('undoBtn').addEventListener('click', function () {
    var s = TT.undo(state);
    if (s) { state = s; save(); render([]); }
  });
  $('hintBtn').addEventListener('click', function () {
    hints = !hints; this.setAttribute('aria-pressed', hints); render([]);
  });
  // New game: pick the map and the bear mode in a small dialog (the last picks are remembered); Play again repeats both
  var dlg = { map: 'easy', wild: false };
  function showDialog() {
    document.querySelectorAll('#newGame .opt[data-map]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.map === dlg.map); });
    document.querySelectorAll('#newGame .opt[data-bears]').forEach(function (b) { b.setAttribute('aria-pressed', (b.dataset.bears === 'wild') === dlg.wild); });
    $('mapNote').textContent = MAP_NOTES[dlg.map];
    $('bearNote').textContent = dlg.wild ? 'Boxed-in bears growl, get angry, then maul a 🌱🌿🌳🏕️🛖 next to them (one tier down). Bears breed in small pens. Own best scores.' : 'Bears wander and get trapped into tombstones.';
  }
  var MAP_NOTES = { easy: 'A plain grass field.', standard: 'A plain field with a few grass, bushes and trees already growing.', medium: 'A river runs across the field and splits it in two.', hard: 'Random ponds eat into the field (different every game).' };
  function openNewGame() {
    dlg.map = mapPref(); dlg.wild = wildPref();
    $('newNote').textContent = state.over || state.turn === 0 ? '' : 'Your current game will be replaced.';
    showDialog();
    $('newGame').classList.remove('hidden');
  }
  document.querySelectorAll('#newGame .opt[data-map]').forEach(function (b) { b.addEventListener('click', function () { dlg.map = b.dataset.map; showDialog(); }); });
  document.querySelectorAll('#newGame .opt[data-bears]').forEach(function (b) { b.addEventListener('click', function () { dlg.wild = b.dataset.bears === 'wild'; showDialog(); }); });
  $('newStart').addEventListener('click', function () {
    store.set('tt-map', dlg.map); store.set('tt-wild', dlg.wild);
    $('newGame').classList.add('hidden');
    startNew(0, dlg.wild, dlg.map);
  });
  $('newBtn').addEventListener('click', openNewGame);
  $('newCancel').addEventListener('click', function () { $('newGame').classList.add('hidden'); });
  $('againBtn').addEventListener('click', function () { startNew(0, state.wild, state.map); });
  // item guide: built from the logic tables so it can never drift from the real merge chains
  function chip(code, label) {
    return '<div class="chip"><span class="ce">' + TT.EMOJI[code] + '</span><small>' + (label || TT.NAME[code]) + '</small></div>';
  }
  function chain(start, firstLabel, finalLabel) {
    var out = [], c = start, first = true;
    while (c) {
      var last = !TT.NEXT[c];
      out.push(chip(c, last && finalLabel ? finalLabel : (first && firstLabel) || null));
      if (!last) out.push('<span class="arrow">&rarr;<small>x3</small></span>');
      c = TT.NEXT[c]; first = false;
    }
    return out.join('');
  }
  $('guideBody').innerHTML =
    '<h3>Buildings</h3><div class="chain">' + chain(1, null, 'cash (final)') + '</div>' +
    '<p class="gnote">💵 Cash is collectible: tap it for +' + TT.CASH_COINS + ' coins. 🐇🐤 hop around the homes (camp to village).</p>' +
    '<h3>Bears</h3><div class="chain">' + chip(TT.BEAR, 'trap it') + '<span class="arrow">&rarr;</span>' +
    chain(TT.TOMB, null, 'treasure: tap to open, +' + TT.TREASURE_COINS + ' coins') + '</div>' +
    '<p class="gnote">👻🐈‍⬛ haunt the tombstones and churches. <b>Wild bears</b> mode: a bear that cannot step but is not sealed in gets angry (💢, then 💢💢) and on the third turn mauls a 🌱🌿🌳🏕️🛖 next to it, one tier down (a 🌱 is destroyed), then starts over. In a small pen (4 to 6 tiles) with 2 bears and 2 free tiles, a cub is sometimes born (🍼). Blue tiles are <b>water</b>: nothing can be placed, merged, moved or smashed there, and animals cannot cross it.</p>' +
    '<h3>Special</h3><div class="chain">' + chip(TT.CRYSTAL, 'wildcard') + chip(TT.FOX, 'warps, walls trap it') + '</div>' +
    '<p class="gnote">💎 stands in for any tier, including 🏬 (making 💵 cash) and 🕌 (making a 💰 treasure). Three or more 💎 touching each other merge into a 💰 treasure. 🚚 moves one item to an empty tile for coins.</p>' +
    '<p class="gnote">Three or more connected items of the same kind merge into the next one. Bigger groups pay more points and coins.</p>';
  $('guideLink').addEventListener('click', function (e) { e.preventDefault(); $('guide').classList.remove('hidden'); });
  $('guideClose').addEventListener('click', function () { $('guide').classList.add('hidden'); });
  $('helpLink').addEventListener('click', function (e) { e.preventDefault(); $('help').classList.remove('hidden'); });
  $('helpClose').addEventListener('click', function () { $('help').classList.add('hidden'); store.set('tt-seen-help', 1); });

  // ---- start: ?#seed=N forces a reproducible game, otherwise resume the saved one
  var forced = seedFromHash();
  if (forced) startNew(forced);
  else {
    state = loadSaved();
    if (state) render([]); else startNew();
  }
  if (!store.get('tt-seen-help', 0) && state.turn === 0) $('help').classList.remove('hidden');

  // test / debugging hooks (read-only view of the game)
  window.ttDebug = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    validate: function () { return TT.validate(state); },
    critters: function () { return critters.map(function (c) { return c.kind; }); },
    critterHomes: function () { return critters.map(function (c) { return { kind: c.kind, cell: c.cell, code: state.grid[c.cell] }; }); }
  };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    // cache-first service worker: when an update takes over, reload once so the new version shows without a manual refresh
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
