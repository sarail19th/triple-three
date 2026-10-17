// Logic tests for Triple Three. Run: node test/test.js
const assert = require('assert');
const TT = require('../src/logic.js');

let n = 0;
const t = (name, fn) => { fn(); n++; };
const blank = (over = {}) => Object.assign(TT.newGame(7), { cur: 1, next: 1, hold: 0 }, over);
const withGrid = (cells, over = {}) => {
  const s = blank(over);
  for (const k in cells) s.grid[k] = cells[k];
  return s;
};
const I = (r, c) => r * TT.W + c;

t('rng is deterministic and uniform-ish', () => {
  const a = { rng: 42 }, b = { rng: 42 };
  for (let i = 0; i < 100; i++) assert.strictEqual(TT.rand(a), TT.rand(b));
  const s = { rng: 1 }; let sum = 0;
  for (let i = 0; i < 20000; i++) { const x = TT.rand(s); assert(x >= 0 && x < 1); sum += x; }
  assert(Math.abs(sum / 20000 - 0.5) < 0.02);
});

t('queue distribution matches weights', () => {
  const s = { rng: 99 }, cnt = {};
  for (let i = 0; i < 20000; i++) { const d = TT.drawItem(s); cnt[d] = (cnt[d] || 0) + 1; }
  TT.WEIGHTS.forEach(([code, w]) => assert(Math.abs(cnt[code] / 200 - w) < 2, `item ${code}: ${cnt[code] / 200}% vs ${w}%`));
});

t('same seed => same game; different seed differs', () => {
  const play = (seed) => { let s = TT.newGame(seed); for (let k = 0; k < 10; k++) { const e = s.grid.findIndex((v) => v === 0); s = TT.place(s, e).state; } return JSON.stringify(s); };
  assert.strictEqual(play(5), play(5));
  assert.notStrictEqual(play(5), play(6));
});

t('three grass merge into a bush on the tapped cell', () => {
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1 });
  const r = TT.place(s, I(2, 3));
  assert.strictEqual(r.state.grid[I(2, 3)], 2);
  assert.strictEqual(r.state.grid[I(2, 2)], 0);
  assert.strictEqual(r.state.grid[I(2, 4)], 0);
  assert.strictEqual(r.state.score, 3 * TT.BASE[1]);
});

t('diagonal / non-connected does not merge', () => {
  const s = withGrid({ [I(1, 1)]: 1, [I(2, 2)]: 1 });
  const r = TT.place(s, I(3, 3));
  assert.strictEqual(r.state.score, 0);
  assert.strictEqual(r.state.grid[I(3, 3)], 1);
});

t('five connected grass (plus shape) merge into one bush', () => {
  const s = withGrid({ [I(0, 0)]: 1, [I(1, 0)]: 1, [I(3, 0)]: 1, [I(2, 1)]: 1 });
  const r = TT.place(s, I(2, 0));
  assert.strictEqual(r.state.grid[I(2, 0)], 2);
  assert.strictEqual(r.state.grid.filter((v) => v === 1).length, 0);
  assert.strictEqual(r.state.score, 5 * TT.BASE[1]);
});

t('chain merge: result keeps merging with neighbours', () => {
  // two bushes next to the spot where 3 grass will make a third bush -> bush group -> tree
  const s = withGrid({ [I(0, 0)]: 1, [I(0, 2)]: 1, [I(1, 1)]: 2, [I(1, 2)]: 2 });
  const r = TT.place(s, I(0, 1));
  assert.strictEqual(r.state.grid[I(0, 1)], 3, 'grass trio -> bush -> bush trio -> tree');
  assert.strictEqual(r.events.filter((e) => e.type === 'merge').length, 2);
  assert.strictEqual(r.state.score, 3 * TT.BASE[1] + 3 * TT.BASE[2]);
});

t('bear chain: tombs -> church -> cathedral -> treasure in one chain; treasure is final', () => {
  const s = withGrid({ [I(2, 2)]: TT.BEAR, [I(2, 1)]: 5, [I(2, 3)]: TT.TOMB, [I(2, 4)]: TT.TOMB, [I(1, 2)]: TT.CHURCH, [I(0, 2)]: TT.CHURCH, [I(3, 2)]: TT.CATHEDRAL, [I(4, 2)]: TT.CATHEDRAL });
  const r = TT.place(s, I(5, 5)); // the bear at (2,2) has no exit: tomb -> church -> cathedral -> treasure
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE);
  assert.strictEqual(r.events.filter((e) => e.type === 'merge').length, 3);
  assert.deepStrictEqual(TT.validate(r.state), []);
  const g = withGrid({ [I(0, 0)]: TT.TREASURE, [I(0, 1)]: TT.TREASURE, [I(0, 2)]: TT.TREASURE });
  assert.deepStrictEqual(TT.validate(g), [], 'treasures never merge');
});

t('open: treasure pays coins, free action, only on a treasure', () => {
  const s = withGrid({ [I(1, 1)]: TT.TREASURE, [I(2, 2)]: 5 }, { coins: 3 });
  const r = TT.open(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 0); assert.strictEqual(r.state.coins, 3 + TT.TREASURE_COINS);
  assert.strictEqual(r.state.turn, s.turn);
  assert.deepStrictEqual(TT.validate(r.state), []);
  assert.strictEqual(TT.open(s, I(2, 2)), null); assert.strictEqual(TT.open(s, I(0, 0)), null);
});

t('final tiers never merge', () => {
  const g = withGrid({ [I(0, 0)]: TT.CASH, [I(0, 1)]: TT.CASH, [I(0, 2)]: TT.CASH, [I(3, 0)]: TT.TREASURE, [I(3, 1)]: TT.TREASURE, [I(3, 2)]: TT.TREASURE });
  assert.deepStrictEqual(TT.validate(g), [], 'cash and treasures are final');
});

t('mall trio (via crystal) becomes cash', () => {
  const s = withGrid({ [I(0, 0)]: TT.LAST_BUILDING, [I(0, 2)]: TT.LAST_BUILDING }, { cur: TT.CRYSTAL });
  const r = TT.place(s, I(0, 1));
  assert.strictEqual(r.state.grid[I(0, 1)], TT.CASH);
});

t('crystal picks the best merge available, else waits as an inert wildcard', () => {
  let s = withGrid({ [I(0, 0)]: 1, [I(0, 2)]: 1, [I(2, 1)]: 3, [I(3, 1)]: 3 }, { cur: TT.CRYSTAL });
  // cell (1,1): up (0,1) empty, left/right (1,0)/(1,2) empty, down (2,1) tree -> crystal as tree makes tree trio with (2,1),(3,1)
  let r = TT.place(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 4, 'tree trio -> camp');
  s = withGrid({ [I(0, 0)]: 1 }, { cur: TT.CRYSTAL });
  r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(5, 5)], TT.CRYSTAL);
});

