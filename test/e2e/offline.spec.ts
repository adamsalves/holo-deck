import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PRECACHE_CACHE, SPRITE_CACHE_PREFIX, type PrecacheEntry } from '../../app/utils/offline.ts'
import { LOCALE_KEY } from '../../app/utils/locale-preference.ts'
import { defaultLocale, foreignPhrases, label, localeUrl, namespaceLabels, repeated } from '../support/locales'
import { REPO_ROOT } from '../support/source-tree'
import { navLabel, pathPattern, playTurn, saveWith, screenText, seedLocalSave } from './support'

/**
 * **The game with the network gone** — what the service worker is for, measured
 * in a browser.
 *
 * The rest of the suite blocks service workers (see `playwright.config.ts`); this
 * file lets them in, and every test starts the same way: the first page registers
 * the worker, the worker installs its whole list and takes the page, and only
 * then does the context go offline. From there, every navigation the browser
 * makes has one place to go.
 *
 * The list the worker installs is measured on its own by
 * `offline-precache.spec.ts`. What is here is the behaviour on top of it: a page
 * nobody opened comes up, in either language, the root still honours the
 * language this device chose, and a battle is played to the end. And what a
 * picture that is not on the device turns into — the board *Offline*'s glyph
 * for a thumbnail, and the hero's fall from the artwork.
 */

test.use({ serviceWorkers: 'allow' })

/**
 * Where every test registers the worker: a page none of them opens offline.
 *
 * **Not the root, and that was measured the hard way.** What the browser fetched
 * online stays in its HTTP cache, and the worker's own `fetch` is answered from
 * there: `yarn preview` sends the root with no `cache-control`, only a
 * `Last-Modified`, so the browser reuses it by heuristic freshness. Registered
 * from `/`, the offline root came back as the prerendered page with its own
 * guard, and the shell's was never asked — a shell built without the guard left
 * the root test green. Production sends `max-age=0, must-revalidate`, which
 * forbids exactly that reuse, so there the shell answers; this keeps the suite
 * on production's side.
 */
const REGISTERED_FROM = '/rules'

/**
 * One of the names the build writes in front of the worker, read from `/sw.js`
 * as the browser gets it: `const NAME = <JSON>;`, on a line of its own (see
 * `serviceWorkerScript`).
 */
function servedConstant(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async (constant) => {
    const source = await (await fetch('/sw.js')).text()
    const line = new RegExp(`^const ${constant} = (.*);$`, 'm').exec(source)?.[1]
    const parsed: unknown = line === undefined ? undefined : JSON.parse(line)

    return parsed
  }, name)
}

function isEntry(value: unknown): value is PrecacheEntry {
  return typeof value === 'object' && value !== null
    && 'url' in value && typeof value.url === 'string'
    && 'revision' in value && typeof value.revision === 'string'
}

/**
 * Opens a page and waits for the worker to have installed everything and to
 * control it — `clients.claim()` on its first activation is what makes a reload
 * unnecessary. The cache read back is the other side of "installed": every
 * listed address at its revision, and nothing else. A worker whose install
 * failed on one entry never activates; one that skipped an entry, or kept one
 * under another revision, shows it here.
 */
async function underWorker(page: Page): Promise<void> {
  await page.goto(REGISTERED_FROM)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  const served = await servedConstant(page, 'PRECACHE')
  const listed = (Array.isArray(served) ? served : []).filter(isEntry).map(entry => `${entry.url} ${entry.revision}`)
  const installed = await page.evaluate(async (name) => {
    return (await (await caches.open(name)).keys()).map((request) => {
      const url = new URL(request.url)
      const revision = url.searchParams.get('__revision') ?? ''
      url.searchParams.delete('__revision')

      return `${url.pathname}${url.search} ${revision}`
    })
  }, PRECACHE_CACHE)

  expect(listed.length).toBeGreaterThan(0)
  expect(installed.sort()).toEqual(listed.sort())
}

/**
 * Whether the document on screen is the offline shell and not a prerendered
 * page. The shell is rendered with no server-side app, and Nuxt marks that on
 * the payload it inlines: a page that came from the network is `true`.
 *
 * Without this, a test that "works offline" would pass just as well on a
 * context whose network was never cut.
 */
function fromShell(page: Page): Promise<boolean> {
  return page.evaluate(() => document.getElementById('__NUXT_DATA__')?.dataset.ssr === 'false')
}

