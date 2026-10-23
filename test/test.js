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

t('lucky drops: only tiers you have already built, never above a house, never before a camp is possible', () => {
  const draws = (map, top, n = 4000) => { const s = { rng: 12345, map, top }, out = {}; for (let i = 0; i < n; i++) { const d = TT.drawItem(s); out[d] = (out[d] || 0) + 1; } return out; };
  const luckyOnly = (o) => Object.keys(o).map(Number).filter((k) => k >= 4 && k <= 10).sort((a, b) => a - b);
  assert.deepStrictEqual(luckyOnly(draws('easy', 1)), [], 'nothing built yet');
  assert.deepStrictEqual(luckyOnly(draws('easy', 4)), [], 'a camp must be below the best tier first');
  assert.deepStrictEqual(luckyOnly(draws('easy', 5)), [4], 'with a hut built: camps');
  assert.deepStrictEqual(luckyOnly(draws('easy', 6)), [4, 5], 'with a house built: camps and huts');
  assert.deepStrictEqual(luckyOnly(draws('easy', 7)), [4, 5, 6], 'with a village built: camps, huts, houses');
  assert.deepStrictEqual(luckyOnly(draws('easy', 10)), [4, 5, 6], 'never above a house');
  assert.deepStrictEqual(luckyOnly(draws('hard', 10)), [], 'no lucky drops on the hard map');
  assert.deepStrictEqual(luckyOnly(draws(undefined, 10)), [], 'an unknown map gets none');
});

t('lucky drops: rate per map, lower tiers likelier, and the rest of the queue still follows its weights', () => {
  const N = 60000;
  const share = (map) => { const s = { rng: 777, map, top: 10 }, c = {}; for (let i = 0; i < N; i++) { const d = TT.drawItem(s); c[d] = (c[d] || 0) + 1; } return c; };
  [['easy', 0.06], ['standard', 0.04], ['medium', 0.03]].forEach(([map, rate]) => {
    const c = share(map), lucky = (c[4] || 0) + (c[5] || 0) + (c[6] || 0);
    assert(Math.abs(lucky / N - rate) < 0.006, map + ' lucky share ' + lucky / N + ' vs ' + rate);
    assert(c[4] > c[5] && c[5] > c[6], 'camp > hut > house');
    assert(Math.abs((c[4] / lucky) - 0.5) < 0.04 && Math.abs((c[6] / lucky) - 1 / 6) < 0.04, 'about 3 : 2 : 1');
    const base = N - lucky;
    TT.WEIGHTS.forEach(([code, w]) => assert(Math.abs(c[code] / base * 100 - w) < 1.2, map + ' item ' + code + ': ' + (c[code] / base * 100) + '% vs ' + w + '%'));
  });
});

t('lucky drops: early games and the hard map draw exactly the old sequence; a real game shows lucky items in Next once tiers are built', () => {
  // identical draws (and rng consumption) while no drop is possible: early in the game, and on the hard map at any tier
  const same = (state) => { const s = Object.assign({ rng: 99 }, state), old = { rng: 99 }; for (let i = 0; i < 300; i++) assert.strictEqual(TT.drawItem(s), TT.drawItem(old)); assert.strictEqual(s.rng, old.rng); };
  same({ map: 'easy', top: 3 }); same({ map: 'easy', top: 4 }); same({ map: 'hard', top: 10 }); same({});
  assert.strictEqual(TT.newGame(5).next, TT.newGame(5, { map: 'easy', wild: true }).next);
  // in a played game with a high top tier, the queue now serves camps / huts / houses
  let seen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let g = TT.newGame(seed); g.top = 8;
    for (let k = 0; k < 60 && !g.over; k++) {
      if ([4, 5, 6].includes(g.next)) seen++;
      const e = g.grid.indexOf(0); if (e < 0) break;
      g = TT.place(g, e).state;
      assert.deepStrictEqual(TT.validate(g), []);
    }
  }
  assert(seen > 20, 'lucky items show up in Next: ' + seen);
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

t('crystal plays every option out and keeps the best chain reaction: camp trio -> hut that joins two huts -> house', () => {
  // crystal (2,2): two camps on its left (2,1),(3,1), two huts below it (3,2),(3,3). As a hut it would only make a house from the huts;
  // as a camp it makes a hut that then forms a hut trio with the two huts -> a house AND the camps are cleared too
  const s = withGrid({ [I(2, 1)]: 4, [I(3, 1)]: 4, [I(3, 2)]: 5, [I(3, 3)]: 5 }, { cur: TT.CRYSTAL });
  const r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], 6, 'one house on the crystal tile');
  [I(2, 1), I(3, 1), I(3, 2), I(3, 3)].forEach((i) => assert.strictEqual(r.state.grid[i], 0, 'tile ' + i + ' is cleared'));
  assert(r.events.some((e) => e.type === 'crystal' && e.at === I(2, 2) && e.as === 4), 'the crystal acted as a camp');
  assert.strictEqual(r.events.filter((e) => e.type === 'merge').length, 2, 'two merges in a row');
  assert.strictEqual(TT.preview(s, I(2, 2)).eaten.length, 4, 'the preview shows the whole chain');
  assert.deepStrictEqual(TT.validate(r.state), []);
  // when the huts are the only option the crystal is a hut as before; and a lone higher merge still beats nothing
  const h = withGrid({ [I(3, 2)]: 5, [I(3, 3)]: 5 }, { cur: TT.CRYSTAL });
  assert.strictEqual(TT.place(h, I(2, 2)).state.grid[I(2, 2)], 6);
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
  const bought = TT.buy(Object.assign(r.state, { cur: 1, coins: 1000 }), TT.CRYSTAL);
  assert.strictEqual(bought.cur, TT.CRYSTAL); assert.strictEqual(bought.coins, 1000 - TT.PRICE[TT.CRYSTAL]);
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

t('a warping fox never lands in a hole it could not get out of (all four sides blocked, or a corner)', () => {
  // (0,0) and (5,5) are single tiles walled in by buildings; everything else is open
  const holes = { [I(0, 1)]: 5, [I(1, 0)]: 6, [I(5, 4)]: 7, [I(4, 5)]: 8, [I(3, 3)]: TT.FOX };
  let landings = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = withGrid(holes, { rng: seed });
    const r = TT.place(s, I(2, 1)); // any ordinary move
    const fox = r.state.grid.indexOf(TT.FOX);
    assert(fox >= 0, 'the fox is alive (seed ' + seed + ')');
    assert(fox !== I(0, 0) && fox !== I(5, 5), 'it did not jump into a sealed hole (seed ' + seed + ')');
    assert(!r.events.some((e) => e.type === 'trapped'));
    landings++;
  }
  assert.strictEqual(landings, 200);
  // and with a hole in the middle of the board (four walls)
  const mid = { [I(2, 2)]: 0, [I(1, 2)]: 5, [I(3, 2)]: 6, [I(2, 1)]: 7, [I(2, 3)]: 8, [I(4, 4)]: TT.FOX };
  for (let seed = 1; seed <= 100; seed++) assert.notStrictEqual(TT.place(withGrid(mid, { rng: seed }), I(0, 0)).state.grid.indexOf(TT.FOX), I(2, 2), 'seed ' + seed);
});

t('a fox may still hop into a bigger box (it is only trapped later if the player fills it) and into its own box', () => {
  // box of 2 empty tiles (0,0)+(0,1): safe to land in, because one free tile stays
  const walls = { [I(1, 0)]: 5, [I(1, 1)]: 6, [I(0, 2)]: 7, [I(3, 3)]: TT.FOX };
  let boxed = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = TT.place(withGrid(walls, { rng: seed }), I(5, 5));
    const f = r.state.grid.indexOf(TT.FOX);
    if (f === I(0, 0) || f === I(0, 1)) boxed++;
    assert(f >= 0);
  }
  assert(boxed > 0, 'landing in a two-tile box is allowed');
  // only its own box and two sealed holes are free: the fox has to stay in its box, it never picks a hole
  const cb = {};
  for (let i = 0; i < 36; i++) cb[i] = (((i / 6) | 0) + (i % 6)) % 2 ? 5 : 6; // checkerboard of two buildings: nothing merges
  cb[I(0, 0)] = TT.FOX; cb[I(0, 1)] = 0; cb[I(5, 5)] = 0; cb[I(5, 0)] = 0; cb[I(3, 3)] = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = TT.place(withGrid(cb, { rng: seed, cur: 2, coins: 0 }), I(3, 3));
    assert.strictEqual(r.state.grid[I(0, 1)], TT.FOX, 'hopped within its own box (seed ' + seed + ')');
    assert.strictEqual(r.state.grid.filter((v) => v === TT.FOX).length, 1);
    assert(!r.events.some((e) => e.type === 'trapped'));
  }
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

// Wild bears: a bear that cannot step (boxed in, but its pocket still has room through the fox next to it) escalates
// 12 -> growl (turn 1) -> angry (turn 2) -> mauls a neighbouring grass..hut one tier down (turn 3) and starts over.
// The fox next to the bear keeps the pocket open for the test (it warps away at the end of every turn, so each turn is set up fresh).
const boxed = (bearCode, walls, over = {}) => withGrid(Object.assign({ [I(0, 0)]: bearCode, [I(1, 0)]: TT.FOX }, walls), Object.assign({ wild: true, cur: 2, rng: 5 }, over));

t('wild bears: boxed in for turn 1 and 2 only warns (growl, angry); nothing is damaged', () => {
  let r = TT.place(boxed(TT.BEAR, { [I(0, 1)]: 6 }), I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 0)], TT.BEAR_GROWL);
  assert.deepStrictEqual(r.events.filter((e) => e.type === 'growl'), [{ type: 'growl', at: I(0, 0), level: 1 }]);
  assert.deepStrictEqual(TT.validate(r.state), []);
  r = TT.place(boxed(TT.BEAR_GROWL, { [I(0, 1)]: 5 }), I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 0)], TT.BEAR_ANGRY); assert.strictEqual(r.state.grid[I(0, 1)], 5, 'a hut next to a growling bear is still a hut');
  assert.deepStrictEqual(r.events.filter((e) => e.type === 'growl'), [{ type: 'growl', at: I(0, 0), level: 2 }]);
  assert(!r.events.some((e) => e.type === 'maul'));
});

