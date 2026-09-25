import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SpriteFetch, SpriteStore } from '~~/app/utils/sprite-download'
import { keepSprites, keptOf, spriteUrls } from '~~/app/utils/sprite-download'
import { SPECIES_COUNT } from '~~/shared/types/brand'
import { REPO_ROOT } from '../support/source-tree'

/**
 * *Download everything for offline*, the loop without the row: what it keeps,
 * what it asks for, and which of the board's two reasons each failure gives.
 */

const ORIGIN = 'https://holo.test'

/** A cache as the browser holds it: keys come back absolute. It refuses with `refusal` once it holds `refuseAfter`. */
function store(initial: readonly string[] = [], refuseAfter = Infinity, refusal = 'QuotaExceededError'): SpriteStore & { kept: string[] } {
  const kept = [...initial]

  return {
    kept,
    keys: async () => kept.map(url => ({ url: new URL(url, ORIGIN).href })),
    put: async (url) => {
      if (kept.length >= refuseAfter) throw new DOMException('refused', refusal)
      kept.push(url)
    },
  }
}

function thumbnail(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } })
}

/** A network that answers every thumbnail but the ones named, and records what it was asked. */
function network(failing: ReadonlySet<string> = new Set(), answer: () => Response = thumbnail): SpriteFetch & { asked: string[] } {
  const asked: string[] = []
  const fetcher = async (url: string): Promise<Response> => {
    asked.push(url)
    if (failing.has(url)) throw new TypeError('Failed to fetch')

    return answer()
  }

  return Object.assign(fetcher, { asked })
}

describe('spriteUrls', () => {
  it('names every thumbnail the build ships, and nothing else', () => {
    // Held against the disk, as sets: a thumbnail the pipeline stops writing,
    // or one it starts writing under another name, fails here.
    const onDisk = readdirSync(join(REPO_ROOT, 'public/sprites')).map(name => `/sprites/${name}`)

    expect(onDisk.length).toBe(SPECIES_COUNT)
    expect(new Set(spriteUrls(SPECIES_COUNT))).toEqual(new Set(onDisk))
  })
})

describe('keptOf', () => {
  it('finds the kept ones by path, whatever origin the keys carry', async () => {
    const urls = spriteUrls(4)
    const kept = await keptOf(store(['/sprites/2.webp', '/sprites/4.webp', '/sprites/99.webp']), urls)

    expect(kept).toEqual(new Set(['/sprites/2.webp', '/sprites/4.webp']))
  })
})

describe('keepSprites', () => {
  it('keeps every thumbnail asked for, one call to onKept each', async () => {
    const cache = store()
    const fetcher = network()
    let calls = 0

    const stopped = await keepSprites(cache, spriteUrls(20), () => {
      calls += 1
    }, fetcher)

    expect(stopped).toBeNull()
    expect(new Set(cache.kept)).toEqual(new Set(spriteUrls(20)))
    expect(calls).toBe(20)
    expect(fetcher.asked.sort()).toEqual(spriteUrls(20).sort())
  })

  it('stops for the network when a fetch fails, and keeps what came before', async () => {
    const urls = spriteUrls(40)
    const cache = store()
    const fetcher = network(new Set(['/sprites/3.webp']))

    const stopped = await keepSprites(cache, urls, () => undefined, fetcher)

    expect(stopped).toBe('network')
    // The lanes stop taking more: the ones in flight finish, the rest wait for *Continue*.
    expect(fetcher.asked.length).toBeLessThan(urls.length)
    expect(cache.kept).not.toContain('/sprites/3.webp')
    expect(cache.kept.length).toBeGreaterThan(0)
  })

  it('keeps no answer that is not a thumbnail, and stops for the network', async () => {
    const cache = store()
    const page = () => new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } })

    expect(await keepSprites(cache, spriteUrls(3), () => undefined, network(new Set(), page))).toBe('network')
    expect(cache.kept).toEqual([])

    const missing = () => new Response('not here', { status: 404, headers: { 'content-type': 'image/webp' } })
    expect(await keepSprites(cache, spriteUrls(3), () => undefined, network(new Set(), missing))).toBe('network')
    expect(cache.kept).toEqual([])
  })

  it('stops for space when the store refuses to keep one', async () => {
    const cache = store([], 5)

    const stopped = await keepSprites(cache, spriteUrls(30), () => undefined, network())

    expect(stopped).toBe('space')
    expect(cache.kept.length).toBe(5)
  })

  /**
   * `Cache.put` reads the body, which is still coming over the network: in
   * Chromium, a connection dropped after the headers rejects the write with a
   * `NetworkError`, and the deadline running out mid-body with an `AbortError`.
   * Neither is the disk — the row would send the player to free space for a
   * connection that dropped.
   */
  it('stops for the network when a write fails for any reason but quota', async () => {
    for (const refusal of ['NetworkError', 'AbortError']) {
      expect(await keepSprites(store([], 0, refusal), spriteUrls(3), () => undefined, network()), refusal).toBe('network')
    }
  })

  it('gives up on a thumbnail that never comes, as the network', async () => {
    // Settles only when its signal aborts: a connection that is up and never answers.
    const hanging: SpriteFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
    })
    const unbounded = new Promise(resolve => setTimeout(resolve, 1_000, 'still waiting'))

    expect(await Promise.race([keepSprites(store(), spriteUrls(2), () => undefined, hanging, 10), unbounded])).toBe('network')
  })
})