/**
 * Whether the app's icon in the bar came out — `decode()` settles once the image
 * has loaded or failed, so there is nothing to poll.
 */
function barIconLoads(page: Page): Promise<boolean> {
  return page.getByRole('link', { name: 'HOLO/DECK', exact: true }).locator('img').evaluate(async image => image instanceof HTMLImageElement && await image.decode().then(() => true, () => false))
}

test('the worker installs everything it lists and takes the page it was registered from', async ({ page }) => {
  await underWorker(page)
})

test('offline, a page nobody opened comes up from the shell', async ({ page, context }) => {
  await underWorker(page)
  await context.setOffline(true)
  // Routing turns the HTTP cache off. Without it, the icon the online visit
  // left there would draw the bar with nothing installed; with it, whatever the
  // worker does not answer reaches the route and fails.
  await page.route('**/_nuxt/*.svg', route => route.abort())

  await page.goto('/pokemon/pikachu')

  await expect(page.getByRole('heading', { level: 1, name: 'Pikachu' })).toBeVisible()
  expect(await fromShell(page)).toBe(true)
  expect(await barIconLoads(page), 'the bar\'s icon offline').toBe(true)
})

test('offline, English comes from the messages the worker installed', async ({ page, context }) => {
  await underWorker(page)
  await context.setOffline(true)

  // The other side: a label both languages spell alike would be found on a
  // Portuguese page too, and prove nothing about the messages.
  const binder = navLabel('nav.collection', 'en')
  expect(binder).not.toBe(navLabel('nav.collection', defaultLocale()))

  await page.goto('/en/collection')

  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByRole('link', { name: binder, exact: true })).toBeVisible()
  expect(await fromShell(page)).toBe(true)
})

/**
 * Decision 2 of the 4d plan, offline: whoever chose English and opens `/` — the
 * installed app, a bookmark — lands on `/en`. Online the root's own HTML carries
 * the guard; offline the root is the shell, so the shell has to carry it too.
 */
test('offline, the root still opens in the language this device chose', async ({ page, context }) => {
  await underWorker(page)
  await page.evaluate(key => localStorage.setItem(key, 'en'), LOCALE_KEY)
  await context.setOffline(true)

  await page.goto('/')

  await expect(page).toHaveURL(pathPattern('/en'))
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  expect(await fromShell(page)).toBe(true)
})

/**
 * The worker leaves `/api/` to the browser (see `worker.ts`): offline, an address
 * there fails as the network does, instead of opening the game on a route that
 * does not exist. The page test above is the other side — the same navigation
 * anywhere else is answered by the shell.
 */
test('offline, an address under /api/ is left to the network, and fails', async ({ page, context }) => {
  await underWorker(page)
  await context.setOffline(true)

  await expect(page.goto('/api/auth/get-session')).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/)
})

/**
 * Six cards chosen here and not drawn from a pack: the pack is not what is being
 * measured, and a fixed deck keeps the battle the same length from run to run.
 */
const DECK = [6, 9, 3, 143, 149, 130]

/** The board's offline glyph, as the app inlines it into a thumbnail. */
const GLYPH = /^data:image\/svg\+xml,/

/**
 * Writes down, on each image, every thumbnail address it failed to load — a list
 * in `data-thumbnail-failures`. Registered before the page's own scripts, it
 * hears each failure before the app's listener stops it.
 */
async function recordThumbnailFailures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener('error', (event) => {
      const image = event.target
      if (!(image instanceof HTMLImageElement)) return

      const address = image.getAttribute('src') ?? ''
      if (address.startsWith('/sprites/')) image.dataset.thumbnailFailures = `${image.dataset.thumbnailFailures ?? ''} ${address}`.trim()
    }, true)
  })
}

/** What `recordThumbnailFailures` wrote, one list per image. */
function thumbnailFailures(page: Page): Promise<string[][]> {
  return page.locator('[data-thumbnail-failures]').evaluateAll(images => images.map((image) => {
    return (image instanceof HTMLElement ? image.dataset.thumbnailFailures ?? '' : '').split(' ')
  }))
}