t('wild bears: on the third boxed-in turn it mauls ONE tier down (hut -> camp) and starts over', () => {
  const r = TT.place(boxed(TT.BEAR_ANGRY, { [I(0, 1)]: 5 }), I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 1)], 4, 'hut -> camp'); assert.strictEqual(r.state.grid[I(0, 0)], TT.BEAR, 'calm again');
  assert.deepStrictEqual(r.events.find((e) => e.type === 'maul'), { type: 'maul', at: I(0, 1), bear: I(0, 0), from: 5, to: 4 });
  assert.deepStrictEqual(TT.validate(r.state), []);
  // every low tier drops exactly one step
  for (let tier = 2; tier <= 5; tier++) assert.strictEqual(TT.place(boxed(TT.BEAR_ANGRY, { [I(0, 1)]: tier }), I(5, 5)).state.grid[I(0, 1)], tier - 1, 'tier ' + tier);
});

t('wild bears: a mauled grass is destroyed, leaving an escape hole', () => {
  const r = TT.place(boxed(TT.BEAR_ANGRY, { [I(0, 1)]: 1 }), I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 1)], 0);
  assert.deepStrictEqual(TT.validate(r.state), []);
  const next = TT.place(Object.assign(r.state, { cur: 2 }), I(5, 4)); // next turn the bear walks out through the hole
  assert.strictEqual(next.state.grid[I(0, 0)], 0, 'the bear left its corner');
  assert.strictEqual(next.state.grid.filter((v) => v === TT.BEAR).length, 1, 'calm again');
  assert(next.events.some((e) => e.type === 'bear' && e.from === I(0, 0)));
});

t('wild bears: houses and everything above are never mauled; with nothing to maul it just calms down', () => {
  const walls = { [I(0, 1)]: 6 }; // house
  const r = TT.place(boxed(TT.BEAR_ANGRY, walls), I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 1)], 6); assert.strictEqual(r.state.grid[I(0, 0)], TT.BEAR);
  assert(!r.events.some((e) => e.type === 'maul'));
  [TT.TOMB, TT.CHURCH, 10, TT.CASH].forEach((code) => {
    const q = TT.place(boxed(TT.BEAR_ANGRY, { [I(0, 1)]: code }), I(5, 5));
    assert.strictEqual(q.state.grid[I(0, 1)], code, 'code ' + code + ' is safe');
  });
});

t('wild bears: with several neighbours it picks a mauled-able one at random, never a safe one', () => {
  const seen = {};
  for (let seed = 1; seed <= 60; seed++) {
    const s = withGrid({ [I(1, 1)]: TT.BEAR_ANGRY, [I(0, 1)]: 1, [I(1, 0)]: 5, [I(1, 2)]: 6, [I(2, 1)]: TT.FOX }, { wild: true, cur: 2, rng: seed });
    const r = TT.place(s, I(5, 5));
    const m = r.events.find((e) => e.type === 'maul');
    assert(m && (m.at === I(0, 1) || m.at === I(1, 0)), 'hit grass or hut, seed ' + seed);
    assert.strictEqual(r.state.grid[I(1, 2)], 6, 'the house is untouched');
    seen[m.at] = true;
  }
  assert.strictEqual(Object.keys(seen).length, 2, 'both candidates get picked sometimes');
});

t('wild bears: a lowered tile that completes a group merges at once', () => {
  const s = boxed(TT.BEAR_ANGRY, { [I(0, 1)]: 5, [I(0, 2)]: 4, [I(1, 1)]: 4 });
  const r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 1)], 5, 'hut -> camp, then camp trio -> hut on the mauled tile');
  assert.strictEqual(r.state.grid[I(0, 2)], 0); assert.strictEqual(r.state.grid[I(1, 1)], 0);
  assert.strictEqual(r.state.score, 3 * TT.BASE[4]);
  assert.deepStrictEqual(TT.validate(r.state), []);
});

t('wild bears: a bear that can step walks and is calm again; a sealed bear still dies on the spot', () => {
  const walker = withGrid({ [I(3, 3)]: TT.BEAR_ANGRY }, { wild: true, cur: 2 });
  const r = TT.place(walker, I(0, 0));
  const at = r.state.grid.findIndex((v) => TT.isBear(v));
  assert.strictEqual(r.state.grid[at], TT.BEAR); assert(TT.neighbors(I(3, 3)).includes(at));
  const sealed = withGrid({ [I(0, 0)]: TT.BEAR_ANGRY, [I(0, 1)]: 5, [I(1, 0)]: 6 }, { wild: true, cur: 2 });
  assert.strictEqual(TT.place(sealed, I(5, 5)).state.grid[I(0, 0)], TT.TOMB);
});

t('wild bears: classic games never escalate; the trap kills any stage; stages cannot be carried; validate guards the mode', () => {
  const c = TT.place(boxed(TT.BEAR, { [I(0, 1)]: 5 }, { wild: false }), I(5, 5));
  assert.strictEqual(c.state.grid[I(0, 0)], TT.BEAR); assert(!c.events.some((e) => e.type === 'growl' || e.type === 'maul'));
  [TT.BEAR_GROWL, TT.BEAR_ANGRY].forEach((code) => {
    const s = withGrid({ [I(2, 2)]: code }, { wild: true, coins: 100 });
    assert.strictEqual(TT.trap(s, I(2, 2)).state.grid[I(2, 2)], TT.TOMB);
    assert.strictEqual(TT.move(s, I(2, 2), I(0, 0)), null, 'bears cannot be carried');
    assert(!TT.isMovable(code) && TT.isBear(code));
    assert.deepStrictEqual(TT.validate(s), []);
    assert(TT.validate(Object.assign({}, s, { wild: false })).length, 'an angry bear in a classic game is invalid');
  });
  assert.strictEqual(TT.newGame(5).wild, false); assert.strictEqual(TT.newGame(5, { wild: true }).wild, true);
  const old = JSON.parse(JSON.stringify(TT.newGame(3))); delete old.wild;
  TT.migrate(old);
  assert.strictEqual(old.wild, false); assert.deepStrictEqual(TT.validate(old), []);
});

// ---- maps
const waterCells = (s) => s.grid.map((v, i) => (v === TT.WATER ? i : -1)).filter((i) => i >= 0);
const fieldIsOne = (s) => {
  const free = s.grid.map((v, i) => (v === TT.WATER ? -1 : i)).filter((i) => i >= 0), seen = new Set([free[0]]), stack = [free[0]];
  while (stack.length) TT.neighbors(stack.pop()).forEach((j) => { if (s.grid[j] !== TT.WATER && !seen.has(j)) { seen.add(j); stack.push(j); } });
  return seen.size === free.length;
};

t('maps: easy is the plain empty field (and uses no random numbers, so classic seeds replay as before)', () => {
  const s = TT.newGame(5);
  assert.strictEqual(s.map, 'easy'); assert(s.grid.every((v) => v === 0));
  assert.strictEqual(TT.newGame(5, { map: 'nonsense' }).map, 'easy');
  const same = TT.newGame(5, { map: 'easy', wild: true });
  assert.strictEqual(same.rng, s.rng); assert.strictEqual(same.next, s.next);
});

t('maps: standard scatters a few grass / bush / tree, never a mergeable group, reproducibly per seed', () => {
  const kinds = new Set(); let differ = false;
  for (let seed = 1; seed <= 100; seed++) {
    const s = TT.newGame(seed, { map: 'standard' });
    const items = s.grid.filter((v) => v !== 0);
    assert.strictEqual(items.length, TT.STANDARD_ITEMS, 'seed ' + seed);
    items.forEach((v) => { assert(v >= 1 && v <= 3); kinds.add(v); });
    assert.deepStrictEqual(TT.validate(s), []);
    assert.strictEqual(JSON.stringify(s), JSON.stringify(TT.newGame(seed, { map: 'standard' })), 'same seed, same map');
    if (JSON.stringify(s.grid) !== JSON.stringify(TT.newGame(seed + 1, { map: 'standard' }).grid)) differ = true;
  }
  assert.strictEqual(kinds.size, 3, 'all three kinds show up'); assert(differ, 'different seeds give different fields');
});

t('maps: medium has the same river for every seed, across the field from edge to edge, and nothing else', () => {
  const a = TT.newGame(1, { map: 'medium' }), b = TT.newGame(999, { map: 'medium' });
  assert.deepStrictEqual(waterCells(a), TT.MEDIUM_WATER); assert.deepStrictEqual(waterCells(b), TT.MEDIUM_WATER);
  assert(a.grid.every((v) => v === 0 || v === TT.WATER));
  assert.deepStrictEqual(TT.validate(a), []);
  const rows = new Set(TT.MEDIUM_WATER.map((i) => (i / 6) | 0));
  assert.strictEqual(rows.size, 6, 'water in every row: the river runs from the top edge to the bottom edge');
  // orthogonally connected river
  const w = new Set(TT.MEDIUM_WATER), seen = new Set([TT.MEDIUM_WATER[0]]), stack = [TT.MEDIUM_WATER[0]];
  while (stack.length) TT.neighbors(stack.pop()).forEach((j) => { if (w.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); } });
  assert.strictEqual(seen.size, w.size);
});

t('maps: hard has random ponds (6..9 water tiles) that leave the land in one piece, reproducibly per seed', () => {
  const layouts = new Set();
  for (let seed = 1; seed <= 150; seed++) {
    const s = TT.newGame(seed, { map: 'hard' });
    const n = waterCells(s).length;
    assert(n >= 4 && n <= 9, 'water tiles ' + n + ' (seed ' + seed + ')');
    assert(fieldIsOne(s), 'one connected field (seed ' + seed + ')');
    assert.deepStrictEqual(TT.validate(s), []);
    assert.deepStrictEqual(waterCells(s), waterCells(TT.newGame(seed, { map: 'hard' })));
    layouts.add(waterCells(s).join(','));
  }
  assert(layouts.size > 100, 'ponds differ from seed to seed');
});

