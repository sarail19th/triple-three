// Inlines CSS + JS into one self-contained dist/index.html and writes PWA files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// function replacers so "$&"-style sequences in the source are never interpreted
const html = read('src/index.html')
  .replace('/*INLINE_CSS*/', () => read('src/style.css'))
  .replace('/*INLINE_LOGIC*/', () => read('src/logic.js'))
  .replace('/*INLINE_GAME*/', () => read('src/game.js'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), html);

fs.writeFileSync(path.join(__dirname, 'dist/manifest.webmanifest'), JSON.stringify({
  name: 'เกมสามหมี', short_name: 'เกมสามหมี', start_url: './', scope: './', display: 'standalone',
  orientation: 'portrait', background_color: '#0f2418', theme_color: '#14301f',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

// cache name derives from the content, so the cache only rolls over when the game actually changes
const v = crypto.createHash('md5').update(html).digest('hex').slice(0, 8);
fs.writeFileSync(path.join(__dirname, 'dist/sw.js'), `const C='three-bears-${v}';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
`);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