t('crystal also stands in for cathedral / church / tombstone (bear chain)', () => {
  let s = withGrid({ [I(2, 1)]: TT.CATHEDRAL, [I(2, 3)]: TT.CATHEDRAL }, { cur: TT.CRYSTAL });
  let r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE, 'crystal as cathedral -> treasure');
  s = withGrid({ [I(2, 1)]: TT.CHURCH, [I(2, 3)]: TT.CHURCH }, { cur: TT.CRYSTAL });
  assert.strictEqual(TT.place(s, I(2, 2)).state.grid[I(2, 2)], TT.CATHEDRAL, 'crystal as church -> cathedral');
  s = withGrid({ [I(2, 1)]: TT.TOMB, [I(2, 3)]: TT.TOMB }, { cur: TT.CRYSTAL });
  assert.strictEqual(TT.place(s, I(2, 2)).state.grid[I(2, 2)], TT.CHURCH, 'crystal as tombstone -> church');
  assert.strictEqual(TT.preview(s, I(2, 2)).final, TT.CHURCH);
});

t('a waiting crystal merges as soon as a later placement makes a group possible', () => {
  let s = withGrid({ [I(2, 2)]: TT.CRYSTAL, [I(2, 1)]: 1 }, { cur: 1, next: 1 });
  assert.deepStrictEqual(TT.validate(s), [], 'crystal + one grass cannot merge yet');
  const r = TT.place(s, I(2, 3)); // grass on the other side: grass, crystal, grass -> trio
  assert.strictEqual(r.state.grid[I(2, 2)], 2, 'crystal acted as grass; the trio became a bush on the crystal cell');
  assert.strictEqual(r.state.grid.filter((v) => v === TT.CRYSTAL).length, 0);
  assert(r.events.some((e) => e.type === 'crystal' && e.at === I(2, 2)));
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('4 connected items merge into ONE next-tier item and consume all four (no leftover); score scales with group size', () => {
  const s = withGrid({ [I(2, 0)]: 1, [I(2, 1)]: 1, [I(2, 3)]: 1 });
  const r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid.filter((v) => v === 1).length, 0, 'no grass left over');
  assert.strictEqual(r.state.grid.filter((v) => v === 2).length, 1, 'exactly one bush');
  assert.strictEqual(r.state.score, 4 * TT.BASE[1]);
  assert.strictEqual(r.state.coins, TT.START_COINS + 2 * TT.COIN[1], 'a bigger group pays more coins');
});

t('merges pay coins: (group - 2) * COIN[tier]', () => {
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1 });
  const r = TT.place(s, I(2, 3));
  assert.strictEqual(r.state.coins, TT.START_COINS + TT.COIN[1]);
  assert.strictEqual(r.events.find((e) => e.type === 'merge').coins, TT.COIN[1]);
});

t('buy: spends coins, makes the item current, pushes the old current to next, free action', () => {
  const s = withGrid({}, { cur: TT.BEAR, next: 3, coins: 50 });
  const b = TT.buy(s, 2);
  assert.strictEqual(b.cur, 2); assert.strictEqual(b.next, TT.BEAR); assert.strictEqual(b.coins, 50 - TT.PRICE[2]);
  assert.strictEqual(b.turn, s.turn, 'buying is free');
  assert.deepStrictEqual(TT.validate(b), []);
  assert.strictEqual(TT.buy(withGrid({}, { coins: TT.PRICE[3] - 1 }), 3), null, 'cannot afford');
  assert.strictEqual(TT.buy(withGrid({}, { cur: 1, coins: 99 }), 1), null, 'already current');
  assert.strictEqual(TT.buy(s, TT.BEAR), null, 'not for sale');
});

t('shop stock: while it lasts the price is flat, past zero it doubles for every purchase; hammer and trap just run out', () => {
  let s = withGrid({}, { cur: TT.BEAR, coins: 5000 });
  for (let k = 0; k < TT.START_STOCK[1]; k++) { assert.strictEqual(TT.priceOf(s, 1), TT.PRICE[1]); const c = s.coins; s.cur = TT.BEAR; s = TT.buy(s, 1); assert(s, 'stock left'); assert.strictEqual(c - s.coins, TT.PRICE[1]); }
  assert.strictEqual(s.stock[1], 0);
  for (let extra = 1; extra <= 3; extra++) {
    assert.strictEqual(TT.priceOf(s, 1), TT.PRICE[1] * 2 ** extra, 'purchase ' + extra + ' past the stock');
    const c = s.coins; s.cur = TT.BEAR; s = TT.buy(s, 1);
    assert.strictEqual(c - s.coins, TT.PRICE[1] * 2 ** extra);
    assert.deepStrictEqual(TT.validate(s), [], 'negative stock (debt) is valid');
  }
  s.cur = TT.BEAR; s.coins = TT.priceOf(s, 1) - 1;
  assert.strictEqual(TT.buy(s, 1), null, 'cannot afford the surcharge');
  assert.strictEqual(TT.buy(withGrid({}, { coins: 500, cur: TT.BEAR }), TT.CRYSTAL), null, 'crystal is locked until the first milestone');
  const h = withGrid({ [I(0, 0)]: 5 }, { coins: 500 });
  h.stock.hammer = 0;
  assert.strictEqual(TT.hammer(h, I(0, 0)), null, 'no hammers left');
  const tp = withGrid({ [I(0, 0)]: TT.BEAR }, { coins: 500 });
  tp.stock.trap = 0;
  assert.strictEqual(TT.trap(tp, I(0, 0)), null, 'no traps left');
});

t('a milestone restock pays back stock debt', () => {
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1 }, { score: TT.milestoneScore(0) - 10 });
  s.stock[1] = -2;
  const r = TT.place(s, I(2, 3));
  assert.strictEqual(r.state.stock[1], -2 + TT.RESTOCK[1]);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('higher building tiers unlock in the shop once one has stood on the board', () => {
  let s = withGrid({ [I(1, 1)]: 5, [I(1, 2)]: 5 }, { cur: 5, coins: 1000 });
  assert(TT.isAvailable(s, 3) && !TT.isAvailable(s, 4) && !TT.isAvailable(s, 6), 'grass/bush/tree only at the start');
  assert.strictEqual(TT.buy(s, 4), null, 'camp is locked');
  const r = TT.place(s, I(1, 3)); // hut trio -> house
  assert.strictEqual(r.state.grid[I(1, 3)], 6);
  assert.strictEqual(r.state.top, 6);
  assert(r.events.some((e) => e.type === 'tierunlock' && e.tier === 6));
  s = r.state;
  [4, 5, 6].forEach((t) => assert(TT.isAvailable(s, t), 'tier ' + t + ' unlocked'));
  assert(!TT.isAvailable(s, 7), 'only up to the best tier reached');
  s.cur = 1; s.coins = 1000;
  const b = TT.buy(s, 6);
  assert.strictEqual(b.cur, 6); assert.strictEqual(b.coins, 1000 - TT.PRICE[6]);
  assert.deepStrictEqual(TT.validate(b), []);
  // the unlock sticks after the house itself is gone
  assert(TT.isAvailable(TT.hammer(Object.assign({}, s, { coins: 1000 }), I(1, 3)).state, 6));
});

