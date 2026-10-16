// Triple Three UI. Relies on global TT (logic.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var boardEl = $('board'), fxEl = $('fx');
  var state, best = store.get('tt-best', 0), hints = false;
  var previewOn = store.get('tt-preview', true) !== false;
  var sel = -1, hover = -1, mode = null, lastPointer = 'touch'; // UI-only: tile awaiting confirmation, mouse hover, armed tool ('hammer'|'trap'), last input type
  var cells = [];

  function seedFromHash() {
    var m = /seed=(\d+)/.exec(location.hash);
    return m ? (parseInt(m[1], 10) >>> 0) || 1 : 0;
  }
  function randomSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }

  function startNew(seed) {
    state = TT.newGame(seed || randomSeed());
    sel = -1; hover = -1; mode = null;
    $('overlay').classList.add('hidden');
    save();
    render([]);
  }
  function save() { store.set('tt-save', state); }

  function loadSaved() {
    var s = store.get('tt-save', null);
    // saves from before the shop existed have no coins
    if (s && typeof s.coins !== 'number') { s.coins = TT.START_COINS; if (s.undo) s.undo.coins = TT.START_COINS; }
    try { if (s && TT.validate(s).length === 0 && typeof s.rng === 'number') return s; } catch (e) {}
    return null;
  }

  // ---- board construction
  for (var i = 0; i < TT.N; i++) {
    var el = document.createElement('div');
    el.className = 'cell empty' + (((i % TT.W) + ((i / TT.W) | 0)) % 2 ? ' alt' : '');
    el.dataset.i = i; el.dataset.c = 0; el.setAttribute('role', 'gridcell');
    var e = document.createElement('span'); e.className = 'e'; el.appendChild(e);
    boardEl.appendChild(el); cells.push(el);
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

  // Is idx a legal target for the armed tool (or for placement when none is armed)?
  function targetOk(idx) {
    var v = state.grid[idx];
    return mode === 'hammer' ? v !== 0 : mode === 'trap' ? v === TT.BEAR : (v === 0 || v === TT.TREASURE);
  }
  function doAction(idx) {
    return mode === 'hammer' ? TT.hammer(state, idx) : mode === 'trap' ? TT.trap(state, idx) : TT.place(state, idx);
  }

  // Mouse: hover already showed the preview, so one click commits. Touch: the first tap selects and previews
  // (when Preview is on), a second tap on the same tile commits.
  function tap(idx) {
    if (!state || state.over) return;
    if (!targetOk(idx)) { bump(idx); return; }
    if (!mode && state.grid[idx] === TT.TREASURE) { // opening a treasure is always good news: no confirmation step
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
  function bump(idx) { var c = cells[idx]; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }

  // ---- rendering
  function cellCenter(idx) {
    var c = cells[idx], b = fxEl.getBoundingClientRect(), r = c.getBoundingClientRect();
    return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, w: r.width, h: r.height };
  }
  function clearAnim() {
    cells.forEach(function (c) { c.classList.remove('drop', 'pop', 'shake', 'slide'); });
  }

  function render(events) {
    clearAnim();
    var g = state.grid;
    cells.forEach(function (c, i) {
      var code = g[i];
      c.dataset.c = code;
      c.firstChild.textContent = TT.EMOJI[code];
      c.classList.toggle('empty', code === 0);
      c.classList.toggle('hint', hints && !state.over && TT.wouldMerge(state, i));
      c.setAttribute('aria-label', 'row ' + (((i / TT.W) | 0) + 1) + ' column ' + ((i % TT.W) + 1) + ' ' + TT.NAME[code]);
    });
    if (mode && (state.over || state.coins < TT.PRICE[mode])) mode = null;
    if (sel >= 0 && (state.over || !targetOk(sel))) sel = -1;
    $('score').textContent = state.score;
    $('coins').textContent = state.coins;
    if (state.score > best) { best = state.score; store.set('tt-best', best); }
    $('best').textContent = best;
    $('curItem').textContent = TT.EMOJI[state.cur];
    $('curName').textContent = TT.NAME[state.cur];
    $('nextItem').textContent = TT.EMOJI[state.next];
    $('holdItem').textContent = state.hold ? TT.EMOJI[state.hold] : '·';
    $('undoBtn').disabled = !state.undo;
    document.querySelectorAll('.tool').forEach(function (b) {
      var t = b.dataset.tool;
      if (t === 'hammer') {
        b.disabled = state.over || state.coins < TT.PRICE.hammer || TT.emptyCount(g) === TT.N;
        b.setAttribute('aria-pressed', mode === 'hammer');
      } else if (t === 'trap') {
        b.disabled = state.over || state.coins < TT.PRICE.trap || g.indexOf(TT.BEAR) < 0;
        b.setAttribute('aria-pressed', mode === 'trap');
      } else b.disabled = !TT.buy(state, +t);
    });
    $('turn').textContent = 'Turn ' + state.turn;
    $('seed').textContent = 'seed ' + state.seed;
    animate(events);
    updatePreview();
    if (state.over) showOver();
  }

  // ---- move preview: ghost of the resulting item, merged tiles outlined, plus a one-line explanation
  function updatePreview() {
    cells.forEach(function (c) {
      c.classList.remove('pv', 'eat', 'target');
      if (c.hasAttribute('data-pv')) c.removeAttribute('data-pv');
    });
    var note = '', hot = false, pi = sel >= 0 ? sel : (previewOn ? hover : -1), p;
    if (state.over) note = '';
    else if (mode === 'trap') {
      if (pi >= 0 && state.grid[pi] === TT.BEAR) {
        cells[pi].classList.add('target');
        var tr = TT.trap(state, pi);
        var res = tr ? tr.state.grid[pi] : TT.TOMB;
        note = (sel === pi ? 'Tap again to trap' : 'Trap') + ' the bear -> ' + TT.NAME[res] + ' (-' + TT.PRICE.trap + ' coins)';
        hot = sel === pi;
      } else note = '🪤 Tap a bear to kill it';
    } else if (mode === 'hammer') {
      if (pi >= 0 && state.grid[pi] !== 0) {
        cells[pi].classList.add('target');
        note = (lastPointer !== 'mouse' && sel === pi ? 'Tap again to smash ' : 'Smash ') + TT.NAME[state.grid[pi]] + ' (-' + TT.PRICE.hammer + ' coins)';
        hot = sel === pi;
      } else note = '🔨 Tap an item to remove it';
    } else if (pi >= 0 && state.grid[pi] === TT.TREASURE) {
      note = '💰 Click to open the treasure: +' + TT.TREASURE_COINS + ' coins'; hot = true;
    } else if (TT.emptyCount(state.grid) === 0) {
      note = 'Board full - use the 🔨 hammer (' + TT.PRICE.hammer + ' coins) to clear a tile'; hot = true;
    } else if (previewOn && pi >= 0 && (p = TT.preview(state, pi))) {
      cells[pi].classList.add('pv'); cells[pi].setAttribute('data-pv', TT.EMOJI[p.final]);
      p.eaten.forEach(function (i) { cells[i].classList.add('eat'); });
      var verb = sel === pi ? 'Tap again to ' : '';
      note = p.merged
        ? (verb ? verb + 'merge' : 'Merges') + ' into ' + TT.NAME[p.final] + ' · +' + p.points + ' pts · +' + p.coins + ' coins'
        : (verb ? verb + 'place ' : 'Place ') + TT.NAME[state.cur] + ' here';
      hot = sel === pi;
    } else if (previewOn) note = 'Tap a tile to preview, tap again to place';
    $('note').textContent = note;
    $('note').classList.toggle('hot', hot);
  }

  function animate(events) {
    fxEl.textContent = '';
    void boardEl.offsetWidth; // reflow so restarted animations play
    events.forEach(function (ev) {
      if (ev.type === 'place') cells[ev.at].classList.add('drop');
      else if (ev.type === 'merge') {
        var to = cellCenter(ev.at);
        cells[ev.at].classList.remove('drop'); cells[ev.at].classList.add('pop');
        ev.cells.forEach(function (ci) {
          if (ci === ev.at) return;
          var f = cellCenter(ci), gh = document.createElement('div');
          gh.className = 'ghost'; gh.textContent = TT.EMOJI[ev.from];
          gh.style.cssText = 'left:' + (f.x - f.w / 2) + 'px;top:' + (f.y - f.h / 2) + 'px;width:' + f.w + 'px;height:' + f.h +
            'px;--dx:' + (to.x - f.x) + 'px;--dy:' + (to.y - f.y) + 'px';
          fxEl.appendChild(gh);
        });
        var p = document.createElement('div');
        p.className = 'pts'; p.textContent = '+' + ev.points + (ev.coins ? ' · +' + ev.coins + '🪙' : '');
        p.style.left = to.x + 'px'; p.style.top = to.y + 'px';
        fxEl.appendChild(p);
      } else if (ev.type === 'bear') {
        var a = cellCenter(ev.from), b = cellCenter(ev.to), c = cells[ev.to];
        c.style.setProperty('--dx', (a.x - b.x) + 'px'); c.style.setProperty('--dy', (a.y - b.y) + 'px');
        c.classList.add('slide');
      } else if (ev.type === 'trapped') {
        cells[ev.at].classList.add('shake');
      } else if (ev.type === 'open') {
        var oc = cellCenter(ev.at), oe = document.createElement('div');
        oe.className = 'pts'; oe.textContent = '💰 +' + ev.coins + '🪙'; oe.style.left = oc.x + 'px'; oe.style.top = oc.y + 'px';
        fxEl.appendChild(oe);
      } else if (ev.type === 'trap') {
        var tp = cellCenter(ev.at), tel = document.createElement('div');
        tel.className = 'pts'; tel.textContent = '🪤 -' + TT.PRICE.trap + '🪙'; tel.style.left = tp.x + 'px'; tel.style.top = tp.y + 'px';
        fxEl.appendChild(tel); cells[ev.at].classList.add('shake');
      } else if (ev.type === 'hammer') {
        var h = cellCenter(ev.at), hp = document.createElement('div');
        hp.className = 'pts'; hp.textContent = '🔨 -' + TT.PRICE.hammer + '🪙'; hp.style.left = h.x + 'px'; hp.style.top = h.y + 'px';
        fxEl.appendChild(hp);
      }
    });
    setTimeout(function () { if (fxEl.childNodes.length) fxEl.textContent = ''; }, 1000);
  }

  function showOver() {
    var newBest = state.score >= best && state.score > 0;
    $('overTitle').textContent = newBest ? 'New best!' : 'Town full!';
    $('overText').textContent = 'Score ' + state.score + ' in ' + state.turn + ' turns' + (newBest ? '' : ' · best ' + best);
    $('overlay').classList.remove('hidden');
  }

  // ---- controls
  $('holdBtn').addEventListener('click', function () {
    var s = TT.swap(state);
    if (s) { state = s; save(); render([]); }
  });
  document.querySelectorAll('.tool').forEach(function (b) {
    var t = b.dataset.tool;
    b.querySelector('.tp').textContent = '🪙' + TT.PRICE[t];
    b.addEventListener('click', function () {
      if (t === 'hammer' || t === 'trap') { mode = mode === t ? null : t; sel = -1; render([]); return; }
      var s = TT.buy(state, +t);
      if (s) { state = s; save(); render([]); }
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
  $('newBtn').addEventListener('click', function () {
    if (state.over || state.turn === 0 || confirm('Start a new game?')) startNew();
  });
  $('againBtn').addEventListener('click', function () { startNew(); });
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
    '<h3>Buildings</h3><div class="chain">' + chain(1, null, 'grand castle (final)') + '</div>' +
    '<h3>Bears</h3><div class="chain">' + chip(TT.BEAR, 'trap it') + '<span class="arrow">&rarr;</span>' +
    chain(TT.TOMB, null, 'treasure: tap to open, +' + TT.TREASURE_COINS + ' coins') + '</div>' +
    '<h3>Special</h3><div class="chain">' + chip(TT.CRYSTAL, 'wildcard') + '</div>' +
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
    validate: function () { return TT.validate(state); }
  };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
