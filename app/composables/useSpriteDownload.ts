import { useRuntimeConfig, useState } from 'nuxt/app'
import type { Ref } from 'vue'
import { spriteCacheName } from '~~/app/utils/offline'
import type { SpriteDownloadStop } from '~~/app/utils/sprite-download'
import { keepSprites, keptOf, spriteUrls } from '~~/app/utils/sprite-download'
import { SPECIES_COUNT } from '~~/shared/types/brand'

/** What the row in *Settings* is drawn from — see `useSpriteDownload`. */
export interface SpriteDownload {
  /** How many thumbnails are on this device; `null` until a worker is in charge and they were counted. */
  kept: number | null
  running: boolean
  stopped: SpriteDownloadStop | null
}

/**
 * *Download everything for offline*, as the last row of *Preferences* reads
 * it. The board *Offline* draws four states, and each comes out of this: at
 * rest (with the count once some are kept), downloading, on the device — every
 * thumbnail kept, and no button —, and stopped, with its reason, until
 * *Continue*.
 *
 * **The state lives in `useState`, and the loop in no component.** The board
 * draws the download going on through the game and stopping when the tab
 * closes: leaving *Settings* keeps it running, and coming back finds the count
 * where it got to.
 *
 * **Without a worker the row does not exist** — no browser support, `yarn dev`,
 * a suite that blocks workers. `kept` stays `null` until
 * `navigator.serviceWorker.ready` resolves, which it never does without one:
 * the board has the row vanish rather than show switched off, as the account
 * panel does with no account.
 *
 * The cache is this build's (`spriteRevision`). A worker of an older build still
 * in charge reads its own until the new one takes over; the new one keeps this
 * cache and deletes the other, so what was downloaded meanwhile is not lost —
 * and it is this build's art, because the download asks past the worker in
 * charge (`keepSprites`).
 */
export function useSpriteDownload(): {
  state: Ref<SpriteDownload>
  total: number
  count: () => Promise<void>
  start: () => Promise<void>
} {
  const state = useState<SpriteDownload>('sprite-download', () => ({ kept: null, running: false, stopped: null }))
  const cacheName = spriteCacheName(useRuntimeConfig().public.spriteRevision)
  const urls = spriteUrls(SPECIES_COUNT)

  /** Counts what is on the device, once a worker is in charge. A download in flight keeps its own count. */
  async function count(): Promise<void> {
    if (!('serviceWorker' in navigator)) return
    await navigator.serviceWorker.ready
    if (state.value.running) return

    try {
      state.value.kept = (await keptOf(await caches.open(cacheName), urls)).size
    }
    catch {
      // Storage the browser will not open for this page: no row, as with no worker.
    }
  }

  /** *Download* and *Continue* alike: fetches what the cache does not have yet. */
  async function start(): Promise<void> {
    if (state.value.running) return
    state.value.running = true
    state.value.stopped = null

    try {
      const store = await caches.open(cacheName)
      const kept = await keptOf(store, urls)
      state.value.kept = kept.size
      state.value.stopped = await keepSprites(store, urls.filter(url => !kept.has(url)), () => {
        state.value.kept = (state.value.kept ?? 0) + 1
      })
    }
    catch {
      // The cache itself refused to open: nowhere to keep them.
      state.value.stopped = 'space'
    }
    finally {
      state.value.running = false
    }
  }

  return { state, total: SPECIES_COUNT, count, start }
}
