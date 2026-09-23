import { expect, test, type Page } from '@playwright/test'
import { PRECACHE_CACHE, SPRITE_CACHE_PREFIX, type PrecacheEntry } from '../../app/utils/offline.ts'
import { LOCALE_KEY } from '../../app/utils/locale-preference.ts'
import { defaultLocale } from '../support/locales'
import { navLabel, pathPattern, playTurn, saveWith, seedLocalSave } from './support'

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

test('the worker installs everything it lists and takes the page it was registered from', async ({ page }) => {
  await underWorker(page)
})

test('offline, a page nobody opened comes up from the shell', async ({ page, context }) => {
  await underWorker(page)
  await context.setOffline(true)

  await page.goto('/pokemon/pikachu')

  await expect(page.getByRole('heading', { level: 1, name: 'Pikachu' })).toBeVisible()
  expect(await fromShell(page)).toBe(true)
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
