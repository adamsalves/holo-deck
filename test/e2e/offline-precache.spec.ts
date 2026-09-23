import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'
import { localeCodes, localeUrl } from '../support/locales'

/**
 * **What the service worker installs with, measured against what the game
 * loads** — the gate the Phase 8 contract asked for: *"the manifest has the
 * shell and the dex, and not a sprite"*.
 *
 * The list is read back from `/sw.js` as the server hands it to a browser, and
 * held against three things the list was not built from:
 *
 * 1. **The output on disk, by who leaves.** Every file of `.output/public` is
 *    either installed or named below as leaving, with the reason. A folder the
 *    build starts writing fails here until someone decides which it is — a list
 *    of what goes in would let it through in silence.
 * 2. **What the pages load in a browser**, in both languages. That is the list
 *    that matters offline, and no function of the build computes it: the
 *    browser picks the font files from the text on screen and the chunks from
 *    the route.
 * 3. **The server, file by file.** One entry the server does not answer with a
 *    200 aborts the whole install in the browser, and the worker never takes
 *    over — `@vite-pwa/nuxt` did exactly that in the spike of this PR, turning
 *    `200.html` into `/200`, which answers 404.
 *
 * This suite runs with service workers blocked, as the whole suite does (see
 * `playwright.config.ts`): what it measures is the list, not the worker. The
 * worker is `offline.spec.ts`.
 */

/**
 * The build's public output, relative to the repository — and every path below
 * relative on both sides, so the answer does not depend on where the suite runs.
 */
const PUBLIC = '.output/public'

/** The dex as the repository holds it — the source the build copies from. */
const DEX_SOURCE = 'public/data'

interface PrecacheEntry {
  readonly url: string
  readonly revision: string
}

/** The entries the served worker installs with, from the line the build writes. */
async function servedPrecache(request: APIRequestContext): Promise<readonly PrecacheEntry[]> {
  const response = await request.get('/sw.js')
  expect(response.status(), '/sw.js is not served').toBe(200)

  const line = /^const PRECACHE = (.*);$/m.exec(await response.text())?.[1]
  expect(line, '/sw.js has no `const PRECACHE = …;` line').toBeDefined()

  const parsed: unknown = JSON.parse(line ?? '[]')
  expect(Array.isArray(parsed), 'PRECACHE is not a list').toBe(true)

  return (Array.isArray(parsed) ? parsed : []).filter(isEntry)
}

function isEntry(value: unknown): value is PrecacheEntry {
  return typeof value === 'object' && value !== null
    && 'url' in value && typeof value.url === 'string'
    && 'revision' in value && typeof value.revision === 'string'
}

/**
 * **Who leaves, and why.** Each exit names a kind of file the worker does not
 * install. The list is closed on purpose: a file that fits none of them fails.
 */
const LEAVES: readonly { name: string, matches: (path: string) => boolean }[] = [
  // The second layer. Cached as a page shows them, and all 1025 by *Download
  // everything for offline*: 6 MB the first visit should not pay for.
  { name: 'sprites', matches: path => path.startsWith('sprites/') },
  // 2,104 prerendered pages. Offline, the shell renders any of them from the
  // installed dex — installing each would be 109 MB.
  { name: 'pages', matches: path => path.endsWith('index.html') },
  // Each page's data, fetched next to it. Offline the shell runs the same
  // handlers on the installed dex, and Nuxt treats a payload that fails as none.
  { name: 'payloads', matches: path => path.endsWith('_payload.json') },
  // `latest.json` is how Nuxt learns a new build exists — installed, it would
  // never change. `meta/` is read online; offline Nuxt reads its absence as
  // "not prerendered" and runs the handlers, which is what the shell wants.
  { name: 'build manifest', matches: path => path.startsWith('_nuxt/builds/') },
  // Faces for the Latin extension, Cyrillic, Greek and Vietnamese. Neither
  // language makes the browser fetch them — which the page loads at the end of
  // this file measure.
  { name: 'fonts for other scripts', matches: path => path.startsWith('_fonts/') },
  { name: 'the worker itself', matches: path => path === 'sw.js' },
  // Asked for by the browser, outside the page; offline the tab shows its
  // default icon. 110 KB, and it is not what the installed app will use.
  { name: 'favicon', matches: path => path === 'favicon.ico' },
]

