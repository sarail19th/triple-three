const C='triple-three-7cdbb7a5';
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