t('score milestones restock the shop (crystal unlocks) and the state stays valid', () => {
  assert.strictEqual(TT.START_STOCK[TT.CRYSTAL], 0);
  const m = TT.milestoneScore(0);
  // score just below the first milestone, then a grass trio pushes it over
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1 }, { score: m - 10 });
  const r = TT.place(s, I(2, 3));
  assert(r.state.score >= m && r.state.milestone === 1);
  assert(r.events.some((e) => e.type === 'unlock'));
  assert.strictEqual(r.state.stock[TT.CRYSTAL], 1);
  assert.strictEqual(r.state.stock[1], TT.START_STOCK[1] + TT.RESTOCK[1]);
  assert.strictEqual(r.state.stock[4], TT.START_STOCK[4], 'locked tiers are not restocked');
  assert.deepStrictEqual(TT.validate(r.state), []);
  const bought = TT.buy(Object.assign(r.state, { cur: 1, coins: 100 }), TT.CRYSTAL);
  assert.strictEqual(bought.cur, TT.CRYSTAL); assert.strictEqual(bought.coins, 100 - TT.PRICE[TT.CRYSTAL]);
  assert.deepStrictEqual(TT.validate(bought), []);
});

t('a full board with money but no hammers left is game over, unless land can still be bought', () => {
  const cells = {};
  for (let i = 0; i < 35; i++) cells[i] = ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6;
  const s = withGrid(cells, { cur: 4, coins: TT.LAND_PRICE[0] - 1 });
  s.stock.hammer = 0;
  assert(TT.place(s, 35).state.over, 'no hammer and too poor for land');
  const rich = withGrid(cells, { cur: 4, coins: 500 });
  rich.stock.hammer = 0;
  const f = TT.place(rich, 35).state;
  assert(!f.over, 'can still buy land');
  assert.deepStrictEqual(TT.validate(f), []);
});

t('undo costs coins; refused when the restored state cannot pay', () => {
  const s = withGrid({}, { coins: 4 });
  const a = TT.place(s, I(0, 0)).state;
  assert(!TT.canUndo(a) && TT.undo(a) === null, 'cannot afford undo');
  const rich = TT.place(withGrid({}, { coins: 30 }), I(0, 0)).state;
  assert(TT.canUndo(rich));
  assert.strictEqual(TT.undo(rich).coins, 30 - TT.UNDO_COST);
});

t('migrate fills coins / stock / milestone for old saves, including the undo snapshot', () => {
  const old = JSON.parse(JSON.stringify(TT.newGame(3)));
  delete old.coins; delete old.stock; delete old.milestone;
  old.score = 1500; old.undo = JSON.parse(JSON.stringify(old)); old.undo.undo = null;
  TT.migrate(old);
  assert.strictEqual(old.coins, TT.START_COINS); assert.strictEqual(old.milestone, 2); assert.strictEqual(old.undo.milestone, 2);
  assert.deepStrictEqual(TT.validate(old), []);
});

t('migrate upgrades a version-1 save: codes shift, grand castles merge into malls, bears keep walking', () => {
  const g = new Array(36).fill(0);
  [14, 15, 16, 21].forEach((i) => { g[i] = 8; });        // 4 connected grand castles (a dead end in v1)
  g[0] = 9; g[1] = 10; g[2] = 11; g[3] = 12; g[4] = 14; g[5] = 13; g[6] = 4; g[7] = 7; // bear, tomb, church, cathedral, treasure, crystal, hut, castle
  const old = { grid: g, cur: 9, next: 13, hold: 4, score: 737910, coins: 13392, stock: { 1: 5, 2: 0, 3: 1, 13: 2, hammer: 1, trap: 0 }, milestone: 0, turn: 300, over: false, rng: 5, seed: 5,
    undo: null };
  while (old.score >= TT.milestoneScore(old.milestone)) old.milestone++;
  old.undo = JSON.parse(JSON.stringify(old));
  TT.migrate(old);
  assert.deepStrictEqual(TT.validate(old), []);
  assert.strictEqual(old.ver, TT.VERSION); assert.strictEqual(old.w, 6); assert.deepStrictEqual(old.land, []);
  assert.strictEqual(old.cur, TT.BEAR); assert.strictEqual(old.next, TT.CRYSTAL); assert.strictEqual(old.hold, 5, 'hut is tier 5 now');
  assert.strictEqual(old.grid[0], TT.BEAR); assert.strictEqual(old.grid[1], TT.TOMB); assert.strictEqual(old.grid[2], TT.CHURCH);
  assert.strictEqual(old.grid[3], TT.CATHEDRAL); assert.strictEqual(old.grid[4], TT.TREASURE); assert.strictEqual(old.grid[5], TT.CRYSTAL);
  assert.strictEqual(old.grid[6], 5); assert.strictEqual(old.grid[7], 8);
  assert.strictEqual(old.grid.filter((v) => v === 9).length, 0, 'the four hospitals merged');
  assert.strictEqual(old.grid.filter((v) => v === TT.LAST_BUILDING).length, 1, '...into one mall');
  assert(old.stock[TT.CRYSTAL] >= 2 && old.stock[1] >= 5 && old.stock[4] >= TT.START_STOCK[4], 'stock carried over (merging the castles may also pay milestone restocks)');
  assert(old.score > 737910, 'the merge paid points');
  assert(old.top >= 8);
  assert.deepStrictEqual(TT.validate(old.undo), [], 'the undo snapshot is upgraded too');
  const again = JSON.stringify(old); TT.migrate(old);
  assert.strictEqual(JSON.stringify(old), again, 'migrating twice changes nothing');
});

t('hammer removes an item for coins; empty cells and poor players are rejected', () => {
  const s = withGrid({ [I(1, 1)]: TT.BEAR, [I(4, 4)]: 6 }, { coins: 25 });
  const r = TT.hammer(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 0); assert.strictEqual(r.state.grid[I(4, 4)], 6);
  assert.strictEqual(r.state.coins, 25 - TT.PRICE.hammer);
  assert.strictEqual(r.state.turn, s.turn, 'hammering is free');
  assert.deepStrictEqual(TT.validate(r.state), []);
  assert.strictEqual(TT.hammer(s, I(0, 0)), null, 'nothing to hit');
  assert.strictEqual(TT.hammer(withGrid({ [I(1, 1)]: 1 }, { coins: TT.PRICE.hammer - 1 }), I(1, 1)), null);
});