t('water: nothing can be placed, hammered, moved or trapped there; animals treat it as a wall and never enter it', () => {
  const s = TT.newGame(3, { map: 'medium' });
  s.coins = 500;
  const wi = TT.MEDIUM_WATER[0];
  assert.strictEqual(TT.place(s, wi), null, 'cannot place on water'); assert.strictEqual(TT.preview(s, wi), null);
  assert.strictEqual(TT.hammer(s, wi), null, 'the hammer cannot remove water');
  assert.strictEqual(TT.move(withGridKeep(s, { [I(0, 0)]: 3 }), I(0, 0), wi), null, 'cannot drop onto water');
  assert.strictEqual(TT.move(withGridKeep(s, { [I(0, 0)]: 3 }), wi, I(0, 1)), null, 'cannot pick water up');
  assert(!TT.isMovable(TT.WATER));
  // a bear next to water never steps into it
  for (let seed = 1; seed <= 60; seed++) {
    const g = withGridKeep(Object.assign(TT.newGame(seed, { map: 'medium' }), { cur: 2 }), { [I(0, 1)]: TT.BEAR });
    const r = TT.place(g, I(5, 5));
    assert.deepStrictEqual(waterCells(r.state), TT.MEDIUM_WATER, 'water never changes');
  }
  // a fox never warps onto water either; a bear walled in by water and buildings dies like any trapped bear
  for (let seed = 1; seed <= 60; seed++) {
    const base = Object.assign(TT.newGame(seed, { map: 'hard' }), { cur: 2 }), free = base.grid.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    const g = withGridKeep(base, { [free[3]]: TT.FOX });
    const r = TT.place(g, free[0]);
    assert.deepStrictEqual(waterCells(r.state), waterCells(base), 'water never changes (seed ' + seed + ')');
    const fx = r.state.grid.indexOf(TT.FOX);
    assert(fx >= 0 && !waterCells(base).includes(fx), 'the fox warped to dry land');
  }
  const corner = Object.assign(TT.newGame(2), { map: 'medium' });
  corner.grid = new Array(36).fill(0); corner.grid[I(0, 0)] = TT.BEAR; corner.grid[I(0, 1)] = TT.WATER; corner.grid[I(1, 0)] = 5; corner.cur = 2;
  assert.strictEqual(TT.place(corner, I(5, 5)).state.grid[I(0, 0)], TT.TOMB, 'water + building seal the bear in');
  const fox = Object.assign(TT.newGame(2), { map: 'medium' }); fox.grid = new Array(36).fill(0);
  fox.grid[I(0, 0)] = TT.FOX; fox.grid[I(0, 1)] = TT.WATER; fox.grid[I(1, 0)] = TT.WATER; fox.cur = 2;
  assert.strictEqual(TT.place(fox, I(5, 5)).state.grid[I(0, 0)], TT.TOMB, 'a fox cornered by water is trapped too');
});
function withGridKeep(base, cells) { const s = JSON.parse(JSON.stringify(base)); for (const k in cells) s.grid[k] = cells[k]; return s; }

t('water: the board is full when every non-water tile is used; land adds plain tiles and keeps the water', () => {
  const s = TT.newGame(4, { map: 'medium' });
  s.grid = s.grid.map((v, i) => (v === TT.WATER ? v : ((((i / 6) | 0) + (i % 6)) % 2 ? 5 : 6)));
  s.grid[I(0, 0)] = 0; s.stock.hammer = 0; s.coins = 0; s.cur = 4;
  const r = TT.place(s, I(0, 0));
  assert(r.state.over, 'water does not count as a free tile');
  assert.deepStrictEqual(TT.validate(r.state), []);
  const rich = Object.assign(TT.newGame(4, { map: 'medium' }), { coins: 1000 });
  const l = TT.buyLand(rich, 'top').state;
  assert.deepStrictEqual(waterCells(l), [2].concat(TT.MEDIUM_WATER.map((i) => i + 6)), 'the river moved down one row and runs on into the new top row');
  assert.deepStrictEqual(TT.validate(l), []);
});

t('land: water on the edge carries on into the new row / column, everything else is plain land', () => {
  const rich = (opts) => Object.assign(TT.newGame(4, opts), { coins: 5000 });
  const m = rich({ map: 'medium' }); // river tiles 2 (top edge) and 33 (bottom edge)
  assert.deepStrictEqual(waterCells(TT.buyLand(m, 'bottom').state), TT.MEDIUM_WATER.concat([39]), 'bottom: only under the river end (col 3)');
  assert.deepStrictEqual(waterCells(TT.buyLand(m, 'left').state), TT.MEDIUM_WATER.map((i) => i + 1 + ((i / 6) | 0)), 'left / right: the river does not touch those edges, so no new water');
  assert.deepStrictEqual(waterCells(TT.buyLand(m, 'right').state), TT.MEDIUM_WATER.map((i) => i + ((i / 6) | 0)));
  // a pond on the left edge grows into the new left column; a bridged edge tile continues as water too
  const e = rich({}); e.grid[I(2, 0)] = TT.WATER; e.grid[I(3, 0)] = TT.WATER; e.bridges = [];
  const l = TT.buyLand(e, 'left').state;
  assert.deepStrictEqual(waterCells(l), [2 * 7, 2 * 7 + 1, 3 * 7, 3 * 7 + 1]);
  assert.deepStrictEqual(TT.validate(l), []);
  const eb = rich({ map: 'medium' }); eb.bridges = [2]; eb.grid[2] = 0;
  assert.strictEqual(TT.buyLand(eb, 'top').state.grid[2], TT.WATER, 'a bridged edge tile carries the river on');
});

t('maps: migrate gives old saves the plain field; validate rejects an unknown map', () => {
  const old = JSON.parse(JSON.stringify(TT.newGame(3))); delete old.map;
  TT.migrate(old);
  assert.strictEqual(old.map, 'easy'); assert.deepStrictEqual(TT.validate(old), []);
  assert(TT.validate(Object.assign({}, old, { map: 'swamp' })).length);
  assert(TT.validate(Object.assign({}, old, { grid: old.grid.map((v, i) => (i === 3 ? 99 : v)) })).length);
});

// ---- breeding (Wild bears only): a small pocket with 2+ bears and 2+ empty tiles sometimes grows a cub on one of its empty tiles
const pen4 = (extra = {}) => Object.assign({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.BEAR, [I(1, 0)]: 5, [I(1, 1)]: 6, [I(0, 4)]: 7, [I(1, 3)]: 8, [I(1, 2)]: 9, [I(0, 3)]: 0 }, extra);
// pen: (0,0) (0,1) (0,2) (0,3) in a row along the top edge, walled below by buildings and at (0,4)

t('breeding: 2 bears + 2 empty tiles in a pen sometimes make a cub, and always leave a free tile', () => {
  let cubs = 0; const runs = 300;
  for (let seed = 1; seed <= runs; seed++) {
    const r = TT.place(withGrid(pen4(), { wild: true, cur: 2, rng: seed }), I(5, 5));
    const bears = r.state.grid.filter((v) => TT.isBear(v)).length;
    assert(bears === 2 || bears === 3, 'bears ' + bears);
    if (bears === 3) {
      cubs++;
      const e = r.events.find((x) => x.type === 'cub');
      assert(e && e.at <= I(0, 3), 'the cub appears on a tile of the pen (the first four tiles)');
      assert.strictEqual(r.state.grid[e.at], TT.BEAR);
    }
    assert(r.state.grid.slice(0, 4).some((v) => v === 0), 'the pen always keeps a free tile (seed ' + seed + ')');
    assert(!r.events.some((x) => x.type === 'trapped'), 'a cub never seals the pen');
    assert.deepStrictEqual(TT.validate(r.state), []);
  }
  assert(cubs > runs * 0.04 && cubs < runs * 0.2, 'about ' + TT.BREED_CHANCE * 100 + '% of turns: ' + cubs + '/' + runs);
});

t('breeding: not in classic games, not with 1 bear, not with only 1 empty tile, not in big pockets, not past the bear cap', () => {
  const none = (s, why) => { for (let seed = 1; seed <= 150; seed++) { s.rng = seed; const r = TT.place(JSON.parse(JSON.stringify(s)), I(5, 5)); assert(!r.events.some((e) => e.type === 'cub'), why + ' (seed ' + seed + ')'); } };
  none(withGrid(pen4(), { wild: false, cur: 2 }), 'classic');
  none(withGrid(pen4({ [I(0, 1)]: 0 }), { wild: true, cur: 2 }), 'one bear');
  none(withGrid(pen4({ [I(0, 3)]: 7 }), { wild: true, cur: 2 }), 'one free tile only');
  const big = withGrid({ [I(2, 2)]: TT.BEAR, [I(2, 3)]: TT.BEAR }, { wild: true, cur: 2 });
  none(big, 'open board (a pocket far bigger than ' + TT.BREED_MAX_POCKET + ' tiles)');
  const crowded = withGrid(pen4(), { wild: true, cur: 2 });
  let k = 0; for (let i = 0; i < 36 && k < TT.BREED_MAX_BEARS - 2; i++) if (crowded.grid[i] === 0 && i > 11 && i !== I(5, 5)) { crowded.grid[i] = TT.BEAR; k++; }
  none(crowded, 'bear cap');
});

// ---- bridges
const medium = (over = {}) => Object.assign(TT.newGame(3, { map: 'medium' }), { coins: 100000 }, over);
// medium river water indices: 2 8 14 15 21 27 33 (the winding river); 14 and 15 are the double-wide part

t('bridge spots: water tiles with dry land on both opposite sides, so edges yes, corners and the middle of water no', () => {
  assert.deepStrictEqual(TT.bridgeSpots(medium()), [2, 8, 21, 27, 33], 'the single-width parts of the river (the top and bottom edge tiles included)');
  [TT.newGame(3), TT.newGame(3, { map: 'standard' })].forEach((s) => assert.deepStrictEqual(TT.bridgeSpots(s), [], 'no water, no spots'));
  // a corner water tile is never a spot, even with land next to it; a lone lake tile in the middle is
  const g = TT.newGame(3); g.grid[I(0, 0)] = TT.WATER; g.grid[I(3, 3)] = TT.WATER; g.grid[I(3, 4)] = TT.WATER; g.grid[I(5, 5)] = TT.WATER;
  assert.deepStrictEqual(TT.bridgeSpots(g), [I(3, 3), I(3, 4)], 'only the two-tile pond tiles that have banks on both sides (up/down)');
  const wide = TT.newGame(3); [I(2, 1), I(2, 2), I(2, 3)].forEach((i) => { wide.grid[i] = TT.WATER; });
  assert.deepStrictEqual(TT.bridgeSpots(wide), [I(2, 1), I(2, 2), I(2, 3)], 'a horizontal strip of water can be crossed up/down at every tile');
  const lake = TT.newGame(3); for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) lake.grid[I(r, c)] = TT.WATER;
  assert(!TT.bridgeSpots(lake).includes(I(2, 2)), 'the middle of a lake is not a spot');
});