/**
 * The phase's closing check, as the plan writes it: *"with the network offline,
 * the game opens and a battle runs to the end"*. Everything a battle reads — the
 * engine, the dex, the moves, the gym's team — is on the device once the worker
 * installed; the sprites it cannot find fall back to the thumbnails.
 *
 * **And the fallback happens once per image, never in a loop** — the board's
 * words. No thumbnail of this battle was ever kept, so the animated sprite
 * falls to a thumbnail that fails too; the battle's handler would set that same
 * address again, and each failure would bring the next. Each image may fail at
 * an address once, and ends on the glyph.
 */
test('offline, a battle runs to the end', async ({ page, context }) => {
  await seedLocalSave(page, saveWith({
    collection: Object.fromEntries(DECK.map(id => [id, { c: 1, s: 0 }])),
    deck: DECK,
  }))
  await recordThumbnailFailures(page)
  await underWorker(page)
  await context.setOffline(true)

  await page.goto('/battle/1')
  expect(await fromShell(page)).toBe(true)
  await expect(page.locator('.combatant')).toHaveCount(2)
  await expect(page.locator('.battle__sprite--foe')).toHaveAttribute('src', GLYPH)
  await expect(page.locator('.battle__sprite--own')).toHaveAttribute('src', GLYPH)

  // A generous ceiling: a first gym closes in far fewer turns, and a loop with
  // no ceiling would hide a battle that never ends.
  const result = page.locator('.battle__result')
  for (let turn = 0; turn < 200 && !(await result.isVisible()); turn += 1) {
    await playTurn(page)
  }
  await expect(result).toBeVisible()

  const failures = await thumbnailFailures(page)
  expect(failures.length, 'no thumbnail failed, so no fallback was asked for').toBeGreaterThan(0)
  expect(failures.flatMap(list => repeated(list))).toEqual([])
})

/**
 * **The boundary the second layer draws**, stated so that *Download everything
 * for offline* (PR 5b) has something to change: a sprite a page showed while the
 * worker was in charge is on the device; one no page showed is not.
 */
test('a sprite a page showed is kept, and one never shown is not', async ({ page, context }) => {
  await underWorker(page)
  // The name carries the revision of the art, so it is read from the worker the
  // build wrote, not rebuilt here.
  const spriteCache = String(await servedConstant(page, 'SPRITE_CACHE'))
  expect(spriteCache).toMatch(new RegExp(`^${SPRITE_CACHE_PREFIX}-[0-9a-f]{16}$`))

  await page.goto('/pokedex/1')
  await expect(page.locator('img[src="/sprites/1.webp"]').first()).toBeVisible()
  await expect.poll(() => page.evaluate(async ([name, url]) => {
    return (await (await caches.open(name)).match(url)) !== undefined
  }, [spriteCache, '/sprites/1.webp'] as const)).toBe(true)

  await context.setOffline(true)

  const outcome = await page.evaluate(async () => {
    const attempt = async (url: string) => {
      try {
        return (await fetch(url)).ok ? 'ok' : 'error'
      }
      catch {
        return 'unreachable'
      }
    }

    return { shown: await attempt('/sprites/1.webp'), never: await attempt('/sprites/1025.webp') }
  })

  expect(outcome).toEqual({ shown: 'ok', never: 'unreachable' })
})

/**
 * The thumbnails on the page that tried to load and failed, by address — what
 * the glyph is there to replace. One still waiting, lazy and off screen, is not
 * counted either way.
 */
function brokenThumbnails(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.images)
    .filter(image => image.getAttribute('src')?.startsWith('/sprites/') === true && image.complete && image.naturalWidth === 0)
    .map(image => image.getAttribute('src') ?? ''))
}

/**
 * **The board's glyph, wherever a thumbnail is missing.** Nothing of the ninth
 * generation was shown before the network went, so every thumbnail of its grid
 * has to come out as the glyph; one left at its address, broken, is the listener
 * missing. The search is the screen whose image would not survive the failure
 * on its own: `UAvatar` swaps an image that fails for an empty `<span>`, which
 * is why the listener stops the event.
 */
test('offline, a thumbnail the device never kept shows the glyph, in the grid and in the search', async ({ page, context }) => {
  await underWorker(page)
  await context.setOffline(true)

  await page.goto('/pokedex/9')
  expect(await fromShell(page)).toBe(true)
  await expect(page.locator('.dex-card img').first()).toHaveAttribute('src', GLYPH)
  expect(await brokenThumbnails(page)).toEqual([])

  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await dialog.getByPlaceholder('Nome, número ou tipo…').fill('sprigatito')
  await expect(dialog.getByRole('option', { name: /Sprigatito/ }).locator('img')).toHaveAttribute('src', GLYPH)
})

