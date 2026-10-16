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
  var cells = [];

  function seedFromHash() {
    var m = /seed=(\d+)/.exec(location.hash);
    return m ? (parseInt(m[1], 10) >>> 0) || 1 : 0;
  }
  function randomSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }

  function startNew(seed) {
    state = TT.newGame(seed || randomSeed());
    $('overlay').classList.add('hidden');
    save();
    render([]);
  }
  function save() { store.set('tt-save', state); }

  function loadSaved() {
    var s = store.get('tt-save', null);
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
  boardEl.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.cell') : null;
    if (t) tap(+t.dataset.i);
  });

  function tap(idx) {
    if (!state || state.over) return;
    var r = TT.place(state, idx);
    if (!r) { bump(idx); return; }
    state = r.state;
    save();
    render(r.events);
    if (navigator.vibrate) { try { navigator.vibrate(r.events.some(function (e) { return e.type === 'merge'; }) ? 25 : 8); } catch (e) {} }
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
    $('score').textContent = state.score;
    if (state.score > best) { best = state.score; store.set('tt-best', best); }
    $('best').textContent = best;
    $('curItem').textContent = TT.EMOJI[state.cur];
    $('curName').textContent = TT.NAME[state.cur];
    $('nextItem').textContent = TT.EMOJI[state.next];
    $('holdItem').textContent = state.hold ? TT.EMOJI[state.hold] : '·';
    $('undoBtn').disabled = !state.undo;
    $('turn').textContent = 'Turn ' + state.turn;
    $('seed').textContent = 'seed ' + state.seed;
    animate(events);
    if (state.over) showOver();
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
        p.className = 'pts'; p.textContent = '+' + ev.points; p.style.left = to.x + 'px'; p.style.top = to.y + 'px';
        fxEl.appendChild(p);
      } else if (ev.type === 'bear') {
        var a = cellCenter(ev.from), b = cellCenter(ev.to), c = cells[ev.to];
        c.style.setProperty('--dx', (a.x - b.x) + 'px'); c.style.setProperty('--dy', (a.y - b.y) + 'px');
        c.classList.add('slide');
      } else if (ev.type === 'trapped') {
        cells[ev.at].classList.add('shake');
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
