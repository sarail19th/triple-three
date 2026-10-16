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

t('crystal picks the best merge available, else stays inert', () => {
  let s = withGrid({ [I(0, 0)]: 1, [I(0, 2)]: 1, [I(2, 1)]: 3, [I(3, 1)]: 3 }, { cur: TT.CRYSTAL });
  // cell (1,1): up (0,1) empty, left/right (1,0)/(1,2) empty, down (2,1) tree -> crystal as tree makes tree trio with (2,1),(3,1)
  let r = TT.place(s, I(1, 1));
  assert.strictEqual(r.state.grid[I(1, 1)], 4, 'tree trio -> hut');
  s = withGrid({ [I(0, 0)]: 1 }, { cur: TT.CRYSTAL });
  r = TT.place(s, I(5, 5));
  assert.strictEqual(r.state.grid[I(5, 5)], TT.CRYSTAL);
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
  let maxTurns = 0, merges = 0, trapped = 0, churches = 0;
  for (let seed = 1; seed <= 400; seed++) {
    let s = TT.newGame(seed);
    const pick = TT.newGame(seed * 7919 + 1); // independent chooser rng
    let guard = 0;
    while (!s.over) {
      assert(++guard < 2000, 'game must terminate (seed ' + seed + ')');
      if (TT.rand(pick) < 0.05) { s = TT.swap(s); assert.deepStrictEqual(TT.validate(s), []); continue; }
      const empties = [];
      s.grid.forEach((v, i) => { if (v === 0) empties.push(i); });
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
  console.log(`  fuzz: max ${maxTurns} turns, ${merges} merges, ${trapped} trapped bears, ${churches} churches`);
});

console.log(`OK: ${n} logic tests passed`);