/** The height of the hero's art box: the page under it moves when it changes. */
function artBox(page: Page): Promise<number> {
  return page.locator('.hero__art').evaluate(box => box.getBoundingClientRect().height)
}

/**
 * Opens a region's grid and waits for the app to take it: the grid shrinking
 * from the 151 the server sent to the few the virtualizer keeps is the signal
 * that exists only after hydration — see the search test of `pokedex.spec.ts`.
 * Before it, a click on a card is a new document, and the search does not open.
 */
async function hydratedGrid(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)
}

/**
 * Opens the search and goes to the species it finds for `query`. The first
 * option is the index having arrived, which the palette asks for only when it
 * opens.
 */
async function searchFor(page: Page, placeholder: string, query: string, name: RegExp): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await dialog.getByPlaceholder(placeholder).fill(query)
  await dialog.getByRole('option', { name }).click()
}

/** Whether the worker's thumbnail cache holds `url`. */
function isKept(page: Page, cache: string, url: string): Promise<boolean> {
  return page.evaluate(async ([name, address]) => {
    return (await (await caches.open(name)).match(address)) !== undefined
  }, [cache, url] as const)
}

/**
 * **The hero, in the board's two states.** The artwork is remote and never on
 * the device: the hero falls to the thumbnail when the device kept it — the grid
 * kept Bulbasaur's here — and to a glyph of its own when it did not, each with
 * the board's chip, and both in one box. That it is the artwork's box is
 * measured in `pokedex.spec.ts`, with an artwork the suite serves itself.
 *
 * **And the chip keeps its word** — *the artwork arrives with the connection*:
 * when the network comes back, the chip goes and the artwork is asked for
 * again. It is served here, so the real host stays out of the test.
 *
 * **One document, from the grid on.** The chip reads `navigator.onLine`, and
 * Playwright's offline reaches it on the page that was open when the network
 * went, not on one the worker brings up afterwards: that one reads online, where
 * a browser whose network is really gone reads offline — measured with Chromium
 * in a network namespace with no interface. So the hero is reached the way a
 * player gets there, by the card and by the search.
 */
test('offline, the hero falls to the thumbnail the device kept and to its glyph without it, and to the artwork when the network comes back', async ({ page, context }) => {
  await underWorker(page)
  const spriteCache = String(await servedConstant(page, 'SPRITE_CACHE'))

  await hydratedGrid(page, '/pokedex/1')
  await expect.poll(() => isKept(page, spriteCache, '/sprites/1.webp')).toBe(true)
  await context.setOffline(true)

  await page.locator('a[href="/pokemon/bulbasaur"]').first().click()
  const hero = page.locator('.hero__art')
  await expect(hero.locator('img')).toHaveAttribute('src', '/sprites/1.webp')
  await expect(hero).toContainText('sem rede · mostrando a miniatura')
  const box = await artBox(page)

  await searchFor(page, 'Nome, número ou tipo…', 'sprigatito', /Sprigatito/)
  await expect(page).toHaveURL(pathPattern('/pokemon/sprigatito'))
  await expect(hero).toContainText('sem rede · a arte chega com a conexão')
  await expect(hero.locator('img')).toHaveCount(0)
  expect(await artBox(page)).toBe(box)

  let served = 0
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    served += 1
    await route.fulfill({ path: join(REPO_ROOT, 'public/sprites/906.webp') })
  })
  await context.setOffline(false)
  await expect(hero.locator('img')).toHaveAttribute('src', /\/official-artwork\/906\.png$/)
  await expect(hero.locator('img')).toHaveJSProperty('naturalWidth', 128)
  await expect(hero.locator('.hero__offline')).toHaveCount(0)
  expect(served, 'the artwork came from the real host, and not from this test').toBeGreaterThan(0)
})

/**
 * The chip in English, where a Portuguese sentence left in the hero would show.
 * Reached by the search as above, and for the same reason.
 */
