const C='triple-three-b1a719c2';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
// Other apps on the same github.io origin share Cache Storage: only ever delete our own 'triple-three-' caches.
// Anything loaded online that is missing from the cache is saved, so a wiped cache refills itself on the next online visit.
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>fetch(new Request(f,{cache:'reload'})).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('triple-three-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
function page(e){
  const net=fetch(e.request.url,{cache:'no-cache'}).then(r=>{
    if(r.ok){const a=r.clone(),b=r.clone();caches.open(C).then(c=>Promise.all([c.put('./',a),c.put('./index.html',b)])).catch(()=>{})}
    return r});
  e.waitUntil(net.catch(()=>{}));
  const timeout=new Promise((_,no)=>setTimeout(no,4000));
  return Promise.race([net,timeout]).catch(()=>caches.match('./').then(r=>r||net));
}
// The page asks "is everything saved for offline?": re-save anything missing (online), then answer.
self.addEventListener('message',e=>{if(!e.data||e.data.type!=='offline?'||!e.source)return;const src=e.source;e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>c.match(f).then(r=>r||fetch(new Request(f,{cache:'reload'})).then(x=>{if(x.ok)return c.put(f,x)}).catch(()=>{})))).then(()=>Promise.all(FILES.map(f=>c.match(f).then(Boolean))))).then(a=>src.postMessage({type:'offline',ok:a.every(Boolean)})).catch(()=>src.postMessage({type:'offline',ok:false})))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(e.request.mode==='navigate')e.respondWith(page(e));
  else e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{if(res.ok&&!u.search){const x=res.clone();caches.open(C).then(c=>c.put(e.request,x)).catch(()=>{})}return res})));
});
