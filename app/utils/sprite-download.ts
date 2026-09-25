/**
 * *Download everything for offline* — the loop that fills the thumbnails'
 * cache, apart from the row that shows it (`useSpriteDownload`).
 *
 * **The page downloads, not the worker**, and it writes into the cache itself.
 * The board *Offline* draws the download stopping when the tab closes, which is
 * what a page's loop does; and it draws two reasons to stop, which only the side
 * that writes can tell apart. A thumbnail fetched through the worker is kept by
 * the worker too (`keptAsShown`), but that write swallows its own failure — a
 * full disk would read as a download that finished.
 */

/** Why a download stopped: the two reasons of the board's state 04. */
export type SpriteDownloadStop = 'network' | 'space'

/** What the loop needs of a `Cache` — the browser's, or a test's. */
export interface SpriteStore {
  keys: () => Promise<readonly { readonly url: string }[]>
  put: (url: string, response: Response) => Promise<void>
}

/** What the loop needs of `fetch`. */
export type SpriteFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/**
 * Thumbnails in flight at once. A browser opens six connections to a host over
 * HTTP/1.1, and over HTTP/2 more buys nothing at 6 KB a file.
 */
const PARALLEL = 6

/**
 * How long one thumbnail may take, body included. A connection that is up and
 * never answers — a captive portal, a train between stations — would otherwise
 * leave the row on *downloading* for as long as the browser waits, which is
 * minutes; the board's answer to a connection that went away is state 04 and
 * *Continue*.
 */
const SPRITE_TIMEOUT = 15_000

/** Every thumbnail of the dex, by the address the pages show it at. */
export function spriteUrls(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `/sprites/${index + 1}.webp`)
}

/**
 * The ones among `urls` the store already has. The keys come back absolute —
 * the worker keeps a thumbnail under the request a page made —, so they are
 * compared by path.
 */
export async function keptOf(store: SpriteStore, urls: readonly string[]): Promise<Set<string>> {
  const kept = new Set((await store.keys()).map(request => new URL(request.url).pathname))

  return new Set(urls.filter(url => kept.has(url)))
}

/**
 * Whether an answer is a thumbnail worth keeping — the worker's rule
 * (`isThumbnail` in `scripts/service-worker/worker.ts`), which cannot be
 * imported from there: a redirect's answer or a page would outlive the file
 * being fixed. On a Vercel preview that page is the sign-in wall.
 */
function isThumbnail(response: Response): boolean {
  return response.ok && !response.redirected && (response.headers.get('content-type') ?? '').startsWith('image/')
}

/**
 * Downloads `urls` into the store, `PARALLEL` at a time, calling `onKept` for
 * each one kept. Resolves with `null` once all of them are, or with the reason
 * the first failure gives — and then the lanes stop taking more.
 *
 * **The reason is the error's, not the step's.** Only `QuotaExceededError` is
 * the disk's. Everything else is the network's: a fetch that fails, an answer
 * that is not a thumbnail — what a captive portal or a sign-in wall sends —,
 * and a write that fails for any other reason, because `Cache.put` reads the
 * body, which is still coming over the network. Measured in Chromium: a
 * connection dropped after the headers rejects the write with a `NetworkError`,
 * and the deadline running out mid-body with an `AbortError`. The way out is
 * the same for all of them — *Continue* once the connection is back.
 *
 * What was kept before the failure stays: the next run starts from what the
 * store has, which is what *Continue* does.
 */
export async function keepSprites(
  store: SpriteStore,
  urls: readonly string[],
  onKept: () => void,
  fetcher: SpriteFetch = fetch,
  deadline = SPRITE_TIMEOUT,
): Promise<SpriteDownloadStop | null> {
  const queue = [...urls]
  let stopped: SpriteDownloadStop | null = null

  const lane = async (): Promise<void> => {
    while (stopped === null) {
      const url = queue.shift()
      if (url === undefined) return

      let response: Response
      try {
        response = await fetcher(url, { signal: AbortSignal.timeout(deadline) })
      }
      catch {
        stopped ??= 'network'
        return
      }
      if (!isThumbnail(response)) {
        stopped ??= 'network'
        return
      }

      try {
        await store.put(url, response)
      }
      catch (error) {
        stopped ??= error instanceof Error && error.name === 'QuotaExceededError' ? 'space' : 'network'
        return
      }
      onKept()
    }
  }

  await Promise.all(Array.from({ length: PARALLEL }, lane))

  return stopped
}