t('trap: kills a bear instantly into a tombstone (chaining into a church), costs coins, needs a bear', () => {
  const s = withGrid({ [I(2, 2)]: TT.BEAR, [I(2, 3)]: TT.TOMB, [I(2, 4)]: TT.TOMB, [I(5, 5)]: 1 }, { coins: 30 });
  const r = TT.trap(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.CHURCH, 'tomb trio becomes a church on the trapped cell');
  assert.strictEqual(r.state.coins, 30 - TT.PRICE.trap + TT.COIN[TT.TOMB]);
  assert.strictEqual(r.state.turn, s.turn, 'free action');
  assert.deepStrictEqual(TT.validate(r.state), []);
  const lone = TT.trap(withGrid({ [I(0, 0)]: TT.BEAR }, { coins: 30 }), I(0, 0));
  assert.strictEqual(lone.state.grid[I(0, 0)], TT.TOMB);
  assert.strictEqual(TT.trap(s, I(5, 5)), null, 'only bears and foxes');
  assert.strictEqual(TT.trap(withGrid({ [I(0, 0)]: TT.BEAR }, { coins: TT.PRICE.trap - 1 }), I(0, 0)), null, 'too poor');
});

t('full board with enough coins is not game over: hammer makes room; poor + full = over', () => {
  const cells = {};
  for (let i = 0; i < 35; i++) cells[i] = ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6;
  const rich = TT.place(withGrid(cells, { cur: 4, coins: 40 }), 35).state;
  assert(!rich.over, 'rich player gets to hammer');
  assert.deepStrictEqual(TT.validate(rich), []);
  assert.strictEqual(TT.place(rich, 0), null, 'no empty cell to place on');
  const h = TT.hammer(rich, 0).state;
  assert(!h.over && h.grid[0] === 0);
  assert.deepStrictEqual(TT.validate(h), []);
  // hammering the last affordable time while still full is impossible (it always frees a cell), poor + full ends the game
  const poor = TT.place(withGrid(cells, { cur: 4, coins: 0 }), 35).state;
  assert(poor.over);
});

t('preview agrees with place: result, eaten cells, points', () => {
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1, [I(0, 0)]: 5 });
  const p = TT.preview(s, I(2, 3));
  assert.strictEqual(p.final, 2); assert.deepStrictEqual(p.eaten.sort(), [I(2, 2), I(2, 4)].sort());
  assert.strictEqual(p.points, 3 * TT.BASE[1]); assert(p.merged);
  const r = TT.place(s, I(2, 3));
  assert.strictEqual(r.state.grid[I(2, 3)], p.final); assert.strictEqual(r.state.score - s.score, p.points);
  const q = TT.preview(s, I(5, 5));
  assert(!q.merged && q.final === 1 && q.eaten.length === 0);
  assert.strictEqual(TT.preview(s, I(0, 0)), null, 'occupied');
  assert.strictEqual(JSON.stringify(s), JSON.stringify(withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1, [I(0, 0)]: 5 })), 'preview does not mutate');
});

t('bear moves one step into an empty neighbour', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = withGrid({ [I(3, 3)]: TT.BEAR }, { rng: seed });
    const r = TT.place(s, I(0, 0));
    const at = r.state.grid.indexOf(TT.BEAR);
    assert(at >= 0);
    assert(TT.neighbors(I(3, 3)).includes(at), 'moved to an orthogonal neighbour');
    assert.strictEqual(r.state.grid[I(3, 3)], 0);
  }
});

t('bears do not move onto occupied cells', () => {
  // bear in corner with one free neighbour must go there
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: 5 });
  const r = TT.place(s, I(3, 3));
  assert.strictEqual(r.state.grid[I(1, 0)], TT.BEAR);
});

t('trapped bear becomes a tombstone', () => {
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: 5 }, { cur: 2 });
  const r = TT.place(s, I(1, 0)); // closes the last exit
  assert.strictEqual(r.state.grid[I(0, 0)], TT.TOMB);
  assert(r.events.some((e) => e.type === 'trapped' && e.at === I(0, 0)));
});

// a 3-cell pocket along the top edge: (0,0) (0,1) (0,2), walled by distinct buildings so nothing merges
const pocketWalls = { [I(1, 0)]: 5, [I(1, 1)]: 6, [I(1, 2)]: 7, [I(0, 3)]: 8 };

t('bears sharing a pocket with a free cell do not die', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = withGrid(Object.assign({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.BEAR }, pocketWalls), { rng: seed });
    const r = TT.place(s, I(5, 5));
    assert.strictEqual(r.state.grid.filter((v) => v === TT.BEAR).length, 2, 'both bears alive (seed ' + seed + ')');
    assert(!r.events.some((e) => e.type === 'trapped'));
    assert(r.events.some((e) => e.type === 'bear'), 'the bear next to the free cell stepped');
    assert.deepStrictEqual(TT.validate(r.state), []);
  }
});

t('a pocket with no free cell left turns all its bears into tombstones', () => {
  const s = withGrid(Object.assign({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.BEAR }, pocketWalls), { cur: 2 });
  const r = TT.place(s, I(0, 2)); // fills the last free cell of the pocket
  assert.strictEqual(r.state.grid[I(0, 0)], TT.TOMB);
  assert.strictEqual(r.state.grid[I(0, 1)], TT.TOMB);
  assert.strictEqual(r.events.filter((e) => e.type === 'trapped').length, 2);
});

t('the last bear into a full pocket: the church forms where it was placed', () => {
  const s = withGrid(Object.assign({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.BEAR }, pocketWalls), { cur: TT.BEAR });
  const r = TT.place(s, I(0, 2));
  assert.strictEqual(r.state.grid[I(0, 2)], TT.CHURCH, 'church on the tapped cell');
  assert.strictEqual(r.state.grid[I(0, 0)], 0);
  assert.strictEqual(r.state.grid[I(0, 1)], 0);
  assert.strictEqual(r.events.find((e) => e.type === 'merge').at, I(0, 2));
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('3 tombstones merge into a church where the bear died', () => {
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.TOMB, [I(0, 2)]: TT.TOMB, [I(1, 0)]: 5 });
  const r = TT.place(s, I(5, 5)); // bear at (0,0) has no free neighbour -> trapped
  assert.strictEqual(r.state.grid[I(0, 0)], TT.CHURCH);
  assert.strictEqual(r.state.grid[I(0, 1)], 0);
  assert.strictEqual(r.state.score, 3 * TT.BASE[TT.TOMB]);
});

t('church formed next to 2 churches chains into a cathedral', () => {
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.TOMB, [I(0, 2)]: TT.TOMB, [I(1, 0)]: TT.CHURCH, [I(2, 0)]: TT.CHURCH });
  const r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 0)], TT.CATHEDRAL);
  assert.strictEqual(r.state.score, 3 * TT.BASE[TT.TOMB] + 3 * TT.BASE[TT.CHURCH]);
});

