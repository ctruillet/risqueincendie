const CACHE_NAME = 'risqueincendie-v22';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './ui/sgdf.css',
  './js/app.js',
  './js/common.js',
  './camp.html',
  './js/camp.js',
  './camps.json',
  './regles.json',
  './manifest.json',
  './icon.svg',
  './logo.svg',
  './icon-192.png',
  './apple-touch-icon.png'
];

// Installation : mise en cache des fichiers de l'application
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : suppression des anciens caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord : on garde une copie à jour en cache, utilisée hors ligne
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // L'admin, la connexion et l'API ne passent jamais par le cache
  const { pathname } = new URL(e.request.url);
  if (pathname.startsWith('/api/') || /^\/(admin(\.html)?|connexion(\.html)?|js\/(admin|connexion)\.js|css\/admin\.css)$/.test(pathname)) return;

  e.respondWith(
    // no-cache : contourne le cache HTTP du navigateur
    // pour toujours récupérer la dernière version quand le réseau est là.
    // On repart de l'URL : une requête de navigation ne peut pas être copiée avec d'autres options.
    fetch(e.request.url, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
