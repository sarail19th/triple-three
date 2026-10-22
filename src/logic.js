// Triple Three (emoji) - pure game logic. No DOM. States are plain JSON; every operation returns a new state.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // The board starts 6x6 and grows by one row/column per bought side (state.w / state.h). W, H, N are the dimensions of the
  // state being worked on, set by dim() at the start of every public function; the exported W/H/N are the starting size.
  var DEFAULT_W = 6, DEFAULT_H = 6, W = DEFAULT_W, H = DEFAULT_H, N = W * H;
  var LOCK = {}; // cells locked by a loan (the collateral building, and every bank that has a loan): they cannot merge, move, be smashed or mauled
  function dim(s) { W = s.w || DEFAULT_W; H = s.h || DEFAULT_H; N = W * H; LOCK = lockedSet(s); }
  function lockedSet(s) {
    var set = {};
    (s.loans || []).forEach(function (l) { set[l.bank] = true; if (!l.defaulted) set[l.at] = true; });
    return set;
  }
  var VERSION = 2;
  // Wild bears (a per-game option): a bear that cannot step for 3 turns in a row (boxed in, but its pocket still has room) mauls
  // one neighbouring building of tier 1..MAUL_MAX (grass .. hut) one tier down (grass is destroyed), then starts over.
  var MAUL_MAX = 5;
  // Wild bears also breed: a pocket of 4..BREED_MAX_POCKET tiles with 2+ bears and 2+ empty tiles has a BREED_CHANCE each turn of
  // a cub appearing on one of its empty tiles (so a cub never takes the last free tile), up to BREED_MAX_BEARS bears on the board.
  var BREED_MIN_BEARS = 2, BREED_MIN_EMPTY = 2, BREED_MAX_POCKET = 6, BREED_MAX_BEARS = 8, BREED_CHANCE = 0.1;
  // Maps (chosen when a game starts, kept in state.map): easy = plain field, standard = a few random grass/bush/tree, medium = a
  // river across the field, hard = random ponds. Water tiles are fixed for the whole game.
  var MAPS = ['easy', 'standard', 'medium', 'hard'];
  var STANDARD_ITEMS = 5;
  // Calendar: every turn advances the game clock by `speed` ticks (1 = normal; 0 pauses it), 10 ticks = a month, 12 months = a year.
  // Banks (a shop item, at most MAX_BANKS on the board) pay coins every turn; three connected banks merge into cash.
  var TICKS_PER_MONTH = 10, MONTHS_PER_YEAR = 12, MAX_SPEED = 3;
  var MAX_BANKS = 3, BANK_PRICE = [1500, 3500, 8000], BANK_MIN_TIER = 7, BANK_INCOME_RATE = 0.01; // income per bank per tick (a turn at normal speed) = 1% of the shop price of your best tier
  // Loans: tap a bank to borrow half the shop value of the most expensive building on one of its four sides; that building (and the bank)
  // is locked until repaid. Simple interest, charged per month: the first bank asks 15% a year, each later bank (in the order they were
  // placed) doubles the previous rate. A year without repaying: the building is lost and its tile is seized (dead) until the debt is paid,
  // and that bank stops paying.
  var LOAN_RATE = 0.15, LOAN_TICKS = TICKS_PER_MONTH * MONTHS_PER_YEAR;
  // Ponds: a shop tool (any map). Turns one empty tile into permanent water (state.ponds) that pays points every turn, scaled to your best
  // building tier; dearer every time. Lake quests: the first pond that completes a 2x2 / 3x3 / 4x4 block of water pays a one-off bonus (state.lake).
  var MAX_PONDS = 16;
  var POND_PRICE = []; (function () { for (var n = 0, p = 60; n < MAX_PONDS; n++, p *= 1.3) POND_PRICE.push(Math.round(p / 10) * 10); })();
  var LAKE_SIZES = [2, 3, 4], LAKE_BONUS = [30, 100, 300], LAKE_COINS = [200, 1200, 8000]; // a quest pays points (BASE[top] * LAKE_BONUS) AND coins
  // Bridges: a shop tool for maps with water. A bridge turns one water tile into a walkable tile (bears and foxes cross it, nothing can
  // be built on it) and is remembered in state.bridges. At most MAX_BRIDGES per game, dearer every time.
  var MAX_BRIDGES = 5;
  var BRIDGE_PRICE = [300, 700, 1500, 3200, 6500];
  var MEDIUM_WATER = [2, 8, 14, 15, 21, 27, 33]; // a winding river from the top edge to the bottom edge (6x6 indices)
  function isBear(v) { return v === BEAR || v === BEAR_GROWL || v === BEAR_ANGRY; }

  // Cell / item codes. 0 empty. 1..10 building chain (10 = mall), 11 cash (collectible, final), 12 bear, 13 tombstone,
  // 14 church, 15 cathedral, 16 crystal, 17 treasure (final tier of the bear chain: collectible), 18 fox,
  // 19/20 a bear that was boxed in for 1 / 2 turns in a row (Wild bears games only: the warning stages before it mauls),
  // 21 water (map tiles that never change: nothing can be placed, merged, moved or smashed there, and animals cannot enter it),
  // 23 seized lot (a tile lost to an unpaid loan: a dead tile until the debt is paid, then empty again),
  // 22 bank (a shop item placed like a building: a dead tile for animals and movers that pays coins every turn; three connected banks merge into cash).
  var EMPTY = 0, LAST_BUILDING = 10, CASH = 11, BEAR = 12, TOMB = 13, CHURCH = 14, CATHEDRAL = 15, CRYSTAL = 16, TREASURE = 17, FOX = 18, BEAR_GROWL = 19, BEAR_ANGRY = 20, WATER = 21, BANK = 22, SEIZED = 23;
  var EMOJI = ['', '🌱', '🌿', '🌳', '🏕️', '🛖', '🏠', '🏘️', '🏫', '🏥', '🏬', '💵', '🐻', '🪦', '⛪', '🕌', '💎', '💰', '🦊', '🐻', '🐻', '', '🏦', '🏚️'];
  var NAME = ['empty', 'grass', 'bush', 'tree', 'camp', 'hut', 'house', 'village', 'school', 'hospital', 'mall', 'cash', 'bear', 'tombstone', 'church', 'cathedral', 'crystal', 'treasure', 'fox', 'growling bear', 'angry bear', 'water', 'bank', 'seized lot'];
  // code -> code it becomes when 3+ connect. Final tiers (11 cash, 15->17 treasure), bear, fox and crystal are absent / collectible.
  var NEXT = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 13: 14, 14: 15, 15: 17, 22: 11 };
  // points per item consumed by a merge, keyed by the consumed code (buildings x3 per tier)
  var BASE = { 13: 150, 14: 1500, 15: 15000 };
  var COIN = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 30, 6: 60, 7: 120, 8: 240, 9: 480, 10: 960, 13: 20, 14: 100, 15: 500 };
  (function () { var b = 10; for (var k = 1; k <= LAST_BUILDING; k++) { BASE[k] = b; b *= 3; } })();
  // item queue draw weights (sum 100): mostly grass, sometimes bush/tree/bear, rare crystal and fox
  var WEIGHTS = [[1, 61], [2, 16], [3, 6], [BEAR, 12], [CRYSTAL, 3], [FOX, 2]];
  var TRAP_DROP = 0.03; // chance per turn that the queue brings a free trap (+1 trap in stock): a way to deal with the foxes
  // Lucky drops: once you have built a tier, the next item is now and then a camp / hut / house (never above a house, and only tiers
  // below the best one you have built), more often on the easier maps. The extra random numbers are drawn only when a drop is
  // possible, so early games (and the whole Hard map) draw exactly the sequence they always did.
  var LUCKY_RATE = { easy: 0.06, standard: 0.04, medium: 0.03, hard: 0 };
  var LUCKY_MIN_TIER = 4, LUCKY_MAX_TIER = 6;
  var QUEUE_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, BEAR, CRYSTAL, FOX, BANK]; // BANK only ever comes from the shop
  // coins: earned per merge (COIN[consumed code] * (group size - 2)), spent in the shop (free actions, no turn passes)
  var START_COINS = 10;
  var TREASURE_COINS = 250; // paid when a treasure is opened
  var CASH_COINS = 5000;    // paid when cash (the last building tier) is collected
  var PRICE = { 1: 6, 2: 15, 3: 35, 4: 80, 5: 180, 6: 400, 7: 900, 8: 2000, 9: 4500, 10: 10000, 16: 300, hammer: 20, trap: 12, move: 60 };
  var BUYABLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, CRYSTAL];
  var UNDO_COST = 5; // coins per undo
  // Shop stock per game. An item bought with no stock left still sells, at double the price for every purchase past zero
  // (stock goes negative = debt, milestone restocks pay it back). Hammer, trap and mover simply run out.
  var START_STOCK = { 1: 3, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 16: 0, hammer: 2, trap: 2, move: 1 };
  var MILESTONES = [400, 1200, 3000, 7000, 15000, 30000]; // after the last one a restock comes every 30000 more points
  var RESTOCK = { 1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 16: 1, hammer: 1, trap: 1, move: 1 };
  // Score that counts towards shop restocks: pond income and lake bonuses (state.bonusScore) add to the score but never trigger restocks.
  function milestoneProgress(s) { return s.score - (s.bonusScore || 0); }
  function milestoneScore(n) { return n < MILESTONES.length ? MILESTONES[n] : MILESTONES[MILESTONES.length - 1] * (n - MILESTONES.length + 2); }
  // Land: one extra row/column per side, each side once, dearer every time.
  var SIDES = ['top', 'bottom', 'left', 'right'];
  var LAND_PRICE = [150, 400, 1000, 2500];
  // The shop always sells grass, bush and tree; a higher building tier is unlocked once one has stood on the board.
  var STARTER_TIER = 3;

  // ---- seeded RNG (mulberry32). The state is one uint32 kept inside the game state, so undo/replay is exact.
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    var t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(s, n) { return Math.floor(rand(s) * n); }
  // A lucky building tier for the next item, or 0. Lower tiers are likelier (camp 3 : hut 2 : house 1 when all three are possible).
  function luckyTier(s) {
    var rate = LUCKY_RATE[s.map], hi = Math.min((s.top || 0) - 1, LUCKY_MAX_TIER);
    if (!rate || hi < LUCKY_MIN_TIER || rand(s) >= rate) return 0;
    var total = 0, k;
    for (k = LUCKY_MIN_TIER; k <= hi; k++) total += hi - k + 1;
    var r = randInt(s, total);
    for (k = LUCKY_MIN_TIER; k <= hi; k++) { r -= hi - k + 1; if (r < 0) return k; }
    return LUCKY_MIN_TIER;
  }
  function drawItem(s, events) {
    // a free trap now and then (only when `events` is given, i.e. on a real turn; needs animals in the game)
    if (events && s.stock && (s.bears !== false || s.foxes !== false) && rand(s) < TRAP_DROP) { s.stock.trap++; events.push({ type: 'bonus', item: 'trap' }); }
    var lucky = luckyTier(s);
    if (lucky) return lucky;
    var r = randInt(s, 100), acc = 0;
    for (var i = 0; i < WEIGHTS.length; i++) {
      acc += WEIGHTS[i][1];
      if (r < acc) {
        var it = WEIGHTS[i][0];
        // a switched-off animal turns into plain grass (the draw is the same, so games with both animals on replay exactly as ever)
        return (it === BEAR && s.bears === false) || (it === FOX && s.foxes === false) ? 1 : it;
      }
    }
    return 1;
  }

  function clone(s) {
    return { ver: s.ver, wild: s.wild, bears: s.bears, foxes: s.foxes, map: s.map, bridges: s.bridges.slice(), ponds: s.ponds.slice(), lake: s.lake, tick: s.tick, speed: s.speed, banksBought: s.banksBought, bankOrder: s.bankOrder.slice(), loans: s.loans.map(function (l) { return Object.assign({}, l); }), w: s.w, h: s.h, land: s.land.slice(), top: s.top, grid: s.grid.slice(), cur: s.cur, next: s.next, hold: s.hold, score: s.score, coins: s.coins,
      stock: Object.assign({}, s.stock), milestone: s.milestone, bonusScore: s.bonusScore, turn: s.turn, over: s.over, rng: s.rng, seed: s.seed, undo: s.undo };
  }

  function newGame(seed, opts) {
    seed = (seed >>> 0) || 1;
    var bears = !(opts && opts.bears === false), foxes = !(opts && opts.foxes === false);
    var s = { ver: VERSION, wild: bears && !!(opts && opts.wild), bears: bears, foxes: foxes, map: opts && MAPS.indexOf(opts.map) >= 0 ? opts.map : 'easy', bridges: [], ponds: [], lake: 0, tick: 0, speed: 1, banksBought: 0, bankOrder: [], loans: [], w: DEFAULT_W, h: DEFAULT_H, land: [], top: 1, grid: new Array(DEFAULT_W * DEFAULT_H).fill(EMPTY), cur: 1, next: 1, hold: 0, score: 0, coins: START_COINS,
      stock: Object.assign({}, START_STOCK), milestone: 0, bonusScore: 0, turn: 0, over: false, rng: seed, seed: seed, undo: null };
    dim(s);
    genMap(s);
    s.next = drawItem(s); // always open with grass
    return s;
  }

  // ---- maps. Easy uses no random numbers at all, so classic seeds replay exactly as they always did.
  function genMap(s) {
    var i;
    if (s.map === 'standard') scatter(s, STANDARD_ITEMS);
    else if (s.map === 'medium') for (i = 0; i < MEDIUM_WATER.length; i++) s.grid[MEDIUM_WATER[i]] = WATER;
    else if (s.map === 'hard') ponds(s);
  }
  // a few random grass / bush / tree on the empty field (never three of a kind touching)
  function scatter(s, count) {
    for (var placed = 0, tries = 0; placed < count && tries < 500; tries++) {
      var at = randInt(s, N), r = randInt(s, 6), kind = r < 3 ? 1 : r < 5 ? 2 : 3;
      if (s.grid[at] !== EMPTY) continue;
      s.grid[at] = kind;
      if (group(s.grid, at, kind).length >= 3) s.grid[at] = EMPTY; else placed++;
    }
  }
  // do the non-water tiles of grid form one connected area?
  function oneField(grid) {
    var first = -1, total = 0, i;
    for (i = 0; i < N; i++) if (grid[i] !== WATER) { total++; if (first < 0) first = i; }
    var seen = {}, stack = [first], n = 0;
    seen[first] = true;
    while (stack.length) {
      var c = stack.pop(); n++;
      neighbors(c).forEach(function (j) { if (!seen[j] && grid[j] !== WATER) { seen[j] = true; stack.push(j); } });
    }
    return n === total;
  }
  // three random ponds of 2..4 tiles each; kept only if there are 6..9 water tiles and the land stays in one piece
  function ponds(s) {
    for (var attempt = 0; attempt < 80; attempt++) {
      var g = new Array(N).fill(EMPTY), water = 0, p, i;
      for (p = 0; p < 3; p++) {
        var cells = [randInt(s, N)], size = 2 + randInt(s, 3);
        g[cells[0]] = WATER;
        while (cells.length < size) {
          var from = cells[randInt(s, cells.length)], free = neighbors(from).filter(function (j) { return g[j] === EMPTY; });
          if (!free.length) break;
          var j = free[randInt(s, free.length)];
          g[j] = WATER; cells.push(j);
        }
      }
      for (i = 0; i < N; i++) if (g[i] === WATER) water++;
      if (water >= 6 && water <= 9 && oneField(g)) { s.grid = g; return; }
    }
    [14, 15, 20, 21].forEach(function (i) { s.grid[i] = WATER; }); // (practically never reached) a pond in the middle
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
        if (!seen[j] && grid[j] === code && !LOCK[j]) { seen[j] = true; stack.push(j); }
      }
    }
    return out;
  }

  // Resolve merges triggered at cell `at`, chaining while the result keeps matching. Mutates s.
  function resolveAt(s, at, events) {
    for (;;) {
      var code = s.grid[at], next = code === CRYSTAL ? TREASURE : NEXT[code]; // 3+ connected gems merge into a treasure
      if (!next) return;
      var g = group(s.grid, at, code);
      if (g.length < 3) return;
      var pts = g.length * (BASE[code] || 0), coins = (g.length - 2) * (COIN[code] || 0); // gems themselves pay nothing: the treasure is the prize
      for (var k = 0; k < g.length; k++) s.grid[g[k]] = EMPTY;
      s.grid[at] = next;
      s.score += pts; s.coins += coins;
      events.push({ type: 'merge', at: at, cells: g, from: code, to: next, points: pts, coins: coins });
    }
  }

  // Item kinds a crystal can stand in for, best first: the bear chain (cathedral -> treasure, church, tombstone), then buildings.
  // The order only breaks ties; see crystalTier.
  var CRYSTAL_AS = [CATHEDRAL, CHURCH, TOMB, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  // Best kind the crystal at `at` could stand in for to form a 3+ group; 0 if none (grid is left unchanged). Every kind that works is
  // played out including the merges that follow (a camp trio makes a hut that may join two huts into a house...), and the kind that
  // earns the most points wins (then the most coins, then the order above), so a crystal can pull a whole chain reaction together.
  function crystalTier(grid, at) {
    var found = 0, bestPts = -1, bestCoins = -1;
    for (var k = 0; k < CRYSTAL_AS.length; k++) {
      var t = CRYSTAL_AS[k], sim = { grid: grid.slice(), score: 0, coins: 0 };
      sim.grid[at] = t;
      if (group(sim.grid, at, t).length < 3) continue;
      resolveAt(sim, at, []);
      if (sim.score > bestPts || (sim.score === bestPts && sim.coins > bestCoins)) { found = t; bestPts = sim.score; bestCoins = sim.coins; }
    }
    return found;
  }

  // Every crystal on the board turns into the best item kind that merges at its cell; one that cannot merge yet
  // stays as a wildcard (three of them together merge into a treasure, see applyItem) and is re-checked after every placement. `first` (the crystal just placed) goes first.
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

  // Put `item` on empty cell idx and resolve every merge it causes (no animal movement). Mutates s.
  function applyItem(s, idx, item, events) {
    s.grid[idx] = item;
    if (item === CRYSTAL) {
      settleCrystals(s, events, idx);
      if (s.grid[idx] === CRYSTAL) { resolveAt(s, idx, events); settleCrystals(s, events); } // no tier to stand in for: 3+ connected gems -> treasure
    } else { resolveAt(s, idx, events); settleCrystals(s, events); }
  }

  function emptyCount(grid) { var n = 0; for (var i = 0; i < grid.length; i++) if (grid[i] === EMPTY) n++; return n; }

  // Would a fox jumping from `from` to the empty cell `to` still have a free cell in its pocket (counting the cell it leaves)?
  // A warp never picks a landing that would trap the fox at once, e.g. a single tile walled in on all four sides.
  function landsWithRoom(s, from, to) {
    var seen = {}, stack = [to], ok = false;
    seen[to] = true;
    while (stack.length && !ok) {
      var c = stack.pop();
      if (c !== to && (c === from || s.grid[c] === EMPTY)) { ok = true; break; } // `to` is about to hold the fox; `from` is vacated by the jump
      neighbors(c).forEach(function (j) {
        if (!seen[j] && (j === from || isBear(s.grid[j]) || s.grid[j] === FOX || s.grid[j] === EMPTY)) { seen[j] = true; stack.push(j); }
      });
    }
    return ok;
  }

  // cells animals can be on or walk through (water, buildings, tombstones... are walls)
  function roaming(v) { return isBear(v) || v === FOX || v === EMPTY; }

  // Animals are trapped per pocket: a pocket is a connected area of empty cells, bears and foxes. A pocket with no empty
  // cell left turns all its bears and foxes into tombstones (a fox walled in on all sides, or in a corner, or sharing a
  // pocket whose last free cell just got filled). In a pocket that still has room every bear that can step does, and a
  // bear that is boxed in by other animals just waits (it does not die while a neighbour can still free a cell for it).
  // A fox does not walk: if it is not trapped it warps to a random empty cell anywhere on the board.
  // `last` is the cell just played: if it was trapped, its tombstones merge there first (the church forms where the
  // last animal went in), then the rest in board order.
  function moveBears(s, events, last) {
    var seen = {}, trapped = [], bears = [], i;
    for (i = 0; i < N; i++) {
      if (seen[i] || !roaming(s.grid[i])) continue;
      var stack = [i], pocket = [], room = false;
      seen[i] = true;
      while (stack.length) {
        var c = stack.pop();
        pocket.push(c);
        if (s.grid[c] === EMPTY) room = true;
        neighbors(c).forEach(function (j) { if (!seen[j] && roaming(s.grid[j])) { seen[j] = true; stack.push(j); } });
      }
      if (!room) pocket.forEach(function (c) { if (s.grid[c] !== EMPTY) trapped.push(c); });
    }
    trapped.sort(function (a, b) { return (b === last) - (a === last) || a - b; });
    trapped.forEach(function (at) { s.grid[at] = TOMB; events.push({ type: 'trapped', at: at }); });
    for (i = 0; i < N; i++) if (isBear(s.grid[i])) bears.push(i);
    var mauled = [];
    bears.forEach(function (from) {
      var free = neighbors(from).filter(function (j) { return s.grid[j] === EMPTY; });
      if (!free.length) { if (s.wild) boxedBear(s, from, events, mauled); return; }
      var to = free[randInt(s, free.length)];
      s.grid[from] = EMPTY; s.grid[to] = BEAR; // a bear that walks calms down again
      events.push({ type: 'bear', from: from, to: to });
    });
    var foxes = [];
    for (i = 0; i < N; i++) if (s.grid[i] === FOX) foxes.push(i);
    foxes.forEach(function (from) {
      var safe = [];
      for (var j = 0; j < N; j++) if (s.grid[j] === EMPTY && landsWithRoom(s, from, j)) safe.push(j);
      if (!safe.length) return; // nowhere safe to jump (a fox that survived always has its own box to hop around in, so this is rare): it stays
      var to = safe[randInt(s, safe.length)];
      s.grid[from] = EMPTY; s.grid[to] = FOX;
      events.push({ type: 'fox', from: from, to: to });
    });
    if (s.wild) breed(s, events);
    trapped.forEach(function (at) { if (s.grid[at] === TOMB) resolveAt(s, at, events); });
    mauled.forEach(function (at) { if (s.grid[at] !== EMPTY) resolveAt(s, at, events); }); // a lowered tile may complete a group
  }

  // Wild bears breed: see BREED_*. A cub appears (calm, code 12) on an empty tile of a small pocket that has 2+ bears and 2+ empty tiles.
  function breed(s, events) {
    var seen = {}, bears = 0, i;
    for (i = 0; i < N; i++) if (isBear(s.grid[i])) bears++;
    for (i = 0; i < N; i++) {
      if (seen[i] || !roaming(s.grid[i])) continue;
      var stack = [i], size = 0, inPocket = 0, empties = [];
      seen[i] = true;
      while (stack.length) {
        var c = stack.pop();
        size++;
        if (isBear(s.grid[c])) inPocket++; else if (s.grid[c] === EMPTY) empties.push(c);
        neighbors(c).forEach(function (j) { if (!seen[j] && roaming(s.grid[j])) { seen[j] = true; stack.push(j); } });
      }
      if (size <= BREED_MAX_POCKET && inPocket >= BREED_MIN_BEARS && empties.length >= BREED_MIN_EMPTY && bears < BREED_MAX_BEARS && rand(s) < BREED_CHANCE) {
        var at = empties[randInt(s, empties.length)];
        s.grid[at] = BEAR; bears++;
        events.push({ type: 'cub', at: at });
      }
    }
  }

  // Wild bears: a bear that could not step this turn gets one stage angrier (2 warning turns); on the third boxed-in turn it
  // mauls one adjacent tile of tier 1..MAUL_MAX one tier down (a grass becomes an empty tile, an escape hole) and starts over.
  function boxedBear(s, at, events, mauled) {
    var code = s.grid[at];
    if (code === BEAR) { s.grid[at] = BEAR_GROWL; events.push({ type: 'growl', at: at, level: 1 }); return; }
    if (code === BEAR_GROWL) { s.grid[at] = BEAR_ANGRY; events.push({ type: 'growl', at: at, level: 2 }); return; }
    var prey = neighbors(at).filter(function (j) { return s.grid[j] >= 1 && s.grid[j] <= MAUL_MAX && !LOCK[j]; });
    s.grid[at] = BEAR;
    if (!prey.length) return;
    var t = prey[randInt(s, prey.length)], from = s.grid[t], to = from - 1;
    s.grid[t] = to; // 0 (empty) for grass
    mauled.push(t);
    events.push({ type: 'maul', at: t, bear: at, from: from, to: to });
  }

  // ---- shop helpers
  // Highest building tier unlocked in the shop (a tier unlocks once one has stood on the board; s.top remembers it).
  function unlockedTop(s) { return Math.max(STARTER_TIER, s.top || 0); }
  function isAvailable(s, item) {
    if (BUYABLE.indexOf(item) < 0) return false;
    if (item === CRYSTAL) return s.milestone >= 1;
    return item <= unlockedTop(s);
  }
  // Price of the next purchase: base price while stock lasts, doubling for every purchase beyond it.
  function priceOf(s, item) {
    var base = PRICE[item], st = s.stock[item] || 0;
    if (BUYABLE.indexOf(item) >= 0 && st <= 0) base *= Math.pow(2, 1 - st);
    return base;
  }
  // Remember the highest building tier seen on the board; unlocking a new shop tier emits an event. Mutates s.
  function noteTop(s, events) {
    var m = s.top || 1, before = unlockedTop(s);
    for (var i = 0; i < N; i++) { var v = s.grid[i]; if (v > m && v <= LAST_BUILDING) m = v; }
    s.top = m;
    if (unlockedTop(s) > before) events.push({ type: 'tierunlock', tier: unlockedTop(s) });
  }

  // A full board only ends the game when the player can neither hammer a tile nor afford more land.
  function canHammer(s) { return s.coins >= PRICE.hammer && s.stock.hammer > 0; }
  function landPrice(s) { return s.land.length < SIDES.length ? LAND_PRICE[s.land.length] : null; }
  function canLand(s) { return s.land.length < SIDES.length && s.coins >= LAND_PRICE[s.land.length]; }
  // empty tiles an item can actually be placed on (a bridge tile is empty but nothing is built on it)
  function freeCount(s) { var n = 0; for (var i = 0; i < s.grid.length; i++) if (s.grid[i] === EMPTY && s.bridges.indexOf(i) < 0) n++; return n; }
  function isOver(s) { return freeCount(s) === 0 && !canHammer(s) && !canLand(s) && !loanEscape(s); }
  // Score milestones restock the shop (only tiers that are unlocked). Mutates s.
  function grantMilestones(s, events) {
    while (milestoneProgress(s) >= milestoneScore(s.milestone)) {
      s.milestone++;
      for (var k in RESTOCK) {
        if (+k <= LAST_BUILDING && +k > unlockedTop(s)) continue;
        s.stock[k] = (s.stock[k] || 0) + RESTOCK[k];
      }
      events.push({ type: 'unlock', milestone: s.milestone });
    }
  }

  // Play one turn: put s.cur on empty cell idx. Returns {state, events}, or null if the move is illegal.
  function place(state, idx) {
    dim(state);
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== EMPTY || state.bridges.indexOf(idx) >= 0) return null;
    var s = clone(state), events = [], item = s.cur;
    s.undo = clone(state); s.undo.undo = null; // one level of undo, no nesting
    events.push({ type: 'place', at: idx, item: item });
    applyItem(s, idx, item, events);
    settleBanks(s);
    moveBears(s, events, idx);
    settleCrystals(s, events); // new tombstones / churches may complete a group for a waiting crystal
    noteTop(s, events);
    var pp = pondPoints(s);
    if (pp) { s.score += pp; s.bonusScore += pp; events.push({ type: 'pondpts', points: pp }); }
    s.tick += s.speed;
    s.loans.forEach(function (l) { // a year without repaying: the building is gone and its tile seized
      if (!l.defaulted && s.tick - l.since >= LOAN_TICKS) { l.defaulted = true; s.grid[l.at] = SEIZED; events.push({ type: 'default', bank: l.bank, at: l.at, tier: l.tier }); }
    });
    if (s.speed > 0) { // every turn each paying bank earns its income for the ticks that passed (a bank with a defaulted loan earns nothing)
      var inDefault = {}, paying = [], each = bankIncome(s) * s.speed;
      s.loans.forEach(function (l) { if (l.defaulted) inDefault[l.bank] = true; });
      for (var bi = 0; bi < s.grid.length; bi++) if (s.grid[bi] === BANK && !inDefault[bi]) paying.push(bi);
      if (paying.length) { s.coins += each * paying.length; events.push({ type: 'bankpay', coins: each * paying.length, each: each, ticks: s.speed, banks: paying.length, at: paying }); }
    }
    grantMilestones(s, events);
    s.cur = s.next; s.next = drawItem(s, events); s.turn++;
    if (isOver(s)) { s.over = true; events.push({ type: 'over', score: s.score }); }
    return { state: s, events: events };
  }

  // Swap the current item with the storage slot (free action). Empty slot: store it and advance the queue.
  function swap(state) {
    if (state.over || state.cur === BANK) return null; // a bank cannot go into the reserve
    var s = clone(state);
    if (!s.hold) { s.hold = s.cur; s.cur = s.next; s.next = drawItem(s); }
    else { var t = s.cur; s.cur = s.hold; s.hold = t; }
    return s;
  }

  // Swap the current item with the next one (free action: no turn, no random numbers, so it only chooses which of the two comes first).
  function swapNext(state) {
    if (state.over) return null;
    var s = clone(state), t = s.cur;
    s.cur = s.next; s.next = t;
    return s;
  }

  // Shop: swap the current item for a bought one (cost in coins, free action). The old current item becomes `next`;
  // the old `next` is discarded. Returns a new state or null (cannot afford, locked, already current, game over).
  function buy(state, item) {
    dim(state);
    if (state.over || !isAvailable(state, item) || state.coins < priceOf(state, item) || state.cur === item) return null;
    var s = clone(state);
    s.coins -= priceOf(state, item); s.stock[item] = (s.stock[item] || 0) - 1; s.next = s.cur; s.cur = item;
    return isOver(s) ? null : s; // never let a purchase strand a full board without hammer money
  }

  // Shop: the hammer removes whatever stands on cell idx (free action, costs coins). Returns {state, events} or null.
  function hammer(state, idx) {
    dim(state);
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] === EMPTY || state.grid[idx] === WATER || state.grid[idx] === SEIZED || LOCK[idx] || !canHammer(state)) return null; // a loan locks its building and its bank
    var s = clone(state), item = s.grid[idx];
    s.grid[idx] = EMPTY; s.coins -= PRICE.hammer; s.stock.hammer--; settleBanks(s); s.over = isOver(s);
    return { state: s, events: [{ type: 'hammer', at: idx, item: item }] };
  }

  // Collect the treasure or the cash on cell idx: it disappears and pays coins (free action). Returns {state, events} or null.
  function open(state, idx) {
    dim(state);
    if (state.over || !(idx >= 0 && idx < N) || (state.grid[idx] !== TREASURE && state.grid[idx] !== CASH)) return null;
    var s = clone(state), item = s.grid[idx], coins = item === CASH ? CASH_COINS : TREASURE_COINS;
    s.grid[idx] = EMPTY; s.coins += coins;
    return { state: s, events: [{ type: 'open', at: idx, item: item, coins: coins }] };
  }

  // Shop: the trap kills the bear or fox on cell idx on the spot: it becomes a tombstone (which may merge into a church
  // right away). Free action, costs coins. Returns {state, events} or null (nothing to trap there, too poor, or it would
  // leave a full board without hammer money).
  function trap(state, idx) {
    dim(state);
    if (state.over || !(idx >= 0 && idx < N) || (!isBear(state.grid[idx]) && state.grid[idx] !== FOX) || state.coins < PRICE.trap || !(state.stock.trap > 0)) return null;
    var s = clone(state), events = [{ type: 'trap', at: idx }];
    s.coins -= PRICE.trap; s.stock.trap--; s.grid[idx] = TOMB;
    resolveAt(s, idx, events);
    settleCrystals(s, events);
    noteTop(s, events);
    grantMilestones(s, events);
    s.over = isOver(s);
    return s.over ? null : { state: s, events: events };
  }

  // Shop: the mover picks up the item on `from` and drops it on the empty cell `to` (free action, costs coins, limited stock).
  // It merges there exactly as a placed item would. Bears and foxes cannot be moved (only the trap deals with them).
  // Returns {state, events} or null.
  function isMovable(code) { return code !== EMPTY && code !== WATER && code !== BANK && code !== SEIZED && !isBear(code) && code !== FOX; }
  function canMove(s) { return s.coins >= PRICE.move && s.stock.move > 0; }
  function moveLegal(state, from, to) {
    return !state.over && from >= 0 && from < N && to >= 0 && to < N && from !== to && isMovable(state.grid[from]) && !LOCK[from] && state.grid[to] === EMPTY && state.bridges.indexOf(to) < 0;
  }
  function move(state, from, to) {
    dim(state);
    if (!moveLegal(state, from, to) || !canMove(state)) return null;
    var s = clone(state), item = state.grid[from], events = [{ type: 'move', from: from, to: to, item: item }];
    s.coins -= PRICE.move; s.stock.move--;
    s.grid[from] = EMPTY;
    applyItem(s, to, item, events);
    noteTop(s, events);
    grantMilestones(s, events);
    s.over = isOver(s); // the board is as full as before, so this only ever stays false
    return { state: s, events: events };
  }

  // Water tiles where a bridge may go: the tile must have dry (or already bridged) tiles on BOTH opposite sides, up/down or left/right,
  // so it joins two banks. That rules out the middle of wide water and every corner of the map (a corner has no opposite pair).
  function bridgeSpots(state) {
    dim(state);
    var out = [];
    if (state.over || state.bridges.length >= MAX_BRIDGES) return out;
    for (var i = 0; i < N; i++) {
      if (state.grid[i] !== WATER || state.ponds.indexOf(i) >= 0) continue; // a dug pond is a pond, not a river to cross
      var r = (i / W) | 0, c = i % W;
      var vertical = r > 0 && r < H - 1 && state.grid[i - W] !== WATER && state.grid[i + W] !== WATER;
      var horizontal = c > 0 && c < W - 1 && state.grid[i - 1] !== WATER && state.grid[i + 1] !== WATER;
      if (vertical || horizontal) out.push(i);
    }
    return out;
  }
  function bridgePrice(s) { return s.bridges.length < MAX_BRIDGES ? BRIDGE_PRICE[s.bridges.length] : null; }
  function canBridge(s) { return s.bridges.length < MAX_BRIDGES && s.coins >= BRIDGE_PRICE[s.bridges.length] && bridgeSpots(s).length > 0; }
  // Shop: build a bridge on water tile idx (free action, limited, dearer every time). Returns {state, events} or null.
  function buyBridge(state, idx) {
    dim(state);
    if (state.over || state.bridges.length >= MAX_BRIDGES || state.coins < BRIDGE_PRICE[state.bridges.length] || bridgeSpots(state).indexOf(idx) < 0) return null;
    var s = clone(state);
    s.coins -= BRIDGE_PRICE[state.bridges.length];
    s.grid[idx] = EMPTY; s.bridges.push(idx); s.bridges.sort(function (a, b) { return a - b; });
    s.over = isOver(s);
    return s.over ? null : { state: s, events: [{ type: 'bridge', at: idx }] };
  }

  // ---- banks and the calendar
  function bankCount(s) { var n = 0; for (var i = 0; i < s.grid.length; i++) if (s.grid[i] === BANK) n++; return n; }
  function isBankAvailable(s) { return unlockedTop(s) >= BANK_MIN_TIER; }
  function bankPrice(s) { var n = s.banksBought || 0; return n < BANK_PRICE.length ? BANK_PRICE[n] : Math.round(BANK_PRICE[BANK_PRICE.length - 1] * Math.pow(1.5, n - BANK_PRICE.length + 1) / 10) * 10; }
  function bankSlots(s) { return bankCount(s) + (s.cur === BANK ? 1 : 0) + (s.next === BANK ? 1 : 0) + (s.hold === BANK ? 1 : 0); }
  // coins one bank pays per tick (per turn at normal speed)
  function bankIncome(s) { return Math.max(1, Math.round(PRICE[Math.min(s.top || 1, LAST_BUILDING)] * BANK_INCOME_RATE)); }
  function calendar(s) { var m = Math.floor((s.tick || 0) / TICKS_PER_MONTH); return { year: Math.floor(m / MONTHS_PER_YEAR) + 1, month: m % MONTHS_PER_YEAR + 1 }; }
  function canBuyBank(s) { return !s.over && isBankAvailable(s) && s.coins >= bankPrice(s) && s.cur !== BANK && s.next !== BANK && bankSlots(s) < MAX_BANKS; }
  // Shop: buy a bank. It becomes the current item (the old current item moves to `next`, the old next is dropped), to be placed like any item;
  // it cannot be stored in the reserve. Returns a new state or null.
  function buyBank(state) {
    dim(state);
    if (!canBuyBank(state)) return null;
    var s = clone(state);
    s.coins -= bankPrice(state); s.banksBought++; s.next = s.cur; s.cur = BANK;
    return isOver(s) ? null : s;
  }

  // Keep `bankOrder` (banks in the order they were placed; the order sets the loan rate) in step with the banks on the grid. Mutates s.
  function settleBanks(s) {
    var order = s.bankOrder.filter(function (i) { return s.grid[i] === BANK; });
    for (var i = 0; i < s.grid.length; i++) if (s.grid[i] === BANK && order.indexOf(i) < 0) order.push(i);
    s.bankOrder = order;
  }
  function bankRate(s, bankIdx) { var r = s.bankOrder.indexOf(bankIdx); return LOAN_RATE * Math.pow(2, r < 0 ? s.bankOrder.length : r); }
  // What borrowing at this bank would do: the most expensive unlocked building next to it is the collateral; null if there is none.
  function loanOptions(s, bankIdx) {
    if (!(bankIdx >= 0 && bankIdx < s.grid.length) || s.grid[bankIdx] !== BANK) return null;
    var best = -1;
    neighbors(bankIdx).forEach(function (j) {
      var v = s.grid[j];
      if (v >= 1 && v <= LAST_BUILDING && !LOCK[j] && (best < 0 || v > s.grid[best])) best = j;
    });
    return best < 0 ? null : { at: best, tier: s.grid[best], principal: Math.floor(PRICE[s.grid[best]] / 2), rate: bankRate(s, bankIdx) };
  }
  // Debt of a loan now: principal + simple interest for the whole months passed (the interest stops growing after a year).
  function loanOwed(s, loan) {
    var months = Math.min(MONTHS_PER_YEAR, Math.max(0, Math.floor((s.tick - loan.since) / TICKS_PER_MONTH)));
    return loan.principal + Math.floor(loan.principal * loan.rate * months / MONTHS_PER_YEAR);
  }
  // months left until the loan defaults (0 = due now)
  function loanMonthsLeft(s, loan) { return Math.max(0, Math.ceil((loan.since + LOAN_TICKS - s.tick) / TICKS_PER_MONTH)); }
  // Can the player get out of a stuck (full) board through the bank: pay a defaulted loan to free its tile, or borrow enough to afford the hammer?
  function loanEscape(s) {
    if (s.loans.some(function (l) { return l.defaulted && s.coins >= loanOwed(s, l); })) return true;
    if (s.stock.hammer > 0 && s.coins < PRICE.hammer) {
      for (var i = 0; i < s.bankOrder.length; i++) { var o = loanOptions(s, s.bankOrder[i]); if (o && s.coins + o.principal >= PRICE.hammer) return true; }
    }
    return false;
  }
  // Tap a bank: take a loan (free action). Returns {state, events} or null.
  function borrow(state, bankIdx) {
    dim(state);
    var o = state.over ? null : loanOptions(state, bankIdx);
    if (!o) return null;
    var s = clone(state);
    s.coins += o.principal;
    s.loans.push({ bank: bankIdx, at: o.at, tier: o.tier, principal: o.principal, rate: o.rate, since: s.tick, defaulted: false });
    return { state: s, events: [{ type: 'loan', bank: bankIdx, at: o.at, tier: o.tier, coins: o.principal, rate: o.rate }] };
  }
  // Pay a loan back (free action): the building is unlocked (and may merge at once), or a seized tile comes back empty.
  function repay(state, loanIdx) {
    dim(state);
    var loan = state.loans[loanIdx];
    if (!loan || state.over && !loan.defaulted) return null;
    var owed = loanOwed(state, loan);
    if (state.coins < owed) return null;
    var s = clone(state), events = [{ type: 'repay', bank: loan.bank, at: loan.at, coins: owed, freed: !!loan.defaulted }];
    s.coins -= owed; s.loans.splice(loanIdx, 1);
    if (loan.defaulted) s.grid[loan.at] = EMPTY;
    dim(s); // the lock set changed
    if (!loan.defaulted) resolveAt(s, loan.at, events);
    if (s.grid[loan.bank] === BANK) resolveAt(s, loan.bank, events); // a bank freed of its last loan may complete a trio
    settleCrystals(s, events); noteTop(s, events); settleBanks(s); grantMilestones(s, events);
    s.over = isOver(s);
    dim(state);
    return { state: s, events: events };
  }
  // The game clock speed (free action): 0 pauses it, 1..MAX_SPEED ticks per turn.
  // indices of the cells a loan has locked (collateral buildings and banks with a loan)
  function lockedCells(state) { dim(state); return Object.keys(LOCK).map(Number); }
  function setSpeed(state, n) {
    if (state.over || !(n >= 0 && n <= MAX_SPEED) || n !== (n | 0) || n === state.speed) return null;
    var s = clone(state); s.speed = n; return s;
  }

  function pondPrice(s) { return s.ponds.length < MAX_PONDS ? POND_PRICE[s.ponds.length] : null; }
  function pondPoints(s) { return s.ponds.length ? s.ponds.length * Math.ceil(BASE[s.top] / 20) : 0; } // per turn
  function canPond(s) { dim(s); return !s.over && s.ponds.length < MAX_PONDS && s.coins >= POND_PRICE[s.ponds.length] && freeCount(s) >= 2; }
  // Is there a k x k block of water containing idx?
  function squareAt(grid, idx, k) {
    var r = (idx / W) | 0, c = idx % W;
    for (var r0 = Math.max(0, r - k + 1); r0 <= Math.min(r, H - k); r0++) for (var c0 = Math.max(0, c - k + 1); c0 <= Math.min(c, W - k); c0++) {
      var all = true;
      for (var a = 0; a < k && all; a++) for (var b = 0; b < k; b++) if (grid[(r0 + a) * W + c0 + b] !== WATER) { all = false; break; }
      if (all) return true;
    }
    return false;
  }
  // The biggest square lake on the board (0 when there is no water), for the quest progress line.
  function bestLake(state) {
    dim(state);
    var best = 0;
    for (var i = 0; i < N; i++) if (state.grid[i] === WATER) for (var k = best + 1; k <= Math.min(W, H) && squareAt(state.grid, i, k); k++) best = k;
    return best;
  }
  // Shop: dig a pond on the empty tile idx (free action, always leaves one free tile). Returns {state, events} or null.
  function buyPond(state, idx) {
    dim(state);
    if (!canPond(state) || !(idx >= 0 && idx < N) || state.grid[idx] !== EMPTY || state.bridges.indexOf(idx) >= 0) return null;
    var s = clone(state), price = POND_PRICE[state.ponds.length], events = [{ type: 'pond', at: idx, price: price }];
    s.coins -= price;
    s.grid[idx] = WATER; s.ponds.push(idx); s.ponds.sort(function (a, b) { return a - b; });
    while (s.lake < LAKE_SIZES.length && squareAt(s.grid, idx, LAKE_SIZES[s.lake])) {
      var bonus = BASE[s.top] * LAKE_BONUS[s.lake];
      s.score += bonus; s.bonusScore += bonus; s.coins += LAKE_COINS[s.lake];
      events.push({ type: 'lake', size: LAKE_SIZES[s.lake], points: bonus, coins: LAKE_COINS[s.lake] });
      s.lake++;
    }
    grantMilestones(s, events);
    return { state: s, events: events };
  }

  // Shop: buy one more row (top/bottom) or column (left/right) of land; each side once, dearer every time. Free action.
  // Returns {state, events} or null.
  function buyLand(state, side) {
    dim(state);
    if (state.over || SIDES.indexOf(side) < 0 || state.land.indexOf(side) >= 0 || !canLand(state)) return null;
    var s = clone(state), g = state.grid, w = W, h = H;
    s.coins -= LAND_PRICE[state.land.length];
    s.land.push(side);
    if (side === 'top') { g = new Array(w).fill(EMPTY).concat(g); s.h++; }
    else if (side === 'bottom') { g = g.concat(new Array(w).fill(EMPTY)); s.h++; }
    else {
      var out = [];
      for (var r = 0; r < h; r++) { var row = g.slice(r * w, (r + 1) * w); out = out.concat(side === 'left' ? [EMPTY].concat(row) : row.concat([EMPTY])); }
      g = out; s.w++;
    }
    // water that touches the edge carries on into the new row / column (a river keeps running off the map); everything else is new land
    var isW = function (i) { return state.grid[i] === WATER || state.bridges.indexOf(i) >= 0; };
    for (var k = 0; k < (side === 'top' || side === 'bottom' ? w : h); k++) {
      var src = side === 'top' ? k : side === 'bottom' ? (h - 1) * w + k : side === 'left' ? k * w : k * w + w - 1;
      var dst = side === 'top' ? k : side === 'bottom' ? h * w + k : side === 'left' ? k * (w + 1) : k * (w + 1) + w;
      if (isW(src)) g[dst] = WATER;
    }
    s.grid = g;
    var remap = function (i) { // the new row / column moves every index
      var r = (i / w) | 0, c = i % w;
      return side === 'top' ? i + w : side === 'bottom' ? i : side === 'left' ? r * (w + 1) + c + 1 : r * (w + 1) + c;
    };
    s.bridges = state.bridges.map(remap); s.ponds = state.ponds.map(remap); s.bankOrder = state.bankOrder.map(remap);
    s.loans.forEach(function (l) { l.bank = remap(l.bank); l.at = remap(l.at); });
    dim(s);
    s.over = isOver(s); // a strip that is all water adds no free tile
    return { state: s, events: [{ type: 'land', side: side, w: s.w, h: s.h }] };
  }

  // What would placing the current item at idx do? Pure (no animal movement, no rng use). Returns null for an illegal move,
  // else {item, final (code left on idx), eaten (other cells emptied by merges), points, coins, merged}.
  function preview(state, idx) {
    dim(state);
    if (state.over || !(idx >= 0 && idx < N) || state.grid[idx] !== EMPTY || state.bridges.indexOf(idx) >= 0) return null;
    var s = clone(state), events = [], eaten = [], pts = 0, coins = 0;
    applyItem(s, idx, s.cur, events);
    for (var i = 0; i < N; i++) if (i !== idx && state.grid[i] !== EMPTY && s.grid[i] === EMPTY) eaten.push(i);
    events.forEach(function (e) { if (e.type === 'merge') { pts += e.points; coins += e.coins; } });
    return { item: state.cur, final: s.grid[idx], eaten: eaten, points: pts, coins: coins, merged: events.some(function (e) { return e.type === 'merge'; }) };
  }

  // What would moving the item on `from` to the empty cell `to` do? Pure. Same shape as preview(); `eaten` never lists `from`.
  function previewMove(state, from, to) {
    dim(state);
    if (!moveLegal(state, from, to)) return null;
    var s = clone(state), events = [], eaten = [], pts = 0, coins = 0, item = state.grid[from];
    s.grid[from] = EMPTY;
    applyItem(s, to, item, events);
    for (var i = 0; i < N; i++) if (i !== to && i !== from && state.grid[i] !== EMPTY && s.grid[i] === EMPTY) eaten.push(i);
    events.forEach(function (e) { if (e.type === 'merge') { pts += e.points; coins += e.coins; } });
    return { item: item, final: s.grid[to], eaten: eaten, points: pts, coins: coins, merged: events.some(function (e) { return e.type === 'merge'; }) };
  }

  // Undo is possible when there is a snapshot and the player can pay UNDO_COST (taken from the restored coins).
  function canUndo(state) { return !!state.undo && state.undo.coins >= UNDO_COST; }

  // Revert the last placement (one level, including any shop use / swap / land bought since) for UNDO_COST coins.
  // Returns null if there is nothing to undo or the player cannot pay.
  function undo(state) {
    if (!canUndo(state)) return null;
    var s = clone(state.undo);
    dim(s);
    s.undo = null; s.coins -= UNDO_COST; s.over = isOver(s);
    return s;
  }

  // Old (version 1) saves used other codes for everything after the tree: hut..grand castle moved up one or more places
  // to make room for the new building tiers, and the bear chain moved to the end of the table.
  var V1_CODE = { 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: BEAR, 10: TOMB, 11: CHURCH, 12: CATHEDRAL, 13: CRYSTAL, 14: TREASURE };
  function v1Code(v) { return V1_CODE[v] || v; }
  function upgradeV1(x) {
    if (Array.isArray(x.grid)) x.grid = x.grid.map(v1Code);
    ['cur', 'next', 'hold'].forEach(function (k) { if (x[k]) x[k] = v1Code(x[k]); });
    var ns = Object.assign({}, START_STOCK);
    if (x.stock && typeof x.stock === 'object') for (var k in x.stock) ns[k === '13' ? CRYSTAL : k] = x.stock[k];
    x.stock = ns;
    x.ver = VERSION; x.w = DEFAULT_W; x.h = DEFAULT_H; x.land = [];
    x.top = STARTER_TIER;
    if (Array.isArray(x.grid)) x.grid.forEach(function (v) { if (v > x.top && v <= LAST_BUILDING) x.top = v; });
  }

  // Fill in fields that older saves lack (coins, stock, milestone, land, new codes) on s and its undo snapshot. Mutates s.
  // Every save is settled once: tiers that no longer end the chain (the old grand castles) and gems that sat inert in a group of
  // three may now merge, and a save with such a group would be invalid.
  function migrate(s) {
    [s, s && s.undo].forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      if (typeof x.coins !== 'number') x.coins = START_COINS;
      var old = !(x.ver >= VERSION);
      if (old) upgradeV1(x);
      if (!x.stock || typeof x.stock !== 'object') x.stock = Object.assign({}, START_STOCK);
      for (var sk in START_STOCK) if (typeof x.stock[sk] !== 'number') x.stock[sk] = START_STOCK[sk]; // items added since the save was made
      if (!Array.isArray(x.bridges)) x.bridges = [];
      if (!Array.isArray(x.ponds)) x.ponds = []; // dug ponds and lake quests came later
      if (typeof x.lake !== 'number') x.lake = 0;
      if (typeof x.tick !== 'number') x.tick = 0; // the calendar and banks came later
      if (typeof x.speed !== 'number') x.speed = 1;
      if (!Array.isArray(x.loans)) x.loans = [];
      if (!Array.isArray(x.bankOrder)) x.bankOrder = [];
      if (typeof x.banksBought !== 'number') x.banksBought = Array.isArray(x.grid) ? x.grid.filter(function (v) { return v === BANK; }).length : 0;
      if (MAPS.indexOf(x.map) < 0) x.map = 'easy'; // every older game was played on the plain field
      if (typeof x.bears !== 'boolean') x.bears = true; // bears and foxes can be switched off per game; every older game has both
      if (typeof x.foxes !== 'boolean') x.foxes = true;
      if (typeof x.wild !== 'boolean') x.wild = false; // Wild bears is chosen per game; every older game is a classic one
      if (typeof x.bonusScore !== 'number') x.bonusScore = 0; // pond income / lake bonuses (they do not count towards restocks)
      if (typeof x.milestone !== 'number') { x.milestone = 0; while (milestoneProgress(x) >= milestoneScore(x.milestone)) x.milestone++; }
      if (Array.isArray(x.grid) && x.grid.length === (x.w || DEFAULT_W) * (x.h || DEFAULT_H)) {
        dim(x);
        settleBanks(x);
        var ev = [];
        for (var i = 0; i < N; i++) resolveAt(x, i, ev);
        settleCrystals(x, ev);
        grantMilestones(x, ev);
        x.over = isOver(x);
      }
    });
    return s;
  }

  // Returns a list of problems (empty = valid). Used by tests and before restoring a saved game.
  function validate(s) {
    var p = [], i;
    if (!s || typeof s !== 'object') return ['bad state'];
    var ok = function (v) { return v === (v | 0) && v >= DEFAULT_W && v <= DEFAULT_W + 2; };
    if (!ok(s.w) || !ok(s.h) || !Array.isArray(s.land)) return ['bad board size'];
    if (typeof s.wild !== 'boolean') return ['bad wild flag'];
    if (typeof s.bears !== 'boolean' || typeof s.foxes !== 'boolean') return ['bad animal flags'];
    if (s.wild && !s.bears) return ['wild bears without bears'];
    if (MAPS.indexOf(s.map) < 0) return ['bad map'];
    dim(s);
    if (!Array.isArray(s.grid) || s.grid.length !== N) return ['bad grid'];
    if (!Array.isArray(s.bridges) || s.bridges.length > MAX_BRIDGES) return ['bad bridges'];
    var seenB = {};
    for (i = 0; i < s.bridges.length; i++) {
      var bi = s.bridges[i];
      if (bi !== (bi | 0) || bi < 0 || bi >= N || seenB[bi] || s.grid[bi] === WATER) return ['bad bridge at ' + bi];
      seenB[bi] = true;
    }
    if (!Array.isArray(s.ponds) || s.ponds.length > MAX_PONDS || !(s.lake >= 0 && s.lake <= LAKE_SIZES.length) || s.lake !== (s.lake | 0)) return ['bad ponds'];
    var seenP = {};
    for (i = 0; i < s.ponds.length; i++) {
      var pi = s.ponds[i];
      if (pi !== (pi | 0) || pi < 0 || pi >= N || seenP[pi] || s.grid[pi] !== WATER) return ['bad pond at ' + pi];
      seenP[pi] = true;
    }
    var lr = 0, tb = 0;
    s.land.forEach(function (side, k) {
      if (SIDES.indexOf(side) < 0 || s.land.indexOf(side) !== k) p.push('bad land ' + side);
      else if (side === 'left' || side === 'right') lr++; else tb++;
    });
    if (s.w !== DEFAULT_W + lr || s.h !== DEFAULT_H + tb) p.push('board size does not match the land bought');
    for (i = 0; i < N; i++) {
      var v = s.grid[i];
      if (v !== (v | 0) || v < 0 || v > SEIZED) p.push('bad code at ' + i + ': ' + v);
      else if (!s.bears && !s.foxes && (v === TOMB || v === CHURCH || v === CATHEDRAL)) p.push('graves in a calm game at ' + i);
      else if (!s.bears && isBear(v)) p.push('bear in a no-bears game at ' + i);
      else if (!s.foxes && v === FOX) p.push('fox in a no-foxes game at ' + i);
      else if (!s.wild && (v === BEAR_GROWL || v === BEAR_ANGRY)) p.push('angry bear in a classic game at ' + i);
    }
    if (p.length) return p;
    if (QUEUE_ITEMS.indexOf(s.cur) < 0) p.push('bad current item ' + s.cur);
    if (QUEUE_ITEMS.indexOf(s.next) < 0) p.push('bad next item ' + s.next);
    if (s.hold && QUEUE_ITEMS.indexOf(s.hold) < 0) p.push('bad hold ' + s.hold);
    if (s.hold === BANK) p.push('a bank in the reserve');
    if (bankSlots(s) > MAX_BANKS) p.push('more than ' + MAX_BANKS + ' banks');
    if (!Array.isArray(s.loans) || !Array.isArray(s.bankOrder)) return ['bad loans'];
    var perBank = {}, seizedWanted = 0, boSeen = {};
    for (i = 0; i < s.bankOrder.length; i++) { var bo = s.bankOrder[i]; if (boSeen[bo] || s.grid[bo] !== BANK) return ['bad bank order at ' + bo]; boSeen[bo] = true; }
    if (s.bankOrder.length !== s.grid.filter(function (v) { return v === BANK; }).length) return ['bank order does not list every bank'];
    var atSeen = {};
    for (i = 0; i < s.loans.length; i++) {
      var ln = s.loans[i];
      if (!ln || ln.bank !== (ln.bank | 0) || ln.at !== (ln.at | 0) || s.grid[ln.bank] !== BANK || neighbors(ln.bank).indexOf(ln.at) < 0 || atSeen[ln.at]) return ['bad loan ' + i];
      atSeen[ln.at] = true;
      if (!(ln.principal > 0) || ln.principal !== (ln.principal | 0) || !(ln.rate > 0) || ln.since !== (ln.since | 0) || ln.since > s.tick || ln.since < 0) return ['bad loan terms ' + i];
      if (ln.defaulted ? s.grid[ln.at] !== SEIZED : !(s.grid[ln.at] >= 1 && s.grid[ln.at] <= LAST_BUILDING)) return ['loan ' + i + ' collateral is wrong'];
      if (ln.defaulted) seizedWanted++;
      perBank[ln.bank] = (perBank[ln.bank] || 0) + 1;
      if (perBank[ln.bank] > 4) return ['more than 4 loans on a bank'];
    }
    if (s.grid.filter(function (v) { return v === SEIZED; }).length !== seizedWanted) return ['seized lots and defaulted loans differ'];
    if (s.tick !== (s.tick | 0) || s.tick < 0 || !(s.speed >= 0 && s.speed <= MAX_SPEED) || s.speed !== (s.speed | 0) || s.banksBought !== (s.banksBought | 0) || s.banksBought < bankSlots(s)) p.push('bad calendar / banks');
    [s.cur, s.next, s.hold].forEach(function (it) {
      if ((it === BEAR && !s.bears) || (it === FOX && !s.foxes)) p.push('switched-off animal in the queue');
    });
    if (typeof s.score !== 'number' || s.score < 0 || s.score !== (s.score | 0)) p.push('bad score ' + s.score);
    if (typeof s.coins !== 'number' || s.coins < 0 || s.coins !== (s.coins | 0)) p.push('bad coins ' + s.coins);
    if (!(s.top >= 1 && s.top <= LAST_BUILDING) || s.top !== (s.top | 0)) p.push('bad top tier ' + s.top);
    if (!s.stock || typeof s.stock !== 'object') return ['bad stock'];
    for (var sk in START_STOCK) {
      var n = s.stock[sk];
      if (typeof n !== 'number' || n !== (n | 0) || ((sk === 'hammer' || sk === 'trap' || sk === 'move') && n < 0)) p.push('bad stock ' + sk + ': ' + n);
    }
    if (!(s.milestone >= 0) || s.milestone !== (s.milestone | 0)) p.push('bad milestone ' + s.milestone);
    else if (milestoneProgress(s) < (s.milestone ? milestoneScore(s.milestone - 1) : 0) || milestoneProgress(s) >= milestoneScore(s.milestone)) p.push('milestone ' + s.milestone + ' inconsistent with score ' + s.score);
    if (!(s.bonusScore >= 0) || s.bonusScore !== (s.bonusScore | 0) || s.bonusScore > s.score) p.push('bad bonus score ' + s.bonusScore);
    if (p.length) return p;
    if (s.over !== isOver(s)) p.push('over flag inconsistent with grid/coins');
    // after a resolved turn no mergeable group of 3+ may remain
    var seen = {};
    for (i = 0; i < N; i++) {
      var c = s.grid[i];
      if ((NEXT[c] || c === CRYSTAL) && !seen[i] && !LOCK[i]) {
        var g = group(s.grid, i, c);
        g.forEach(function (k) { seen[k] = true; });
        if (g.length >= 3) p.push('unmerged group of ' + NAME[c] + ' at ' + i);
      }
    }
    // a crystal that could merge must already have done so
    for (i = 0; i < N; i++) if (s.grid[i] === CRYSTAL && crystalTier(s.grid.slice(), i)) p.push('crystal at ' + i + ' could merge');
    return p;
  }

  return {
    W: DEFAULT_W, H: DEFAULT_H, N: DEFAULT_W * DEFAULT_H, MAX_LAND: SIDES.length, SIDES: SIDES, LAND_PRICE: LAND_PRICE, LAST_BUILDING: LAST_BUILDING, VERSION: VERSION,
    EMPTY: EMPTY, CASH: CASH, BEAR: BEAR, BEAR_GROWL: BEAR_GROWL, BEAR_ANGRY: BEAR_ANGRY, WATER: WATER, MAUL_MAX: MAUL_MAX, isBear: isBear, MAPS: MAPS, LUCKY_RATE: LUCKY_RATE, LUCKY_MIN_TIER: LUCKY_MIN_TIER, LUCKY_MAX_TIER: LUCKY_MAX_TIER, MEDIUM_WATER: MEDIUM_WATER, STANDARD_ITEMS: STANDARD_ITEMS,
    BREED_MAX_POCKET: BREED_MAX_POCKET, BREED_MAX_BEARS: BREED_MAX_BEARS, BREED_CHANCE: BREED_CHANCE, TOMB: TOMB, CHURCH: CHURCH, CATHEDRAL: CATHEDRAL, CRYSTAL: CRYSTAL, TREASURE: TREASURE, FOX: FOX,
    TREASURE_COINS: TREASURE_COINS, CASH_COINS: CASH_COINS,
    EMOJI: EMOJI, NAME: NAME, NEXT: NEXT, BASE: BASE, WEIGHTS: WEIGHTS, TRAP_DROP: TRAP_DROP,
    START_COINS: START_COINS, COIN: COIN, PRICE: PRICE, BUYABLE: BUYABLE, UNDO_COST: UNDO_COST, START_STOCK: START_STOCK,
    RESTOCK: RESTOCK, MILESTONES: MILESTONES, milestoneScore: milestoneScore, milestoneProgress: milestoneProgress, canUndo: canUndo, canHammer: canHammer, migrate: migrate,
    rand: rand, drawItem: drawItem, newGame: newGame, neighbors: neighbors, group: group,
    place: place, swap: swap, swapNext: swapNext, undo: undo, validate: validate, emptyCount: emptyCount,
    buy: buy, hammer: hammer, trap: trap, move: move, open: open, buyLand: buyLand, buyBridge: buyBridge, borrow: borrow, repay: repay, setSpeed: setSpeed, lockedCells: lockedCells, loanOptions: loanOptions, loanOwed: loanOwed, loanMonthsLeft: loanMonthsLeft, bankRate: bankRate, SEIZED: SEIZED, LOAN_RATE: LOAN_RATE, LOAN_TICKS: LOAN_TICKS, MAX_SPEED: MAX_SPEED, buyBank: buyBank, bankPrice: bankPrice, bankCount: bankCount, bankSlots: bankSlots, bankIncome: bankIncome, canBuyBank: canBuyBank, isBankAvailable: isBankAvailable, calendar: calendar, BANK: BANK, MAX_BANKS: MAX_BANKS, BANK_PRICE: BANK_PRICE, BANK_MIN_TIER: BANK_MIN_TIER, TICKS_PER_MONTH: TICKS_PER_MONTH, MONTHS_PER_YEAR: MONTHS_PER_YEAR, buyPond: buyPond, pondPrice: pondPrice, pondPoints: pondPoints, canPond: canPond, bestLake: bestLake, MAX_PONDS: MAX_PONDS, POND_PRICE: POND_PRICE, LAKE_SIZES: LAKE_SIZES, LAKE_BONUS: LAKE_BONUS, LAKE_COINS: LAKE_COINS, bridgeSpots: bridgeSpots, bridgePrice: bridgePrice, canBridge: canBridge, freeCount: freeCount, MAX_BRIDGES: MAX_BRIDGES, BRIDGE_PRICE: BRIDGE_PRICE, preview: preview, previewMove: previewMove, isOver: isOver,
    priceOf: priceOf, isMovable: isMovable, canMove: canMove, isAvailable: isAvailable, unlockedTop: unlockedTop, landPrice: landPrice, canLand: canLand
  };
});