t('building chain: 10 tiers, each x3, ending in collectible cash', () => {
  assert.strictEqual(TT.EMOJI.slice(1, 12).join(' '), '🌱 🌿 🌳 🏕️ 🛖 🏠 🏘️ 🏫 🏥 🏬 💵');
  for (let k = 1; k <= TT.LAST_BUILDING; k++) assert.strictEqual(TT.NEXT[k], k + 1);
  assert(!TT.NEXT[TT.CASH], 'cash is final');
  for (let k = 2; k <= TT.LAST_BUILDING; k++) assert.strictEqual(TT.BASE[k], TT.BASE[k - 1] * 3);
  // three malls in a row become cash on the tapped tile
  const r = TT.place(withGrid({ [I(0, 0)]: 10, [I(0, 2)]: 10 }, { cur: 10 }), I(0, 1));
  assert.strictEqual(r.state.grid[I(0, 1)], TT.CASH);
  assert.strictEqual(r.state.score, 3 * TT.BASE[10]);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('open: cash pays more than a treasure, free action', () => {
  const s = withGrid({ [I(1, 1)]: TT.CASH, [I(2, 2)]: TT.TREASURE }, { coins: 3 });
  const r = TT.open(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 0); assert.strictEqual(r.state.coins, 3 + TT.CASH_COINS); assert.strictEqual(r.state.turn, s.turn);
  assert(TT.CASH_COINS > TT.TREASURE_COINS);
  assert.strictEqual(r.events[0].coins, TT.CASH_COINS);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('fox: warps to a random empty cell anywhere, not just to a neighbour', () => {
  let far = 0, runs = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = withGrid({ [I(3, 3)]: TT.FOX }, { rng: seed });
    const r = TT.place(s, I(0, 0));
    const at = r.state.grid.indexOf(TT.FOX);
    assert(at >= 0 && at !== I(3, 3), 'the fox moved (seed ' + seed + ')');
    assert.strictEqual(r.state.grid.filter((v) => v === TT.FOX).length, 1);
    assert.strictEqual(r.state.grid[I(3, 3)], 0);
    assert(r.events.some((e) => e.type === 'fox' && e.from === I(3, 3) && e.to === at));
    assert.deepStrictEqual(TT.validate(r.state), []);
    runs++; if (!TT.neighbors(I(3, 3)).includes(at)) far++;
  }
  assert(far > runs / 2, 'most warps land beyond the neighbouring cells');
});

t('fox walled in on all four sides becomes a tombstone (a bear-style trap)', () => {
  const s = withGrid({ [I(2, 2)]: TT.FOX, [I(1, 2)]: 5, [I(3, 2)]: 6, [I(2, 1)]: 7, [I(2, 3)]: 8 });
  const r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TOMB);
  assert(r.events.some((e) => e.type === 'trapped' && e.at === I(2, 2)));
  assert(!r.events.some((e) => e.type === 'fox'), 'it never got to warp');
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('fox cornered by two walls becomes a tombstone; with a free neighbour it warps instead', () => {
  const cornered = withGrid({ [I(0, 0)]: TT.FOX, [I(0, 1)]: 5, [I(1, 0)]: 6 });
  assert.strictEqual(TT.place(cornered, I(5, 5)).state.grid[I(0, 0)], TT.TOMB);
  const free = withGrid({ [I(0, 0)]: TT.FOX, [I(0, 1)]: 5 });
  const r = TT.place(free, I(5, 5));
  assert.strictEqual(r.state.grid.filter((v) => v === TT.FOX).length, 1, 'still alive');
  assert.strictEqual(r.state.grid[I(0, 0)], 0, 'warped away');
  assert(!r.events.some((e) => e.type === 'trapped'));
});

t('fox in a two-cell box lives until the second cell is filled', () => {
  const walls = { [I(1, 0)]: 5, [I(1, 1)]: 6, [I(0, 2)]: 7 }; // box = (0,0) fox + (0,1) empty
  const open = withGrid(Object.assign({ [I(0, 0)]: TT.FOX }, walls), { cur: 2 });
  const warped = TT.place(open, I(5, 5));
  assert.strictEqual(warped.state.grid.filter((v) => v === TT.FOX).length, 1, 'room left: the fox warps out');
  const closed = TT.place(open, I(0, 1)); // the extra item fills the box
  assert.strictEqual(closed.state.grid[I(0, 0)], TT.TOMB);
  assert.strictEqual(closed.state.grid[I(0, 1)], 2);
  assert.deepStrictEqual(TT.validate(closed.state), []);
});

t('a bear and a fox sharing a pocket with room are safe; filling the last cell kills both', () => {
  const walls = { [I(1, 0)]: 5, [I(1, 1)]: 6, [I(1, 2)]: 7, [I(0, 3)]: 8 }; // pocket = (0,0) (0,1) (0,2)
  const s = withGrid(Object.assign({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.FOX }, walls), { cur: 2 });
  const safe = TT.place(s, I(5, 5));
  assert.strictEqual(safe.state.grid.filter((v) => v === TT.BEAR || v === TT.FOX).length, 2);
  const dead = TT.place(s, I(0, 2));
  assert.strictEqual(dead.state.grid[I(0, 0)], TT.TOMB); assert.strictEqual(dead.state.grid[I(0, 1)], TT.TOMB);
});

t('fox dies only when the board is completely full (the church forms where the last animal was placed)', () => {
  const cells = {};
  for (let i = 0; i < 35; i++) cells[i] = ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6;
  cells[34] = TT.FOX; cells[33] = TT.TOMB; cells[28] = TT.TOMB;
  const s = withGrid(cells, { cur: TT.FOX, coins: 0 });
  const r = TT.place(s, 35); // fills the last cell: no warp possible, both foxes become tombstones
  assert(r.events.some((e) => e.type === 'trapped' && e.at === 35));
  assert(r.events.some((e) => e.type === 'trapped' && e.at === 34));
  assert.strictEqual(r.state.grid[35], TT.CHURCH, 'tombs 33/34/35/28 merge on the placed cell');
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('trap item kills a fox too (it becomes a tombstone)', () => {
  const s = withGrid({ [I(2, 2)]: TT.FOX }, { coins: 30 });
  const r = TT.trap(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TOMB);
  assert.strictEqual(r.state.coins, 30 - TT.PRICE.trap);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('hammer can clear a fox; crystal and fox queue weights are valid', () => {
  assert.strictEqual(TT.WEIGHTS.reduce((a, w) => a + w[1], 0), 100);
  assert(TT.WEIGHTS.some((w) => w[0] === TT.FOX));
  const r = TT.hammer(withGrid({ [I(1, 1)]: TT.FOX }, { coins: 25 }), I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 0);
});

t('land: each side once, dearer every time, items keep their place, board grows', () => {
  let s = withGrid({ [I(0, 0)]: 1, [I(5, 5)]: 2 }, { coins: 10000 });
  assert.strictEqual(TT.landPrice(s), TT.LAND_PRICE[0]);
  assert(TT.LAND_PRICE.every((p, k) => k === 0 || p > TT.LAND_PRICE[k - 1]), 'prices rise');
  let r = TT.buyLand(s, 'top');
  assert.strictEqual(r.state.h, 7); assert.strictEqual(r.state.w, 6); assert.strictEqual(r.state.grid.length, 42);
  assert.strictEqual(r.state.grid[6 + 0], 1, 'old (0,0) is now (1,0)'); assert.strictEqual(r.state.grid[6 + 35], 2);
  assert.strictEqual(r.state.coins, 10000 - TT.LAND_PRICE[0]); assert.strictEqual(r.state.turn, s.turn, 'free action');
  assert.deepStrictEqual(TT.validate(r.state), []);
  s = r.state;
  assert.strictEqual(TT.buyLand(s, 'top'), null, 'one row per side');
  assert.strictEqual(TT.buyLand(s, 'sideways'), null);
  r = TT.buyLand(s, 'left'); // new column: every row grows by one at the front
  s = r.state;
  assert.strictEqual(s.w, 7); assert.strictEqual(s.grid.length, 49);
  assert.strictEqual(s.grid[7 * 1 + 1], 1, 'old item shifted down a row and right a column');
  assert.strictEqual(r.state.coins, 10000 - TT.LAND_PRICE[0] - TT.LAND_PRICE[1]);
  s = TT.buyLand(s, 'right').state; s = TT.buyLand(s, 'bottom').state;
  assert.strictEqual(s.w, 8); assert.strictEqual(s.h, 8); assert.strictEqual(s.grid.length, 64);
  assert.strictEqual(TT.landPrice(s), null); assert.strictEqual(TT.buyLand(s, 'top'), null, 'at most 4');
  assert.deepStrictEqual(TT.validate(s), []);
  assert.strictEqual(s.grid.filter((v) => v === 1).length, 1); assert.strictEqual(s.grid.filter((v) => v === 2).length, 1);
  assert.strictEqual(TT.buyLand(withGrid({}, { coins: TT.LAND_PRICE[0] - 1 }), 'top'), null, 'too poor');
});

t('land: merges, bears and the game-over check work on the bigger board', () => {
  let s = withGrid({}, { coins: 10000 });
  ['right', 'bottom'].forEach((side) => { s = TT.buyLand(s, side).state; });
  assert.strictEqual(s.w, 7); assert.strictEqual(s.h, 7);
  const I7 = (r, c) => r * 7 + c;
  // grass in the new last column connects with grass next to it
  s.grid[I7(2, 5)] = 1; s.grid[I7(2, 6)] = 1; s.cur = 1;
  const r = TT.place(s, I7(2, 4));
  assert.strictEqual(r.state.grid[I7(2, 4)], 2, 'merge across the new column');
  assert.deepStrictEqual(TT.validate(r.state), []);
  // a bear walks into the new bottom row (index 42..48)
  const b = withGrid({}, { coins: 10000 });
  let bs = TT.buyLand(b, 'bottom').state; bs.grid[5 * 6 + 3] = TT.BEAR;
  const walls = [4 * 6 + 3, 5 * 6 + 2, 5 * 6 + 4];
  walls.forEach((i, k) => { bs.grid[i] = 5 + k; });
  const moved = TT.place(bs, 0).state;
  assert.strictEqual(moved.grid[6 * 6 + 3], TT.BEAR, 'the only exit was the new row');
  // full board: poor + no hammer is over; with land money it is not
  const full = withGrid({}, {}); full.grid = full.grid.map((_, i) => ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6);
  full.stock.hammer = 0; full.coins = 0; assert(TT.isOver(full));
  full.coins = TT.LAND_PRICE[0]; assert(!TT.isOver(full));
});

t('validate rejects a board whose size does not match the land bought', () => {
  const s = TT.buyLand(withGrid({}, { coins: 1000 }), 'top').state;
  assert.deepStrictEqual(TT.validate(s), []);
  assert(TT.validate(Object.assign({}, s, { land: [] })).length);
  assert(TT.validate(Object.assign({}, s, { w: 9 })).length);
  assert(TT.validate(Object.assign({}, s, { grid: s.grid.slice(1) })).length);
});

t('crystal turns into a mall (-> cash) or a cathedral (-> treasure)', () => {
  let r = TT.place(withGrid({ [I(2, 1)]: 10, [I(2, 3)]: 10 }, { cur: TT.CRYSTAL }), I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.CASH, 'crystal as mall -> cash');
  assert.strictEqual(TT.preview(withGrid({ [I(2, 1)]: 10, [I(2, 3)]: 10 }, { cur: TT.CRYSTAL }), I(2, 2)).final, TT.CASH);
  r = TT.place(withGrid({ [I(2, 1)]: TT.CATHEDRAL, [I(2, 3)]: TT.CATHEDRAL }, { cur: TT.CRYSTAL }), I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE, 'crystal as cathedral -> treasure');
});

t('three connected gems merge into a treasure on the tile where the last one lands (no points, no coins)', () => {
  const s = withGrid({ [I(2, 1)]: TT.CRYSTAL, [I(2, 3)]: TT.CRYSTAL }, { cur: TT.CRYSTAL, coins: 7 });
  const pv = TT.preview(s, I(2, 2));
  assert(pv.merged && pv.final === TT.TREASURE && pv.points === 0 && pv.coins === 0, 'preview shows the merge');
  assert.deepStrictEqual(pv.eaten.sort(), [I(2, 1), I(2, 3)].sort());
  assert(TT.wouldMerge(s, I(2, 2)), 'the merge hint lights up');
  const r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE);
  assert.strictEqual(r.state.grid[I(2, 1)], 0); assert.strictEqual(r.state.grid[I(2, 3)], 0);
  assert.strictEqual(r.state.score, 0); assert.strictEqual(r.state.coins, 7);
  const m = r.events.find((e) => e.type === 'merge');
  assert(m && m.from === TT.CRYSTAL && m.to === TT.TREASURE && m.at === I(2, 2) && m.cells.length === 3);
  assert.deepStrictEqual(TT.validate(r.state), []);
  assert.strictEqual(TT.open(r.state, I(2, 2)).state.coins, 7 + TT.TREASURE_COINS, 'worth exactly one treasure');
  // 4 gems -> still ONE treasure; diagonal gems do not connect; two gems alone just wait
  const four = TT.place(withGrid({ [I(2, 0)]: TT.CRYSTAL, [I(2, 1)]: TT.CRYSTAL, [I(2, 3)]: TT.CRYSTAL }, { cur: TT.CRYSTAL }), I(2, 2)).state;
  assert.strictEqual(four.grid.filter((v) => v === TT.TREASURE).length, 1); assert.strictEqual(four.grid.filter((v) => v === TT.CRYSTAL).length, 0);
  const diag = TT.place(withGrid({ [I(1, 1)]: TT.CRYSTAL, [I(3, 3)]: TT.CRYSTAL }, { cur: TT.CRYSTAL }), I(2, 2)).state;
  assert.strictEqual(diag.grid.filter((v) => v === TT.CRYSTAL).length, 3);
  const two = TT.place(withGrid({ [I(2, 1)]: TT.CRYSTAL }, { cur: TT.CRYSTAL }), I(2, 2)).state;
  assert.strictEqual(two.grid.filter((v) => v === TT.CRYSTAL).length, 2);
  assert.deepStrictEqual(TT.validate(two), []);
});

t('a gem that can stand in for a tier does that first; the gem trio only forms when no tier fits', () => {
  // placed gem touches two cathedrals and two waiting gems: it becomes a cathedral (-> treasure), the other gems keep waiting
  const s = withGrid({ [I(2, 1)]: TT.CATHEDRAL, [I(2, 3)]: TT.CATHEDRAL, [I(1, 2)]: TT.CRYSTAL, [I(3, 2)]: TT.CRYSTAL }, { cur: TT.CRYSTAL });
  const r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE);
  assert.strictEqual(r.state.grid.filter((v) => v === TT.CRYSTAL).length, 2);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('a gem trio is also made by the mover, and a save with an inert trio is settled on load', () => {
  const s = withGrid({ [I(2, 1)]: TT.CRYSTAL, [I(2, 3)]: TT.CRYSTAL, [I(5, 5)]: TT.CRYSTAL }, { coins: 100 });
  const r = TT.move(s, I(5, 5), I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.TREASURE); assert.deepStrictEqual(TT.validate(r.state), []);
  const old = withGrid({ [I(0, 0)]: TT.CRYSTAL, [I(0, 1)]: TT.CRYSTAL, [I(0, 2)]: TT.CRYSTAL });
  assert(TT.validate(old).length, 'an unmerged gem trio is invalid');
  TT.migrate(old);
  assert.deepStrictEqual(TT.validate(old), []);
  assert.strictEqual(old.grid.filter((v) => v === TT.TREASURE).length, 1);
});

t('mover: picks up an item and drops it on an empty tile for coins; free action, limited stock', () => {
  const s = withGrid({ [I(1, 1)]: 3, [I(4, 4)]: 5 }, { coins: 100 });
  const r = TT.move(s, I(1, 1), I(2, 3));
  assert.strictEqual(r.state.grid[I(1, 1)], 0); assert.strictEqual(r.state.grid[I(2, 3)], 3); assert.strictEqual(r.state.grid[I(4, 4)], 5);
  assert.strictEqual(r.state.coins, 100 - TT.PRICE.move); assert.strictEqual(r.state.stock.move, TT.START_STOCK.move - 1);
  assert.strictEqual(r.state.turn, s.turn, 'free action'); assert.strictEqual(r.state.rng, s.rng, 'no animal moves, no rng use');
  assert.deepStrictEqual(r.events[0], { type: 'move', from: I(1, 1), to: I(2, 3), item: 3 });
  assert.deepStrictEqual(TT.validate(r.state), []);
  assert.strictEqual(TT.move(r.state, I(4, 4), I(0, 0)), null, 'out of movers');
  assert.strictEqual(TT.move(withGrid({ [I(1, 1)]: 3 }, { coins: TT.PRICE.move - 1 }), I(1, 1), I(0, 0)), null, 'too poor');
  assert.strictEqual(TT.move(s, I(0, 0), I(2, 2)), null, 'nothing to pick up');
  assert.strictEqual(TT.move(s, I(1, 1), I(4, 4)), null, 'destination must be empty');
  assert.strictEqual(TT.move(s, I(1, 1), I(1, 1)), null, 'must go somewhere else');
  assert.strictEqual(TT.move(withGrid({ [I(1, 1)]: TT.BEAR }, { coins: 100 }), I(1, 1), I(0, 0)), null, 'bears cannot be moved');
  assert.strictEqual(TT.move(withGrid({ [I(1, 1)]: TT.FOX }, { coins: 100 }), I(1, 1), I(0, 0)), null, 'foxes cannot be moved');
  assert.strictEqual(TT.move(Object.assign({}, s, { over: true }), I(1, 1), I(0, 0)), null);
});

t('mover: the dropped item merges where it lands (chains, points, coins, crystals) and previewMove agrees', () => {
  const s = withGrid({ [I(5, 5)]: 1, [I(2, 0)]: 1, [I(2, 2)]: 1, [I(0, 4)]: 2, [I(1, 3)]: 2, [I(1, 5)]: 2 }, { coins: 500 });
  const pv = TT.previewMove(s, I(5, 5), I(2, 1));
  const r = TT.move(s, I(5, 5), I(2, 1));
  assert.strictEqual(r.state.grid[I(2, 1)], 2, 'grass trio -> bush on the drop tile');
  assert.strictEqual(r.state.grid[I(5, 5)], 0);
  assert.strictEqual(pv.final, 2); assert(pv.merged); assert.deepStrictEqual(pv.eaten.sort(), [I(2, 0), I(2, 2)].sort(), 'the carried item itself is not "eaten"');
  assert.strictEqual(r.state.score - s.score, pv.points); assert.strictEqual(r.state.coins, 500 - TT.PRICE.move + pv.coins);
  assert.deepStrictEqual(TT.validate(r.state), []);
  // a moved crystal settles at its new home
  const c = withGrid({ [I(0, 0)]: TT.CRYSTAL, [I(3, 1)]: 3, [I(3, 3)]: 3 }, { coins: 500 });
  const cr = TT.move(c, I(0, 0), I(3, 2));
  assert.strictEqual(cr.state.grid[I(3, 2)], 4, 'crystal as tree -> camp');
  assert(cr.events.some((e) => e.type === 'crystal'));
  assert.strictEqual(TT.previewMove(c, I(0, 0), I(3, 1)), null, 'preview needs an empty destination');
  assert.strictEqual(JSON.stringify(c), JSON.stringify(withGrid({ [I(0, 0)]: TT.CRYSTAL, [I(3, 1)]: 3, [I(3, 3)]: 3 }, { coins: 500 })), 'previews never mutate');
  // reaching a new tier by moving unlocks it in the shop
  const u = withGrid({ [I(0, 0)]: 5, [I(0, 1)]: 5, [I(4, 4)]: 5 }, { coins: 500 });
  const ur = TT.move(u, I(4, 4), I(0, 2));
  assert.strictEqual(ur.state.grid[I(0, 2)], 6); assert.strictEqual(ur.state.top, 6);
  assert(ur.events.some((e) => e.type === 'tierunlock'));
});

t('mover: tombstones, churches, cash and treasure can all be moved; a trio of tombstones merges', () => {
  const s = withGrid({ [I(1, 0)]: TT.TOMB, [I(1, 2)]: TT.TOMB, [I(4, 4)]: TT.TOMB, [I(3, 3)]: TT.CASH, [I(2, 4)]: TT.TREASURE }, { coins: 500 });
  const r = TT.move(s, I(4, 4), I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], TT.CHURCH);
  assert(TT.move(s, I(3, 3), I(0, 0)) && TT.move(s, I(2, 4), I(0, 0)));
});

t('migrate adds stock entries for shop items introduced after the save was made', () => {
  const s = JSON.parse(JSON.stringify(TT.newGame(4)));
  delete s.stock.move; delete s.stock[7];
  assert(TT.validate(s).length, 'an old save without them is invalid as is');
  TT.migrate(s);
  assert.strictEqual(s.stock.move, TT.START_STOCK.move); assert.strictEqual(s.stock[7], TT.START_STOCK[7]);
  assert.deepStrictEqual(TT.validate(s), []);
});

t('swap stores the item, then exchanges', () => {
  let s = TT.newGame(3);
  const c0 = s.cur, n0 = s.next;
  s = TT.swap(s);
  assert.strictEqual(s.hold, c0); assert.strictEqual(s.cur, n0);
  const c1 = s.cur;
  s = TT.swap(s);
  assert.strictEqual(s.cur, c0); assert.strictEqual(s.hold, c1);
  assert.strictEqual(s.turn, 0, 'swap is free');
});

t('undo restores the exact previous state (incl. rng) and replay is identical', () => {
  let s = TT.newGame(11);
  for (let k = 0; k < 6; k++) s = TT.place(s, s.grid.indexOf(0)).state;
  const before = JSON.stringify(Object.assign({}, s, { undo: null, coins: s.coins - TT.UNDO_COST }));
  const a = TT.place(s, 30);
  const back = TT.undo(a.state);
  assert.strictEqual(JSON.stringify(back), before, 'undo restores everything but charges UNDO_COST');
  const b = TT.place(back, 30);
  ['grid', 'score', 'rng', 'cur', 'next', 'turn'].forEach((k) => assert.deepStrictEqual(a.state[k], b.state[k], 'replay after undo is identical: ' + k));
  assert.strictEqual(TT.undo(back), null, 'one level only');
});

t('illegal moves are rejected', () => {
  const s = withGrid({ [I(0, 0)]: 1 });
  assert.strictEqual(TT.place(s, I(0, 0)), null);
  assert.strictEqual(TT.place(s, -1), null);
  assert.strictEqual(TT.place(s, 36), null);
  assert.strictEqual(TT.place(s, 1000), null);
  const over = Object.assign({}, s, { over: true });
  assert.strictEqual(TT.place(over, 5), null);
  assert.strictEqual(TT.swap(over), null);
});

t('game ends when the grid fills', () => {
  const cells = {};
  for (let i = 0; i < 35; i++) cells[i] = ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6; // checkerboard
  const s = withGrid(cells, { cur: 4 });
  const r = TT.place(s, 35);
  assert(r.state.over);
  assert(r.events.some((e) => e.type === 'over'));
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('wouldMerge agrees with place', () => {
  const s = withGrid({ [I(2, 2)]: 1, [I(2, 4)]: 1 });
  assert(TT.wouldMerge(s, I(2, 3)));
  assert(!TT.wouldMerge(s, I(5, 5)));
});

t('fuzz: 400 random games keep state valid and always terminate', () => {
  let maxTurns = 0, merges = 0, trapped = 0, churches = 0, hammers = 0, lands = 0, foxMoves = 0, maxTier = 0, moves = 0;
  for (let seed = 1; seed <= 400; seed++) {
    let s = TT.newGame(seed);
    const pick = TT.newGame(seed * 7919 + 1); // independent chooser rng
    let guard = 0;
    while (!s.over) {
      assert(++guard < 4000, 'game must terminate (seed ' + seed + ')');
      if (TT.rand(pick) < 0.05) { s = TT.swap(s); assert.deepStrictEqual(TT.validate(s), []); continue; }
      if (TT.rand(pick) < 0.04) {
        const b = TT.buy(s, TT.BUYABLE[Math.floor(TT.rand(pick) * TT.BUYABLE.length)]);
        if (b) { s = b; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      const empties = [], occupied = [];
      s.grid.forEach((v, i) => { (v === 0 ? empties : occupied).push(i); });
      if (TT.rand(pick) < 0.02 && empties.length && occupied.length) { // the mover, now and then
        const mv = TT.move(s, occupied[Math.floor(TT.rand(pick) * occupied.length)], empties[Math.floor(TT.rand(pick) * empties.length)]);
        if (mv) { moves++; s = mv.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (TT.rand(pick) < 0.01 || !empties.length) { // buy land now and then, and whenever stuck
        const side = TT.SIDES[Math.floor(TT.rand(pick) * TT.SIDES.length)];
        const l = TT.buyLand(s, side);
        if (l) { lands++; s = l.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (!empties.length || TT.rand(pick) < 0.03) { // full board (rich) or a random hammer
        const h = TT.hammer(s, occupied[Math.floor(TT.rand(pick) * occupied.length)]);
        if (h) { hammers++; s = h.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
        if (!empties.length) { // out of hammers: only the remaining land can save the game
          const side = TT.SIDES.find((x) => TT.buyLand(s, x));
          assert(side, 'full board must either be over or rescuable');
          s = TT.buyLand(s, side).state; lands++; assert.deepStrictEqual(TT.validate(s), []); continue;
        }
      }
      const idx = empties[Math.floor(TT.rand(pick) * empties.length)];
      const r = TT.place(s, idx);
      assert(r, 'legal move rejected');
      const prob = TT.validate(r.state);
      assert.deepStrictEqual(prob, [], `seed ${seed} turn ${s.turn}: ${prob.join(', ')}`);
      assert(r.state.score >= s.score);
      r.events.forEach((e) => { if (e.type === 'merge') { merges++; if (e.to === TT.CHURCH) churches++; } if (e.type === 'trapped') trapped++; if (e.type === 'fox') foxMoves++; if (e.type === 'merge') maxTier = Math.max(maxTier, e.to); });
      if (TT.rand(pick) < 0.05) {
        const u = TT.undo(r.state);
        assert.strictEqual(!!u, TT.canUndo(r.state));
        if (u) { assert.deepStrictEqual(u.grid, s.grid); assert.strictEqual(u.coins, s.coins - TT.UNDO_COST); assert.deepStrictEqual(TT.validate(u), []); }
      }
      s = r.state;
    }
    maxTurns = Math.max(maxTurns, s.turn);
  }
  assert(merges > 0 && trapped > 0 && foxMoves > 0, 'fuzz exercised merges, trapped bears and fox warps');
  console.log(`  fuzz: max ${maxTurns} turns, ${merges} merges, ${trapped} trapped bears, ${churches} churches, ${hammers} hammers, ${lands} land purchases, ${moves} moves, ${foxMoves} fox warps, best tier ${maxTier}`);
});

console.log(`OK: ${n} logic tests passed`);
