import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ROOT_GUARD_ID } from '../../app/utils/locale-preference'
import {
  latinFontFiles,
  precachePaths,
  serviceWorkerScript,
  transpileWorker,
  withRootGuard,
} from '../../scripts/service-worker/build'
import { localeCodes } from '../support/locales'

/**
 * The pure half of the service worker's build: which files of the public output
 * it installs with, and the two texts it writes — the worker and the shell.
 *
 * Every expectation below is spelled out by hand, never derived from the module
 * under test: a list built by the same function agrees with it when both are
 * wrong. What the built worker does in a browser is `test/e2e/offline.spec.ts`;
 * whether the list it was built from covers what the pages load is
 * `test/e2e/offline-precache.spec.ts`.
 */

/**
 * The four kinds of face the build emits today, one of each: the Latin subset,
 * the Latin extension, a script the game never writes, and a face with no range,
 * which draws every code point. Shapes copied from the built CSS: `@nuxt/fonts`
 * points at `../_fonts/` from inside `_nuxt/`.
 */
const CSS = [
  '@font-face{font-family:Chakra Petch;src:url(../_fonts/latin.woff2) format("woff2");font-weight:400;unicode-range:U+0000-00FF,U+0131,U+2000-206F}',
  '@font-face{font-family:Chakra Petch;src:url(../_fonts/latin-ext.woff2) format("woff2");font-weight:400;unicode-range:U+0100-02BA,U+1E00-1EFF}',
  '@font-face{font-family:JetBrains Mono;src:url(../_fonts/cyrillic.woff2) format("woff2");unicode-range:U+0460-052F,U+2DE0-2DFF}',
  '@font-face{font-family:JetBrains Mono;src:local(JetBrains Mono),url(../_fonts/everything.woff2) format("woff2")}',
].join('')

describe('latinFontFiles', () => {
  it('keeps the faces that draw Latin text and nothing else', () => {
    expect(latinFontFiles(CSS)).toEqual(['_fonts/everything.woff2', '_fonts/latin.woff2'])
  })

  /**
   * The wildcard form of the range, `U+00??`, is what Google writes for the
   * Latin block in some of its stylesheets — and read as a literal it covers
   * nothing, so the one face pt-BR needs would fall out.
   */
  it('reads a wildcard range as the block it stands for', () => {
    const wildcard = '@font-face{src:url(../_fonts/wild.woff2);unicode-range:U+00??}'
    const elsewhere = '@font-face{src:url(../_fonts/greek.woff2);unicode-range:U+03??}'

    expect(latinFontFiles(wildcard + elsewhere)).toEqual(['_fonts/wild.woff2'])
  })

  it('names each file once, however many faces point at it', () => {
    expect(latinFontFiles(CSS + CSS)).toEqual(['_fonts/everything.woff2', '_fonts/latin.woff2'])
  })
})

/** Every language's messages, where the i18n module writes them. */
function messageFiles(codes: readonly string[]): string[] {
  return codes.map(code => `_i18n/50081bfb/${code}/messages.json`)
}

/**
 * A public output with one file of every kind the build writes today — and, for
 * each kind the worker must leave out, the file that would give it away.
 */
const OUTPUT = [
  '_nuxt/entry.CdpVvRXb.js',
  '_nuxt/entry.DpEVjEKB.css',
  '_nuxt/builds/latest.json',
  '_nuxt/builds/meta/8b92f4b8.json',
  '_fonts/latin.woff2',
  '_fonts/latin-ext.woff2',
  '_fonts/cyrillic.woff2',
  '_fonts/everything.woff2',
  'data/core.json',
  'data/gen-1.json',
  'data/index.json',
  ...messageFiles(localeCodes()),
  '200.html',
  'index.html',
  '_payload.json',
  'pokemon/pikachu/index.html',
  'pokemon/pikachu/_payload.json',
  'sprites/25.webp',
  'favicon.ico',
]