test('offline, the hero says in English that the artwork comes with the connection', async ({ page, context }) => {
  await underWorker(page)
  await hydratedGrid(page, localeUrl('/pokedex/1', 'en'))
  await context.setOffline(true)

  await searchFor(page, label('dex.search.placeholder', 'en'), 'sprigatito', /Sprigatito/)
  await expect(page).toHaveURL(pathPattern(localeUrl('/pokemon/sprigatito', 'en')))
  const hero = page.locator('.hero__art')
  await expect(hero).toContainText('offline · the artwork arrives with the connection')

  const foreign = namespaceLabels('species.offline.', 'en', defaultLocale())
  expect(foreign.length, 'no Portuguese label of the chip to look for').toBeGreaterThan(0)
  expect(foreignPhrases(await screenText(hero), foreign)).toEqual([])
})

/**
 * The thumbnails the build ships, read from its output — what *Download
 * everything for offline* has to leave on the device, and the figure the row
 * prints for them, worked out here with `toFixed` rather than the `Intl` the
 * page uses.
 */
function shippedSprites(): { urls: string[], megabytes: string } {
  const dir = join(REPO_ROOT, '.output/public/sprites')
  const names = readdirSync(dir)
  const bytes = names.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)

  return { urls: names.map(name => `/sprites/${name}`), megabytes: (bytes / 1024 / 1024).toFixed(1) }
}

/** The last row of *Preferences*, found by its title in the language `code`. */
function offlineRow(page: Page, code: string): Locator {
  return page.locator('.settings__row').filter({
    has: page.getByText(label('settings.offline.title', code), { exact: true }),
  })
}

/** The paths the worker's thumbnail cache holds. */
function keptSprites(page: Page, cache: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    return (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)
  }, cache)
}

/**
 * **The download leaves the build's thumbnails where the worker reads them.**
 * The page names the cache from `runtimeConfig` and the worker from what the
 * build wrote in front of it, so the cache is read back by the worker's name,
 * and held against the build's output as sets — a thumbnail missing, or one
 * too many. The page asks past the worker, so every one of them is the page's
 * write: with the two names drifted apart, the worker's cache comes out empty.
 *
 * **And no other cache holds a thumbnail**, whatever its name. Filtering the
 * caches by the thumbnails' prefix was green with the page writing to one named
 * otherwise — measured in the review of this PR, back when the worker kept the
 * download too and filled its own cache anyway.
 */
test('downloading everything leaves every thumbnail the build ships in the cache the worker reads', async ({ page, context }) => {
  const shipped = shippedSprites()
  const size = `${shipped.megabytes.replace('.', ',')} MB`
  await underWorker(page)
  const spriteCache = String(await servedConstant(page, 'SPRITE_CACHE'))
  expect(await keptSprites(page, spriteCache)).toEqual([])

  await page.goto('/settings')
  const row = offlineRow(page, 'pt-BR')
  await expect(row).toContainText(`As 1025 miniaturas, ${size}. O jogo já funciona offline com o que você viu — isso cobre o resto.`)

  await row.getByRole('button', { name: 'BAIXAR', exact: true }).click()

  await expect(row).toContainText(`As 1025 miniaturas estão neste aparelho, ${size}.`, { timeout: 60_000 })
  // The green chip: its words are also in the note, so it is asked for whole.
  await expect(row.getByText('neste aparelho', { exact: true })).toBeVisible()
  await expect(row.getByRole('button')).toHaveCount(0)
  expect(new Set(await keptSprites(page, spriteCache))).toEqual(new Set(shipped.urls))

  const elsewhere = await page.evaluate(async (read) => {
    const found: string[] = []
    for (const name of (await caches.keys()).filter(name => name !== read)) {
      for (const request of await (await caches.open(name)).keys()) {
        const path = new URL(request.url).pathname
        if (path.startsWith('/sprites/')) found.push(`${name}: ${path}`)
      }
    }

    return found
  }, spriteCache)
  expect(elsewhere, 'thumbnails kept in a cache the worker does not read').toEqual([])

  // And the worker answers from it: a thumbnail no page showed, with no network.
  await context.setOffline(true)
  expect(await page.evaluate(async () => (await fetch('/sprites/1025.webp')).ok)).toBe(true)
})

/**
 * State 04 by the network, and *Continue*: what came stays, and the rest comes
 * once the connection is back. In English, where a Portuguese label left in the
 * row would show.
 */
