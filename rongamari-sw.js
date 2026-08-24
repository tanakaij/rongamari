/* RongaMari service worker.
 *
 * No CI step stamps a hash in here — GitHub Pages serves the repo's files as
 * they are — so CACHE_VERSION is the manual lever: BUMP IT whenever you change
 * index.html, css/ or js/. Registration passes updateViaCache:'none' (see
 * js/app.js) so this file itself always revalidates, which is what makes the
 * bump take effect on the next load.
 */
var CACHE_VERSION = 'v1';
var SHELL_CACHE = 'rongamari-shell-' + CACHE_VERSION;

/* Anything added to index.html must be added here too, or it will work
   online and fail offline. cache.addAll() rejects wholesale if any entry 404s;
   the navigation handler already falls back to index.html. */
var SHELL = [
  'index.html',
  'css/app.css',
  'js/store.js',
  'js/charts.js',
  'js/insights.js',
  'js/ui.js',
  'js/export.js',
  'js/app.js',
  'rongamari.manifest.json',
  'resources/mark.png',
  'resources/logo-full.png',
  'resources/favicon-128.png',
  'resources/apple-touch-icon-180.png',
  'resources/icon-192x192-any.png',
  'resources/icon-512x512-any.png'
];

var NAV_TIMEOUT_MS = 2500;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  /* Navigations: try the network briefly, then fall back to cache. */
  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        var done = function (res) { if (!settled) { settled = true; resolve(res); } };

        var timer = setTimeout(function () {
          caches.match('index.html', { ignoreSearch: true }).then(function (hit) {
            if (hit) done(hit);
          });
        }, NAV_TIMEOUT_MS);

        fetch(req).then(function (res) {
          clearTimeout(timer);
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(SHELL_CACHE).then(function (c) { c.put('index.html', copy); });
          }
          done(res);
        }).catch(function () {
          clearTimeout(timer);
          caches.match('index.html', { ignoreSearch: true }).then(function (hit) {
            done(hit || new Response('Offline and nothing cached yet.', {
              status: 503, headers: { 'Content-Type': 'text/plain' }
            }));
          });
        });
      })
    );
    return;
  }

  /* Everything else: cache first, revalidate in the background. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return hit || new Response('', { status: 504, statusText: 'Offline' });
      });
      return hit || network;
    })
  );
});
