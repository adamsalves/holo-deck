/**
 * The names the service worker and the pages agree on.
 *
 * The worker cannot import them: it is one file, transpiled on its own and
 * served as a classic script. So the build writes these into its first lines
 * (`serviceWorkerScript`, in `scripts/service-worker/build.ts`) and the pages
 * import them from here. Two copies of a cache name would drift apart the day
 * one of them is renamed, and *Download everything for offline* (Phase 8's PR
 * 5b) would fill a cache the worker never reads.
 *
 * This module holds no browser access, and that is load-bearing: the worker's
 * project compiles it without the DOM library and the tools project without
 * any browser library at all.
 */

/** Where the build writes the worker, and where the pages register it from. */
export const SERVICE_WORKER_PATH = '/sw.js'

/**
 * The document the worker answers every navigation with when the network is
 * gone — `200.html`, which Nuxt renders with no server-side app: an empty page
 * that boots the game on the client for whatever address it was opened at.
 */
export const OFFLINE_SHELL_PATH = '/200.html'

/** The first layer: code, dex, messages, fonts and the shell, installed whole. */
export const PRECACHE_CACHE = 'holodeck-precache'

/**
 * The second layer: the 1025 thumbnails, kept as the pages show them — in a
 * cache whose name ends in the revision of the art (`spriteCacheName`).
 *
 * A thumbnail keeps its address from build to build, and a kept one is answered
 * without asking the network again. Under one name for good, art a build changed
 * would never reach a device that kept the old one; under one name per revision,
 * the worker of that build starts an empty cache and deletes the old one when it
 * takes over. The build writes the whole name into the worker.
 */
export const SPRITE_CACHE_PREFIX = 'holodeck-sprites'

/** The thumbnails' cache for one revision of the art. */
export function spriteCacheName(revision: string): string {
  return `${SPRITE_CACHE_PREFIX}-${revision}`
}

/**
 * The address a page asks for one file of the dex by: the dex's revision rides
 * along in it.
 *
 * The dex keeps its file names from build to build, and a page of a new build
 * can be answered by the worker of an old one — a new worker waits for every tab
 * on the old version to close, and a tab opened meanwhile is the old worker's
 * too. With the revision in the address, a page asks for the dex it was built
 * with: the old worker has no such address and leaves it to the network, and a
 * page of the old build still gets the copy installed with it.
 */
export function dexUrl(name: string, revision: string): string {
  return `/data/${name}?v=${revision}`
}

/**
 * One file the worker installs with.
 *
 * `url` is the address a page asks for; `revision` is a hash of the file's
 * content, so an unchanged file survives a new build without being downloaded
 * again, and a changed one is downloaded under its new revision. What keeps an
 * old worker from answering a new page with an old copy is the address: every
 * installed file's changes with its content — the dex's through `dexUrl`.
 */
export interface PrecacheEntry {
  readonly url: string
  readonly revision: string
}
