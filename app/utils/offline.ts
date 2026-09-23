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

/** The second layer: the 1025 thumbnails, kept as the pages show them. */
export const SPRITE_CACHE = 'holodeck-sprites'

/**
 * One file the worker installs with.
 *
 * `url` is the address a page asks for; `revision` is a hash of the file's
 * content, so an unchanged file survives a new build without being downloaded
 * again, and a changed one never answers under its old content.
 */
export interface PrecacheEntry {
  readonly url: string
  readonly revision: string
}