t('buying a bridge: the water tile becomes a walkable tile, free action, price rises, at most five, and it extends over wide water', () => {
  let s = medium();
  const first = TT.buyBridge(s, 8);
  assert(first && first.events[0].type === 'bridge' && first.events[0].at === 8);
  assert.strictEqual(first.state.grid[8], 0); assert.deepStrictEqual(first.state.bridges, [8]);
  assert.strictEqual(first.state.coins, s.coins - TT.BRIDGE_PRICE[0]); assert.strictEqual(first.state.turn, s.turn, 'free action');
  assert.deepStrictEqual(TT.validate(first.state), []);
  assert.strictEqual(TT.buyBridge(s, 14), null, 'the middle of the double-wide river is not a spot yet');
  assert.strictEqual(TT.buyBridge(s, I(0, 0)), null, 'dry land is not a spot'); assert.strictEqual(TT.buyBridge(s, -1), null);
  s = first.state;
  assert(TT.bridgeSpots(s).includes(14), 'next to the first bridge the wide part opens up: the bridge counts as a bank');
  const prices = [TT.BRIDGE_PRICE[0]];
  for (const idx of [14, 21, 27, 33]) { const before = s.coins, r = TT.buyBridge(s, idx); assert(r, 'bridge at ' + idx); prices.push(before - r.state.coins); s = r.state; }
  assert.deepStrictEqual(prices, TT.BRIDGE_PRICE, 'every bridge costs more than the last');
  assert(TT.BRIDGE_PRICE.every((p, k) => k === 0 || p > TT.BRIDGE_PRICE[k - 1]));
  assert.strictEqual(s.bridges.length, 5); assert.strictEqual(TT.bridgePrice(s), null); assert.strictEqual(TT.buyBridge(s, 2), null, 'limit of 5');
  assert.deepStrictEqual(TT.bridgeSpots(s), []); assert(!TT.canBridge(s));
  assert.deepStrictEqual(TT.validate(s), []);
  assert.strictEqual(TT.buyBridge(medium({ coins: TT.BRIDGE_PRICE[0] - 1 }), 8), null, 'too poor');
  assert(TT.canBridge(medium()) && !TT.canBridge(medium({ coins: 5 })));
});

t('bridge tiles: nothing can be placed, dropped or previewed there, and they do not count as free tiles', () => {
  const s = Object.assign(TT.buyBridge(medium(), 8).state, { cur: 2 });
  assert.strictEqual(TT.place(s, 8), null); assert.strictEqual(TT.preview(s, 8), null);
  const withItem = JSON.parse(JSON.stringify(s)); withItem.grid[I(5, 5)] = 3; withItem.coins = 1000;
  assert.strictEqual(TT.move(withItem, I(5, 5), 8), null, 'the mover cannot drop on a bridge either');
  assert.strictEqual(TT.hammer(withItem, 8), null, 'nothing to smash');
  assert.strictEqual(TT.freeCount(s), s.grid.filter((v) => v === 0).length - 1);
  // a board full except the bridge tile is over: nothing can be placed
  const full = JSON.parse(JSON.stringify(s)); full.stock.hammer = 0; full.coins = 0;
  full.grid = full.grid.map((v, i) => (v === TT.WATER || i === 8 ? v : ((((i / 6) | 0) + (i % 6)) % 2 ? 5 : 6)));
  full.grid[I(5, 5)] = 0; full.cur = 4;
  const r = TT.place(full, I(5, 5));
  assert(r.state.over, 'only a bridge tile left: game over'); assert.deepStrictEqual(TT.validate(r.state), []);
});

t('bears cross a bridge: they step onto it and off the other side', () => {
  const s0 = medium(); const b = TT.buyBridge(s0, 8).state; // bridge on (1,2): banks (1,1) and (1,3)
  // turn 1: the bear on the left bank is walled in except for the bridge tile
  const left = JSON.parse(JSON.stringify(b)); left.cur = 2;
  left.grid[I(1, 1)] = TT.BEAR; left.grid[I(0, 1)] = 5; left.grid[I(2, 1)] = 6; left.grid[I(1, 0)] = 7;
  const r1 = TT.place(left, I(5, 5));
  assert.strictEqual(r1.state.grid[I(1, 2)], TT.BEAR, 'the bear is on the bridge'); assert.strictEqual(r1.state.grid[I(1, 1)], 0);
  assert(!r1.events.some((e) => e.type === 'trapped'), 'a bridge tile is room, not a wall');
  assert.deepStrictEqual(TT.validate(r1.state), []);
  // turn 2: on the bridge with the left bank blocked, the only way is across
  const onBridge = JSON.parse(JSON.stringify(r1.state)); onBridge.cur = 2; onBridge.grid[I(1, 1)] = 8;
  const r2 = TT.place(onBridge, I(5, 4));
  assert.strictEqual(r2.state.grid[I(1, 3)], TT.BEAR, 'the bear walked across to the other bank'); assert.strictEqual(r2.state.grid[I(1, 2)], 0);
  // a bear walled in by buildings and a bridge tile is trapped only when the bridge is blocked too
  const sealed = JSON.parse(JSON.stringify(b)); sealed.cur = 2; sealed.grid[I(1, 2)] = TT.BEAR;
  sealed.grid[I(1, 1)] = 5; sealed.grid[I(1, 3)] = 6;
  assert.strictEqual(TT.place(sealed, I(5, 5)).state.grid[I(1, 2)], TT.TOMB, 'walled in on the bridge: it turns into a tombstone like anywhere else');
});

t('bridges keep their tiles when land is bought, and undo takes a bridge back with its price', () => {
  const b = TT.buyBridge(medium(), 8).state;                // (1,2)
  const top = TT.buyLand(b, 'top').state;
  assert.deepStrictEqual(top.bridges, [8 + 6]); assert.strictEqual(top.grid[14], 0); assert.deepStrictEqual(TT.validate(top), []);
  const left = TT.buyLand(b, 'left').state;                  // (1,2) -> (1,3) on a 7-wide board
  assert.deepStrictEqual(left.bridges, [1 * 7 + 3]); assert.deepStrictEqual(TT.validate(left), []);
  const right = TT.buyLand(b, 'right').state, bottom = TT.buyLand(b, 'bottom').state;
  assert.deepStrictEqual(right.bridges, [1 * 7 + 2]); assert.deepStrictEqual(bottom.bridges, [8]);
  [left, right].forEach((x) => assert.strictEqual(TT.bridgeSpots(x).length, 5, 'the same five spots on the grown board (one bridged, the double-wide part opened up)'));
  [top, bottom].forEach((x) => assert.strictEqual(TT.bridgeSpots(x).length, 6, 'the river runs on into the new row: one more spot, at the new edge'));
  // undo: place something, build a bridge, undo -> the bridge and its cost are gone (undo charges only its own fee)
  const base = medium({ coins: 5000 });
  const placed = TT.place(base, I(5, 0)).state;
  const built = TT.buyBridge(placed, 2).state;
  assert.strictEqual(built.bridges.length, 1);
  const undone = TT.undo(built);
  assert.deepStrictEqual(undone.bridges, []); assert.strictEqual(undone.coins, base.coins - TT.UNDO_COST);
  assert.deepStrictEqual(TT.validate(undone), []);
});