/** Where an installed URL comes from — each source has to be there by name. */
const SOURCE_NAMES = ['code', 'dex', 'messages', 'fonts', 'shell'] as const

type Source = typeof SOURCE_NAMES[number]

const SOURCES: Readonly<Record<Source, (url: string) => boolean>> = {
  code: url => url.startsWith('/_nuxt/') && /\.(?:js|css)$/.test(url),
  dex: url => url.startsWith('/data/'),
  messages: url => url.startsWith('/_i18n/'),
  fonts: url => url.startsWith('/_fonts/'),
  shell: url => url === '/200.html',
}

/**
 * **A budget per source, never on the sum.** Measured on 23/09/2026 and given
 * about a quarter of headroom: code 1,199 KB, dex 737, messages 57, fonts 147,
 * shell 12 — 2.0 MB on disk, 539 KB over the wire. The plan's "~310 KB" was
 * written before the game existed.
 *
 * A total would let one source grow into the room another left. Crossing one of
 * these is a decision to take — the worker downloads all of it on the first
 * visit, and again when it changes — and then this number moves with the
 * reason next to it.
 */
const BUDGET_KB: Readonly<Record<Source, number>> = {
  code: 1500,
  dex: 920,
  messages: 75,
  fonts: 185,
  shell: 16,
}

function sourceOf(url: string): Source | undefined {
  return SOURCE_NAMES.find(source => SOURCES[source](url))
}

test.describe('the precache', () => {
  test('leaves out only what is named as leaving, and each exit is in use', async ({ request }) => {
    const installed = new Set((await servedPrecache(request)).map(entry => entry.url))
    const files = walkFiles(join(REPO_ROOT, PUBLIC), new Set(), () => true)
      .map(file => relative(PUBLIC, file).replaceAll(sep, '/'))

    // The other side: an empty walk would leave nothing to classify.
    expect(files.length, 'nothing in .output/public — build first').toBeGreaterThan(1000)

    const unnamed = files.filter(path => !installed.has(`/${path}`) && !LEAVES.some(exit => exit.matches(path)))
    expect(unnamed, 'files neither installed nor named as leaving').toEqual([])

    const idle = LEAVES.filter(exit => !files.some(path => !installed.has(`/${path}`) && exit.matches(path)))
    expect(idle.map(exit => exit.name), 'exits that match nothing: a rule for a file that is gone').toEqual([])

    const missing = [...installed].filter(url => !files.includes(url.slice(1)))
    expect(missing, 'installed URLs with no file in the output').toEqual([])
  })

  test('has every source, by name, within its budget', async ({ request }) => {
    const entries = await servedPrecache(request)
    const strays = entries.filter(entry => sourceOf(entry.url) === undefined)
    expect(strays.map(entry => entry.url), 'installed URLs from no known source').toEqual([])

    for (const source of SOURCE_NAMES) {
      const urls = entries.map(entry => entry.url).filter(SOURCES[source])
      expect(urls.length, `the precache has nothing from ${source}`).toBeGreaterThan(0)

      let bytes = 0
      for (const url of urls) bytes += (await (await request.get(url)).body()).length
      expect(Math.round(bytes / 1024), `${source} is over its budget`).toBeLessThanOrEqual(BUDGET_KB[source])
    }
  })

  test('has the dex as the repository holds it, file by file', async ({ request }) => {
    const installed = (await servedPrecache(request)).map(entry => entry.url).filter(SOURCES.dex).sort()
    const source = (await readdir(join(REPO_ROOT, DEX_SOURCE))).filter(hasExtension(['.json'])).map(name => `/data/${name}`).sort()

    // The other side: two empty lists are equal.
    expect(source.length).toBeGreaterThan(20)
    expect(installed).toEqual(source)
  })

  test('has one set of messages per language', async ({ request }) => {
    const installed = (await servedPrecache(request)).map(entry => entry.url).filter(SOURCES.messages)

    for (const code of localeCodes()) {
      const mine = installed.filter(url => url.endsWith(`/${code}/messages.json`))
      expect(mine, `messages for ${code}`).toHaveLength(1)
    }
    expect(installed).toHaveLength(localeCodes().length)
  })

  test('is answered by the server, every entry, with a 200 and no redirect', async ({ request }) => {
    const entries = await servedPrecache(request)
    const refused: string[] = []

    for (const { url } of entries) {
      const response = await request.get(url, { maxRedirects: 0 })
      if (response.status() !== 200) refused.push(`${url} → ${response.status()}`)
    }

    expect(entries.length).toBeGreaterThan(0)
    expect(refused).toEqual([])
  })

  /**
   * The shell goes out with the root guard first in its head, ahead of every
   * stylesheet and script — offline it is the document `/` opens as, and the
   * guard is what sends a player who chose English to `/en` before the Hub is
   * painted in Portuguese (decision 2 of the 4d plan).
   */
  test('ships the shell with the root guard first in its head', async ({ request }) => {
    const shell = await (await request.get('/200.html')).text()
    const head = shell.slice(0, shell.indexOf('</head>'))
    const first = /<(?:script|link rel="stylesheet"|style)\b[^>]*>/.exec(head)?.[0] ?? ''

    expect(first, 'the first script or style of the shell').toContain('id="locale-root-guard"')
    expect(shell.split('id="locale-root-guard"')).toHaveLength(2)
  })
})

