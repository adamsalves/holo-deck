import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { OFFLINE_SHELL_PATH } from '../../app/utils/offline.ts'
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
 * 2. **What the pages load in a browser**, in both languages — served as a page
 *    and booted from the shell, the way the worker answers them offline. That
 *    is the list that matters offline, and no function of the build computes
 *    it: the browser picks the chunks from the route, the dex from the
 *    handlers, and the font files from the text — every character the game can
 *    write, asked of every face the stylesheets declare.
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

/** Both languages' messages, as the repository holds them. */
const LOCALES_SOURCE = 'i18n/locales'

/** An installed address as a path of the public output — the query is not part of the file. */
function pathOf(url: string): string {
  return new URL(url, 'http://gate.test').pathname.slice(1)
}

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
 *
 * The fonts that leave are the ones no text asks for, which only a browser can
 * say (`fontsTheTextAsksFor`) — the one exit that needs to be handed what the
 * browser answered.
 */
const LEAVES: readonly { name: string, matches: (path: string, fontsAskedFor: ReadonlySet<string>) => boolean }[] = [
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
  // never change. `meta/` is read online and sent `immutable`, so offline it
  // comes from the HTTP cache or not at all: from the cache, Nuxt takes the page
  // as prerendered, asks for its payload and swallows the failure; without it,
  // it takes the page as not prerendered. Both end in the handlers running on
  // the installed dex, which is what the shell wants.
  { name: 'build manifest', matches: path => path.startsWith('_nuxt/builds/') },
  // Faces no character on screen makes a browser download: the Latin
  // extension, Cyrillic, Greek and Vietnamese, today. Asked of the browser, never
  // read from the CSS — see `fontsTheTextAsksFor`.
  { name: 'fonts no text asks for', matches: (path, fontsAskedFor) => path.startsWith('_fonts/') && !fontsAskedFor.has(path) },
  { name: 'the worker itself', matches: path => path === 'sw.js' },
  // The app's icon for a browser that reads no SVG one, and the square iOS puts
  // on a home screen: both asked for by the browser, outside the page. The SVG
  // the tab and the bar share is installed with the code.
  { name: 'favicon', matches: path => path === 'favicon.ico' },
  { name: 'home screen icon', matches: path => path === 'apple-touch-icon.png' },
]

/** Where an installed URL comes from — each source has to be there by name. */
const SOURCE_NAMES = ['code', 'dex', 'messages', 'fonts', 'shell'] as const

type Source = typeof SOURCE_NAMES[number]

const SOURCES: Readonly<Record<Source, (url: string) => boolean>> = {
  code: url => url.startsWith('/_nuxt/') && /\.(?:js|css|svg)$/.test(url),
  dex: url => url.startsWith('/data/'),
  messages: url => url.startsWith('/_i18n/'),
  fonts: url => url.startsWith('/_fonts/'),
  shell: url => url === '/200.html',
}

/**
 * **A budget per source, never on the sum.** Measured on 23/09/2026 and given
 * about a quarter of headroom: code 1,190 KB, dex 737, messages 57, fonts 144,
 * shell 12 — 2.1 MB on disk, 681 KB over the wire with gzip, of which the fonts
 * are 144 KB that woff2 had already compressed. The plan's "~310 KB" was
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

/**
 * Every character the game can put on screen: the two languages' messages and
 * every text in the dex — names, types, moves, descriptions.
 */
async function charactersOnScreen(): Promise<string> {
  const characters = new Set<string>()
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const character of value) characters.add(character)
    }
    else if (typeof value === 'object' && value !== null) {
      for (const inner of Object.values(value)) collect(inner)
    }
  }

  for (const folder of [LOCALES_SOURCE, DEX_SOURCE]) {
    for (const name of (await readdir(join(REPO_ROOT, folder))).filter(hasExtension(['.json']))) {
      const parsed: unknown = JSON.parse(await readFile(join(REPO_ROOT, folder, name), 'utf8'))
      collect(parsed)
    }
  }

  return [...characters].join('')
}

/**
 * The font files the game's text makes a browser download — asked of the
 * browser, not read from the stylesheets.
 *
 * Every face the stylesheets declare, by family, style and weight, is loaded
 * with every character on screen (`document.fonts.load`): the browser matches
 * the text against each face's `unicode-range` and downloads the ones it needs.
 * That is the list that has to be installed. The builder reads those ranges out
 * of the CSS (`latinFontFiles`), and a gate that read them too would agree with
 * its mistakes — the first version of this gate named every font as leaving,
 * and a Latin italic taken out of the install went through it green.
 *
 * A face that refuses to load is not an error here, and is handed back by name:
 * the metric fallbacks `@nuxt/fonts` declares (`… Fallback: sans-serif`,
 * `src: local(…)`) refuse on a machine without that system font, and download
 * nothing from the site either way. Tolerating a refusal costs the gate nothing,
 * because the comparison against the install runs both ways: a real family the
 * probe failed to load would leave its installed files without a match.
 */
