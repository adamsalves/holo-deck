import type { PrecacheEntry } from '../../app/utils/offline'

/**
 * The service worker — what keeps the game playable with the network gone.
 *
 * **Two layers, as the plan draws them.** The first is installed whole, before
 * the worker takes over: the code, the dex, both languages' messages, the Latin
 * fonts and the shell — 2.0 MB on disk, about 540 KB over the wire. The second
 * is the 1025 thumbnails, 6.3 MB, kept as the pages show them: installing them
 * up front would make the first visit download the whole dex's art before it is
 * usable. *Download everything for offline* fills the same cache on purpose.
 *
 * **Every navigation goes to the network first, and to the shell when there is
 * none.** The prerendered pages are the better answer when they can be had —
 * their HTML is complete before any script runs, and their head carries the
 * language, the canonical and the root guard. Offline there is one document for
 * every address: `200.html`, which boots the game on the client for whatever
 * address it was opened at, from the dex this worker installed. Installing the
 * pages themselves would be 109 MB, and each one reads its data from a
 * `_payload.json` of its own.
 *
 * **A new version waits for every tab to close.** No `skipWaiting()`: until the
 * last tab on the old version goes away, the old worker keeps answering with
 * the old build's files — the only copy left of them, since the host serves just
 * the newest build. Taking over mid-session would hand an open tab chunks from a
 * build it was not written against, or reload it in the middle of a battle.
 * Decided with the user on 23/09/2026, and why this worker needs no screen to
 * announce an update.
 *
 * **What it never touches:** other origins, any method but GET, and `/api/`.
 * Signing in is a navigation to `/api/auth/…` and back, and answering it with
 * the shell would break the login.
 *
 * Served as a classic script: this file is transpiled on its own
 * (`transpileWorker`) and the names below are written in front of it by the
 * build (`serviceWorkerScript`), which is why it imports nothing but types.
 */

declare const self: ServiceWorkerGlobalScope

/** Written in front of this file by the build — see `serviceWorkerScript`. */
declare const PRECACHE: readonly PrecacheEntry[]
declare const PRECACHE_CACHE: string
declare const SPRITE_CACHE: string
declare const OFFLINE_SHELL: string

/**
 * The key a file is kept under: its address with its revision appended.
 *
 * Two builds' copies of one address can then sit in the same cache, and they
 * have to: a new worker installs while the old one is still answering tabs, and
 * each reads only its own keys. The old copies go when the new worker takes
 * over (`activate`).
 */
function keyOf(entry: PrecacheEntry): string {
  const url = new URL(entry.url, self.location.origin)
  url.searchParams.set('__revision', entry.revision)

  return url.href
}

/**
 * This build's files, by the exact address a page asks for — query included, so
 * `/_payload.json?_b=…` is never mistaken for something installed.
 */
const keyByUrl = new Map(PRECACHE.map(entry => [new URL(entry.url, self.location.origin).href, keyOf(entry)]))

const shellKey = keyByUrl.get(new URL(OFFLINE_SHELL, self.location.origin).href)

self.addEventListener('install', (event) => {
  event.waitUntil(install())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(activate())
})

self.addEventListener('fetch', (event) => {
  const response = respond(event.request)
  if (response !== undefined) event.respondWith(response)
})

/**
 * Downloads every file this build lists that an earlier build did not already
 * leave under the same revision — a new build of the game changes the code, and
 * the dex, the messages and the fonts stay where they are.
 *
 * **One refusal fails the whole install**, and that is the safe way round: the
 * browser throws this worker away and tries again on the next visit, while the
 * one in charge, if any, carries on. A worker that installed with a hole in its
 * list would take over and then fail offline, where nobody can retry.
 */
async function install(): Promise<void> {
  const cache = await caches.open(PRECACHE_CACHE)

  await Promise.all(PRECACHE.map(async (entry) => {
    const key = keyOf(entry)
    if (await cache.match(key) !== undefined) return

    const response = await fetch(entry.url, { cache: 'reload' })
    // A redirected response cannot answer a navigation, and the shell answers
    // every navigation offline.
    if (!response.ok || response.redirected) {
      throw new Error(`${entry.url} answered ${response.status}${response.redirected ? ' through a redirect' : ''}`)
    }
    await cache.put(key, response)
  }))
}

/**
 * Runs once no tab is left on the previous version — on a first install, right
 * away. Deletes the files of every build gone by, and takes the tabs open now:
 * on a first install, that is the page that registered the worker, which then
 * keeps what it shows from here on without a reload.
 */
async function activate(): Promise<void> {
  const cache = await caches.open(PRECACHE_CACHE)
  const current = new Set(keyByUrl.values())
  const stale = (await cache.keys()).filter(request => !current.has(request.url))

  await Promise.all(stale.map(request => cache.delete(request)))
  await self.clients.claim()
}

/** The answer to one request, or `undefined` to leave it to the browser. */
function respond(request: Request): Promise<Response> | undefined {
  if (request.method !== 'GET') return undefined

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return undefined
  if (request.mode === 'navigate') return navigate(request)

  const key = keyByUrl.get(url.href)
  if (key !== undefined) return installed(request, key)
  if (url.pathname.startsWith('/sprites/')) return keptAsShown(request)

  return undefined
}

/**
 * The network, and the shell only when there is no network at all. An answer
 * that arrives — a 404 for an address that does not exist, a 500 — goes to the
 * page as it came: the shell would render a page the server just said is not
 * there.
 */
async function navigate(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  }
  catch (error) {
    const shell = shellKey === undefined ? undefined : await (await caches.open(PRECACHE_CACHE)).match(shellKey)
    if (shell === undefined) throw error

    return shell
  }
}

/**
 * A file of the first layer, from the cache. The network is only the fallback
 * for a cache the browser cleared under a worker that is still running.
 */
async function installed(request: Request, key: string): Promise<Response> {
  return (await (await caches.open(PRECACHE_CACHE)).match(key)) ?? fetch(request)
}

/**
 * A thumbnail: the one kept if there is one, else the network's, kept for next
 * time. Only a success is kept — a 404 stored here would outlive the file
 * being fixed.
 */
async function keptAsShown(request: Request): Promise<Response> {
  const cache = await caches.open(SPRITE_CACHE)
  const kept = await cache.match(request)
  if (kept !== undefined) return kept

  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())

  return response
}
