import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serviceWorkerScript, transpileWorker } from '../../scripts/service-worker/build'
import type { SpriteFetch } from '~~/app/utils/sprite-download'
import { keepSprites } from '~~/app/utils/sprite-download'

/**
 * The worker's rules, run: the script the build serves — `transpileWorker` over
 * `worker.ts`, behind `serviceWorkerScript`'s header — in a sandbox with a fake
 * Cache Storage, a fake network and the events a browser would send.
 *
 * The same text the browser gets, so what is measured is the worker and not a
 * copy of it. A real browser going offline is `test/e2e/offline.spec.ts`; what
 * is here is what that suite cannot bring about on demand — a download that is
 * not the file the build listed, a network that never answers, storage that
 * refuses to keep — and the rules of what the worker leaves alone, which the
 * browser suite would only notice by their absence.
 *
 * Every expected revision is computed here with `node:crypto`, never by the
 * module under test.
 */

const ORIGIN = 'https://holo.test'
const WORKER = transpileWorker(readFileSync(new URL('../../scripts/service-worker/worker.ts', import.meta.url), 'utf8'))
const SPRITES = 'holodeck-sprites-aaaaaaaaaaaaaaaa'
const DEX = '/data/core.json?v=1111111111111111'

/** SHA-256, the first sixteen hex digits — the revision, computed by hand. */
function revision(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

/** What the server has: one body per address, path and query. */
const SITE: Readonly<Record<string, string>> = {
  '/200.html': '<!DOCTYPE html><html><head></head><body><div id="__nuxt"></div></body></html>',
  [DEX]: '{"dexVersion":"19c9dc2a"}',
  '/_nuxt/entry.js': 'console.log("entry")',
}

const ENTRIES = Object.entries(SITE).map(([url, body]) => ({ url, revision: revision(body) }))

/** The key an installed file sits under, spelled out: its address, then `__revision`. */
function keyOf(url: string, body: string): string {
  return `${ORIGIN}${url}${url.includes('?') ? '&' : '?'}__revision=${revision(body)}`
}

/** One Cache of the Cache Storage, keyed by absolute URL. */
class FakeCache {
  readonly entries = new Map<string, Response>()
  refusal: Error | null = null

  async match(request: string | { url: string }): Promise<Response | undefined> {
    return this.entries.get(typeof request === 'string' ? request : request.url)?.clone()
  }

  async put(request: string | { url: string }, response: Response): Promise<void> {
    if (this.refusal !== null) throw this.refusal
    this.entries.set(typeof request === 'string' ? request : request.url, response)
  }

  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map(url => ({ url }))
  }

  async delete(request: { url: string }): Promise<boolean> {
    return this.entries.delete(request.url)
  }
}

class FakeCacheStorage {
  readonly byName = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    const cache = this.byName.get(name) ?? new FakeCache()
    this.byName.set(name, cache)

    return cache
  }

  async keys(): Promise<string[]> {
    return [...this.byName.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.byName.delete(name)
  }
}

/** A request as the worker reads one — `navigate` is a mode `new Request` refuses to build. */
interface FakeRequest {
  readonly url: string
  readonly method: string
  readonly mode: string
  readonly cache?: string
}

function get(path: string, mode = 'cors'): FakeRequest {
  return { url: new URL(path, ORIGIN).href, method: 'GET', mode }
}

type Network = (url: string) => Promise<Response>

/** What the server has, answered as the server would: 200 with a type, or 404. */
const server: Network = async (url) => {
  const { pathname, search } = new URL(url)
  const body = SITE[pathname + search]
  if (body === undefined) return new Response('not here', { status: 404 })

  return new Response(body, { status: 200, headers: { 'content-type': pathname.endsWith('.html') ? 'text/html' : 'text/plain' } })
}

/** A response that came through a redirect — the flag `new Response` cannot set. */
function redirected(response: Response): Response {
  return Object.defineProperty(response, 'redirected', { value: true })
}

