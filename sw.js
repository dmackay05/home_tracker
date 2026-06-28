const CACHE_NAME = 'ledger-v1';
const SHELL_FILES = ['./index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for shell files so deployed updates always reach the browser.
// Cache-first for everything else (icons, fonts).
self.addEventListener('fetch', (event)=>{
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some(f => url.pathname.endsWith(f.replace('./','')));

  if(isShellFile){
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        })
        .catch(()=> caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
