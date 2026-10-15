/* MagSwoop offline service worker. Generated at build time from scripts/sw-template.js:
 * the VERSION and ASSETS constants are filled in with the build's content hash and file list. */
const VERSION = '__VERSION__'
const ASSETS = __ASSETS__
const CACHE = `magswoop-${VERSION}`
const SCOPE = new URL(self.registration.scope)
const INDEX = new URL('./', SCOPE).href

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(a => new Request(new URL(a, SCOPE).href, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('magswoop-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

/** Requests the worker must never answer: the game API, platform routes, other origins. */
function bypass(url) {
  if (url.origin !== SCOPE.origin) return true
  if (!url.pathname.startsWith(SCOPE.pathname)) return true
  const rel = url.pathname.slice(SCOPE.pathname.length)
  return rel.startsWith('api/') || rel.startsWith('__manus') || url.pathname.includes('/api/')
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (bypass(url)) return

  // Pages: always try the network first so login/checkout returns and new versions are seen;
  // fall back to the cached game when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 5000)
        const res = await fetch(req, { signal: ctrl.signal })
        clearTimeout(timer)
        if (res.ok && url.search === '') (await caches.open(CACHE)).put(INDEX, res.clone())
        return res
      } catch {
        return (await caches.match(INDEX, { ignoreVary: true })) || (await caches.match(req, { ignoreVary: true })) || Response.error()
      }
    })())
    return
  }

  // Everything else in the build is content-hashed or versioned: cache first.
  event.respondWith((async () => {
    // ignoreVary: module scripts and fonts are CORS requests (Origin header) while the precache
    // requests were not; a `Vary: Origin` response must still match.
    const hit = await caches.match(req, { ignoreVary: true })
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone())
    return res
  })())
})
