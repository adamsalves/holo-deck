import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PRECACHE_CACHE, SPRITE_CACHE_PREFIX, type PrecacheEntry } from '../../app/utils/offline.ts'
import { LOCALE_KEY } from '../../app/utils/locale-preference.ts'
import { defaultLocale, foreignPhrases, label, localeUrl, namespaceLabels } from '../support/locales'
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
 * language this device chose, and a battle is played to the end.
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

/**
 * The phase's closing check, as the plan writes it: *"with the network offline,
 * the game opens and a battle runs to the end"*. Everything a battle reads — the
 * engine, the dex, the moves, the gym's team — is on the device once the worker
 * installed; the sprites it cannot find fall back to the thumbnails.
 */
test('offline, a battle runs to the end', async ({ page, context }) => {
  await seedLocalSave(page, saveWith({
    collection: Object.fromEntries(DECK.map(id => [id, { c: 1, s: 0 }])),
    deck: DECK,
  }))
  await underWorker(page)
  await context.setOffline(true)

  await page.goto('/battle/1')
  expect(await fromShell(page)).toBe(true)
  await expect(page.locator('.combatant')).toHaveCount(2)

  // A generous ceiling: a first gym closes in far fewer turns, and a loop with
  // no ceiling would hide a battle that never ends.
  const result = page.locator('.battle__result')
  for (let turn = 0; turn < 200 && !(await result.isVisible()); turn += 1) {
    await playTurn(page)
  }
  await expect(result).toBeVisible()
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
  await expect(row).toContainText('neste aparelho')
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
 * The page's writes hang after 412, which holds the download there, and the
 * game is left and come back to without a reload: a row whose state lived in
 * the component would come back at rest, having counted the same 412.
 */
test('leaving settings does not stop the download', async ({ page }) => {
  await page.addInitScript(() => {
    const put = Cache.prototype.put
    let calls = 0
    Cache.prototype.put = function (this: Cache, request: RequestInfo | URL, response: Response): Promise<void> {
      calls += 1

      return calls > 412 ? new Promise<void>(() => undefined) : put.call(this, request, response)
    }
  })
  await underWorker(page)

  await page.goto('/settings')
  const row = offlineRow(page, 'pt-BR')
  await row.getByRole('button', { name: 'BAIXAR', exact: true }).click()
  await expect(row).toContainText('412 de 1025')

  await page.getByRole('link', { name: 'HOLO/DECK', exact: true }).click()
  await expect(page).toHaveURL(pathPattern('/'))
  await page.goBack()

  await expect(row).toContainText('412 de 1025')
  await expect(row.getByText('baixando…', { exact: true })).toBeVisible()
})
