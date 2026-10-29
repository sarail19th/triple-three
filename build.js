// Inlines CSS + JS into one self-contained dist/index.html and writes PWA files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// function replacers so "$&"-style sequences in the source are never interpreted
const template = read('src/index.html')
  .replace('/*INLINE_CSS*/', () => read('src/style.css'))
  .replace('/*INLINE_LOGIC*/', () => read('src/logic.js'))
  .replace('/*INLINE_GAME*/', () => read('src/game.js'));
// the version id (shown in How to play, also the service-worker cache name) is a hash of the game's content
const v = crypto.createHash('md5').update(template).digest('hex').slice(0, 8);
const html = template.replace('__BUILD__', v);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), html);

fs.writeFileSync(path.join(__dirname, 'dist/manifest.webmanifest'), JSON.stringify({
  name: 'Triple Three', short_name: 'Triple Three', start_url: './', scope: './', display: 'standalone',
  orientation: 'portrait', background_color: '#0f2418', theme_color: '#14301f',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

// cache name derives from the content (the same id as the version shown in the game), so the cache is versioned per deploy and only rolls over when the game actually changes
// - install fetches every file with cache:'reload', so a new cache never fills from the host's HTTP cache (GitHub Pages keeps pages for 10 minutes: without it the new cache could hold the OLD page)
// - page loads are network-first (revalidated, 4 s timeout) and refresh the cache, so online you always get the latest deploy; offline or on a bad network the cached copy is served
// - the other files (manifest, icons) are cache-first
fs.writeFileSync(path.join(__dirname, 'dist/sw.js'), `const C='triple-three-${v}';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>fetch(new Request(f,{cache:'reload'})).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
function page(e){
  const net=fetch(e.request.url,{cache:'no-cache'}).then(r=>{
    if(r.ok){const a=r.clone(),b=r.clone();caches.open(C).then(c=>Promise.all([c.put('./',a),c.put('./index.html',b)])).catch(()=>{})}
    return r});
  e.waitUntil(net.catch(()=>{}));
  const timeout=new Promise((_,no)=>setTimeout(no,4000));
  return Promise.race([net,timeout]).catch(()=>caches.match('./').then(r=>r||net));
}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(e.request.mode==='navigate')e.respondWith(page(e));
  else e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));
});
`);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
