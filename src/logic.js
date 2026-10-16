// Three Bears (emoji) - pure game logic. No DOM. States are plain JSON; every operation returns a new state.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var W = 6, H = 6, N = W * H;

  // Cell / item codes. 0 empty. 1..8 building chain. 9 bear, 10 tombstone, 11 church, 12 cathedral, 13 crystal, 14 treasure
  // (final tier of the bear chain: tap it to open it for coins).
  var EMPTY = 0, BEAR = 9, TOMB = 10, CRYSTAL = 13, TREASURE = 14;
  var EMOJI = ['', '🌱', '🌿', '🌳', '🛖', '🏠', '🏛️', '🏰', '🏯', '🐻', '🪦', '⛪', '🕌', '💎', '💰'];
  var NAME = ['empty', 'grass', 'bush', 'tree', 'hut', 'house', 'mansion', 'castle', 'grand castle', 'bear', 'tombstone', 'church', 'cathedral', 'crystal', 'treasure'];
  // code -> code it becomes when 3+ connect. Final tiers (8 grand castle, 12 cathedral), bear and crystal are absent.
  var NEXT = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 10: 11, 11: 12, 12: 14 };
  // points per item consumed by a merge, keyed by the consumed code
  var BASE = { 1: 10, 2: 30, 3: 90, 4: 270, 5: 810, 6: 2430, 7: 7290, 10: 150, 11: 1500, 12: 15000 };
  // item queue draw weights (sum 100): mostly grass, sometimes bush/tree/bear, rare crystal
  var WEIGHTS = [[1, 62], [2, 16], [3, 6], [BEAR, 12], [CRYSTAL, 4]];
  var QUEUE_ITEMS = [1, 2, 3, BEAR, CRYSTAL];
  // coins: earned per merge (COIN[consumed code] * (group size - 2)), spent in the shop (free actions, no turn passes)
  var START_COINS = 10;
  var COIN = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 30, 6: 60, 7: 120, 10: 20, 11: 100, 12: 500 };
  var TREASURE_COINS = 250; // paid when a treasure is opened
  var PRICE = { 1: 6, 2: 15, 3: 35, 13: 50, hammer: 20, trap: 12 };
  var BUYABLE = [1, 2, 3, CRYSTAL];
  var UNDO_COST = 5; // coins per undo
  // The shop has limited stock per game. Reaching a score milestone restocks it (the crystal only appears from the first one).
  var START_STOCK = { 1: 3, 2: 2, 3: 1, 13: 0, hammer: 2, trap: 2 };
  var MILESTONES = [400, 1200, 3000, 7000, 15000, 30000]; // after the last one a restock comes every 30000 more points
  var RESTOCK = { 1: 2, 2: 1, 3: 1, 13: 1, hammer: 1, trap: 1 };
  function milestoneScore(n) { return n < MILESTONES.length ? MILESTONES[n] : MILESTONES[MILESTONES.length - 1] * (n - MILESTONES.length + 2); }

  // ---- seeded RNG (mulberry32). The state is one uint32 kept inside the game state, so undo/replay is exact.
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    var t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(s, n) { return Math.floor(rand(s) * n); }
  function drawItem(s) {
    var r = randInt(s, 100), acc = 0;
    for (var i = 0; i < WEIGHTS.length; i++) { acc += WEIGHTS[i][1]; if (r < acc) return WEIGHTS[i][0]; }
    return 1;
  }

  function clone(s) {
    return { grid: s.grid.slice(), cur: s.cur, next: s.next, hold: s.hold, score: s.score, coins: s.coins, stock: Object.assign({}, s.stock), milestone: s.milestone, turn: s.turn,
      over: s.over, rng: s.rng, seed: s.seed, undo: s.undo };
  }

  function newGame(seed) {
    seed = (seed >>> 0) || 1;
    var s = { grid: new Array(N).fill(EMPTY), cur: 1, next: 1, hold: 0, score: 0, coins: START_COINS, stock: Object.assign({}, START_STOCK), milestone: 0, turn: 0, over: false, rng: seed, seed: seed, undo: null };
    s.next = drawItem(s); // always open with grass
    return s;
  }

  function neighbors(i) {
    var r = (i / W) | 0, c = i % W, out = [];
    if (r > 0) out.push(i - W);
    if (c > 0) out.push(i - 1);
    if (c < W - 1) out.push(i + 1);
    if (r < H - 1) out.push(i + W);
    return out;
  }

  // flood fill over orthogonally connected cells holding `code`, starting at `start`
  function group(grid, start, code) {
    var seen = {}, stack = [start], out = [];
    seen[start] = true;
    while (stack.length) {
      var i = stack.pop(); out.push(i);
      var nb = neighbors(i);
      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (!seen[j] && grid[j] === code) { seen[j] = true; stack.push(j); }
      }
    }
    return out;
  }

  // Resolve merges triggered at cell `at`, chaining while the result keeps matching. Mutates s.
  function resolveAt(s, at, events) {
    for (;;) {
      var code = s.grid[at];
      if (!NEXT[code]) return;
      var g = group(s.grid, at, code);
      if (g.length < 3) return;
      var pts = g.length * BASE[code], coins = (g.length - 2) * COIN[code];
      for (var k = 0; k < g.length; k++) s.grid[g[k]] = EMPTY;
      s.grid[at] = NEXT[code];
      s.score += pts; s.coins += coins;
      events.push({ type: 'merge', at: at, cells: g, from: code, to: NEXT[code], points: pts, coins: coins });
    }
  }

  // Item kinds a crystal can stand in for, best first: the bear chain (cathedral -> treasure, church, tombstone), then buildings.
  var CRYSTAL_AS = [12, 11, 10, 7, 6, 5, 4, 3, 2, 1];
  // Best kind the crystal at `at` could stand in for to form a 3+ group; 0 if none (grid is left unchanged).
  function crystalTier(grid, at) {
    var keep = grid[at], found = 0;
    for (var k = 0; k < CRYSTAL_AS.length && !found; k++) { var t = CRYSTAL_AS[k]; grid[at] = t; if (group(grid, at, t).length >= 3) found = t; }
    grid[at] = keep;
    return found;
  }

  // Every crystal on the board turns into the best item kind that merges at its cell; one that cannot merge yet
  // stays as an inert wildcard and is re-checked after every placement. `first` (the crystal just placed) goes first.
  function settleCrystals(s, events, first) {
    for (var again = true; again;) {
      again = false;
      var order = [], i;
      if (first !== undefined && s.grid[first] === CRYSTAL) order.push(first);
      for (i = 0; i < N; i++) if (s.grid[i] === CRYSTAL && i !== first) order.push(i);
      for (var k = 0; k < order.length && !again; k++) {
        var t = crystalTier(s.grid, order[k]);
        if (t) { s.grid[order[k]] = t; events.push({ type: 'crystal', at: order[k], as: t }); resolveAt(s, order[k], events); again = true; }
      }
    }
  }

  // Put `item` on empty cell idx and resolve every merge it causes (no bear movement). Mutates s.
  function applyItem(s, idx, item, events) {
    s.grid[idx] = item;
    if (item === CRYSTAL) settleCrystals(s, events, idx);
    else { resolveAt(s, idx, events); settleCrystals(s, events); }
  }

  // Each bear takes one random step into an empty neighbour; a bear with none is trapped and becomes a tombstone.
  function moveBears(s, events) {
    var bears = [], trapped = [], i;
    for (i = 0; i < N; i++) if (s.grid[i] === BEAR) bears.push(i);
    bears.forEach(function (from) {
      var free = neighbors(from).filter(function (j) { return s.grid[j] === EMPTY; });
      if (!free.length) { s.grid[from] = TOMB; trapped.push(from); events.push({ type: 'trapped', at: from }); return; }
      var to = free[randInt(s, free.length)];
      s.grid[from] = EMPTY; s.grid[to] = BEAR;
      events.push({ type: 'bear', from: from, to: to });
    });
    trapped.forEach(function (at) { if (s.grid[at] === TOMB) resolveAt(s, at, events); });
  }

  function emptyCount(grid) { var n = 0; for (var i = 0; i < N; i++) if (grid[i] === EMPTY) n++; return n; }
  // A full board only ends the game when the player cannot afford a hammer to clear a tile.
  function canHammer(s) { return s.coins >= PRICE.hammer && s.stock.hammer > 0; }
  function isOver(s) { return emptyCount(s.grid) === 0 && !canHammer(s); }
  // Score milestones restock the shop. Mutates s.
  function grantMilestones(s, events) {
    while (s.score >= milestoneScore(s.milestone)) {
      s.milestone++;
      for (var k in RESTOCK) s.stock[k] = (s.stock[k] || 0) + RESTOCK[k];
      events.push({ type: 'unlock', milestone: s.milestone });
    }
  }

  // Play one turn: put s.cur on empty cell idx. Returns {state, events}, or null if the move is illegal.
  function place(state, idx) {
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== EMPTY) return null;
    var s = clone(state), events = [], item = s.cur;
    s.undo = clone(state); s.undo.undo = null; // one level of undo, no nesting
    events.push({ type: 'place', at: idx, item: item });
    applyItem(s, idx, item, events);
    moveBears(s, events);
    settleCrystals(s, events); // new tombstones / churches may complete a group for a waiting crystal
    grantMilestones(s, events);
    s.cur = s.next; s.next = drawItem(s); s.turn++;
    if (isOver(s)) { s.over = true; events.push({ type: 'over', score: s.score }); }
    return { state: s, events: events };
  }

  // Swap the current item with the storage slot (free action). Empty slot: store it and advance the queue.
  function swap(state) {
    if (state.over) return null;
    var s = clone(state);
    if (!s.hold) { s.hold = s.cur; s.cur = s.next; s.next = drawItem(s); }
    else { var t = s.cur; s.cur = s.hold; s.hold = t; }
    return s;
  }

  // Shop: swap the current item for a bought one (cost in coins, free action). The old current item becomes `next`;
  // the old `next` is discarded. Returns a new state or null (cannot afford, not sold, already current, game over).
  function buy(state, item) {
    if (state.over || BUYABLE.indexOf(item) < 0 || state.coins < PRICE[item] || !(state.stock[item] > 0) || state.cur === item) return null;
    var s = clone(state);
    s.coins -= PRICE[item]; s.stock[item]--; s.next = s.cur; s.cur = item;
    return isOver(s) ? null : s; // never let a purchase strand a full board without hammer money
  }

  // Shop: the hammer removes whatever stands on cell idx (free action, costs coins). Returns {state, events} or null.
  function hammer(state, idx) {
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] === EMPTY || !canHammer(state)) return null;
    var s = clone(state), item = s.grid[idx];
    s.grid[idx] = EMPTY; s.coins -= PRICE.hammer; s.stock.hammer--; s.over = isOver(s);
    return { state: s, events: [{ type: 'hammer', at: idx, item: item }] };
  }

  // Open the treasure on cell idx: it disappears and pays TREASURE_COINS (free action). Returns {state, events} or null.
  function open(state, idx) {
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== TREASURE) return null;
    var s = clone(state);
    s.grid[idx] = EMPTY; s.coins += TREASURE_COINS;
    return { state: s, events: [{ type: 'open', at: idx, coins: TREASURE_COINS }] };
  }

  // Shop: the bear trap kills the bear on cell idx on the spot: it becomes a tombstone (which may merge into a church
  // right away). Free action, costs coins. Returns {state, events} or null (no bear there, too poor, or it would
  // leave a full board without hammer money).
  function trap(state, idx) {
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== BEAR || state.coins < PRICE.trap || !(state.stock.trap > 0)) return null;
    var s = clone(state), events = [{ type: 'trap', at: idx }];
    s.coins -= PRICE.trap; s.stock.trap--; s.grid[idx] = TOMB;
    resolveAt(s, idx, events);
    settleCrystals(s, events);
    grantMilestones(s, events);
    s.over = isOver(s);
    return s.over ? null : { state: s, events: events };
  }

  // What would placing the current item at idx do? Pure (no bear movement, no rng use). Returns null for an illegal move,
  // else {item, final (code left on idx), eaten (other cells emptied by merges), points, coins, merged}.
  function preview(state, idx) {
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== EMPTY) return null;
    var s = clone(state), events = [], eaten = [], pts = 0, coins = 0;
    applyItem(s, idx, s.cur, events);
    for (var i = 0; i < N; i++) if (i !== idx && state.grid[i] !== EMPTY && s.grid[i] === EMPTY) eaten.push(i);
    events.forEach(function (e) { if (e.type === 'merge') { pts += e.points; coins += e.coins; } });
    return { item: state.cur, final: s.grid[idx], eaten: eaten, points: pts, coins: coins, merged: pts > 0 };
  }

  // Undo is possible when there is a snapshot and the player can pay UNDO_COST (taken from the restored coins).
  function canUndo(state) { return !!state.undo && state.undo.coins >= UNDO_COST; }

  // Revert the last placement (one level, including any shop use / swap made since) for UNDO_COST coins.
  // Returns null if there is nothing to undo or the player cannot pay.
  function undo(state) {
    if (!canUndo(state)) return null;
    var s = clone(state.undo);
    s.undo = null; s.coins -= UNDO_COST; s.over = isOver(s);
    return s;
  }

  // Fill in fields that older saves lack (coins, stock, milestone) on s and its undo snapshot. Mutates s.
  function migrate(s) {
    [s, s && s.undo].forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      if (typeof x.coins !== 'number') x.coins = START_COINS;
      if (!x.stock || typeof x.stock !== 'object') x.stock = Object.assign({}, START_STOCK);
      if (typeof x.milestone !== 'number') { x.milestone = 0; while (x.score >= milestoneScore(x.milestone)) x.milestone++; }
    });
    return s;
  }

  // Returns a list of problems (empty = valid). Used by tests and before restoring a saved game.
  function validate(s) {
    var p = [], i;
    if (!s || !Array.isArray(s.grid) || s.grid.length !== N) return ['bad grid'];
    for (i = 0; i < N; i++) {
      var v = s.grid[i];
      if (v !== (v | 0) || v < 0 || v > TREASURE) p.push('bad code at ' + i + ': ' + v);
    }
    if (p.length) return p;
    if (QUEUE_ITEMS.indexOf(s.cur) < 0) p.push('bad current item ' + s.cur);
    if (QUEUE_ITEMS.indexOf(s.next) < 0) p.push('bad next item ' + s.next);
    if (s.hold && QUEUE_ITEMS.indexOf(s.hold) < 0) p.push('bad hold ' + s.hold);
    if (typeof s.score !== 'number' || s.score < 0 || s.score !== (s.score | 0)) p.push('bad score ' + s.score);
    if (typeof s.coins !== 'number' || s.coins < 0 || s.coins !== (s.coins | 0)) p.push('bad coins ' + s.coins);
    if (!s.stock || typeof s.stock !== 'object') return ['bad stock'];
    for (var sk in START_STOCK) if (!(s.stock[sk] >= 0) || s.stock[sk] !== (s.stock[sk] | 0)) p.push('bad stock ' + sk + ': ' + s.stock[sk]);
    if (!(s.milestone >= 0) || s.milestone !== (s.milestone | 0)) p.push('bad milestone ' + s.milestone);
    else if (s.score < (s.milestone ? milestoneScore(s.milestone - 1) : 0) || s.score >= milestoneScore(s.milestone)) p.push('milestone ' + s.milestone + ' inconsistent with score ' + s.score);
    if (p.length) return p;
    if (s.over !== isOver(s)) p.push('over flag inconsistent with grid/coins');
    // after a resolved turn no mergeable group of 3+ may remain
    var seen = {};
    for (i = 0; i < N; i++) {
      var c = s.grid[i];
      if (NEXT[c] && !seen[i]) {
        var g = group(s.grid, i, c);
        g.forEach(function (k) { seen[k] = true; });
        if (g.length >= 3) p.push('unmerged group of ' + NAME[c] + ' at ' + i);
      }
    }
    // a crystal that could merge must already have done so
    for (i = 0; i < N; i++) if (s.grid[i] === CRYSTAL && crystalTier(s.grid.slice(), i)) p.push('crystal at ' + i + ' could merge');
    return p;
  }

  // Would placing the current item at idx trigger a merge? (for the tap hint). Does not mutate.
  function wouldMerge(state, idx) { var p = preview(state, idx); return !!p && p.merged; }

  return {
    W: W, H: H, N: N, EMPTY: EMPTY, BEAR: BEAR, TOMB: TOMB, CRYSTAL: CRYSTAL, TREASURE: TREASURE, TREASURE_COINS: TREASURE_COINS,
    EMOJI: EMOJI, NAME: NAME, NEXT: NEXT, BASE: BASE, WEIGHTS: WEIGHTS,
    START_COINS: START_COINS, COIN: COIN, PRICE: PRICE, BUYABLE: BUYABLE, UNDO_COST: UNDO_COST, START_STOCK: START_STOCK,
    RESTOCK: RESTOCK, MILESTONES: MILESTONES, milestoneScore: milestoneScore, canUndo: canUndo, canHammer: canHammer, migrate: migrate,
    rand: rand, drawItem: drawItem, newGame: newGame, neighbors: neighbors, group: group,
    place: place, swap: swap, undo: undo, validate: validate, wouldMerge: wouldMerge, emptyCount: emptyCount,
    buy: buy, hammer: hammer, trap: trap, open: open, preview: preview, isOver: isOver
  };
});
