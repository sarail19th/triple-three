// Writes the app icons (PNG, no dependencies): PWA icons into dist/ and the README icon docs/icon.png.
// Run after build.js: node gen/icons.js
// Art: a 2x2 board, three tiles in an L each holding the same little house (three of a kind = a town), one tile left empty.
// Everything is vector shapes (signed distance functions) so no emoji font or image library is needed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- tiny vector toolkit: signed distance functions (negative inside), everything in 0..100 "house units" ----
const sdRect = (x, y, x0, y0, x1, y1, r = 0) => {
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r, dx = Math.abs(x - (x0 + x1) / 2) - hx, dy = Math.abs(y - (y0 + y1) / 2) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const sdSeg = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const sdPoly = (x, y, p) => {
  let d = Infinity, inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    d = Math.min(d, sdSeg(x, y, p[j][0], p[j][1], p[i][0], p[i][1]));
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside ? -d : d;
};
const hex = (h) => [h >> 16 & 255, h >> 8 & 255, h & 255];
const lerp = (a, b, t) => { t = Math.min(1, Math.max(0, t)); return a.map((v, i) => v + (b[i] - v) * t); };
const grad = (a, b, y0, y1) => (y) => lerp(hex(a), hex(b), (y - y0) / (y1 - y0));

const RED = grad(0xef4a3c, 0xc92a22, 10, 60), DARKRED = hex(0xa21f1a), WALL = grad(0xffe6c8, 0xf6c79a, 20, 90), WALLEDGE = hex(0xd9a37a);
const DOOR = grad(0xf08a3c, 0xc95a1f, 63, 90), DOORDARK = hex(0x8a3f14), KNOB = hex(0xffe08a), GLASS = grad(0x58b6f2, 0x2e86d6, 62, 82), WHITE = [255, 255, 255];

// the house: red roof with a chimney on the left, arched door on the left, window on the right (null = outside the house)
function house(x, y) {
  let c = null;
  const paint = (d, fill, stroke, sw) => { // fill inside, a stroke centred on the edge (sw = stroke width)
    const h = (sw || 0) / 2;
    if (d <= -h) c = typeof fill === 'function' ? fill(y) : fill; else if (stroke && d <= h) c = stroke;
  };
  paint(sdRect(x, y, 22, 14, 35, 40, 2.5), RED, DARKRED, 2);                                   // chimney
  paint(sdPoly(x, y, [[14, 52], [50, 20], [86, 52], [86, 90], [14, 90]]), WALL, WALLEDGE, 2);  // wall + gable
  const roof = Math.min(sdSeg(x, y, 6, 54, 50, 14), sdSeg(x, y, 50, 14, 94, 54));              // thick roof line, round ends
  paint(roof - 6, DARKRED); paint(roof - 4.25, RED);
  paint(Math.min(sdRect(x, y, 24, 72, 42, 90), sdCircle(x, y, 33, 72, 9)), DOOR, DOORDARK, 2.4); // arched door
  paint(sdCircle(x, y, 37, 81, 1.9), KNOB);
  paint(sdRect(x, y, 55, 62, 78, 82, 2.5), GLASS, WHITE, 3.2);                                  // window
  paint(sdRect(x, y, 65.4, 62, 67.6, 82), WHITE); paint(sdRect(x, y, 55, 70.9, 78, 73.1), WHITE);
  return c;
}

const FRAME = hex(0x143a25), TILE = grad(0x4a9446, 0x3b7f3a, 0, 1), EMPTY = hex(0x1b4a2c);
const M = 0.09, GAP = 0.012, CELL = (1 - 2 * M) / 2, TILEW = CELL - 2 * GAP, HOUSE = CELL * 0.9;
const TRIO = new Set(['0,1', '1,0', '1,1']);

// unit square in, colour out (null = transparent). `inset` shrinks the art for the maskable safe zone (the frame colour fills the rest).
function scene(u, v, round, inset) {
  if (round) { // rounded-square alpha mask
    const r = 0.2, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
  }
  u = (u - 0.5) / inset + 0.5; v = (v - 0.5) / inset + 0.5;
  const c = Math.floor((u - M) / CELL), r = Math.floor((v - M) / CELL);
  if (c < 0 || r < 0 || c > 1 || r > 1) return FRAME;
  const x0 = M + c * CELL + GAP, y0 = M + r * CELL + GAP;
  if (sdRect(u, v, x0, y0, x0 + TILEW, y0 + TILEW, 0.12 * TILEW) > 0) return FRAME;
  if (!TRIO.has(r + ',' + c)) return EMPTY;
  const hx = x0 + TILEW / 2 - HOUSE / 2, hy = y0 + TILEW / 2 - HOUSE / 2;
  const sx = (u - hx) / HOUSE * 100, sy = (v - hy) / HOUSE * 100;
  return (sx >= 0 && sx <= 100 && sy >= 0 && sy <= 100 && house(sx, sy)) || lerp(TILE(0), TILE(1), (v - y0) / TILEW);
}

function render(size, round, inset) {
  const buf = Buffer.alloc(size * size * 4), S = size < 300 ? 4 : 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = scene((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, round, inset);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (y * size + x) * 4;
    if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = Math.round(255 * a / (S * S)); }
  }
  return png(size, size, buf);
}

const dist = path.join(__dirname, '..', 'dist');
fs.mkdirSync(dist, { recursive: true });
const icon512 = render(512, true, 1);
fs.writeFileSync(path.join(dist, 'icon-192.png'), render(192, true, 1));
fs.writeFileSync(path.join(dist, 'icon-512.png'), icon512);
fs.writeFileSync(path.join(dist, 'icon-maskable-512.png'), render(512, false, 0.7));
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'icon.png'), icon512); // README icon
console.log('wrote icons into dist/ and docs/icon.png');
