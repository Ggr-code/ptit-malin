// Mode hors ligne.
// - L'appli (HTML, JS, CSS) : réseau d'abord pour recevoir les mises à jour, mais sans attendre plus de 2,5 s.
// - Les sons (voix/, sons/) : servis tout de suite depuis le cache, et rafraîchis en arrière-plan.
// - Les ~500 phrases sont mises en cache en arrière-plan, quelques-unes à la fois, pour ne pas saturer
//   la connexion au premier lancement (ce qui retardait les sons du jeu).

// Liste des phrases enregistrées (self.VOICE_CLIPS), écrite par outils/generer-voix.mjs
importScripts('voix/manifest.js')

const CACHE = 'ptit-malin-v4'
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'voix/manifest.js']
const SOUNDS = ['chien', 'chat', 'vache', 'cochon', 'mouton', 'canard', 'cheval', 'poule', 'lion', 'grenouille']
const AUDIO = [...SOUNDS.map((s) => `sons/${s}.mp3`), ...(self.VOICE_CLIPS || []).map((id) => `voix/${id}.mp3`)]
const NETWORK_TIMEOUT = 2500
const BATCH = 4

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    )
})

// L'appli demande la mise en cache des sons une fois chargée
self.addEventListener('message', (e) => {
    if (e.data === 'precache-audio') e.waitUntil(precacheAudio())
})

async function precacheAudio() {
    const cache = await caches.open(CACHE)
    const cached = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
    const todo = AUDIO.filter((f) => !cached.has(new URL(f, self.registration.scope).pathname))
    for (let i = 0; i < todo.length; i += BATCH) {
        await Promise.all(todo.slice(i, i + BATCH).map((f) =>
            fetch(f).then((res) => res.ok && cache.put(f, res)).catch(() => {})))
    }
}

const isAudio = (url) => /\/(voix|sons)\/[^/]+\.mp3$/.test(url.pathname)

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url)
    if (e.request.method !== 'GET' || url.origin !== location.origin) return
    e.respondWith(isAudio(url) ? cacheFirst(e) : networkFirst(e.request))
})

// Le cache répond tout de suite ; le réseau rafraîchit le fichier pour la prochaine fois
async function cacheFirst(e) {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(e.request, { ignoreSearch: true })
    const refresh = fetch(e.request)
        .then((res) => {
            if (res.status === 200) cache.put(e.request, res.clone())
            return res
        })
        .catch(() => null)
    if (hit) {
        e.waitUntil(refresh)
        return hit
    }
    return (await refresh) || Response.error()
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE)
    const network = fetch(request).then((res) => {
        if (res.status === 200) cache.put(request, res.clone())
        return res
    })
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT))
    const fast = await Promise.race([network.catch(() => null), timeout])
    if (fast) return fast
    // Réseau lent ou coupé : la version en cache, sinon on attend quand même le réseau
    return (await cache.match(request, { ignoreSearch: true })) || network.catch(() => Response.error())
}
