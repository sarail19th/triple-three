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

t('final tiers never merge', () => {
  const g = withGrid({ [I(0, 0)]: 8, [I(0, 1)]: 8, [I(0, 2)]: 8, [I(3, 0)]: 12, [I(3, 1)]: 12, [I(3, 2)]: 12 });
  assert.deepStrictEqual(TT.validate(g), [], 'grand castles and cathedrals are final');
});

t('castle trio (via crystal) becomes a grand castle', () => {
  const s = withGrid({ [I(0, 0)]: 7, [I(0, 2)]: 7 }, { cur: TT.CRYSTAL });
  const r = TT.place(s, I(0, 1));
  assert.strictEqual(r.state.grid[I(0, 1)], 8);
});

t('crystal picks the best merge available, else waits as an inert wildcard', () => {
  let s = withGrid({ [I(0, 0)]: 1, [I(0, 2)]: 1, [I(2, 1)]: 3, [I(3, 1)]: 3 }, { cur: TT.CRYSTAL });
  // cell (1,1): up (0,1) empty, left/right (1,0)/(1,2) empty, down (2,1) tree -> crystal as tree makes tree trio with (2,1),(3,1)
  let r = TT.place(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 4, 'tree trio -> hut');
  s = withGrid({ [I(0, 0)]: 1 }, { cur: TT.CRYSTAL });
  r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(5, 5)], TT.CRYSTAL);
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
  assert.strictEqual(r.state.grid[I(2, 2)], 11, 'tomb trio becomes a church on the trapped cell');
  assert.strictEqual(r.state.coins, 30 - TT.PRICE.trap + TT.COIN[10]);
  assert.strictEqual(r.state.turn, s.turn, 'free action');
  assert.deepStrictEqual(TT.validate(r.state), []);
  const lone = TT.trap(withGrid({ [I(0, 0)]: TT.BEAR }, { coins: 30 }), I(0, 0));
  assert.strictEqual(lone.state.grid[I(0, 0)], TT.TOMB);
  assert.strictEqual(TT.trap(s, I(5, 5)), null, 'only bears');
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

t('3 tombstones merge into a church where the bear died', () => {
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.TOMB, [I(0, 2)]: TT.TOMB, [I(1, 0)]: 5 });
  const r = TT.place(s, I(5, 5)); // bear at (0,0) has no free neighbour -> trapped
  assert.strictEqual(r.state.grid[I(0, 0)], 11);
  assert.strictEqual(r.state.grid[I(0, 1)], 0);
  assert.strictEqual(r.state.score, 3 * TT.BASE[10]);
});

t('church formed next to 2 churches chains into a cathedral', () => {
  const s = withGrid({ [I(0, 0)]: TT.BEAR, [I(0, 1)]: TT.TOMB, [I(0, 2)]: TT.TOMB, [I(1, 0)]: 11, [I(2, 0)]: 11 });
  const r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(0, 0)], 12);
  assert.strictEqual(r.state.score, 3 * TT.BASE[10] + 3 * TT.BASE[11]);
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
  const before = JSON.stringify(Object.assign({}, s, { undo: null }));
  const a = TT.place(s, 30);
  const back = TT.undo(a.state);
  assert.strictEqual(JSON.stringify(back), before);
  const b = TT.place(back, 30);
  assert.strictEqual(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.strictEqual(TT.undo(back), null, 'one level only');
});

t('illegal moves are rejected', () => {
  const s = withGrid({ [I(0, 0)]: 1 });
  assert.strictEqual(TT.place(s, I(0, 0)), null);
  assert.strictEqual(TT.place(s, -1), null);
  assert.strictEqual(TT.place(s, 36), null);
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
  let maxTurns = 0, merges = 0, trapped = 0, churches = 0, hammers = 0;
  for (let seed = 1; seed <= 400; seed++) {
    let s = TT.newGame(seed);
    const pick = TT.newGame(seed * 7919 + 1); // independent chooser rng
    let guard = 0;
    while (!s.over) {
      assert(++guard < 4000, 'game must terminate (seed ' + seed + ')');
      if (TT.rand(pick) < 0.05) { s = TT.swap(s); assert.deepStrictEqual(TT.validate(s), []); continue; }
      if (TT.rand(pick) < 0.04) {
        const b = TT.buy(s, TT.BUYABLE[Math.floor(TT.rand(pick) * 3)]);
        if (b) { s = b; assert.deepStrictEqual(TT.validate(s), []); continue; }
      }
      const empties = [], occupied = [];
      s.grid.forEach((v, i) => { (v === 0 ? empties : occupied).push(i); });
      if (!empties.length || TT.rand(pick) < 0.03) { // full board (rich) or a random hammer
        const h = TT.hammer(s, occupied[Math.floor(TT.rand(pick) * occupied.length)]);
        if (h) { hammers++; s = h.state; assert.deepStrictEqual(TT.validate(s), []); continue; }
        assert(empties.length, 'full board must either be over or hammerable');
      }
      const idx = empties[Math.floor(TT.rand(pick) * empties.length)];
      const r = TT.place(s, idx);
      assert(r, 'legal move rejected');
      const prob = TT.validate(r.state);
      assert.deepStrictEqual(prob, [], `seed ${seed} turn ${s.turn}: ${prob.join(', ')}`);
      assert(r.state.score >= s.score);
      r.events.forEach((e) => { if (e.type === 'merge') { merges++; if (e.to === 11) churches++; } if (e.type === 'trapped') trapped++; });
      if (TT.rand(pick) < 0.05) { const u = TT.undo(r.state); assert.deepStrictEqual(u.grid, s.grid); }
      s = r.state;
    }
    maxTurns = Math.max(maxTurns, s.turn);
  }
  assert(merges > 0 && trapped > 0, 'fuzz exercised merges and trapped bears');
  console.log(`  fuzz: max ${maxTurns} turns, ${merges} merges, ${trapped} trapped bears, ${churches} churches, ${hammers} hammers`);
});

console.log(`OK: ${n} logic tests passed`);