/** Loads the worker into a fresh sandbox, answering its `fetch` with `network`. */
function boot(network: Network = server) {
  const caches = new FakeCacheStorage()
  const listeners = new Map<string, (event: object) => void>()
  const requested: { url: string, cache: string | undefined }[] = []
  let claims = 0

  runInNewContext(serviceWorkerScript(ENTRIES, SPRITES, WORKER), {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: (event: object) => void) => {
        listeners.set(type, listener)
      },
      clients: {
        claim: async () => {
          claims += 1
        },
      },
    },
    caches,
    crypto: globalThis.crypto,
    fetch: (input: string | FakeRequest, init?: { cache?: string }) => {
      const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN).href
      requested.push({ url, cache: init?.cache })

      return network(url)
    },
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    URL,
  })

  const dispatch = async (type: 'install' | 'activate'): Promise<void> => {
    let lifetime: unknown
    listeners.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        lifetime = promise
      },
    })
    await lifetime
  }

  /** The worker's answer to one request, or `undefined` when it leaves it to the browser. */
  const request = (fake: FakeRequest): { answer: Promise<Response> | undefined, kept: Promise<unknown>[] } => {
    let answer: Promise<Response> | undefined
    const kept: Promise<unknown>[] = []
    listeners.get('fetch')?.({
      request: fake,
      respondWith: (response: Promise<Response>) => {
        answer = response
      },
      waitUntil: (promise: Promise<unknown>) => {
        kept.push(promise)
      },
    })

    return { answer, kept }
  }

  return { caches, requested, dispatch, request, claims: () => claims }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('what the worker leaves to the browser', () => {
  it('leaves any method but GET, any other origin, and everything under /api/', () => {
    const worker = boot()
    const untouched: FakeRequest[] = [
      { url: `${ORIGIN}${DEX}`, method: 'POST', mode: 'cors' },
      { url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/25.png', method: 'GET', mode: 'no-cors' },
      get('/api/save'),
      get('/api/auth/get-session', 'navigate'),
      get('/api/auth/callback/github?code=one-time', 'navigate'),
    ]

    for (const fake of untouched) {
      expect(worker.request(fake).answer, `${fake.method} ${fake.url} (${fake.mode})`).toBeUndefined()
    }
  })

  // The other side: a sandbox where nothing is ever answered would pass the test
  // above for no reason.
  it('does answer a navigation and a thumbnail of its own origin', () => {
    const worker = boot()

    expect(worker.request(get('/pokedex', 'navigate')).answer).toBeDefined()
    expect(worker.request(get('/sprites/25.webp')).answer).toBeDefined()
  })
})

describe('the install', () => {
  it('keeps every listed file under its revision, downloaded past the HTTP cache', async () => {
    const worker = boot()
    await worker.dispatch('install')

    const keys = [...(worker.caches.byName.get('holodeck-precache')?.entries.keys() ?? [])]

    expect(keys.sort()).toEqual(Object.entries(SITE).map(([url, body]) => keyOf(url, body)).sort())
    expect(worker.requested.map(call => call.cache)).toEqual(ENTRIES.map(() => 'reload'))
  })

  it('downloads only what an earlier build did not leave under the same revision', async () => {
    const worker = boot()
    const kept = await worker.caches.open('holodeck-precache')
    await kept.put(keyOf('/_nuxt/entry.js', SITE['/_nuxt/entry.js'] ?? ''), new Response('from the build before'))

    await worker.dispatch('install')

    expect(worker.requested.map(call => call.url).sort()).toEqual([`${ORIGIN}${DEX}`, `${ORIGIN}/200.html`].sort())
  })

  /**
   * The host moved on to another build between the download of the worker and
   * this one: the file answers 200, and it is not the one this build listed.
   * Kept under this build's revision, it would answer this build's pages with
   * the other build's content.
   */
  it('fails whole when a download is not the file the build listed', async () => {
    const worker = boot(async url => (url.endsWith(DEX) ? new Response('{"dexVersion":"another build"}') : server(url)))

    await expect(worker.dispatch('install')).rejects.toThrow(`${DEX} is not the file this build listed`)
  })

  /**
   * The one exception, and a measured one: Vercel's previews append the feedback
   * toolbar's script to every HTML document they serve, after `</html>`, so the
   * shell never hashes to the file the build wrote. Checked like the rest, it
   * kept the worker from ever installing on a preview.
   */
  it('keeps the shell as the host serves it, decorated or not', async () => {
    const toolbar = '<script async src="https://vercel.live/_next-live/feedback/feedback.js"></script>'
    const worker = boot(async url => (url.endsWith('/200.html')
      ? new Response(`${SITE['/200.html'] ?? ''}${toolbar}`, { headers: { 'content-type': 'text/html' } })
      : server(url)))

    await worker.dispatch('install')

    const shell = await (await worker.caches.open('holodeck-precache')).match(keyOf('/200.html', SITE['/200.html'] ?? ''))
    expect(await shell?.text()).toBe(`${SITE['/200.html'] ?? ''}${toolbar}`)
  })

  it('fails whole on a refusal, and on a redirect', async () => {
    const refused = boot(async url => (url.endsWith('/200.html') ? new Response('gone', { status: 404 }) : server(url)))
    await expect(refused.dispatch('install')).rejects.toThrow('/200.html answered 404')

    const moved = boot(async url => (url.endsWith('/200.html') ? redirected(await server(url)) : server(url)))
    await expect(moved.dispatch('install')).rejects.toThrow('/200.html answered 200 through a redirect')
  })
})

describe('the answers', () => {
  it('answers an installed file from the cache, at the exact address the page asks for', async () => {
    const worker = boot()
    await worker.dispatch('install')
    const downloads = worker.requested.length

    const answer = await worker.request(get(DEX)).answer

    expect(await answer?.text()).toBe(SITE[DEX])
    expect(worker.requested, 'the installed file went to the network').toHaveLength(downloads)
  })

  /**
   * A page of another build asks for the dex with another revision. The worker
   * has no such address, and the network — the build that page belongs to —
   * answers it, instead of this worker's copy of another dex.
   */
  it('leaves the dex of another revision to the network', async () => {
    const worker = boot()
    await worker.dispatch('install')

    expect(worker.request(get('/data/core.json?v=2222222222222222')).answer).toBeUndefined()
    expect(worker.request(get('/data/core.json')).answer).toBeUndefined()
  })

  it('answers a navigation from the network, a 404 included', async () => {
    const worker = boot()
    await worker.dispatch('install')

    const answer = await worker.request(get('/pokemon/missingno', 'navigate')).answer

    expect(answer?.status).toBe(404)
  })

  it('answers a navigation with the shell when the network fails', async () => {
    const worker = boot(async (url) => {
      if (url.endsWith('/pokemon/pikachu')) throw new TypeError('Failed to fetch')
      return server(url)
    })
    await worker.dispatch('install')

    const answer = await worker.request(get('/pokemon/pikachu', 'navigate')).answer

    expect(await answer?.text()).toBe(SITE['/200.html'])
  })

  /**
   * A connection that is up and never answers. The barrier is the clock: one
   * millisecond short of the timeout the answer is still pending, which is what
   * tells a timeout from a fallback that happens at once.
   */
  it('answers a navigation with the shell when the network has not answered in three seconds', async () => {
    vi.useFakeTimers()
    const worker = boot(async url => (url.endsWith('/pokemon/pikachu') ? new Promise<Response>(() => undefined) : server(url)))
    await worker.dispatch('install')

    let settled: Response | undefined
    void worker.request(get('/pokemon/pikachu', 'navigate')).answer?.then((answer) => {
      settled = answer
    })

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled, 'answered before the timeout').toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    expect(await settled?.text()).toBe(SITE['/200.html'])
  })

  it('waits for the network, however long, when there is no shell to fall back on', async () => {
    vi.useFakeTimers()
    let arrive: (response: Response) => void = () => undefined
    const worker = boot(async () => new Promise<Response>((resolve) => {
      arrive = resolve
    }))

    let settled: Response | undefined
    void worker.request(get('/pokemon/pikachu', 'navigate')).answer?.then((answer) => {
      settled = answer
    })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(settled, 'answered with nothing to answer with').toBeUndefined()

    arrive(new Response('the page, at last'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await settled?.text()).toBe('the page, at last')
  })
})

describe('the thumbnails', () => {
  const image = async (): Promise<Response> => new Response('webp', { headers: { 'content-type': 'image/webp' } })

  it('keeps an image the network sent, and answers it from the cache the next time', async () => {
    const worker = boot(image)

    const first = worker.request(get('/sprites/25.webp'))
    expect(await (await first.answer)?.text()).toBe('webp')
    await Promise.all(first.kept)

    const again = await worker.request(get('/sprites/25.webp')).answer

    expect(await again?.text()).toBe('webp')
    expect(worker.requested, 'the kept thumbnail went to the network again').toHaveLength(1)
    expect([...(worker.caches.byName.get(SPRITES)?.entries.keys() ?? [])]).toEqual([`${ORIGIN}/sprites/25.webp`])
  })

  /**
   * A 404, a page served where an image was asked for, and an image that came
   * through a redirect: kept, any of them would answer for the thumbnail long
   * after the file was fixed.
   */
  it('keeps nothing but an image sent as itself', async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => new Response('missing', { status: 404, headers: { 'content-type': 'image/webp' } }),
      async () => new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }),
      async () => redirected(await image()),
    ]

    for (const answer of answers) {
      const worker = boot(answer)
      const { answer: response, kept } = worker.request(get('/sprites/25.webp'))
      await response
      await Promise.all(kept)

      expect(worker.caches.byName.get(SPRITES)?.entries.size ?? 0).toBe(0)
    }
  })

  /**
   * An update that changes the art: the page is the new build's — navigations
   * go to the network first —, the worker in charge is still the old one, and
   * its cache holds the old art. The download asks past it; an answer from that
   * cache, kept under the new revision, would be served by the new worker until
   * the art changed again.
   */
  it('leaves a download to the network, so the page keeps the art the host has now', async () => {
    const network = async (): Promise<Response> => new Response('new art', { headers: { 'content-type': 'image/webp' } })
    const worker = boot(network)
    const old = await worker.caches.open(SPRITES)
    await old.put(`${ORIGIN}/sprites/25.webp`, new Response('old art', { headers: { 'content-type': 'image/webp' } }))
    const next = await worker.caches.open('holodeck-sprites-bbbbbbbbbbbbbbbb')

    // The page's fetch, routed as a browser routes it: to the worker, and to
    // the network when the worker leaves it.
    const fetcher: SpriteFetch = (url, init) => worker.request({ ...get(url), cache: init.cache }).answer ?? network()

    expect(await keepSprites(next, ['/sprites/25.webp'], () => undefined, fetcher)).toBeNull()
    expect(await (await next.match('/sprites/25.webp'))?.text()).toBe('new art')
    // The other side: a page showing the thumbnail still gets the kept one.
    expect(await (await worker.request(get('/sprites/25.webp')).answer)?.text()).toBe('old art')
  })

  it('still answers the thumbnail when storage refuses to keep it', async () => {
    const worker = boot(image)
    const cache = await worker.caches.open(SPRITES)
    cache.refusal = new Error('QuotaExceededError')

    const { answer, kept } = worker.request(get('/sprites/25.webp'))

    expect(await (await answer)?.text()).toBe('webp')
    await expect(Promise.all(kept)).resolves.toBeDefined()
    expect(cache.entries.size).toBe(0)
  })
})

describe('taking over', () => {
  it('deletes the files of builds gone by, and keeps its own', async () => {
    const worker = boot()
    await worker.dispatch('install')
    const precache = await worker.caches.open('holodeck-precache')
    await precache.put(`${ORIGIN}/_nuxt/entry.old.js?__revision=0000000000000000`, new Response('old'))
    await precache.put(`${ORIGIN}/data/core.json?v=0000000000000000&__revision=0000000000000000`, new Response('old dex'))

    await worker.dispatch('activate')

    expect([...precache.entries.keys()].sort()).toEqual(Object.entries(SITE).map(([url, body]) => keyOf(url, body)).sort())
    expect(worker.claims()).toBe(1)
  })

  it('retires the thumbnails of every other revision of the art, and no other cache', async () => {
    const worker = boot()
    for (const name of ['holodeck-sprites', 'holodeck-sprites-bbbbbbbbbbbbbbbb', SPRITES, 'holodeck-precache']) {
      await worker.caches.open(name)
    }

    await worker.dispatch('activate')

    expect((await worker.caches.keys()).sort()).toEqual(['holodeck-precache', SPRITES].sort())
  })
})
