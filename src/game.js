// Triple Three UI. Relies on global TT (logic.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var boardEl = $('board'), fxEl = $('fx'), wrapEl = $('boardWrap'), shopEl = $('shop'), critEl = $('critters');
  var state;
  var previewOn = store.get('tt-preview', true) !== false;
  var sel = -1, hover = -1, mode = null, moveFrom = -1, lastPointer = 'touch'; // UI-only: tile awaiting confirmation, mouse hover, armed tool ('hammer'|'trap'|'move'), tile picked up by the mover, last input type
  var cells = [], bw = 0, bh = 0, shopKey = '', waterEl = null, waterKey = '';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function seedFromHash() {
    var m = /seed=(\d+)/.exec(location.hash);
    return m ? (parseInt(m[1], 10) >>> 0) || 1 : 0;
  }
  function randomSeed() { return ((Math.random() * 4294967295) >>> 0) || 1; }
  function fmt(n) { return n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }

  // best scores are kept per map and bear mode: harder games get their own board (easy + classic keeps the original key)
  function bestKey() {
    return (state && state.map && state.map !== 'easy' ? 'tt-best-' + state.map : 'tt-best') + (state && state.wild ? '-wild' : '') +
      (state && state.bears === false ? '-nobears' : '') + (state && state.foxes === false ? '-nofox' : '');
  }
  function wildPref() { return store.get('tt-wild', false) === true; } // the mode picked last in the New game dialog
  function bearsPref() { return store.get('tt-bears', true) !== false; }
  function foxesPref() { return store.get('tt-foxes', true) !== false; }
  function mapPref() { var m = store.get('tt-map', 'easy'); return TT.MAPS.indexOf(m) >= 0 ? m : 'easy'; }
  // ' · wild bears', ' · calm' ... for the seed line and the erase warning
  function modeLabel(st) {
    return (st.wild ? ' · wild bears' : '') + (st.bears === false && st.foxes === false ? ' · calm' : (st.bears === false ? ' · no bears' : '') + (st.foxes === false ? ' · no foxes' : ''));
  }
  function startNew(seed, o) {
    o = o || {};
    state = TT.newGame(seed || randomSeed(), {
      wild: o.wild === undefined ? wildPref() : o.wild, map: o.map === undefined ? mapPref() : o.map,
      bears: o.bears === undefined ? bearsPref() : o.bears, foxes: o.foxes === undefined ? foxesPref() : o.foxes });
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
    waterEl = null; waterKey = ''; // the water layer lived inside the board that was just cleared
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

  // Haptic feedback (a short buzz on placing, merging and buying): on by default, switched off with the 📳 link at the top.
  var haptics = store.get('tt-haptics', true) !== false;
  function vibrate(ms) { if (haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }
  function showHaptics() {
    var link = $('hapticLink');
    link.hidden = !navigator.vibrate; // phones without vibration support (iPhones) have nothing to switch off
    link.textContent = haptics ? '📳 Haptics: on' : '📴 Haptics: off';
    link.setAttribute('aria-pressed', haptics);
  }

  // Seasons: a colour theme (`data-season` on <html>, CSS tokens) plus a few petals / leaves / snowflakes drifting over the page. 'auto' follows
  // the calendar month. Purely cosmetic (never in the game state); the falling bits use Math.random, which is fine outside the logic.
  // Natural items change with the season: the three plant tiers, and the little critters (who lives around the homes / on the water).
  var PLANTS = { summer: { 1: '🌱', 2: '🌿', 3: '🌳' }, spring: { 1: '🌻', 2: '💐', 3: '🌸' }, autumn: { 1: '🍂', 2: '🍄', 3: '🪾' }, winter: { 1: '❄️', 2: '🎁', 3: '🎄' } };
  // Very new emoji (the bare tree 🪾 is from 2023) show as a black-and-white empty box on older devices. A real emoji has coloured pixels,
  // the missing-glyph box has none: draw it on a canvas and look; if it is not coloured use a leaf instead.
  function glyphOk(ch) {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 40;
      var x = c.getContext('2d'); x.font = '30px sans-serif'; x.textBaseline = 'top';
      x.fillText(ch, 0, 0);
      var d = x.getImageData(0, 0, 40, 40).data;
      for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) return true;
      return false;
    } catch (e) { return true; }
  }
  if (!glyphOk(PLANTS.autumn[3])) PLANTS.autumn[3] = '🍁';
  var CRITTERS = {
    summer: { home: ['🐇', '🐤'], grave: ['👻', '🐈\u200d⬛'], water: ['🦢', '🐟'] },
    spring: { home: ['🐇', '🐤', '🦋'], grave: ['👻', '🐈\u200d⬛'], water: ['🦢', '🐸'] },
    autumn: { home: ['🐿️', '🦔'], grave: ['👻', '🦇'], water: ['🦆', '🐟'] },
    winter: { home: ['🦌', '🐦'], grave: ['👻', '🐈\u200d⬛'], water: ['🦢', '🦆'] }
  };
  // The wild animals change with the season too (display only: the logic still sees BEAR / FOX): [emoji, name] for the bear and the fox.
  var SKINS = { summer: { bear: ['🐻', 'bear'], fox: ['🦊', 'fox'] }, spring: { bear: ['🐻', 'bear'], fox: ['🦊', 'fox'] },
    autumn: { bear: ['🐗', 'boar'], fox: ['🦝', 'raccoon'] }, winter: { bear: ['🐺', 'wolf'], fox: ['🐇', 'rabbit'] } };
  var curSeason = 'summer';
  function em(code) { // the emoji to show for an item code
    var p = PLANTS[curSeason];
    if (p && p[code]) return p[code];
    if (TT.isBear(code)) return SKINS[curSeason].bear[0];
    return code === TT.FOX ? SKINS[curSeason].fox[0] : TT.EMOJI[code];
  }
  function nm(code) { // the name to show ('wolf' instead of 'bear' in winter; 'angry wolf'...)
    var n = TT.NAME[code];
    return TT.isBear(code) ? n.replace('bear', SKINS[curSeason].bear[1]) : code === TT.FOX ? SKINS[curSeason].fox[1] : n;
  }
  var SEASONS = ['auto', 'spring', 'summer', 'autumn', 'winter'];
  var SEASON_LABEL = { auto: '🎨 Season: auto', spring: '🌸 Spring', summer: '☀️ Summer', autumn: '🍂 Autumn', winter: '❄️ Winter' };
  var SEASON_BITS = { spring: ['🌸', '🌼', '🌸'], autumn: ['🍂', '🍁', '🍂'], winter: ['❄️', '❄', '❄️'] };
  var season = store.get('tt-season', 'auto');
  if (SEASONS.indexOf(season) < 0) season = 'auto';
  function seasonNow() { var m = new Date().getMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter'; }
  function applySeason() {
    var cur = season === 'auto' ? seasonNow() : season, fx = $('seasonFx'), bits = SEASON_BITS[cur] || [];
    document.documentElement.dataset.season = cur; curSeason = cur;
    if (typeof AREAS !== 'undefined') { AREAS[0].kinds = CRITTERS[cur].home; AREAS[1].kinds = CRITTERS[cur].grave; AREAS[2].kinds = CRITTERS[cur].water; }
    $('seasonLink').textContent = SEASON_LABEL[season];
    fx.innerHTML = '';
    if (!bits.length) return;
    for (var i = 0; i < 16; i++) {
      var b = document.createElement('i');
      b.textContent = bits[i % bits.length];
      b.style.left = (Math.random() * 100) + '%';
      b.style.fontSize = (9 + Math.random() * 9) + 'px';
      b.style.animationDuration = (9 + Math.random() * 9) + 's';
      b.style.animationDelay = (-Math.random() * 18) + 's';
      b.style.setProperty('--sway', (Math.random() * 60 - 30) + 'px');
      fx.appendChild(b);
    }
  }
  var SPEED_LABEL = ['⏸ paused', '⏱ 1×', '⏩ 2×', '⏩ 3×'];
  // ---- banks: tap one to borrow against the best building next to it, repay, see the interest
  var bankAt = -1;
  function loanText(l) { return l.defaulted ? '🏚️ seized lot' : em(l.tier) + ' ' + nm(l.tier) + ' (locked)'; }
  function openBank(idx) { bankAt = idx; renderBank(); $('bankDlg').classList.remove('hidden'); }
  function closeBank() { $('bankDlg').classList.add('hidden'); bankAt = -1; }
  function renderBank() {
    if (bankAt < 0 || state.grid[bankAt] !== TT.BANK) { closeBank(); return; }
    var rate = TT.bankRate(state, bankAt), box = $('bankLoans'), mine = [];
    state.loans.forEach(function (l, i) { if (l.bank === bankAt) mine.push(i); });
    $('bankTitle').textContent = '🏦 Bank ' + (state.bankOrder.indexOf(bankAt) + 1);
    $('bankInfo').textContent = 'Interest ' + Math.round(rate * 100) + '% a year (simple, counted by the month) · pays 🪙' + fmt(TT.bankIncome(state)) + ' every turn (at 1× speed) while no loan is in default. A loan is half the shop price of the dearest building next to the bank, which is locked until you repay. A year unpaid and that building and its tile are seized.';
    box.textContent = '';
    mine.forEach(function (i) {
      var l = state.loans[i], owed = TT.loanOwed(state, l), row = document.createElement('div');
      row.className = 'loanrow' + (l.defaulted ? ' bad' : '');
      row.innerHTML = '<div class="lt">' + loanText(l) + '<small>borrowed 🪙' + fmt(l.principal) + ' · owe 🪙' + fmt(owed) + ' · ' + (l.defaulted ? 'in default: pay to get the tile back' : 'due in ' + TT.loanMonthsLeft(state, l) + ' month' + (TT.loanMonthsLeft(state, l) === 1 ? '' : 's')) + '</small></div>';
      var b = document.createElement('button');
      b.className = 'btn'; b.textContent = 'Repay 🪙' + fmt(owed); b.disabled = state.coins < owed;
      b.addEventListener('click', function () {
        var r = TT.repay(state, i);
        if (r) { state = r.state; save(); render(r.events); vibrate(15); }
      });
      row.appendChild(b); box.appendChild(row);
    });
    var o = TT.loanOptions(state, bankAt), bb = $('bankBorrow');
    bb.hidden = !o;
    if (o) bb.textContent = 'Borrow 🪙' + fmt(o.principal) + ' · locks the ' + em(o.tier) + ' ' + nm(o.tier);
    $('bankNote').textContent = o ? '' : (mine.length ? 'Nothing else to lock next to this bank.' : 'Put a building next to the bank (up, down, left or right) to borrow against it.');
  }
  function renderLoanLine() {
    var el = $('loanLine'), n = state.loans.length;
    el.hidden = !n;
    if (!n) return;
    var bad = state.loans.filter(function (l) { return l.defaulted; }).length, owed = 0, soon = 99;
    state.loans.forEach(function (l) { owed += TT.loanOwed(state, l); if (!l.defaulted) soon = Math.min(soon, TT.loanMonthsLeft(state, l)); });
    el.textContent = (bad ? '🏚️ ' + bad + ' seized · ' : '') + (n - bad ? '⚠️ ' + (n - bad) + ' loan' + (n - bad > 1 ? 's' : '') + ' · due in ' + soon + ' mo · ' : '') + 'owe 🪙' + fmt(owed);
  }
  function isCollectible(v) { return v === TT.TREASURE || v === TT.CASH; }
  function isAnimal(v) { return TT.isBear(v) || v === TT.FOX; }
  // Is idx a legal target for the armed tool (or for placement when none is armed)?
  function targetOk(idx) {
    var v = state.grid[idx];
    if (mode === 'move') return (TT.isMovable(v) && !lockedNow[idx]) || (v === 0 && moveFrom >= 0 && !isBridgeTile(idx)); // pick something up (not a locked tile), then an empty tile to drop it on
    if (mode === 'bridge') return TT.bridgeSpots(state).indexOf(idx) >= 0;
    if (mode === 'pond') return v === 0 && !isBridgeTile(idx);
    return mode === 'hammer' ? v !== 0 && v !== TT.WATER && v !== TT.SEIZED && !lockedNow[idx] : mode === 'trap' ? isAnimal(v) : ((v === 0 && !isBridgeTile(idx)) || isCollectible(v));
  }
  var lockedNow = {}; // cells a loan has locked (rebuilt on every render)
  function isBridgeTile(i) { return state.bridges.indexOf(i) >= 0; }
  function doAction(idx) {
    return mode === 'hammer' ? TT.hammer(state, idx) : mode === 'trap' ? TT.trap(state, idx) : mode === 'bridge' ? TT.buyBridge(state, idx) : mode === 'pond' ? TT.buyPond(state, idx) : TT.place(state, idx);
  }

  // Mouse: hover already showed the preview, so one click commits. Touch: the first tap selects and previews
  // (when Preview is on), a second tap on the same tile commits.
  function tap(idx) {
    if (!state || state.over) return;
    if (!mode && state.grid[idx] === TT.BANK) { openBank(idx); return; } // tap a bank: loans
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
    cells.forEach(function (c) { c.classList.remove('drop', 'pop', 'shake', 'slide', 'warp', 'built'); });
  }

  // Water is drawn as ONE soft layer under the tiles instead of blue squares: the water tiles become blurred blobs that fuse
  // where they touch and get rounded corners, a sandy bank blends the edge into the grass, and light ripples drift across it.
  // Water that touches the board edge is extended past it, so a river runs off the edge instead of ending in a rounded cap.
  function drawWater() {
    var g = state.grid, w = state.w, h = state.h, r, c;
    function wet(i) { return g[i] === TT.WATER || state.bridges.indexOf(i) >= 0; } // a bridge crosses water: the river runs on underneath
    var key = w + 'x' + h + ':' + g.map(function (v, i) { return wet(i) ? 1 : 0; }).join('');
    if (key === waterKey) return;
    waterKey = key;
    if (waterEl) { waterEl.remove(); waterEl = null; }
    if (key.indexOf('1') < 0) return;
    function isWater(rr, cc) { return wet(Math.min(h - 1, Math.max(0, rr)) * w + Math.min(w - 1, Math.max(0, cc))); }
    var rects = '';
    for (r = -1; r <= h; r++) for (c = -1; c <= w; c++) if (isWater(r, c)) rects += '<rect x="' + (c - 0.01) + '" y="' + (r - 0.01) + '" width="1.02" height="1.02"/>';
    var x0 = -2, y0 = -2, W = w + 4, H = h + 4, box = 'x="' + x0 + '" y="' + y0 + '" width="' + W + '" height="' + H + '"';
    function filter(id, slope, offset) {
      return '<filter id="' + id + '" filterUnits="userSpaceOnUse" ' + box + ' color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0.2"/>' +
        '<feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' + slope + ' ' + offset + '"/></filter>';
    }
    function mask(id, fid) { return '<mask id="' + id + '" maskUnits="userSpaceOnUse" ' + box + '><g filter="url(#' + fid + ')" fill="#fff"><use href="#wcells"/></g></mask>'; }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'water'); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<defs><g id="wcells">' + rects + '</g>' + filter('wbank', 6, -0.9) + filter('wbody', 14, -6.3) + mask('wmbank', 'wbank') + mask('wmbody', 'wbody') +
      '<linearGradient id="wgrad" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" style="stop-color:var(--w1)"/><stop offset="0.55" style="stop-color:var(--w2)"/><stop offset="1" style="stop-color:var(--w3)"/></linearGradient>' +
      '<pattern id="wrip" width="0.55" height="0.55" patternUnits="userSpaceOnUse" patternTransform="rotate(24)"><path d="M0 0.1 Q0.14 0 0.28 0.1 T0.55 0.1" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="0.03"/></pattern></defs>' +
      '<rect ' + box + ' style="fill:var(--bank)" fill-opacity="0.85" mask="url(#wmbank)"/>' +
      '<rect ' + box + ' fill="url(#wgrad)" mask="url(#wmbody)"/>' +
      '<g mask="url(#wmbody)"><rect class="ripples" ' + box + ' fill="url(#wrip)"/></g>';
    boardEl.insertBefore(svg, boardEl.firstChild);
    waterEl = svg;
  }

  // The shop is a pop-up sheet on phones (wide screens show it inline, see the CSS). Every shop action closes it, so the map is back at once.
  function openShop() { $('shopSheet').classList.remove('hidden'); }
  function closeShop() { $('shopSheet').classList.add('hidden'); }

  // The shop row lists every unlocked building tier plus the crystal; it is rebuilt only when that list changes.
  function buildShop() {
    var items = [], k, fresh = shopKey !== '';
    for (k = 1; k <= TT.unlockedTop(state); k++) items.push(k);
    items.push(TT.CRYSTAL);
    if (TT.isBankAvailable(state)) items.push(TT.BANK); // a bank is sold once a village has stood on the board
    var key = items.join(',');
    if (key === shopKey) return;
    var known = shopKey ? shopKey.split(',') : [];
    shopKey = key; shopEl.textContent = '';
    items.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tool' + (fresh && known.indexOf(String(t)) < 0 ? ' fresh' : '');
      b.dataset.tool = t; b.setAttribute('aria-label', 'Buy ' + nm(t));
      b.innerHTML = '<span class="te">' + em(t) + '</span><span class="tp"></span><span class="tb"></span>';
      b.addEventListener('click', function () {
        var s = t === TT.BANK ? TT.buyBank(state) : TT.buy(state, t);
        if (s) { state = s; save(); render([]); closeShop(); }
      });
      shopEl.appendChild(b);
    });
  }

  function render(events) {
    if (state.w !== bw || state.h !== bh) buildBoard();
    clearAnim();
    var g = state.grid, w = state.w;
    lockedNow = {}; TT.lockedCells(state).forEach(function (i) { lockedNow[i] = true; });
    drawWater();
    cells.forEach(function (c, i) {
      var code = g[i];
      c.dataset.c = code;
      c.firstChild.textContent = em(code);
      c.classList.toggle('empty', code === 0);
      var isB = state.bridges.indexOf(i) >= 0, col = i % w; // a bridge tile is walkable water: planks along the way across
      c.classList.toggle('bridge', isB);
      c.classList.toggle('pond', state.ponds.indexOf(i) >= 0);
      c.classList.toggle('locked', !!lockedNow[i]);
      c.classList.toggle('bh', isB && col > 0 && col < w - 1 && g[i - 1] !== TT.WATER && g[i + 1] !== TT.WATER);
      c.classList.toggle('bv', isB && !c.classList.contains('bh'));
      c.setAttribute('aria-label', 'row ' + (((i / w) | 0) + 1) + ' column ' + ((i % w) + 1) + ' ' + (state.bridges.indexOf(i) >= 0 ? 'bridge ' : '') + nm(code));
    });
    if (mode === 'bridge') { if (!TT.canBridge(state)) mode = null; }
    else if (mode === 'pond') { if (!TT.canPond(state)) mode = null; }
    else if (mode && (state.over || state.coins < TT.PRICE[mode] || !(state.stock[mode] > 0))) mode = null;
    if (mode !== 'move' || (moveFrom >= 0 && !TT.isMovable(g[moveFrom]))) moveFrom = -1;
    if (sel >= 0 && (state.over || !targetOk(sel))) sel = -1;
    $('score').textContent = state.score;
    $('coins').textContent = state.coins;
    $('sheetCoins').textContent = state.coins;
    var best = store.get(bestKey(), 0);
    if (state.score > best) { best = state.score; store.set(bestKey(), best); }
    $('best').textContent = best;
    $('curItem').textContent = em(state.cur);
    $('curName').textContent = nm(state.cur);
    $('nextItem').textContent = em(state.next);
    $('holdItem').textContent = state.hold ? em(state.hold) : '·';
    $('undoBtn').disabled = !TT.canUndo(state);
    $('swapBtn').disabled = state.over;
    buildShop();
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
      var t = b.dataset.tool;
      if (t === 'hammer') {
        b.disabled = !TT.canHammer(state) || state.over || !g.some(function (v, i) { return v !== 0 && v !== TT.WATER && v !== TT.SEIZED && !lockedNow[i]; });
        b.setAttribute('aria-pressed', mode === 'hammer');
      } else if (t === 'move') {
        b.disabled = state.over || !TT.canMove(state) || !g.some(function (v, i) { return TT.isMovable(v) && !lockedNow[i]; }) || TT.freeCount(state) === 0;
        b.setAttribute('aria-pressed', mode === 'move');
      } else if (t === 'pond') {
        b.disabled = !TT.canPond(state);
        b.setAttribute('aria-pressed', mode === 'pond');
        b.querySelector('.tp').textContent = TT.pondPrice(state) === null ? 'max' : '🪙' + fmt(TT.pondPrice(state));
        b.querySelector('.tb').textContent = '×' + (TT.MAX_PONDS - state.ponds.length);
        return;
      } else if (t === 'bridge') {
        b.hidden = !state.bridges.length && !TT.bridgeSpots(state).length; // only where a bridge can actually go (dug ponds are not crossable)
        b.disabled = state.over || !TT.canBridge(state);
        b.setAttribute('aria-pressed', mode === 'bridge');
        b.querySelector('.tp').textContent = TT.bridgePrice(state) === null ? 'max' : '🪙' + fmt(TT.bridgePrice(state));
        b.querySelector('.tb').textContent = '×' + (TT.MAX_BRIDGES - state.bridges.length);
        return;
      } else if (t === 'trap') {
        b.hidden = !state.bears && !state.foxes; // a calm game has no animals to trap
        b.disabled = state.over || state.coins < TT.PRICE.trap || !(state.stock.trap > 0) || !g.some(isAnimal);
        b.setAttribute('aria-pressed', mode === 'trap');
      } else if (+t === TT.BANK) {
        b.disabled = !TT.canBuyBank(state);
        b.querySelector('.tp').textContent = '🪙' + fmt(TT.bankPrice(state));
        b.querySelector('.tb').textContent = '×' + Math.max(0, TT.MAX_BANKS - TT.bankSlots(state));
        return;
      } else {
        b.disabled = !TT.buy(state, +t);
        b.querySelector('.tp').textContent = '🪙' + fmt(TT.priceOf(state, +t));
        b.classList.toggle('pricey', (state.stock[t] || 0) <= 0); // out of stock: the price has doubled (or more)
      }
      b.querySelector('.tb').textContent = '×' + Math.max(0, state.stock[t] || 0);
    });
    var TOOL_NAMES = { hammer: '🔨 Hammer', trap: '🪤 Trap', move: '🚚 Mover', bridge: '🌉 Bridge', pond: '💧 Pond' };
    $('toolCancel').hidden = !mode; // a tool is armed: the Shop sheet is closed, so offer a way to put it away
    if (mode) $('toolCancelName').textContent = TOOL_NAMES[mode];
    var util = document.querySelector('.tools.util');
    util.style.setProperty('--tools', 8 + ($('bridgeBtn').hidden ? 0 : 1) - ($('trapBtn').hidden ? 1 : 0));
    var lp = TT.landPrice(state);
    document.querySelectorAll('.land').forEach(function (b) {
      var owned = state.land.indexOf(b.dataset.land) >= 0;
      b.disabled = state.over || owned || !TT.canLand(state);
      b.querySelector('.tp').textContent = owned ? '✓' : '🪙' + fmt(lp);
    });
    var nq = state.lake < TT.LAKE_SIZES.length ? TT.LAKE_SIZES[state.lake] : 0, bl = TT.bestLake(state);
    $('pondNote').textContent = 'Ponds ' + state.ponds.length + '/' + TT.MAX_PONDS + (state.ponds.length ? ' · +' + fmt(TT.pondPoints(state)) + ' pts per turn' : '') +
      (nq ? ' · 🏞️ quest: a ' + nq + '×' + nq + ' lake (biggest now ' + bl + '×' + bl + ') pays 🪙' + fmt(TT.LAKE_COINS[state.lake]) + ' + points' : ' · 🏞️ all lakes built');
    var ql = $('questLine');
    ql.textContent = nq ? '🏞️ Lake quest ' + nq + '×' + nq + ': biggest ' + bl + '×' + bl + ' · reward 🪙' + fmt(TT.LAKE_COINS[state.lake]) + ' + points' : '🏞️ All lakes built';
    $('landNote').textContent = 'Land ' + state.land.length + '/' + TT.MAX_LAND + (lp ? ' · next side 🪙' + lp : ' · all bought');
    var nextAt = TT.milestoneScore(state.milestone), gifts = [];
    [1, 2, 3, TT.CRYSTAL].forEach(function (c) { gifts.push('+' + TT.RESTOCK[c] + em(c)); });
    $('unlock').textContent = 'Shop restocks in ' + (nextAt - TT.milestoneProgress(state)) + ' more points from merges (pond income and lake bonuses do not count): ' + gifts.join(' ') +
      (TT.unlockedTop(state) > 3 ? ' +1 each higher tier' : '') + ' +1🪤 +1🔨';
    $('undoBtn').textContent = '↶ Undo 🪙' + TT.UNDO_COST;
    var cal = TT.calendar(state);
    $('turn').textContent = 'Turn ' + state.turn + ' · 📅 Y' + cal.year + ' M' + cal.month;
    $('speedBox').hidden = !state.bankOrder.length && !state.loans.length;
    $('speedLink').textContent = SPEED_LABEL[state.speed];
    renderLoanLine();
    if (!$('bankDlg').classList.contains('hidden')) renderBank();
    $('seed').textContent = 'seed ' + state.seed + (state.map !== 'easy' ? ' · ' + state.map + ' map' : '') + modeLabel(state);
    animate(events);
    updatePreview();
    syncCritters();
    if (state.over) showOver();
  }

  // ---- move preview: ghost of the resulting item, merged tiles outlined, plus a one-line explanation
  function updatePreview() {
    cells.forEach(function (c) {
      c.classList.remove('pv', 'eat', 'target', 'pick', 'spot');
      if (c.hasAttribute('data-pv')) c.removeAttribute('data-pv');
    });
    var note = '', hot = false, pi = sel >= 0 ? sel : (previewOn ? hover : -1), p;
    if (state.over) note = '';
    else if (mode === 'trap') {
      if (pi >= 0 && isAnimal(state.grid[pi])) {
        cells[pi].classList.add('target');
        var tr = TT.trap(state, pi);
        var res = tr ? tr.state.grid[pi] : TT.TOMB;
        note = (sel === pi ? 'Tap again to trap' : 'Trap') + ' the ' + nm(state.grid[pi]) + ' -> ' + nm(res) + ' (-' + TT.PRICE.trap + ' coins)';
        hot = sel === pi;
      } else note = '🪤 Tap a bear or fox to kill it';
    } else if (mode === 'pond') {
      var pp = TT.pondPrice(state);
      if (pi >= 0 && targetOk(pi)) {
        cells[pi].classList.add('target');
        note = (sel === pi ? 'Tap again to dig' : 'Dig') + ' a pond here (-' + pp + ' coins, +' + TT.pondPoints(Object.assign({}, state, { ponds: state.ponds.concat([pi]) })) + ' pts per turn)'; hot = sel === pi;
      } else note = '💧 Tap an empty tile to dig a pond (-' + pp + ' coins)';
    } else if (mode === 'bridge') {
      var spots = TT.bridgeSpots(state), bp = TT.bridgePrice(state);
      spots.forEach(function (i) { cells[i].classList.add('spot'); });
      if (pi >= 0 && spots.indexOf(pi) >= 0) {
        cells[pi].classList.add('target');
        note = (sel === pi ? 'Tap again to build' : 'Build') + ' a bridge here (-' + bp + ' coins)'; hot = sel === pi;
      } else note = '🌉 Tap a glowing water tile to bridge it (-' + bp + ' coins)';
    } else if (mode === 'move') {
      if (moveFrom < 0) {
        if (pi >= 0 && TT.isMovable(state.grid[pi])) { cells[pi].classList.add('target'); note = '🚚 Pick up the ' + nm(state.grid[pi]); }
        else note = '🚚 Tap an item to pick it up (-' + TT.PRICE.move + ' coins when you drop it)';
      } else {
        cells[moveFrom].classList.add('pick');
        if (pi >= 0 && state.grid[pi] === 0 && (p = TT.previewMove(state, moveFrom, pi))) {
          cells[pi].classList.add('pv'); cells[pi].setAttribute('data-pv', em(p.final));
          p.eaten.forEach(function (i) { cells[i].classList.add('eat'); });
          var mv = sel === pi ? 'Tap again to ' : '';
          note = p.merged
            ? (mv ? mv + 'move and merge' : 'Moves and merges') + ' into ' + nm(p.final) + gain(p)
            : (mv ? mv + 'drop' : 'Drop') + ' the ' + nm(state.grid[moveFrom]) + ' here (-' + TT.PRICE.move + ' coins)';
          hot = sel === pi;
        } else note = '🚚 Tap an empty tile to drop the ' + nm(state.grid[moveFrom]) + ' (tap it again to put it down)';
      }
    } else if (mode === 'hammer') {
      if (pi >= 0 && targetOk(pi)) {
        cells[pi].classList.add('target');
        note = (lastPointer !== 'mouse' && sel === pi ? 'Tap again to smash ' : 'Smash ') + nm(state.grid[pi]) + ' (-' + TT.PRICE.hammer + ' coins)';
        hot = sel === pi;
      } else note = pi >= 0 && lockedNow[pi] ? '🔒 Locked by a loan: repay it first' : pi >= 0 && state.grid[pi] === TT.SEIZED ? '🏚️ A seized lot: pay the debt to free the tile' : '🔨 Tap an item to remove it';
    } else if (pi >= 0 && isCollectible(state.grid[pi])) {
      var cash = state.grid[pi] === TT.CASH;
      note = (cash ? '💵 Click to collect the cash: +' + TT.CASH_COINS : '💰 Click to open the treasure: +' + TT.TREASURE_COINS) + ' coins'; hot = true;
    } else if (TT.freeCount(state) === 0) {
      note = 'Board full - use the 🔨 hammer (' + TT.PRICE.hammer + ' coins) or buy land'; hot = true;
    } else if (previewOn && pi >= 0 && (p = TT.preview(state, pi))) {
      cells[pi].classList.add('pv'); cells[pi].setAttribute('data-pv', em(p.final));
      p.eaten.forEach(function (i) { cells[i].classList.add('eat'); });
      var verb = sel === pi ? 'Tap again to ' : '';
      note = p.merged
        ? (verb ? verb + 'merge' : 'Merges') + ' into ' + nm(p.final) + gain(p)
        : (verb ? verb + 'place ' : 'Place ') + nm(state.cur) + ' here';
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
          gh.className = 'ghost'; gh.textContent = em(ev.from);
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
      } else if (ev.type === 'bridge') { // planks slide in; the price just paid is the one before the current next price
        cells[ev.at].classList.add('built');
        floatAt(ev.at, '🌉 -' + TT.BRIDGE_PRICE[state.bridges.length - 1] + '🪙');
      } else if (ev.type === 'pond') {
        cells[ev.at].classList.add('drop');
        floatAt(ev.at, '💧 -' + fmt(ev.price) + '🪙');
      } else if (ev.type === 'lake') {
        toast('🏞️ ' + ev.size + '×' + ev.size + ' lake! +' + fmt(ev.coins) + ' coins, +' + fmt(ev.points) + ' points', 0.3);
      } else if (ev.type === 'pondpts') {
        if (state.ponds.length) floatAt(state.ponds[0], '💧 +' + fmt(ev.points));
      } else if (ev.type === 'cub') { // a bear cub is born in the pen
        cells[ev.at].classList.add('drop');
        floatAt(ev.at, '🍼');
      } else if (ev.type === 'growl') { // the boxed-in bear gets angrier
        cells[ev.at].classList.add('shake');
        floatAt(ev.at, ev.level === 1 ? '💢' : '💢💢');
      } else if (ev.type === 'maul') { // it takes it out on the building next to it
        cells[ev.at].classList.add('shake'); cells[ev.bear].classList.add('shake');
        floatAt(ev.at, em(TT.BEAR) + '💢 ' + em(ev.from) + '→' + (ev.to ? em(ev.to) : '💨'));
      } else if (ev.type === 'loan') {
        floatAt(ev.at, '🏦 +' + fmt(ev.coins) + '🪙'); cells[ev.at].classList.add('shake');
      } else if (ev.type === 'repay') {
        floatAt(ev.at, ev.freed ? '🏚️ → free' : '🔓 -' + fmt(ev.coins) + '🪙');
      } else if (ev.type === 'default') {
        cells[ev.at].classList.add('shake'); floatAt(ev.at, '🏚️');
        toast('🏚️ A loan ran out: the ' + em(ev.tier) + ' and its tile were seized!', 0.25);
      } else if (ev.type === 'bankpay') {
        var bk = state.grid.indexOf(TT.BANK);
        if (bk >= 0) { floatAt(bk, '🏦 +' + fmt(ev.coins) + '🪙'); cells[bk].classList.add('drop'); }
      } else if (ev.type === 'bonus') {
        toast('🪤 A free trap!', 0.2);
      } else if (ev.type === 'unlock') {
        toast('🛒 Shop restocked!');
      } else if (ev.type === 'tierunlock') {
        toast(em(ev.tier) + ' ' + nm(ev.tier) + ' unlocked in the shop!', 0.35);
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
  // tiles (camp .. village), ghosts and black cats on the tombstone / church / cathedral tiles, swans and fish on the water. Each critter belongs to ONE
  // tile and only wanders inside it; if its tile goes away it is re-homed on another matching tile.
  var AREAS = [
    { codes: [4, 5, 6, 7], kinds: ['🐇', '🐤'] },
    { codes: [TT.TOMB, TT.CHURCH, TT.CATHEDRAL], kinds: ['👻', '🐈\u200d⬛'] },
    { codes: [TT.WATER], kinds: ['🦢', '🐟'] }
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
    critters.slice().forEach(function (c) { if (c.area.kinds.indexOf(c.kind) < 0) { c.el.remove(); critters.splice(critters.indexOf(c), 1); } }); // another season's animals leave
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
  // Next <-> Place: a free swap of the two upcoming items (no turn passes)
  function swapNextItems() {
    var s = TT.swapNext(state);
    if (!s) return;
    state = s; save(); render([]);
    var panel = document.querySelector('.panel');
    panel.classList.remove('swapped'); void panel.offsetWidth; panel.classList.add('swapped');
  }
  $('nextBtn').addEventListener('click', swapNextItems);
  $('swapBtn').addEventListener('click', swapNextItems);
  $('holdBtn').addEventListener('click', function () {
    var s = TT.swap(state);
    if (s) { state = s; save(); render([]); }
    else if (state.cur === TT.BANK) toast('🏦 A bank cannot go in the reserve');
  });
  document.querySelectorAll('.tool[data-tool]').forEach(function (b) { // trap, hammer and mover (the item shop is built in buildShop)
    var t = b.dataset.tool;
    if (t !== 'bridge' && t !== 'pond') b.querySelector('.tp').textContent = '🪙' + TT.PRICE[t];
    b.addEventListener('click', function () { mode = mode === t ? null : t; sel = -1; moveFrom = -1; render([]); closeShop(); });
  });
  document.querySelectorAll('.land').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = TT.buyLand(state, b.dataset.land);
      if (r) { state = r.state; sel = -1; hover = -1; save(); render(r.events); vibrate(15); closeShop(); }
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
  // New game: pick the map and the bear mode in a small dialog (the last picks are remembered); Play again repeats both
  var dlg = { map: 'easy', bears: 'classic', foxes: true };
  // sample maps: the real generator with fixed seeds, drawn as tiny boards (water blue, plants as emoji). Easy and Medium are the same every game.
  var SAMPLE_SEEDS = { easy: [1], standard: [3, 8, 21], medium: [1], hard: [4, 9, 17] }, CARD_SEED = { easy: 1, standard: 3, medium: 1, hard: 4 };
  function miniMap(map, seed, into) {
    var g = TT.newGame(seed, { map: map }).grid;
    into.textContent = '';
    g.forEach(function (v) {
      var c = document.createElement('span');
      if (v === TT.WATER) c.className = 'w'; else if (v) c.textContent = em(v);
      into.appendChild(c);
    });
    return into;
  }
  function buildCards() { document.querySelectorAll('#newGame .mapcard').forEach(function (b) { miniMap(b.dataset.map, CARD_SEED[b.dataset.map], b.querySelector('.mini')); }); }
  buildCards();
  function showSamples() {
    var box = $('mapSamples');
    box.textContent = '';
    SAMPLE_SEEDS[dlg.map].forEach(function (seed) { var m = document.createElement('div'); m.className = 'mini'; box.appendChild(miniMap(dlg.map, seed, m)); });
  }
  function skinLabels() { // the New game buttons show this season's animals
    var wild = document.querySelector('#newGame .opt[data-bears="wild"]'), fox = document.querySelector('#newGame .opt[data-foxes="on"]');
    wild.textContent = em(TT.BEAR) + ' Wild bears'; fox.textContent = em(TT.FOX) + ' Foxes';
  }
  function showDialog() {
    skinLabels();
    document.querySelectorAll('#newGame .opt[data-map]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.map === dlg.map); });
    document.querySelectorAll('#newGame .opt[data-bears]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.bears === dlg.bears); });
    document.querySelectorAll('#newGame .opt[data-foxes]').forEach(function (b) { b.setAttribute('aria-pressed', (b.dataset.foxes === 'on') === dlg.foxes); });
    $('mapNote').textContent = MAP_NOTES[dlg.map];
    showSamples();
    $('foxNote').textContent = dlg.foxes ? 'Foxes warp around the board; walls or a full box trap them.' : 'No foxes in the item queue.';
    $('bearNote').textContent = dlg.bears === 'off' ? 'No bears in the item queue' + (dlg.foxes ? '.' : ' (calm mode: no animals at all, nothing to interrupt you).') : dlg.bears === 'wild' ? 'Boxed-in bears growl, get angry, then maul a 🌱🌿🌳🏕️🛖 next to them (one tier down). Bears breed in small pens. Own best scores.' : 'Bears wander and get trapped into tombstones.';
  }
  var MAP_NOTES = { easy: 'A plain grass field.', standard: 'A plain field with a few grass, bushes and trees already growing (different every game, e.g. these).', medium: 'A river runs across the field and splits it in two (the same map every game).', hard: 'Random ponds eat into the field (different every game, e.g. these).' };
  function openNewGame() {
    dlg.map = mapPref(); dlg.bears = !bearsPref() ? 'off' : wildPref() ? 'wild' : 'classic'; dlg.foxes = foxesPref();
    // a game in progress would be erased: say so loudly, with what is at stake, and make the button say it too
    var inProgress = !state.over && state.turn > 0, warn = $('newWarn');
    warn.classList.toggle('hidden', !inProgress);
    if (inProgress) warn.textContent = '⚠️ Your current game will be lost: score ' + state.score + ' · turn ' + state.turn + (state.map !== 'easy' ? ' · ' + state.map + ' map' : '') + modeLabel(state) + '. This cannot be undone.';
    $('newStart').textContent = inProgress ? 'Erase game & start' : 'Start';
    $('newStart').classList.toggle('danger', inProgress); $('newStart').classList.toggle('primary', !inProgress);
    showDialog();
    $('newGame').classList.remove('hidden');
  }
  document.querySelectorAll('#newGame .opt[data-map]').forEach(function (b) { b.addEventListener('click', function () { dlg.map = b.dataset.map; showDialog(); }); });
  document.querySelectorAll('#newGame .opt[data-bears]').forEach(function (b) { b.addEventListener('click', function () { dlg.bears = b.dataset.bears; showDialog(); }); });
  document.querySelectorAll('#newGame .opt[data-foxes]').forEach(function (b) { b.addEventListener('click', function () { dlg.foxes = b.dataset.foxes === 'on'; showDialog(); }); });
  $('newStart').addEventListener('click', function () {
    store.set('tt-map', dlg.map); store.set('tt-wild', dlg.bears === 'wild'); store.set('tt-bears', dlg.bears !== 'off'); store.set('tt-foxes', dlg.foxes);
    $('newGame').classList.add('hidden');
    startNew(0, { wild: dlg.bears === 'wild', map: dlg.map, bears: dlg.bears !== 'off', foxes: dlg.foxes });
  });
  $('shopBtn').addEventListener('click', openShop);
  $('shopClose').addEventListener('click', closeShop);
  $('shopSheet').addEventListener('click', function (e) { if (e.target === this) closeShop(); }); // a tap on the dimmed background
  $('toolCancel').addEventListener('click', function () { mode = null; moveFrom = -1; sel = -1; render([]); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('tour').classList.contains('hidden')) endTour(); else closeShop();
  });
  $('newBtn').addEventListener('click', function () { closeShop(); openNewGame(); });
  $('newCancel').addEventListener('click', function () { $('newGame').classList.add('hidden'); });
  $('againBtn').addEventListener('click', function () { startNew(0, { wild: state.wild, map: state.map, bears: state.bears, foxes: state.foxes }); });
  // item guide: built from the logic tables so it can never drift from the real merge chains
  function chip(code, label) {
    return '<div class="chip"><span class="ce">' + em(code) + '</span><small>' + (label || nm(code)) + '</small></div>';
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
  function buildGuide() {
  $('guideBody').innerHTML =
    '<h3>Buildings</h3><div class="chain">' + chain(1, null, 'cash (final)') + '</div>' +
    '<p class="gnote">💵 Cash is collectible: tap it for +' + TT.CASH_COINS + ' coins. ' + CRITTERS[curSeason].home.join('') + ' hop around the homes (camp to village).</p>' +
    '<h3>Bears</h3><div class="chain">' + chip(TT.BEAR, 'trap it') + '<span class="arrow">&rarr;</span>' +
    chain(TT.TOMB, null, 'treasure: tap to open, +' + TT.TREASURE_COINS + ' coins') + '</div>' +
    '<p class="gnote">👻🐈‍⬛ haunt the tombstones and churches. <b>Wild bears</b> mode: a bear that cannot step but is not sealed in gets angry (💢, then 💢💢) and on the third turn mauls a 🌱🌿🌳🏕️🛖 next to it, one tier down (a 🌱 is destroyed), then starts over. In a small pen (4 to 6 tiles) with 2 bears and 2 free tiles, a cub is sometimes born (🍼). Blue tiles are <b>water</b>: nothing can be placed, merged, moved or smashed there, and animals cannot cross it. A 🌉 <b>bridge</b> (up to 5, dearer each time) turns a water tile that has land on both sides into a road bears can walk over; nothing can be built on it.</p>' +
    '<h3>Special</h3><div class="chain">' + chip(TT.CRYSTAL, 'wildcard') + chip(TT.FOX, 'warps, walls trap it') + '</div>' +
    '<h3>Bank</h3><div class="chain">' + chip(TT.BANK, 'pays every turn') + '<span class="arrow">&rarr;<small>x3</small></span>' + chip(TT.CASH, 'cash') + '</div>' +
    '<p class="gnote">🏦 A <b>bank</b> is sold in the shop once you have built a village. It is a dead tile (animals and the mover cannot touch it, only the hammer breaks it), cannot go in the reserve, and pays you coins every turn (more at higher clock speed; the 📅 date is at the top). At most 3; each is dearer. Three connected banks merge into 💵 cash.</p>' +
    '<p class="gnote">💸 <b>Loans</b>: tap a bank to borrow half the shop price of the dearest building next to it. That building and the bank are 🔒 locked (no merging, moving or smashing) until you repay the loan plus simple interest: 15% a year at the first bank, 30% at the second, 60% at the third. A year unpaid and the building is gone and its tile becomes a 🏚️ seized lot (a dead tile; the bank stops paying) until you pay the debt. ⏱ The clock speed (shown once you own a bank) decides how many ticks a turn adds: faster means income, interest and the deadline all come sooner; paused stops them all.</p>' +
    '<p class="gnote">💎 stands in for any tier, including 🏬 (making 💵 cash) and 🕌 (making a 💰 treasure). Three or more 💎 touching each other merge into a 💰 treasure. 🚚 moves one item to an empty tile for coins.</p>' +
    '<p class="gnote">🍂 The animals follow the season: bear and fox are ' + SKINS.autumn.bear[0] + ' ' + SKINS.autumn.fox[0] + ' in autumn and ' + SKINS.winter.bear[0] + ' ' + SKINS.winter.fox[0] + ' in winter (now: ' + em(TT.BEAR) + ' ' + em(TT.FOX) + '). Only the looks change.</p>' +
    '<p class="gnote">Three or more connected items of the same kind merge into the next one. Bigger groups pay more points and coins.</p>' +
    '<p class="gnote">🍀 <b>Lucky drops</b>: once you have built a higher tier, the next item is sometimes a free 🏕️ 🛖 or 🏠 (a tier below your best, never above a house). Most often on Easy, rarer on Standard and Medium, never on Hard.</p>';
  }
  buildGuide();
  $('bankBorrow').addEventListener('click', function () {
    var r = TT.borrow(state, bankAt);
    if (r) { state = r.state; save(); render(r.events); vibrate(15); }
  });
  $('bankClose').addEventListener('click', closeBank);
  $('bankDlg').addEventListener('click', function (e) { if (e.target === this) closeBank(); });
  $('speedLink').addEventListener('click', function (e) {
    e.preventDefault();
    var s = TT.setSpeed(state, state.speed === 0 ? 1 : (state.speed + 1) % 4); // 1x -> 2x -> 3x -> paused -> 1x
    if (s) { state = s; save(); render([]); }
  });
  function openFirstLoanBank() { if (state.loans.length) openBank(state.loans[0].bank); }
  $('loanLine').addEventListener('click', openFirstLoanBank);
  $('loanLine').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFirstLoanBank(); } });
  $('questLine').addEventListener('click', openShop);
  $('questLine').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShop(); } });
  // "Get the latest version": drop the service worker and its caches, then reload. The saved game lives in localStorage, which is not touched.
  $('updateLink').addEventListener('click', function (e) {
    e.preventDefault();
    this.textContent = 'Updating…';
    var jobs = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  });
  $('guideLink').addEventListener('click', function (e) { e.preventDefault(); $('guide').classList.remove('hidden'); });
  $('guideClose').addEventListener('click', function () { $('guide').classList.add('hidden'); });
  $('hapticLink').addEventListener('click', function (e) {
    e.preventDefault();
    haptics = !haptics; store.set('tt-haptics', haptics); showHaptics();
    vibrate(20); // switching it on gives a sample buzz
  });
  showHaptics();
  $('seasonLink').addEventListener('click', function (e) {
    e.preventDefault();
    season = SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length]; store.set('tt-season', season); applySeason();
    shopKey = ''; buildGuide(); buildCards(); render([]); // the plant emojis and critters follow the season
  });
  applySeason();
  buildGuide(); buildCards(); // the first build ran before the season was known
  $('helpLink').addEventListener('click', function (e) { e.preventDefault(); $('help').classList.remove('hidden'); });
  $('helpClose').addEventListener('click', function () { $('help').classList.add('hidden'); store.set('tt-seen-help', 1); });

  // ---- first-run guided tour: spotlights each control in turn (opening the shop sheet for its contents) with a short explanation.
  // It starts on the very first game and from "How to play"; Skip / Done / Escape end it and remember that it was seen.
  var TOUR = [
    { title: '👋 Welcome to Triple Three', text: 'Put the item shown in <b>Place</b> on the map. When <b>3 or more of the same item touch</b> (up, down, left, right) they merge into ONE of the next kind, on the tile you tapped: 🌱 → 🌿 → 🌳 → 🏕️ → … → 💵.<br>This quick tour explains every button. You can skip it any time.' },
    { target: '#boardWrap', title: '🗺️ The map', text: 'Tap a tile to <b>preview</b> what would happen, tap the same tile again to <b>place</b> the item. (With a mouse: hover to preview, click once.) 🐻 bears wander and become 🪦 tombstones when they get boxed in; three 🪦 merge into ⛪.' },
    { target: '.panel', title: '🌱 Place and Next', text: '<b>Place</b> is the item you will put down now, <b>Next</b> is the one after it. <b>Tap the ⇄ button between them to swap them</b> (tapping the Next item works too): free, as often as you like.' },
    { target: '#holdBtn', title: '📦 Reserve', text: 'Store the current item here for later. Tap it again to swap with what is stored. Also free.' },
    { target: '.hud .stat', title: '⭐ Score and coins', text: 'Every merge adds to your <b>score</b> and pays 🪙 <b>coins</b> (bigger groups pay more). Coins buy things in the shop. <b>Best</b> is your top score on this map.' },
    { target: '#newBtn', title: '⟳ New game', text: 'Starts a new game: choose the <b>map</b> (Easy, Standard, Medium, Hard) the <b>bear mode</b> (Classic, Wild or No bears) and whether <b>foxes</b> appear. Switch both animals off for a calm game. It erases the game you are playing, and warns you first.' },
    { target: '.topinfo', title: '📋 Turn, rules and settings', text: 'The turn counter with the 📅 calendar and, once you own a bank, the ⏱ clock speed (tap to cycle 1×, 2×, 3×, paused) (10 turns = a month, 12 months = a year) and game seed, <b>How to play</b> (the rules and this tour), the <b>Item guide</b> (every item and what it merges into), the <b>🎨 Season</b> theme (Auto follows the calendar; tap to cycle spring, summer, autumn, winter), the 🏞️ <b>lake quest</b> line (tap it to open the shop) and, on phones with vibration, the <b>📳 Haptics</b> switch.' },
    { target: '#undoBtn', title: '↶ Undo', text: 'Takes back your last move. It costs a few coins, and only one move can be undone.' },
    { target: '#previewBtn', title: '👁 Preview', text: 'Shows what a tap would do before you place. Turn it off to place with a single tap.' },
    { target: '#shopBtn', title: '🛒 Shop', text: 'Opens the shop. Everything you can spend coins on is in there.', when: function () { return $('shopBtn').offsetParent !== null; } },
    { target: '#shop', sheet: true, title: '🏠 Buy an item', text: 'Buy a building and it becomes your item to place right away. The little number is the stock left; after that the price <b>doubles</b> each time. Higher kinds unlock once you have built them.' },
    { target: '#trapBtn', sheet: true, title: '🪤 Trap', text: 'Kills a bear or fox on the spot: it turns into a 🪦 right away. Tap the tool, then the animal.', when: function () { return !$('trapBtn').hidden; } },
    { target: '#hammerBtn', sheet: true, title: '🔨 Hammer', text: 'Smashes any item you have placed, to make room. Tap the tool, then the item.' },
    { target: '#moveBtn', sheet: true, title: '🚚 Mover', text: 'Picks up one item and drops it on another empty tile, where it merges like a placed item. Bears and foxes cannot be moved.' },
    { target: '#bridgeBtn', sheet: true, title: '🌉 Bridge', text: 'On maps with water: turns a water tile that has land on both sides into a road bears can cross. Glowing tiles show where it can go. Up to 5, dearer each time.', when: function () { return !$('bridgeBtn').hidden; } },
    { target: '.tools.shop .tool[data-tool="22"]', sheet: true, title: '🏦 Bank', text: 'Appears once you have built a village. A bank is placed like an item, is a dead tile that animals cannot cross, and pays <b>coins every turn</b> (the 📅 calendar at the top counts 10 turns to a month). At most 3, dearer each time; it cannot go in the reserve. Three connected banks merge into 💵 cash.', when: function () { return !!document.querySelector('.tools.shop .tool[data-tool="22"]'); } },
    { target: '#speedLink', title: '⏱ Clock speed', text: 'Appears once you own a bank. Each turn adds this many ticks to the calendar (10 ticks = a month): faster means bank income per turn, loan interest and the repayment deadline all come sooner; paused stops them all. Tap to cycle 1×, 2×, 3×, paused. <b>Tap a bank</b> on the map to borrow against the dearest building next to it.', when: function () { return !$('speedBox').hidden; } },
    { target: '#pondBtn', sheet: true, title: '💧 Pond', text: 'Digs a pond on an empty tile. It takes the tile for good, but pays <b>points every turn</b>, and dearer ponds pay more in total. Dig a 2×2, then 3×3 and 4×4 block of water for <b>lake quests</b>: each pays coins and points (see the line under the tools, and at the top of the screen).' },
    { target: '.tool.land', sheet: true, title: '⬆️⬇️⬅️➡️ Land', text: 'Adds one more row or column on that side of the map (each side once, dearer every time). Water that touches that edge carries on into it. Handy when the map is nearly full.' },
    { title: '🎉 You are ready', text: 'The <b>Item guide</b> at the top lists every item and what it merges into, and <b>How to play</b> repeats the rules and this tour. Your game is saved automatically. Have fun!' }
  ];
  var tourSteps = [], tourAt = 0, tourDir = 1;
  function tourRect(sel) {
    var l = 1e9, t = 1e9, r = -1, b = -1;
    document.querySelectorAll(sel).forEach(function (el) {
      var q = el.getBoundingClientRect();
      if (q.width > 0 && q.height > 0) { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    });
    return r > 0 ? { l: l, t: t, r: r, b: b } : null;
  }
  function placeTour() {
    var st = tourSteps[tourAt], tour = $('tour'), hole = $('tourHole'), card = $('tourCard'), vw = window.innerWidth, vh = window.innerHeight;
    var rc = st.target ? tourRect(st.target) : null, pad = 6;
    tour.classList.toggle('nohole', !rc);
    var cw = card.offsetWidth, ch = card.offsetHeight, left, top;
    if (!rc) { left = (vw - cw) / 2; top = Math.max(8, (vh - ch) / 2); }
    else {
      hole.style.left = rc.l - pad + 'px'; hole.style.top = rc.t - pad + 'px';
      hole.style.width = rc.r - rc.l + pad * 2 + 'px'; hole.style.height = rc.b - rc.t + pad * 2 + 'px';
      var below = vh - (rc.b + pad), above = rc.t - pad;
      top = below >= ch + 14 ? rc.b + pad + 10 : above >= ch + 14 ? rc.t - pad - ch - 10 : (above > below ? 8 : vh - ch - 8);
      left = Math.min(Math.max(8, (rc.l + rc.r) / 2 - cw / 2), vw - cw - 8);
    }
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }
  function showTour() {
    var st = tourSteps[tourAt], last = tourAt === tourSteps.length - 1;
    if (st.sheet) openShop(); else closeShop();
    $('tourStep').textContent = 'Step ' + (tourAt + 1) + ' of ' + tourSteps.length;
    $('tourTitle').innerHTML = st.title; $('tourText').innerHTML = st.text;
    $('tourBack').hidden = tourAt === 0; $('tourSkip').hidden = last;
    $('tourNext').textContent = tourAt === 0 ? 'Start the tour' : last ? 'Done' : 'Next';
    $('tourHole').style.transition = 'none'; placeTour(); void $('tourHole').offsetWidth; $('tourHole').style.transition = '';
    setTimeout(function () { if (!$('tour').classList.contains('hidden')) placeTour(); }, st.sheet ? 320 : 30); // once the shop sheet has finished sliding up
  }
  function startTour() {
    closeShop(); sel = -1; mode = null; moveFrom = -1;
    tourSteps = TOUR.filter(function (st) { return !st.when || st.when(); });
    tourAt = 0; tourDir = 1;
    $('tour').classList.remove('hidden'); $('help').classList.add('hidden');
    showTour();
  }
  function endTour() { $('tour').classList.add('hidden'); closeShop(); store.set('tt-seen-help', 1); render([]); }
  $('tourNext').addEventListener('click', function () { if (tourAt >= tourSteps.length - 1) endTour(); else { tourAt++; showTour(); } });
  $('tourBack').addEventListener('click', function () { if (tourAt > 0) { tourAt--; showTour(); } });
  $('tourSkip').addEventListener('click', endTour);
  window.addEventListener('resize', function () { if (!$('tour').classList.contains('hidden')) placeTour(); });
  $('helpTour').addEventListener('click', startTour);

  // ---- start: ?#seed=N forces a reproducible game, otherwise resume the saved one
  var forced = seedFromHash();
  if (forced) startNew(forced);
  else {
    state = loadSaved();
    if (state) render([]); else startNew();
  }
  if (!store.get('tt-seen-help', 0) && state.turn === 0) startTour(); // first launch: the guided tour (How to play keeps the written rules)

  // test / debugging hooks (read-only view of the game)
  window.ttDebug = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    validate: function () { return TT.validate(state); },
    emoji: function (code) { return em(code); },
    name: function (code) { return nm(code); },
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
