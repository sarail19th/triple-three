// Writes PWA icons (PNG, no dependencies) into dist/. Run after build.js: node gen/icons.js
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

// Scene in unit square: sky tile, sun, tree (canopy circles + trunk), little house. `inset` shrinks art for maskable safe zone.
function scene(u, v, round, inset) {
  // u,v in [0,1]
  if (round) { // rounded-square alpha mask
    const r = 0.2, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
  }
  const k = inset; u = (u - 0.5) / k + 0.5; v = (v - 0.5) / k + 0.5;
  const circ = (cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  const rect = (x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
  if (circ(0.8, 0.2, 0.08)) return [255, 212, 90];                      // sun
  if (rect(0.18, 0.62, 0.42, 0.86) && !rect(0.27, 0.72, 0.33, 0.86)) return [201, 156, 100]; // house wall w/ door cut
  if (rect(0.27, 0.72, 0.33, 0.86)) return [96, 62, 38];
  if (v >= 0.48 && v <= 0.62 && Math.abs(u - 0.3) <= (v - 0.48) / 0.14 * 0.16) return [196, 75, 60]; // roof
  if (rect(0.62, 0.62, 0.68, 0.88)) return [110, 72, 40];               // trunk
  if (circ(0.65, 0.42, 0.17) || circ(0.54, 0.54, 0.13) || circ(0.76, 0.54, 0.13)) return [86, 170, 84]; // canopy
  if (v > 0.86) return [70, 130, 66];                                    // ground
  return [20 + v * 30 | 0, 60 + v * 60 | 0, 40 + v * 20 | 0];           // background gradient
}

function render(size, round, inset) {
  const buf = Buffer.alloc(size * size * 4), S = 3;
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
fs.writeFileSync(path.join(dist, 'icon-192.png'), render(192, true, 1));
fs.writeFileSync(path.join(dist, 'icon-512.png'), render(512, true, 1));
fs.writeFileSync(path.join(dist, 'icon-maskable-512.png'), render(512, false, 0.72));
console.log('wrote icons into dist/');