async function fontsTheTextAsksFor(page: Page): Promise<{ files: ReadonlySet<string>, refused: readonly string[] }> {
  const text = await charactersOnScreen()

  await page.goto('/rules')
  const { loaded, refused } = await page.evaluate(async (sample) => {
    const fonts = new Set<string>()
    document.fonts.forEach((face) => {
      fonts.add(`${face.style} ${face.weight.split(' ')[0] ?? 'normal'} 16px "${face.family.replaceAll('"', '')}"`)
    })
    const outcomes = await Promise.allSettled([...fonts].map(font => document.fonts.load(font, sample)))

    return {
      loaded: performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname),
      refused: [...fonts].filter((_, index) => outcomes[index]?.status === 'rejected'),
    }
  }, text)

  return { files: new Set(loaded.filter(path => path.startsWith('/_fonts/')).map(path => path.slice(1))), refused }
}

test.describe('the precache', () => {
  test('leaves out only what is named as leaving, and each exit is in use', async ({ page, request }) => {
    const installed = new Set((await servedPrecache(request)).map(entry => pathOf(entry.url)))
    const fontsAskedFor = (await fontsTheTextAsksFor(page)).files
    const files = walkFiles(join(REPO_ROOT, PUBLIC), new Set(), () => true)
      .map(file => relative(PUBLIC, file).replaceAll(sep, '/'))

    // The other side: an empty walk would leave nothing to classify.
    expect(files.length, 'nothing in .output/public — build first').toBeGreaterThan(1000)

    const leaves = (path: string): boolean => LEAVES.some(exit => exit.matches(path, fontsAskedFor))
    const unnamed = files.filter(path => !installed.has(path) && !leaves(path))
    expect(unnamed, 'files neither installed nor named as leaving').toEqual([])

    const idle = LEAVES.filter(exit => !files.some(path => !installed.has(path) && exit.matches(path, fontsAskedFor)))
    expect(idle.map(exit => exit.name), 'exits that match nothing: a rule for a file that is gone').toEqual([])

    const missing = [...installed].filter(path => !files.includes(path))
    expect(missing, 'installed URLs with no file in the output').toEqual([])
  })

  test('installs the fonts the text on screen asks a browser for — every one, and no other', async ({ page, request }) => {
    const { files, refused } = await fontsTheTextAsksFor(page)
    const askedFor = [...files].sort()
    const installed = (await servedPrecache(request)).map(entry => pathOf(entry.url)).filter(path => path.startsWith('_fonts/')).sort()

    // The other side: a probe that loaded nothing would ask for nothing, and the
    // comparison below would then only hold against an install with no fonts.
    expect(askedFor.length, 'the probe made the browser download no font at all').toBeGreaterThan(0)
    expect(installed, `installed fonts against the ones the text asked for — refused: ${refused.join('; ') || 'none'}`).toEqual(askedFor)
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

  test('has the dex as the repository holds it, file by file, under one revision', async ({ request }) => {
    const urls = (await servedPrecache(request)).map(entry => entry.url).filter(SOURCES.dex)
    const installed = urls.map(pathOf).sort()
    const source = (await readdir(join(REPO_ROOT, DEX_SOURCE))).filter(hasExtension(['.json'])).map(name => `data/${name}`).sort()

    // The other side: two empty lists are equal.
    expect(source.length).toBeGreaterThan(20)
    expect(installed).toEqual(source)

    // The revision in the address is what keeps an old worker from answering a
    // new page with an old dex (`dexUrl`): every file carries one, the same one.
    const revisions = [...new Set(urls.map(url => new URL(url, 'http://gate.test').searchParams.get('v')))]
    expect(revisions, 'the dex is installed without a revision, or under more than one').toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)])
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

/**
 * Everything a page loads from its own site: opened as the network serves it,
 * or — given `shell` — booted from the offline shell at the same address, which
 * is how the worker answers it offline. The two differ where it counts: the
 * prerendered page carries its data in a payload, and the shell runs every
 * handler on the client, so only the second asks for the dex.
 */
async function loadedFrom(page: Page, target: string, shell?: string): Promise<URL[]> {
  if (shell !== undefined) {
    await page.route(url => url.pathname === target, route => route.fulfill({ contentType: 'text/html', body: shell }))
  }

  await page.goto(target)
  await page.waitForLoadState('networkidle')

  if (shell !== undefined) {
    // The other side: without it, a route that missed would measure the
    // prerendered page twice and call it the shell.
    const serverRendered = await page.evaluate(() => document.getElementById('__NUXT_DATA__')?.dataset.ssr)
    expect(serverRendered, `${target} did not boot from the shell`).toBe('false')
  }

  const names = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
  const origin = new URL(page.url()).origin

  return names.map(name => new URL(name)).filter(url => url.origin === origin)
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

    test(`everything ${target} loads from the site is installed, as a page and from the shell`, async ({ page, request }) => {
      const installed = new Set((await servedPrecache(request)).map(entry => entry.url))
      const shell = await (await request.get(OFFLINE_SHELL_PATH)).text()

      // The default buffer holds 250 entries, and a region's grid alone asks for
      // more than a hundred sprites: past the limit the browser stops recording.
      await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
      const asPage = await loadedFrom(page, target)
      const fromShell = await loadedFrom(page, target, shell)

      // The other side: a load that asked nothing of the site measured nothing.
      expect(asPage.length, `${target} loaded nothing from the site as a page`).toBeGreaterThan(0)
      expect(fromShell.length, `${target} loaded nothing from the site from the shell`).toBeGreaterThan(0)

      const outside = [...asPage, ...fromShell]
        .filter(url => !leavesAsLoaded(url))
        .map(url => url.pathname + url.search)
        .filter(path => !installed.has(path))

      expect([...new Set(outside)], `${target} loaded these, and offline they would be missing`).toEqual([])
    })
  }
}
