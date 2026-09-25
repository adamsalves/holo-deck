import type { PrecacheEntry } from '../../app/utils/offline'

/**
 * The service worker — what keeps the game playable with the network gone.
 *
 * **Two layers, as the plan draws them.** The first is installed whole, before
 * the worker takes over: the code, the dex, both languages' messages, the Latin
 * fonts and the shell — 2.1 MB on disk, about 680 KB over the wire. The second
 * is the 1025 thumbnails, 6.0 MB, kept as the pages show them: installing them
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
 * announce an update. A page the network brings in the meantime is the new
 * build's, and it asks for none of the old build's files: every installed
 * address a page asks for changes with its content — the dex's through
 * `dexUrl`. The shell keeps a fixed name, and no page asks for it.
 *
 * **What it never touches:** other origins, any method but GET, and `/api/`.
 * Nothing under `/api/` is ever kept — the save answers per account, and
 * signing in is a chain of redirects that sets the session cookie on the way
 * back —, so the browser's own request is the whole answer. Left alone, the
 * sign-in goes exactly as it would with no worker, and offline an address under
 * `/api/` fails as the network does instead of opening the game on a route that
 * does not exist.
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
declare const SPRITE_CACHE_PREFIX: string
declare const OFFLINE_SHELL: string

/**
 * How long a navigation waits for the network before the shell answers it.
 *
 * A connection that is up and never answers — a captive portal, a train between
 * stations — would otherwise keep the page blank for as long as the browser
 * waits, which is minutes, while the shell boots the same game from what is
 * installed. Three seconds: what the shell gives up is the prerendered page's
 * first paint, which a connection that slow was not going to deliver sooner.
 */
const NAVIGATION_TIMEOUT = 3000

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
  const response = respond(event)
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
    // The revision is the hash of what the build shipped. A copy that hashes
    // otherwise is another build's — the host moved on between the download of
    // this worker and this one —, and kept under this revision it would answer
    // this build's pages with the other build's content.
    //
    // All but the shell. A host may decorate the HTML it serves, and Vercel's
    // previews do: they append the feedback toolbar's script to every document,
    // after `</html>`. Measured on the preview of this very check — the shell
    // never hashed to the file the build wrote, and the worker never installed.
    // The shell only answers offline, and another build's would name chunks
    // this list does not have; a deploy landing mid-install mostly fails on
    // those chunks' 404s first.
    if (entry.url !== OFFLINE_SHELL) {
      const revision = await revisionOf(await response.clone().arrayBuffer())
      if (revision !== entry.revision) {
        throw new Error(`${entry.url} is not the file this build listed: revision ${revision}, expected ${entry.revision}`)
      }
    }
    await cache.put(key, response)
  }))
}

/**
 * The revision the build writes (`revisionOf` in `revision.ts`), computed the
 * same way: SHA-256, its first eight bytes in hex.
 */
async function revisionOf(content: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content))

  return [...digest.subarray(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Runs once no tab is left on the previous version — on a first install, right
 * away. Deletes the files of every build gone by and the thumbnails of every
 * other revision of the art, and takes the tabs open now: on a first install,
 * that is the page that registered the worker, which then keeps what it shows
 * from here on without a reload.
 */
async function activate(): Promise<void> {
  const cache = await caches.open(PRECACHE_CACHE)
  const current = new Set(keyByUrl.values())
  const stale = (await cache.keys()).filter(request => !current.has(request.url))

  await Promise.all(stale.map(request => cache.delete(request)))

  const retired = (await caches.keys()).filter(name => name.startsWith(SPRITE_CACHE_PREFIX) && name !== SPRITE_CACHE)
  await Promise.all(retired.map(name => caches.delete(name)))

  await self.clients.claim()
}

/** The answer to one request, or `undefined` to leave it to the browser. */
function respond(event: FetchEvent): Promise<Response> | undefined {
  const { request } = event
  if (request.method !== 'GET') return undefined

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return undefined
  if (request.mode === 'navigate') return navigate(request)

  const key = keyByUrl.get(url.href)
  if (key !== undefined) return installed(request, key)
  // *Download everything* asks past the caches, and keeps what comes itself: an
  // answer from here could be this worker's build's art, not the page's.
  if (url.pathname.startsWith('/sprites/')) return request.cache === 'reload' ? undefined : keptAsShown(event)

  return undefined
}

/**
 * The network, and the shell when there is no network — or when the network
 * has not answered within `NAVIGATION_TIMEOUT`. An answer that arrives in time —
 * a 404 for an address that does not exist, a 500 — goes to the page as it
 * came: the shell would render a page the server just said is not there.
 *
 * With no shell to fall back on — a cache the browser cleared under a worker
 * that is still running — the navigation waits for the network, however long.
 */
async function navigate(request: Request): Promise<Response> {
  const network = fetch(request)

  try {
    return await Promise.race([network, timeout(NAVIGATION_TIMEOUT)])
  }
  catch {
    const shell = shellKey === undefined ? undefined : await (await caches.open(PRECACHE_CACHE)).match(shellKey)

    return shell ?? network
  }
}

/** A promise that rejects after `ms` — the losing side of a race, most of the time. */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)
  })
}

/**
 * A file of the first layer, from the cache. The network is only the fallback
 * for a cache the browser cleared under a worker that is still running.
 */
async function installed(request: Request, key: string): Promise<Response> {
  return (await (await caches.open(PRECACHE_CACHE)).match(key)) ?? fetch(request)
}

/**
 * A thumbnail: the one kept if there is one, else the network's — kept for next
 * time once the page has it, and only when it is an image sent as itself: a 404
 * or a page kept here would outlive the file being fixed. Storage that refuses
 * to keep it costs the next visit, never this one.
 */
async function keptAsShown(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(SPRITE_CACHE)
  const kept = await cache.match(event.request)
  if (kept !== undefined) return kept

  const response = await fetch(event.request)
  if (isThumbnail(response)) event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined))

  return response
}

/** Whether an answer is a thumbnail worth keeping: a success, an image, and not a redirect's. */
function isThumbnail(response: Response): boolean {
  return response.ok && !response.redirected && (response.headers.get('content-type') ?? '').startsWith('image/')
}