/**
 * One address per page of `app/pages`, read from the disk: a page added later is
 * measured without anyone remembering to add it here. A parameter nobody gave a
 * sample for fails instead of being skipped.
 */
const SAMPLES: Readonly<Record<string, string>> = { gymId: '1', gen: '1', name: 'pikachu' }

const PAGES = 'app/pages'

/** `/styleguide` exists only in `yarn dev` — the build removes it (see `nuxt.config.ts`). */
const DEVELOPMENT_ONLY = new Set(['/styleguide'])

function pageAddresses(): string[] {
  const pages = walkFiles(join(REPO_ROOT, PAGES), new Set(), hasExtension(['.vue']))

  return pages.flatMap((file) => {
    const route = `/${relative(PAGES, file).replaceAll(sep, '/').replace(/\.vue$/, '')}`
      .replace(/\/index$/, '') || '/'
    const address = route.replace(/\[(\w+)\]/g, (_, parameter: string) => {
      const sample = SAMPLES[parameter]
      if (sample === undefined) throw new Error(`${file}: no sample for [${parameter}]`)

      return sample
    })

    return DEVELOPMENT_ONLY.has(address) ? [] : [address]
  })
}

/** What a page loaded but the worker must not install — the same exits, as URLs. */
function leavesAsLoaded(url: URL): boolean {
  return url.pathname.startsWith('/sprites/')
    || url.pathname.endsWith('/_payload.json')
    || url.pathname.startsWith('/_nuxt/builds/')
    || url.pathname.startsWith('/api/')
    || url.pathname === '/sw.js'
}

const ADDRESSES = pageAddresses()

test('there are pages to load', () => {
  // The other side of the loop below: no pages, no measurement.
  expect(ADDRESSES.length).toBeGreaterThan(10)
})

for (const code of localeCodes()) {
  for (const address of ADDRESSES) {
    const target = localeUrl(address, code)

    test(`everything ${target} loads from the site is installed`, async ({ page, request }) => {
      const installed = new Set((await servedPrecache(request)).map(entry => entry.url))

      // The default buffer holds 250 entries, and a region's grid alone asks for
      // more than a hundred sprites: past the limit the browser stops recording.
      await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
      await page.goto(target)
      await page.waitForLoadState('networkidle')

      const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
      const origin = new URL(page.url()).origin
      const own = loaded.map(name => new URL(name)).filter(url => url.origin === origin)

      // The other side: a page that loaded nothing from the site measured nothing.
      expect(own.length, `${target} loaded nothing from the site`).toBeGreaterThan(0)

      const outside = own
        .filter(url => !leavesAsLoaded(url))
        .map(url => url.pathname + url.search)
        .filter(path => !installed.has(path))

      expect([...new Set(outside)], `${target} loaded these, and offline they would be missing`).toEqual([])
    })
  }
}