test('offline, downloading stops for the network, and continues once it is back', async ({ page, context }) => {
  const { megabytes } = shippedSprites()
  await underWorker(page)

  await page.goto(localeUrl('/settings', 'en'))
  const row = offlineRow(page, 'en')
  await expect(row).toContainText(`All 1025 thumbnails, ${megabytes} MB.`)

  await context.setOffline(true)
  await row.getByRole('button', { name: 'DOWNLOAD', exact: true }).click()
  await expect(row).toContainText('Stopped at 0 of 1025 — the connection dropped. What already came stays.')

  await context.setOffline(false)
  await row.getByRole('button', { name: 'CONTINUE', exact: true }).click()
  await expect(row).toContainText(`All 1025 thumbnails are on this device, ${megabytes} MB.`, { timeout: 60_000 })

  const foreign = namespaceLabels('settings.offline.', 'en', defaultLocale())
  expect(foreign.length, 'no Portuguese label of the row to look for').toBeGreaterThan(0)
  expect(foreignPhrases(await screenText(row), foreign)).toEqual([])
})

/**
 * State 04 by space, from the page's own writes: the page's `Cache.put` refuses
 * after ten, as a full quota does. The worker runs in a global of its own, so
 * its install is untouched. Reloading then finds state 01 with the count —
 * two counts, each above one, so each sentence has to pick its plural.
 */
test('downloading stops for space when the browser gives no more room, and the count stays', async ({ page }) => {
  await page.addInitScript(() => {
    const put = Cache.prototype.put
    let calls = 0
    Cache.prototype.put = function (this: Cache, request: RequestInfo | URL, response: Response): Promise<void> {
      calls += 1

      return calls > 10 ? Promise.reject(new DOMException('no room', 'QuotaExceededError')) : put.call(this, request, response)
    }
  })
  await underWorker(page)
  const spriteCache = String(await servedConstant(page, 'SPRITE_CACHE'))

  await page.goto('/settings')
  const row = offlineRow(page, 'pt-BR')
  await row.getByRole('button', { name: 'BAIXAR', exact: true }).click()

  await expect(row).toContainText('Parou em 10 de 1025 — o navegador não deu mais espaço.')
  await expect(row.getByRole('button', { name: 'CONTINUAR', exact: true })).toBeVisible()

  // The page is the only one writing what it downloads: the device holds its
  // ten, and none the worker would have kept on the way.
  await page.reload()
  await expect(row).toContainText('10 de 1025 já estão neste aparelho — o jogo guarda o que você vê. Baixar traz as outras 1015.')
  expect(await keptSprites(page, spriteCache)).toHaveLength(10)
  await expect(row.getByRole('button', { name: 'BAIXAR', exact: true })).toBeVisible()
})

/**
 * *Leaving the screen does not stop it*, as the board writes over state 02.
 * The page's writes are held after 412 until the test lets them go. Coming
 * back to *Settings* mid-way, without a reload, finds the download where it
 * got to — a row whose state lived in the component would come back at rest.
 * Then the writes are let go away from *Settings*, and every thumbnail has to
 * reach the device with no *Settings* on screen: a loop that stopped with the
 * screen would stay where it was. Back once more, the row is state 03.
 */
test('leaving settings does not stop the download', async ({ page }) => {
  await page.addInitScript(() => {
    const put = Cache.prototype.put
    let calls = 0
    const held = new Promise<void>((resolve) => {
      window.addEventListener('release-writes', () => resolve())
    })
    Cache.prototype.put = function (this: Cache, request: RequestInfo | URL, response: Response): Promise<void> {
      calls += 1

      return calls > 412 ? held.then(() => put.call(this, request, response)) : put.call(this, request, response)
    }
  })
  await underWorker(page)
  const spriteCache = String(await servedConstant(page, 'SPRITE_CACHE'))

  await page.goto('/settings')
  const row = offlineRow(page, 'pt-BR')
  await row.getByRole('button', { name: 'BAIXAR', exact: true }).click()
  await expect(row).toContainText('412 de 1025')

  const home = page.getByRole('link', { name: 'HOLO/DECK', exact: true })
  await home.click()
  await expect(page).toHaveURL(pathPattern('/'))
  await page.goBack()
  await expect(row).toContainText('412 de 1025')
  await expect(row.getByText('baixando…', { exact: true })).toBeVisible()

  await home.click()
  await expect(page).toHaveURL(pathPattern('/'))
  await page.evaluate(() => window.dispatchEvent(new Event('release-writes')))
  await expect.poll(async () => (await keptSprites(page, spriteCache)).length, { timeout: 60_000 }).toBe(1025)

  await page.goBack()
  await expect(row).toContainText('As 1025 miniaturas estão neste aparelho')
})