describe('precachePaths', () => {
  // The other side: with one language the test that drops one below leaves
  // nothing to drop.
  it('has two languages to lose one of', () => {
    expect(localeCodes().length).toBeGreaterThan(1)
  })

  it('installs the shell, the code, the dex, the messages and the Latin fonts — and only those', () => {
    expect(precachePaths(OUTPUT, CSS)).toEqual([
      '200.html',
      '_fonts/everything.woff2',
      '_fonts/latin.woff2',
      ...messageFiles(localeCodes()),
      '_nuxt/entry.CdpVvRXb.js',
      '_nuxt/entry.DpEVjEKB.css',
      'data/core.json',
      'data/gen-1.json',
      'data/index.json',
    ].sort())
  })

  /**
   * A source that comes up empty is a build that would install an offline game
   * with a hole in it, and the worker installs without complaint either way.
   * The failure names the source, because "the precache is short" says nothing
   * about where to look.
   */
  it('refuses an output without the shell', () => {
    expect(() => precachePaths(OUTPUT.filter(path => path !== '200.html'), CSS)).toThrow(/200\.html/)
  })

  it('refuses an output without the dex', () => {
    expect(() => precachePaths(OUTPUT.filter(path => !path.startsWith('data/')), CSS)).toThrow(/data\//)
  })

  it('refuses an output without the code', () => {
    expect(() => precachePaths(OUTPUT.filter(path => !path.endsWith('.js')), CSS)).toThrow(/_nuxt\//)
  })

  it('refuses an output that lost one language\'s messages, and names it', () => {
    for (const code of localeCodes()) {
      const without = OUTPUT.filter(path => path !== `_i18n/50081bfb/${code}/messages.json`)

      expect(() => precachePaths(without, CSS), code).toThrow(code)
    }
  })

  /**
   * The stylesheet naming a file the output does not have is the worker failing
   * to install in the browser — one 404 aborts the whole install. Better at the
   * build, where the name of the file is still known.
   */
  it('refuses a Latin face whose file is not in the output', () => {
    expect(() => precachePaths(OUTPUT.filter(path => path !== '_fonts/latin.woff2'), CSS)).toThrow(/latin\.woff2/)
  })

  it('refuses a stylesheet with no Latin face at all', () => {
    const noLatin = '@font-face{src:url(../_fonts/cyrillic.woff2);unicode-range:U+0460-052F}'

    expect(() => precachePaths(OUTPUT, noLatin)).toThrow(/font/)
  })
})

describe('withRootGuard', () => {
  const SHELL = '<!DOCTYPE html><html class="dark"><head><meta charset="utf-8"><title>Holo Deck</title><link rel="stylesheet" href="/_nuxt/entry.css"></head><body><div id="__nuxt"></div></body></html>'

  /**
   * First in the head, ahead of the stylesheet: the redirect has to leave before
   * the browser has anything to paint, which is the whole point of the guard
   * being inline — see `rootGuardScript`.
   */
  it('puts the guard first in the head, once', () => {
    const guarded = withRootGuard(SHELL)

    expect(
      guarded.startsWith(`<!DOCTYPE html><html class="dark"><head><script id="${ROOT_GUARD_ID}">`),
      'the guard is not the first thing in the head',
    ).toBe(true)
    expect(guarded.split(`id="${ROOT_GUARD_ID}"`)).toHaveLength(2)
    expect(guarded.indexOf(ROOT_GUARD_ID)).toBeLessThan(guarded.indexOf('rel="stylesheet"'))
  })

  it('refuses a shell that already carries one', () => {
    expect(() => withRootGuard(withRootGuard(SHELL))).toThrow(ROOT_GUARD_ID)
  })

  it('refuses a document with no head to put it in', () => {
    expect(() => withRootGuard('<!DOCTYPE html><html><body></body></html>')).toThrow(/head/)
  })
})

describe('the worker script', () => {
  /**
   * The worker is served as a classic script: a module statement left in it is
   * a syntax error, and a service worker that does not parse never installs.
   * `import type` compiles to nothing, but it leaves the file a module, and the
   * compiler marks that with an `export {}` of its own.
   */
  it('comes out of the compiler with no module syntax left', () => {
    const source = [
      'import type { PrecacheEntry } from \'../../app/utils/offline\'',
      'declare const PRECACHE: readonly PrecacheEntry[]',
      'const count: number = PRECACHE.length',
    ].join('\n')

    const script = transpileWorker(source)

    expect(script).toContain('const count = PRECACHE.length')
    expect(script).not.toMatch(/^\s*(?:import|export)\b/m)
  })

  it('refuses a worker that imports something at run time', () => {
    expect(() => transpileWorker('import { LOCALES } from \'../../app/utils/locales\'\nconsole.log(LOCALES)')).toThrow(/import/)
  })

  /**
   * The names the worker declares and the build writes are one contract in two
   * files — run the script and read them back, as the browser would.
   */
  it('hands the worker its entries and the names it shares with the pages', () => {
    const entries = [{ url: '/200.html', revision: 'a1b2c3d4e5f60718' }]
    const script = serviceWorkerScript(entries, 'globalThis.seen = { PRECACHE, PRECACHE_CACHE, SPRITE_CACHE, OFFLINE_SHELL }')
    const sandbox: { seen?: unknown } = {}

    runInNewContext(script, sandbox)

    expect(sandbox.seen).toEqual({
      PRECACHE: entries,
      PRECACHE_CACHE: 'holodeck-precache',
      SPRITE_CACHE: 'holodeck-sprites',
      OFFLINE_SHELL: '/200.html',
    })
  })

  /**
   * The gate over the build reads the entries back from the served worker by
   * this line, so its shape is part of the contract and not a detail.
   */
  it('writes the entries on a line of their own, as JSON', () => {
    const entries = [{ url: '/data/core.json', revision: '0123456789abcdef' }]
    const line = /^const PRECACHE = (.*);$/m.exec(serviceWorkerScript(entries, ''))?.[1]

    expect(line === undefined ? undefined : JSON.parse(line)).toEqual(entries)
  })
})