t('bridges: migrate gives old saves none; validate rejects a bridge on water, a duplicate, an out-of-range tile, or too many', () => {
  const old = JSON.parse(JSON.stringify(medium())); delete old.bridges;
  TT.migrate(old); assert.deepStrictEqual(old.bridges, []); assert.deepStrictEqual(TT.validate(old), []);
  const ok = TT.buyBridge(medium(), 8).state;
  assert(TT.validate(Object.assign({}, ok, { bridges: [14] })).length, 'bridge on a water tile');
  assert(TT.validate(Object.assign({}, ok, { bridges: [8, 8] })).length, 'duplicate');
  assert(TT.validate(Object.assign({}, ok, { bridges: [99] })).length, 'out of range');
  assert(TT.validate(Object.assign({}, ok, { bridges: [0, 1, 3, 4, 5, 6] })).length, 'more than the limit');
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

t('swapNext: exchanges the current and the next item, free (no turn, no rng, no coins), twice is a no-op, refused when the game is over', () => {
  const s = withGrid({ [I(0, 0)]: 5 }, { cur: 2, next: 3, hold: TT.BEAR });
  const a = TT.swapNext(s);
  assert.strictEqual(a.cur, 3); assert.strictEqual(a.next, 2);
  ['hold', 'turn', 'rng', 'coins', 'score', 'seed'].forEach((k) => assert.strictEqual(a[k], s[k], k + ' untouched'));
  assert.deepStrictEqual(a.grid, s.grid);
  assert.deepStrictEqual(TT.validate(a), []);
  assert.strictEqual(JSON.stringify(TT.swapNext(a)), JSON.stringify(s), 'swapping back restores the state exactly');
  assert.strictEqual(JSON.stringify(s), JSON.stringify(withGrid({ [I(0, 0)]: 5 }, { cur: 2, next: 3, hold: TT.BEAR })), 'the input is not mutated');
  assert.strictEqual(TT.swapNext(Object.assign({}, s, { over: true })), null);
  // the swapped-in item is what gets placed
  const r = TT.place(a, I(3, 3));
  assert.strictEqual(r.state.grid[I(3, 3)], 3); assert.strictEqual(r.events[0].item, 3);
  // equal items: harmless
  const same = withGrid({}, { cur: 1, next: 1 });
  assert.strictEqual(TT.swapNext(same).cur, 1);
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

t('the queue sometimes brings a free trap (+1 trap stock, event), never in a calm game, and gems / foxes are rarer', () => {
  const count = (opts) => {
    let s = TT.newGame(11, opts), bonus = 0, turns = 0;
    const pick = TT.newGame(99);
    while (!s.over && turns < 3000) {
      const e = []; s.grid.forEach((v, i) => { if (v === 0 && !s.bridges.includes(i)) e.push(i); });
      if (!e.length) break;
      const before = s.stock.trap, r = TT.place(s, e[Math.floor(TT.rand(pick) * e.length)]);
      if (!r) break;
      const ev = r.events.filter((x) => x.type === 'bonus').length;
      const restocks = r.events.filter((x) => x.type === 'unlock').length * TT.RESTOCK.trap;
      assert.strictEqual(r.state.stock.trap - before - restocks, ev, 'each bonus event is exactly one trap');
      bonus += ev; turns++; s = r.state;
      s.stock.hammer = 5; s.coins = Math.max(s.coins, 100); // keep the game going
      s.over = false;
    }
    return { bonus, turns };
  };
  const a = count({}); assert(a.bonus > 0 && a.bonus / a.turns > 0.01 && a.bonus / a.turns < 0.06, 'about ' + TT.TRAP_DROP * 100 + '% of turns: ' + a.bonus + '/' + a.turns);
  assert.strictEqual(count({ bears: false, foxes: false }).bonus, 0, 'no animals, no traps');
  assert(TT.WEIGHTS.find((w) => w[0] === TT.CRYSTAL)[1] < 4 && TT.WEIGHTS.find((w) => w[0] === TT.FOX)[1] <= 2, 'gems rarer than the original 4%, foxes rarer than 3%');
  assert(TT.PRICE[TT.CRYSTAL] >= 200 && TT.PRICE[TT.CRYSTAL] <= 500, 'a gem costs about a house, not the 50 it started at');
});

t('ponds: dug on an empty tile, dearer each time, pay points every turn, never take the last free tile', () => {
  let s = withGrid({}, { coins: 100000, top: 4 });
  const r = TT.buyPond(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.WATER); assert.deepStrictEqual(r.state.ponds, [I(2, 2)]);
  assert.strictEqual(r.state.coins, s.coins - TT.POND_PRICE[0]);
  assert.deepStrictEqual(r.events[0], { type: 'pond', at: I(2, 2), price: TT.POND_PRICE[0] });
  assert(TT.POND_PRICE[1] > TT.POND_PRICE[0] && TT.POND_PRICE[15] > TT.POND_PRICE[14], 'dearer every time');
  assert.deepStrictEqual(TT.validate(r.state), []);
  // an occupied tile, water, a bridge tile and a poor player are all refused
  assert.strictEqual(TT.buyPond(withGrid({ [I(1, 1)]: 3 }, { coins: 100000 }), I(1, 1)), null);
  assert.strictEqual(TT.buyPond(r.state, I(2, 2)), null);
  assert.strictEqual(TT.buyPond(withGrid({}, { coins: TT.POND_PRICE[0] - 1 }), I(0, 0)), null);
  // income: ponds x ceil(BASE[top] / 20) every turn, on top of what the merges pay
  s = r.state; s.cur = 1; s.next = 1;
  const t = TT.place(s, I(5, 5));
  assert.strictEqual(t.state.score - s.score, TT.pondPoints(s)); assert.strictEqual(TT.pondPoints(s), Math.ceil(TT.BASE[4] / 20));
  assert(t.events.some((e) => e.type === 'pondpts' && e.points === TT.pondPoints(s) && e.coins === TT.pondCoins(s)));
  assert.strictEqual(t.state.coins - s.coins, TT.pondCoins(s)); assert.strictEqual(TT.pondCoins(s), Math.max(1, Math.round(TT.PRICE[4] / 400)), 'one pond pays coins too');
  // never the last free tile (a fuller board than that would end the game by your own hand)
  const g = {}; for (let i = 0; i < 34; i++) g[i] = (i % 2) ? 5 : 6;
  const tight = withGrid(g, { coins: 100000 });
  assert.strictEqual(TT.buyPond(tight, 34).state.grid[34], TT.WATER, 'two free tiles: one may go');
  assert.strictEqual(TT.buyPond(TT.buyPond(tight, 34).state, 35), null, 'one free tile left: refused');
  // land keeps the index list in step; a dug pond is never a bridge spot
  const moved = TT.buyLand(r.state, 'top').state;
  assert.deepStrictEqual(moved.ponds, [I(2, 2) + 6]); assert.strictEqual(moved.grid[moved.ponds[0]], TT.WATER);
  assert.deepStrictEqual(TT.validate(moved), []);
  const lone = withGrid({}, { coins: 100000 }); lone.grid[I(2, 2)] = 0;
  assert(!TT.bridgeSpots(TT.buyPond(lone, I(2, 2)).state).includes(I(2, 2)));
  // old saves get an empty pond list
  const legacy = JSON.parse(JSON.stringify(withGrid({}))); delete legacy.ponds; delete legacy.lake;
  const m = TT.migrate(legacy); assert.deepStrictEqual(m.ponds, []); assert.strictEqual(m.lake, 0); assert.deepStrictEqual(TT.validate(m), []);
});

t('lake quests: the pond that completes a 2x2, 3x3, 4x4 block of water pays a one-off bonus', () => {
  let s = withGrid({}, { coins: 10 ** 7, top: 5 });
  const ev = [];
  const dig = (r, c) => { const x = TT.buyPond(s, I(r, c)); s = x.state; ev.push(...x.events); };
  [[0, 0], [0, 1], [1, 0]].forEach(([r, c]) => dig(r, c));
  assert.strictEqual(s.lake, 0); assert.strictEqual(TT.bestLake(s), 1, 'an L of water is not a lake yet');
  dig(1, 1);
  assert.strictEqual(s.lake, 1); assert.strictEqual(TT.bestLake(s), 2);
  const q = ev.filter((e) => e.type === 'lake'); assert.deepStrictEqual(q.map((e) => e.size), [2]); assert.strictEqual(q[0].points, TT.BASE[5] * TT.LAKE_BONUS[0]);
  assert.strictEqual(q[0].coins, TT.LAKE_COINS[0], 'a quest pays coins too');
  const paid = 10 ** 7 - s.coins; assert.strictEqual(paid, TT.POND_PRICE[0] + TT.POND_PRICE[1] + TT.POND_PRICE[2] + TT.POND_PRICE[3] - TT.LAKE_COINS[0], 'four ponds cost their prices minus the quest coins');
  dig(2, 2); dig(0, 2); dig(1, 2); dig(2, 0); dig(2, 1); // 3x3
  assert.strictEqual(s.lake, 2); assert.strictEqual(TT.bestLake(s), 3);
  [[0, 3], [1, 3], [2, 3], [3, 0], [3, 1], [3, 2], [3, 3]].forEach(([r, c]) => dig(r, c)); // 4x4
  assert.strictEqual(s.lake, 3); assert.strictEqual(TT.bestLake(s), 4); assert.strictEqual(s.ponds.length, 16);
  assert.strictEqual(ev.filter((e) => e.type === 'lake').length, 3, 'each quest pays once');
  assert.strictEqual(TT.buyPond(s, I(5, 5)), null, 'at most ' + TT.MAX_PONDS + ' ponds');
  assert.deepStrictEqual(TT.validate(s), []);
});

t('calendar: each turn advances the clock by `speed` ticks, 10 ticks a month, 12 months a year', () => {
  let s = withGrid({}, { cur: 1, next: 1 });
  assert.strictEqual(s.tick, 0); assert.strictEqual(s.speed, 1); assert.deepStrictEqual(TT.calendar(s), { year: 1, month: 1 });
  for (let i = 0; i < 10; i++) s = TT.place(s, i).state;
  assert.strictEqual(s.tick, 10); assert.deepStrictEqual(TT.calendar(s), { year: 1, month: 2 }, '10 turns = one month');
  const fast = withGrid({}, { speed: 3, cur: 1, next: 1 }), r = TT.place(fast, 0).state;
  assert.strictEqual(r.tick, 3, 'x3: three ticks a turn');
  const paused = TT.place(withGrid({}, { speed: 0, cur: 1, next: 1 }), 0).state; assert.strictEqual(paused.tick, 0, 'paused: time stands still');
  assert.deepStrictEqual(TT.calendar({ tick: 120 }), { year: 2, month: 1 }); assert.deepStrictEqual(TT.calendar({ tick: 119 }), { year: 1, month: 12 });
  const rich = withGrid({}, { coins: 99999, top: 7, cur: 1, next: 1 });
  assert.deepStrictEqual(TT.validate(TT.place(rich, 0).state), []);
});

t('bank: bought with coins once a village stands, placed like an item, never in the reserve, at most 3, dearer each time', () => {
  const base = (o = {}) => withGrid({ [I(5, 5)]: 7 }, Object.assign({ coins: 100000, top: 7, cur: 1, next: 2 }, o));
  assert(TT.isBankAvailable(base())); assert(!TT.isBankAvailable(withGrid({}, { coins: 100000 })), 'locked until a village has stood on the board');
  assert.strictEqual(TT.buyBank(withGrid({}, { coins: 100000 })), null);
  assert.strictEqual(TT.buyBank(base({ coins: TT.BANK_PRICE[0] - 1 })), null, 'too poor');
  let s = TT.buyBank(base());
  assert.strictEqual(s.cur, TT.BANK); assert.strictEqual(s.next, 1, 'the old current item moves to next'); assert.strictEqual(s.coins, 100000 - TT.BANK_PRICE[0]); assert.strictEqual(s.banksBought, 1);
  assert.deepStrictEqual(TT.validate(s), []);
  assert.strictEqual(TT.swap(s), null, 'a bank cannot go into the reserve');
  assert.strictEqual(TT.swapNext(s).next, TT.BANK, 'but the next / current swap is allowed'); assert.strictEqual(TT.buyBank(s), null, 'already holding one');
  const r = TT.place(s, I(2, 2));
  assert.strictEqual(r.state.grid[I(2, 2)], TT.BANK); assert.strictEqual(TT.bankCount(r.state), 1); assert.strictEqual(r.state.cur, 1);
  // a dead tile: movers cannot carry it, animals cannot walk through it, the hammer can break it
  assert(TT.isMovable(TT.BANK), 'the mover can carry a bank');
  const hm = TT.hammer(Object.assign(r.state, { coins: 1000 }), I(2, 2)); assert.strictEqual(hm.state.grid[I(2, 2)], 0, 'the hammer destroys a bank');
  assert.strictEqual(hm.state.banksBought, 1); assert.strictEqual(TT.bankPrice(hm.state), TT.BANK_PRICE[0], 'the price follows the banks held now, so it starts again after a bank is gone');
  // at most 3 on the board (placed + in the queue)
  let t = base({ coins: 10 ** 7 });
  for (let k = 0; k < 3; k++) { t = TT.buyBank(t); assert(t, 'bank ' + (k + 1)); t = TT.place(t, I(0, k * 2)).state; }
  assert.strictEqual(TT.bankCount(t), 3);
  assert.strictEqual(TT.buyBank(t), null, 'a fourth bank is refused');
  assert.strictEqual(TT.bankPrice(base({ banksBought: 9 })), TT.BANK_PRICE[0], 'banks ever bought do not raise the price');
  const two = withGrid({ [I(0, 0)]: TT.BANK, [I(0, 2)]: TT.BANK }, { banksBought: 9, bankOrder: [I(0, 0), I(0, 2)] }); assert.strictEqual(TT.bankPrice(two), TT.BANK_PRICE[2]);
  const one = withGrid({ [I(0, 0)]: TT.BANK }, { banksBought: 9, bankOrder: [I(0, 0)] }); assert.strictEqual(TT.bankPrice(one), TT.BANK_PRICE[1]);
  assert.strictEqual(TT.bankPrice(Object.assign(one, { cur: TT.BANK })), TT.BANK_PRICE[2], 'a bank waiting in the queue counts');
});

t('bank: pays coins every turn (more at a higher clock speed, nothing paused); three connected banks merge into cash', () => {
  const income = TT.bankIncome(withGrid({}, { top: 7 })); assert.strictEqual(income, Math.round(TT.PRICE[7] * 0.01), '1% of the best tier price per tick');
  // two banks pay on an ordinary turn
  let s = withGrid({ [I(0, 0)]: TT.BANK, [I(0, 5)]: TT.BANK, [I(5, 5)]: 7 }, { coins: 0, top: 7, cur: 1, next: 1, tick: 9, banksBought: 2, bankOrder: [I(0, 0), I(0, 5)] });
  assert.deepStrictEqual(TT.validate(s), []);
  const r = TT.place(s, I(3, 3)), ev = r.events.find((e) => e.type === 'bankpay');
  assert(ev && ev.coins === 2 * income && ev.each === income && ev.ticks === 1 && ev.banks === 2, JSON.stringify(ev)); assert.strictEqual(r.state.coins, 2 * income);
  assert.deepStrictEqual(ev.at, [I(0, 0), I(0, 5)], 'one entry per paying bank, so the UI can float each one');
  assert.strictEqual(TT.place(Object.assign({}, s, { tick: 3 }), I(3, 3)).state.coins, 2 * income, 'not only at a month end: every turn');
  assert.strictEqual(TT.place(Object.assign({}, s, { speed: 3 }), I(3, 3)).state.coins, 2 * income * 3, 'x3 speed: three ticks of income a turn');
  assert(!TT.place(Object.assign({}, s, { speed: 0 }), I(3, 3)).events.some((e) => e.type === 'bankpay'), 'paused clock, no pay');
  // trio -> cash on the tapped tile
  const trio = withGrid({ [I(2, 1)]: TT.BANK, [I(2, 3)]: TT.BANK }, { cur: TT.BANK, next: 1, banksBought: 3, top: 7, coins: 0, bankOrder: [I(2, 1), I(2, 3)] });
  assert.deepStrictEqual(TT.validate(trio), []);
  const m = TT.place(trio, I(2, 2));
  assert.strictEqual(m.state.grid[I(2, 2)], TT.CASH, 'three banks become cash where the last one landed');
  assert.strictEqual(m.state.grid[I(2, 1)], 0); assert.strictEqual(m.state.grid[I(2, 3)], 0); assert.strictEqual(m.state.score, trio.score, 'the cash is the prize: no points');
  assert.deepStrictEqual(TT.validate(m.state), []);
  // old saves
  const legacy = JSON.parse(JSON.stringify(withGrid({}))); delete legacy.tick; delete legacy.speed; delete legacy.banksBought;
  const mg = TT.migrate(legacy); assert.strictEqual(mg.tick, 0); assert.strictEqual(mg.speed, 1); assert.strictEqual(mg.banksBought, 0); assert.deepStrictEqual(TT.validate(mg), []);
});

t('loans: the most expensive neighbouring building is the collateral, half its shop price comes in, the building and the bank are locked', () => {
  const B = I(2, 2), bank = (extra = {}, over = {}) => withGrid(Object.assign({ [B]: TT.BANK, [I(2, 1)]: 6, [I(1, 2)]: 5, [I(3, 2)]: 5 }, extra), Object.assign({ coins: 0, top: 7, banksBought: 1, bankOrder: [B], cur: 1, next: 1 }, over));
  let s = bank();
  assert.deepStrictEqual(TT.validate(s), []);
  let o = TT.loanOptions(s, B); assert(o.at === I(2, 1) && o.tier === 6 && o.principal === Math.floor(TT.PRICE[6] / 2) && o.rate === 0.15, JSON.stringify(o));
  assert.strictEqual(TT.loanOptions(s, I(0, 0)), null, 'only a bank lends');
  const r = TT.borrow(s, B); s = r.state;
  assert.strictEqual(s.coins, 200); assert.strictEqual(s.loans.length, 1); assert.strictEqual(s.loans[0].at, I(2, 1)); assert.strictEqual(r.events[0].type, 'loan');
  assert.deepStrictEqual(TT.validate(s), []);
  // locked: cannot be smashed (the building or the bank), cannot be moved, will not merge
  const rich = Object.assign({}, s, { coins: 5000 });
  assert.strictEqual(TT.hammer(rich, I(2, 1)), null, 'the collateral cannot be smashed'); assert.strictEqual(TT.hammer(rich, B), null, 'nor the bank');
  assert.strictEqual(TT.move(rich, I(2, 1), I(0, 0)), null, 'nor moved');
  const stack = bank({ [I(3, 1)]: 6 }, {}); stack.loans = [{ bank: B, at: I(2, 1), tier: 6, principal: 200, rate: 0.15, since: 0, defaulted: false }]; stack.coins = 200;
  assert.deepStrictEqual(TT.validate(stack), []);
  const next = Object.assign({}, stack, { cur: 6, next: 1 }), m = TT.place(next, I(4, 1));
  assert.strictEqual(m.state.grid[I(4, 1)], 6, 'a locked house does not join a merge'); assert.strictEqual(m.state.grid[I(2, 1)], 6); assert.strictEqual(m.state.grid[I(3, 1)], 6);
  // the next loan takes the next most expensive neighbour; a bank with every side locked or empty cannot lend
  o = TT.loanOptions(s, B); assert.strictEqual(o.at, I(1, 2), 'a hut now (ties: lowest index)');
  s = TT.borrow(s, B).state; s = TT.borrow(s, B).state; assert.strictEqual(s.loans.length, 3); assert.strictEqual(TT.borrow(s, B), null, 'nothing left to lock');
  assert.deepStrictEqual(TT.validate(s), []);
  assert.strictEqual(TT.bankRate({ bankOrder: [5, 9, 12] }, 5), 0.15); assert.strictEqual(TT.bankRate({ bankOrder: [5, 9, 12] }, 9), 0.3); assert.strictEqual(TT.bankRate({ bankOrder: [5, 9, 12] }, 12), 0.6, '15% -> 30% -> 60%');
  // a bank with no building next to it cannot lend; a game that is over cannot borrow
  assert.strictEqual(TT.borrow(withGrid({ [B]: TT.BANK }, { top: 7, banksBought: 1, bankOrder: [B] }), B), null);
});

t('loans: interest grows by the month, a year without repaying seizes the tile, repaying pays interest and unlocks (and merges) or frees the tile', () => {
  const B = I(2, 2);
  const mk = (over = {}) => { const s = withGrid({ [B]: TT.BANK, [I(2, 1)]: 6, [I(2, 0)]: 6, [I(1, 1)]: 6 }, Object.assign({ coins: 0, top: 7, banksBought: 1, bankOrder: [B], cur: 1, next: 1, speed: 1 }, over)); s.loans = [{ bank: B, at: I(2, 1), tier: 6, principal: 200, rate: 0.15, since: 0, defaulted: false }]; return s; };
  let s = mk();
  assert.deepStrictEqual(TT.validate(s), [], 'a locked house next to two houses is a valid (unmerged) position');
  assert.strictEqual(TT.loanOwed(Object.assign({}, s, { tick: 5 }), s.loans[0]), 200, 'no interest before a full month');
  assert.strictEqual(TT.loanOwed(Object.assign({}, s, { tick: 50 }), s.loans[0]), 200 + 12, '5 months at 15%/yr: 200 x 0.15 x 5/12 = 12');
  assert.strictEqual(TT.loanOwed(Object.assign({}, s, { tick: 500 }), s.loans[0]), 230, 'after a year it stops growing');
  assert.strictEqual(TT.loanMonthsLeft(Object.assign({}, s, { tick: 50 }), s.loans[0]), 7);
  // repay: pays principal + interest, unlocks the house, and the trio merges into a village on the repaid tile
  const paid = TT.repay(Object.assign({}, s, { tick: 50, coins: 300 }), 0);
  assert.strictEqual(paid.state.coins, 300 - 212 + TT.COIN[6], 'the merge that follows pays its coins'); assert.strictEqual(paid.state.loans.length, 0);
  assert.strictEqual(paid.state.grid[I(2, 1)], 7, 'the freed house merges at once'); assert.strictEqual(paid.state.grid[I(2, 0)], 0); assert.strictEqual(paid.state.grid[I(1, 1)], 0);
  assert(paid.state.score > 0); assert.deepStrictEqual(TT.validate(paid.state), []);
  assert.strictEqual(TT.repay(Object.assign({}, s, { tick: 50, coins: 100 }), 0), null, 'too poor'); assert.strictEqual(TT.repay(s, 3), null);
  // default: on the turn the year is up the building is gone, the tile is seized and the bank stops paying
  const late = Object.assign(mk({ tick: 119, coins: 0 }), { cur: 1, next: 1 }), d = TT.place(late, I(5, 5));
  assert(d.events.some((e) => e.type === 'default' && e.at === I(2, 1)), 'default event');
  assert.strictEqual(d.state.grid[I(2, 1)], TT.SEIZED); assert(d.state.loans[0].defaulted); assert.deepStrictEqual(TT.validate(d.state), []);
  assert.strictEqual(d.state.coins, 0, 'no bank income while a loan is in default');
  assert.strictEqual(TT.hammer(Object.assign({}, d.state, { coins: 99 }), I(2, 1)), null, 'a seized lot cannot be smashed');
  assert.strictEqual(TT.move(Object.assign({}, d.state, { coins: 999 }), I(2, 1), I(0, 0)), null);
  assert.strictEqual(TT.freeCount(d.state), 36 - 5, 'a seized lot is not a free tile');
  const hold = TT.repay(Object.assign({}, d.state, { coins: 1000 }), 0);
  assert.strictEqual(hold.state.grid[I(2, 1)], 0, 'paying the debt brings the tile back, empty'); assert.strictEqual(hold.state.coins, 1000 - 230); assert(hold.events[0].freed);
  assert.deepStrictEqual(TT.validate(hold.state), []);
  // a bank with no loan in default pays at the month end
  const ok = TT.place(mk({ tick: 9, coins: 0 }), I(5, 5)); assert.strictEqual(ok.state.coins, TT.bankIncome(ok.state), 'locked or not, the bank still pays while the loan is in good standing');
  // a paused clock ages no loan
  assert.strictEqual(TT.place(mk({ tick: 119, speed: 0 }), I(5, 5)).state.loans[0].defaulted, false);
});

t('loans: a stuck board is not over while a defaulted lot can be paid for or a loan buys the hammer; speed control; land and old saves', () => {
  const B = I(2, 2), full = (over = {}) => { const g = {}; for (let i = 0; i < 36; i++) g[i] = ((i % 6) + ((i / 6) | 0)) % 2 ? 5 : 6; g[B] = TT.BANK; g[I(2, 1)] = TT.SEIZED; return withGrid(g, Object.assign({ coins: 0, top: 7, banksBought: 1, bankOrder: [B], cur: 1, next: 1, tick: 130 }, over, {})); };
  let s = full(); s.stock.hammer = 0; s.loans = [{ bank: B, at: I(2, 1), tier: 6, principal: 200, rate: 0.15, since: 0, defaulted: true }]; s.grid[I(2, 1)] = TT.SEIZED;
  s.grid[I(0, 0)] = 0; // one free tile so the position is legal; filling it ends the game unless there is an escape
  assert.deepStrictEqual(TT.validate(s), []);
  const stuck = Object.assign({}, s, { cur: 1, next: 1 }), poor = TT.place(stuck, I(0, 0));
  assert(poor.state.over, 'no hammer, no land money, nothing to pay: the game ends');
  const rich = TT.place(Object.assign({}, stuck, { coins: 240 }), I(0, 0));
  assert(!rich.state.over, 'but 230 coins would free the seized lot: not over');
  // speed control
  const a = withGrid({}, {}); assert.strictEqual(TT.setSpeed(a, 1), null, 'already 1x'); assert.strictEqual(TT.setSpeed(a, 4), null); assert.strictEqual(TT.setSpeed(a, 2).speed, 2); assert.strictEqual(TT.setSpeed(a, 0).speed, 0);
  // land buys remap banks, loans and the order
  const L = withGrid({ [B]: TT.BANK, [I(2, 1)]: 6 }, { coins: 10000, top: 7, banksBought: 1, bankOrder: [B] }); L.loans = [{ bank: B, at: I(2, 1), tier: 6, principal: 200, rate: 0.15, since: 0, defaulted: false }];
  const up = TT.buyLand(L, 'top').state; assert.deepStrictEqual(up.bankOrder, [B + 6]); assert.strictEqual(up.loans[0].bank, B + 6); assert.strictEqual(up.loans[0].at, I(2, 1) + 6); assert.deepStrictEqual(TT.validate(up), []);
  const lf = TT.buyLand(L, 'left').state; assert.strictEqual(lf.loans[0].bank, 2 * 7 + 3); assert.deepStrictEqual(TT.validate(lf), []);
  // undo takes a loan back (undo restores the snapshot from before the last turn)
  const t0 = withGrid({ [B]: TT.BANK, [I(2, 1)]: 6 }, { coins: 50, top: 7, banksBought: 1, bankOrder: [B], cur: 1, next: 1 });
  const t1 = TT.place(t0, I(5, 5)).state, loaned = TT.borrow(t1, B).state, back = TT.undo(loaned);
  assert.strictEqual(back.loans.length, 0); assert.strictEqual(back.coins, 50 - TT.UNDO_COST);
  // old saves
  const legacy = JSON.parse(JSON.stringify(withGrid({}))); delete legacy.loans; delete legacy.bankOrder;
  const mg = TT.migrate(legacy); assert.deepStrictEqual(mg.loans, []); assert.deepStrictEqual(mg.bankOrder, []); assert.deepStrictEqual(TT.validate(mg), []);
});

t('pond income and lake bonuses add to the score but never trigger shop restocks', () => {
  const g = {}; for (let i = 0; i < 6; i++) g[i] = TT.WATER;
  const rich = withGrid(g, { top: 10, ponds: [0, 1, 2, 3, 4, 5], score: 399, cur: 1, next: 1 });
  assert.deepStrictEqual(TT.validate(rich), []);
  const r = TT.place(rich, I(5, 5));
  assert(r.state.score - rich.score === TT.pondPoints(rich) && TT.pondPoints(rich) > 10000, 'the ponds paid a lot');
  assert.strictEqual(r.state.milestone, 0, 'but no restock'); assert(!r.events.some((e) => e.type === 'unlock'));
  assert.strictEqual(TT.milestoneProgress(r.state), 399); assert.strictEqual(r.state.bonusScore, TT.pondPoints(rich));
  assert.deepStrictEqual(TT.validate(r.state), []);
  // a real merge still crosses the milestone (3 grass = 30 points from 399)
  const m = TT.place(withGrid({ [I(2, 1)]: 1, [I(2, 3)]: 1 }, { score: 399, cur: 1, next: 1 }), I(2, 2));
  assert.strictEqual(m.state.milestone, 1); assert(m.events.some((e) => e.type === 'unlock'));
  // lake bonuses are bonus score too
  let s = withGrid({}, { coins: 10 ** 7, top: 5 });
  for (const [a2, b2] of [[0, 0], [0, 1], [1, 0], [1, 1]]) s = TT.buyPond(s, I(a2, b2)).state;
  assert.strictEqual(s.lake, 1); assert(s.score >= TT.BASE[5] * TT.LAKE_BONUS[0]); assert.strictEqual(s.milestone, 0, 'the quest bonus gives no restock'); assert.strictEqual(TT.milestoneProgress(s), 0);
  // old saves (no bonusScore) count their whole score, as before
  const legacy = JSON.parse(JSON.stringify(withGrid({}, { score: 500, milestone: 1 }))); delete legacy.bonusScore;
  const mg = TT.migrate(legacy); assert.strictEqual(mg.bonusScore, 0); assert.strictEqual(TT.milestoneProgress(mg), 500); assert.deepStrictEqual(TT.validate(mg), []);
});

t('the mover carries an unlocked bank (to line three up for a merge into cash), keeps its place in the order; a bank with a loan is locked', () => {
  const B1 = I(0, 0), B2 = I(0, 1), B3 = I(3, 3);
  const s = withGrid({ [B1]: TT.BANK, [B2]: TT.BANK, [B3]: TT.BANK, [I(1, 1)]: 6 }, { coins: 1000, top: 7, banksBought: 3, bankOrder: [B3, B1, B2], cur: 1, next: 1 });
  assert.deepStrictEqual(TT.validate(s), []);
  // B3 is the 1st bank; carry it next to the other two: the trio merges into cash where it lands
  const pv = TT.previewMove(s, B3, I(0, 2)); assert(pv && pv.merged && pv.final === TT.CASH, 'the preview shows the cash');
  const r = TT.move(s, B3, I(0, 2));
  assert.strictEqual(r.state.grid[I(0, 2)], TT.CASH); assert.strictEqual(r.state.grid[B1], 0); assert.strictEqual(r.state.grid[B2], 0); assert.strictEqual(r.state.grid[B3], 0);
  assert.deepStrictEqual(r.state.bankOrder, []); assert.deepStrictEqual(TT.validate(r.state), []);
  // a plain move keeps the bank's rank: the first-placed bank stays first (15%)
  const two = withGrid({ [B1]: TT.BANK, [B3]: TT.BANK, [I(1, 0)]: 6 }, { coins: 1000, top: 7, banksBought: 2, bankOrder: [B3, B1], cur: 1, next: 1 });
  const mv = TT.move(two, B3, I(5, 5)); assert.deepStrictEqual(mv.state.bankOrder, [I(5, 5), B1]); assert.strictEqual(TT.bankRate(mv.state, I(5, 5)), 0.15);
  assert.deepStrictEqual(TT.validate(mv.state), []);
  // locked by a loan: no move
  const lk = Object.assign({}, two); lk.loans = [{ bank: B1, at: I(1, 0), tier: 6, principal: 200, rate: 0.15, since: 0, defaulted: false }];
  assert.strictEqual(TT.move(lk, B1, I(5, 4)), null, 'a bank with a loan cannot be moved'); assert.deepStrictEqual(TT.validate(lk), []);
});

t('undo also takes back a mover, hammer or trap use by itself (one step, costs the undo fee)', () => {
  // mover: carry a bank so that three banks merge into cash, then undo
  const B1 = I(0, 0), B2 = I(0, 1), B3 = I(3, 3);
  const s = withGrid({ [B1]: TT.BANK, [B2]: TT.BANK, [B3]: TT.BANK }, { coins: 1000, top: 7, banksBought: 3, bankOrder: [B1, B2, B3], cur: 1, next: 1 });
  const m = TT.move(s, B3, I(0, 2));
  assert.strictEqual(m.state.grid[I(0, 2)], TT.CASH); assert(TT.canUndo(m.state), 'a mover use can be undone');
  const u = TT.undo(m.state);
  assert.strictEqual(u.grid[B3], TT.BANK); assert.strictEqual(u.grid[B1], TT.BANK); assert.strictEqual(u.grid[B2], TT.BANK); assert.strictEqual(u.grid[I(0, 2)], 0);
  assert.strictEqual(u.coins, 1000 - TT.UNDO_COST, 'the 60 coins come back, the undo fee is paid'); assert.strictEqual(u.stock.move, s.stock.move);
  assert.deepStrictEqual(u.bankOrder, [B1, B2, B3]); assert.deepStrictEqual(TT.validate(u), []); assert.strictEqual(TT.undo(u), null, 'one step only');
  // hammer
  const h = TT.hammer(withGrid({ [I(2, 2)]: 5 }, { coins: 100 }), I(2, 2)), hu = TT.undo(h.state);
  assert.strictEqual(hu.grid[I(2, 2)], 5); assert.strictEqual(hu.coins, 100 - TT.UNDO_COST);
  // trap
  const t = TT.trap(withGrid({ [I(2, 2)]: TT.BEAR }, { coins: 100 }), I(2, 2)), tu = TT.undo(t.state);
  assert.strictEqual(tu.grid[I(2, 2)], TT.BEAR); assert.strictEqual(tu.stock.trap, TT.START_STOCK.trap);
  // a placement after a tool use is undone as before
  const p = TT.place(TT.hammer(withGrid({ [I(2, 2)]: 5 }, { coins: 100, cur: 1, next: 1 }), I(2, 2)).state, I(0, 0));
  assert.strictEqual(TT.undo(p.state).grid[I(0, 0)], 0);
});

t('animals can be switched off per game: no bears, no foxes, or calm (neither)', () => {
  for (const [bears, foxes] of [[false, true], [true, false], [false, false]]) {
    for (let seed = 1; seed <= 40; seed++) {
      let s = TT.newGame(seed, { bears, foxes, wild: true });
      assert.strictEqual(s.bears, bears); assert.strictEqual(s.foxes, foxes); assert.strictEqual(s.wild, bears, 'wild needs bears');
      const pick = TT.newGame(seed * 31 + 7);
      let guard = 0;
      while (!s.over && guard++ < 400) {
        assert.deepStrictEqual(TT.validate(s), [], `bears ${bears} foxes ${foxes} seed ${seed}`);
        for (const v of [s.cur, s.next]) { assert(bears || v !== TT.BEAR); assert(foxes || v !== TT.FOX); }
        s.grid.forEach((v) => { assert(bears || !TT.isBear(v)); assert(foxes || v !== TT.FOX); if (!bears && !foxes) assert(v !== TT.TOMB && v !== TT.CHURCH); });
        const e = []; s.grid.forEach((v, i) => { if (v === 0 && !s.bridges.includes(i)) e.push(i); });
        if (!e.length) break;
        const r = TT.place(s, e[Math.floor(TT.rand(pick) * e.length)]);
        if (r) s = r.state;
      }
    }
  }
  // both on is the old game: the same seed deals the same queue as before the switches existed
  const a = TT.newGame(5, {}), b = TT.newGame(5, { bears: true, foxes: true });
  assert.deepStrictEqual(a, b);
  // old saves have both animals
  const legacy = JSON.parse(JSON.stringify(a)); delete legacy.bears; delete legacy.foxes;
  const m = TT.migrate(legacy); assert(m.bears === true && m.foxes === true); assert.deepStrictEqual(TT.validate(m), []);
});

t('fuzz: 400 random games keep state valid and always terminate', () => {
  let loansUsed = 0, defaults = 0, banksBought = 0, maxTurns = 0, merges = 0, trapped = 0, churches = 0, hammers = 0, lands = 0, foxMoves = 0, maxTier = 0, moves = 0, growls = 0, mauls = 0, cubs = 0, bridges = 0;
  for (let seed = 1; seed <= 400; seed++) {
    let s = TT.newGame(seed, { wild: seed % 2 === 0, map: TT.MAPS[((seed / 2) | 0) % 4] });
    if (seed % 5 === 0) { s.top = 7; s.coins = 60000; } // banks need a village in the past and the money
    if (s.map === 'medium' || s.map === 'hard') s.coins = 30000; // well off, so bridges and land get bought in these games too
    const pick = TT.newGame(seed * 7919 + 1); // independent chooser rng
    let guard = 0;
    while (!s.over) {
      assert(++guard < 4000, 'game must terminate (seed ' + seed + ')');
      if (TT.rand(pick) < 0.05) { const sw = TT.swap(s); if (sw) s = sw; else assert.strictEqual(s.cur, TT.BANK, 'only a bank refuses the reserve'); assert.deepStrictEqual(TT.validate(s), []); continue; }
      if (TT.rand(pick) < 0.05) { const w = TT.swapNext(s); assert(w.cur === s.next && w.next === s.cur && w.turn === s.turn && w.rng === s.rng); s = w; assert.deepStrictEqual(TT.validate(s), []); continue; }
      if (TT.rand(pick) < 0.04) {
        const b = TT.buy(s, TT.BUYABLE[Math.floor(TT.rand(pick) * TT.BUYABLE.length)]);
        if (b) { s = b; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      const empties = [], occupied = [];
      s.grid.forEach((v, i) => { if (v === 0) { if (!s.bridges.includes(i)) empties.push(i); } else if (v !== TT.WATER) occupied.push(i); });
      if (TT.rand(pick) < 0.02 && empties.length && occupied.length) { // the mover, now and then
        const mv = TT.move(s, occupied[Math.floor(TT.rand(pick) * occupied.length)], empties[Math.floor(TT.rand(pick) * empties.length)]);
        if (mv) { moves++; s = mv.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (s.bankOrder.length && TT.rand(pick) < 0.04) { // borrow, repay or change the clock speed now and then
        const roll = TT.rand(pick);
        let act = null;
        if (roll < 0.5) act = TT.borrow(s, s.bankOrder[Math.floor(TT.rand(pick) * s.bankOrder.length)]);
        else if (roll < 0.8 && s.loans.length) act = TT.repay(s, Math.floor(TT.rand(pick) * s.loans.length));
        else { const sp = TT.setSpeed(s, Math.floor(TT.rand(pick) * 4)); if (sp) { s = sp; assert.deepStrictEqual(TT.validate(s), []); continue; } }
        if (act) { loansUsed++; s = act.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (TT.rand(pick) < 0.03) { const bk = TT.buyBank(s); if (bk) { banksBought++; s = bk; assert.deepStrictEqual(TT.validate(s), []); continue; } } // a bank now and then (needs a village on the board and the coins)
      if (TT.rand(pick) < 0.01 && empties.length) { // dig a pond now and then
        const pd = TT.buyPond(s, empties[Math.floor(TT.rand(pick) * empties.length)]);
        if (pd) { s = pd.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (TT.rand(pick) < 0.02) { // build a bridge now and then (maps with water only have spots)
        const spots = TT.bridgeSpots(s), b = spots.length ? TT.buyBridge(s, spots[Math.floor(TT.rand(pick) * spots.length)]) : null;
        if (b) { bridges++; s = b.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (TT.rand(pick) < 0.01 || !empties.length) { // buy land now and then, and whenever stuck
        const side = TT.SIDES[Math.floor(TT.rand(pick) * TT.SIDES.length)];
        const l = TT.buyLand(s, side);
        if (l) { lands++; s = l.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      if (!empties.length || TT.rand(pick) < 0.03) { // full board (rich) or a random hammer
        let h = null; const off = Math.floor(TT.rand(pick) * occupied.length); // locked and seized tiles refuse the hammer: try the others
        for (let q = 0; q < occupied.length && !h; q++) h = TT.hammer(s, occupied[(off + q) % occupied.length]);
        if (h) { hammers++; s = h.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
        if (!empties.length) { // out of hammers: pay a seized lot, borrow for the hammer, or buy the remaining land
          let esc = null;
          for (let li = 0; li < s.loans.length && !esc; li++) if (s.loans[li].defaulted) esc = TT.repay(s, li);
          if (!esc && s.stock.hammer > 0 && s.coins < TT.PRICE.hammer) for (const bk2 of s.bankOrder) if (!esc) esc = TT.borrow(s, bk2);
          if (esc) { loansUsed++; s = esc.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
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
      r.events.forEach((e) => { if (e.type === 'default') defaults++; if (e.type === 'merge') { merges++; if (e.to === TT.CHURCH) churches++; } if (e.type === 'trapped') trapped++; if (e.type === 'fox') foxMoves++; if (e.type === 'growl') growls++; if (e.type === 'maul') mauls++; if (e.type === 'cub') cubs++; if (e.type === 'merge') maxTier = Math.max(maxTier, e.to); });
      if (TT.rand(pick) < 0.05) {
        const u = TT.undo(r.state);
        assert.strictEqual(!!u, TT.canUndo(r.state));
        if (u) { assert.deepStrictEqual(u.grid, s.grid); assert.strictEqual(u.coins, s.coins - TT.UNDO_COST); assert.deepStrictEqual(TT.validate(u), []); }
      }
      s = r.state;
    }
    maxTurns = Math.max(maxTurns, s.turn);
  }
  assert(banksBought > 0 && loansUsed > 0 && defaults > 0, 'the fuzz bought banks, used loans and saw defaults: ' + [banksBought, loansUsed, defaults]);
  assert(merges > 0 && trapped > 0 && foxMoves > 0, 'fuzz exercised merges, trapped bears and fox warps');
  console.log(`  fuzz: ${banksBought} banks, ${loansUsed} loan actions, ${defaults} defaults, max ${maxTurns} turns, ${merges} merges, ${trapped} trapped bears, ${churches} churches, ${hammers} hammers, ${lands} land purchases, ${moves} moves, ${foxMoves} fox warps, ${growls} growls, ${mauls} mauls, ${cubs} cubs, ${bridges} bridges, best tier ${maxTier}`);
});

console.log(`OK: ${n} logic tests passed`);
