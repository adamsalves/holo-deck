import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { NAV_RULES, NAV_SETTINGS } from '../../app/utils/nav-links.ts'
import { localeCodes, localeUrl } from '../support/locales'
import { pageAddresses, REPO_ROOT } from '../support/source-tree'
import { hydrated } from './support'

/**
 * **What moves on a first load, with nobody touching the page.**
 *
 * The bar is on every screen but the battle, on top of everything, and on a
 * phone it wraps into three or four lines: whatever changes its height pushes
 * the whole page, and whatever changes the width of one of its items moves the
 * ones after it. The page is drawn twice on a first visit — as the server wrote
 * it, and again once the client takes it over — and each difference between the
 * two is a jump the player sees.
 *
 * **The bar as the server wrote it against the bar hydrated, by geometry.** The
 * first is read with JavaScript off, which is the page that never hydrates and
 * so the one the player has before it does; both with their fonts in, so a face
 * that is still on its way is not what the comparison measures. A page that
 * jumps would also show in a `layout-shift` entry, but that needs the jump to
 * happen while the probe is looking; the two boxes are there whenever they are
 * read.
 *
 * The widths are a phone's, where the jump was, and two at which the bar breaks
 * its lines the same way in the headless shell this suite runs on and in the
 * Chrome a player has: between 412 and 416 px they disagree, and a width in
 * there would be measuring the shell.
 *
 * **And the faces the bar is written in, which have to be there for the first
 * paint.** Painted in the fallback, the bar's links take one line more at 430 px,
 * and the bar loses 57 px when the face comes. The two faces are preloaded by
 * the bar itself (see `AppNav.vue`), by an address that carries a hash, and
 * three things are asked of that: that a cold load moves neither the bar nor the
 * page under it; that every page preloads the faces of the bar when it has the
 * bar and none when it does not, said by family and weight as the built CSS
 * declares them; and that each preloaded file is one the page would have asked
 * for anyway. The second and third read `.output/public`, so they need
 * `yarn build`.
 */

const ADDRESS = '/rules'
const WIDTHS = [360, 430]

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Bar {
  readonly height: number
  /** The coins: the reserved box before hydration, the link after it. */
  readonly coins: Box | null
  /** Where each link of the bar sits, by its address. */
  readonly links: Readonly<Record<string, Box>>
}

function readBar(page: Page): Promise<Bar> {
  return page.evaluate(async () => {
    await document.fonts.ready

    const boxOf = (element: Element): Box => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const bar = document.querySelector('header.nav')
    if (bar === null) throw new Error('the page has no bar')

    const coins = bar.querySelector('.nav__coins')
    const links: Record<string, Box> = {}
    for (const link of Array.from(bar.querySelectorAll('a[href]:not(.nav__coins)'))) {
      links[link.getAttribute('href') ?? ''] = boxOf(link)
    }

    return { height: bar.getBoundingClientRect().height, coins: coins === null ? null : boxOf(coins), links }
  })
}

async function barOf(browser: Browser, baseURL: string, path: string, width: number, javaScriptEnabled: boolean): Promise<Bar> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: 900 },
    javaScriptEnabled,
    serviceWorkers: 'block',
  })

  try {
    const page = await context.newPage()
    await page.goto(path)

    if (javaScriptEnabled) await barBooted(page)

    return await readBar(page)
  }
  finally {
    await context.close()
  }
}

for (const code of localeCodes()) {
  for (const width of WIDTHS) {
    const path = localeUrl(ADDRESS, code)

    test(`${path} at ${width} px: the bar the server wrote is the bar hydrated`, async ({ browser, baseURL }) => {
      if (baseURL === undefined) throw new Error('no baseURL')

      const served = await barOf(browser, baseURL, path, width, false)
      const booted = await barOf(browser, baseURL, path, width, true)

      // The other side: the links that follow the coins are the ones a missing box moves,
      // and with none of them read the comparison below agrees about nothing.
      expect(
        [NAV_RULES, NAV_SETTINGS].map(link => localeUrl(link.to, code)).filter(address => served.links[address] === undefined),
        'links that follow the coins and are not in the bar the server wrote',
      ).toEqual([])
      expect(booted.coins, 'the hydrated bar has no coins link to compare').not.toBeNull()

      expect.soft(served.height, 'the bar changes height when the page hydrates').toBe(booted.height)
      expect.soft(
        Object.fromEntries(Object.keys(served.links).map(address => [address, booted.links[address]])),
        'links of the bar that move when the page hydrates',
      ).toEqual(served.links)

      expect(served.coins, 'the bar the server wrote reserves no box for the coins').not.toBeNull()
      expect(served.coins?.width, 'the box reserved for the coins is empty').toBeGreaterThan(0)
      expect(served.coins, 'the box reserved for the coins is not the box of the link').toEqual(booted.coins)
    })
  }
}

/** The bar is there once the client has it whole: hydrated, the coins in, the account known. */
async function barBooted(page: Page): Promise<void> {
  await hydrated(page)
  await expect(page.locator('a.nav__coins'), 'the coins link is not in the hydrated bar').toBeVisible()
  // The account is the last thing the bar learns: read after it, the bar is done.
  await expect(page.locator('.nav .account')).toBeVisible()
}

interface Shift {
  /** When it happened, on the page's clock. */
  readonly at: number
  /** What moved that is not a piece of the page's own content, in words. */
  readonly outside: readonly string[]
}

/**
 * How long the test holds the stylesheet back, in milliseconds.
 *
 * A preloaded face is only of use if it is in before the page can paint, and the
 * page can paint once its stylesheet is in. On a network the two are fetched
 * side by side and the faces, 20 KB, are there first or close enough; on
 * `localhost` nothing takes any time, and which came first was the machine's
 * business: with nothing held back the good build failed 2 times in 40 with the
 * suite's own six workers, and 18 in 40 with every core taken. So the test gives
 * the faces the head start a network gives them, and asks what is left to ask:
 * whether, being there, they are what the first paint is drawn with. Held back,
 * no load of the good build had the bar move, in some 400 of them with the
 * machine free and with it saturated — where a page that cannot hydrate in time
 * fails on the test's timeout, which is another matter —, and every load of the
 * build with no preload did, 80 in 80.
 */
const HEAD_START = 300

for (const code of localeCodes()) {
  const path = localeUrl(ADDRESS, code)

  /**
   * **What moved, and whose doing it was.** When the bar changes — its height, or
   * the width of one of its items — what moves is the bar's own pieces and the
   * block that comes after it, whole: painted in the fallback and then in its own
   * faces, that block goes from 217 px down the page to 160. Each shift names the
   * nodes that moved, and the test fails on any that is not strictly inside that
   * block.
   *
   * It does not ask for no shift at all, and that is measured, not given up. The
   * body's faces are not preloaded and still swap: a cold load of this page moves
   * two lines of its text by a pixel in pt-BR, and one by a line in English.
   * That is inside the block, the price of preloading two faces and not four,
   * and how much it comes to depends on the fallback the machine has — a ceiling
   * on the sum would be a number about this machine.
   *
   * **Every shift counts, whatever `hadRecentInput` says.** The filter the metric
   * uses drops what follows a touch, and a probe that applied it read zero on a
   * page that jumped. Nobody touches this page.
   *
   * **The absence is read after a witness.** A shift reaches the observer after
   * the frame it happened in, and the test after that, so a list read once the
   * fonts are in can be empty because it is early. The test moves the bar itself
   * — 120 px, put in front of everything — and reads the list once that shift is
   * in it: they come in the order they happened, so whatever came before is the
   * page's, and a probe that sees nothing fails on the witness instead of
   * passing.
   */
  test(`${path} at 430 px: a cold load does not move the bar, nor the page under it`, async ({ browser, baseURL }) => {
    if (baseURL === undefined) throw new Error('no baseURL')

    const context = await browser.newContext({ baseURL, viewport: { width: 430, height: 932 }, serviceWorkers: 'block' })

    try {
      const page = await context.newPage()

      const shifts: Shift[] = []
      await page.exposeFunction('reportShift', (at: number, outside: string[]) => {
        shifts.push({ at, outside })
      })
      await page.addInitScript(() => {
        /** A `layout-shift` entry's sources, read field by field: the DOM typings do not have them. */
        const sourcesOf = (entry: PerformanceEntry): { node: Node | null, from: DOMRectReadOnly, to: DOMRectReadOnly }[] => {
          const sources: unknown = Reflect.get(entry, 'sources')
          if (!Array.isArray(sources)) return []

          return sources.flatMap((source: unknown) => {
            if (typeof source !== 'object' || source === null) return []

            const node: unknown = Reflect.get(source, 'node')
            const from: unknown = Reflect.get(source, 'previousRect')
            const to: unknown = Reflect.get(source, 'currentRect')
            if (!(from instanceof DOMRectReadOnly) || !(to instanceof DOMRectReadOnly)) return []

            return [{ node: node instanceof Node ? node : null, from, to }]
          })
        }

        new PerformanceObserver((list) => {
          const content = document.querySelector('header.nav')?.nextElementSibling ?? null
          const report: unknown = Reflect.get(window, 'reportShift')
          if (typeof report !== 'function') throw new Error('the page has nobody to report a shift to')

          for (const entry of list.getEntries()) {
            const sources = sourcesOf(entry)
            const outside = sources.flatMap(({ node, from, to }) => {
              if (node !== null && content !== null && node !== content && content.contains(node)) return []

              const name = node instanceof Element ? `${node.localName}.${node.classList.item(0) ?? ''}` : node?.nodeName ?? 'a node that is gone'
              return [`${name}, from ${from.x},${from.y} to ${to.x},${to.y}`]
            })

            Reflect.apply(report, window, [entry.startTime, sources.length === 0 ? ['a shift that names no node'] : outside])
          }
        }).observe({ type: 'layout-shift', buffered: true })
      })

      await page.route('**/_nuxt/*.css', async (route) => {
        await new Promise(resolve => setTimeout(resolve, HEAD_START))
        await route.continue()
      })

      await page.goto(path)
      await barBooted(page)
      await page.evaluate(() => document.fonts.ready.then(() => undefined))

      const planted = await page.evaluate(() => {
        const block = document.createElement('div')
        block.style.height = '120px'
        document.body.prepend(block)

        return performance.now()
      })
      await expect.poll(
        () => shifts.filter(shift => shift.at >= planted && shift.outside.length > 0).length,
        { message: 'the probe did not see the bar pushed down in front of it: an empty list proves nothing' },
      ).toBeGreaterThan(0)

      expect(
        shifts.filter(shift => shift.at < planted).flatMap(shift => shift.outside),
        'what moved while the page loaded that is not a piece of its content',
      ).toEqual([])
    }
    finally {
      await context.close()
    }
  })
}

const PUBLIC = join(REPO_ROOT, '.output/public')

/**
 * The faces of the bar: what a page with the bar preloads, and all it does.
 *
 * By family and weight, as the built CSS spells them, and not by file: the
 * file's name is a hash that changes with the family's version, and a list of
 * hashes here would only ever agree with the list in `AppNav.vue`.
 */
const BAR_FACES: readonly string[] = ['Chakra Petch 600', 'Chakra Petch 700']

const EARLY_FONT = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="font")[^>]*>/g

/** The address of each font a document preloads. */
function earlyFonts(html: string): string[] {
  return (html.match(EARLY_FONT) ?? []).map(tag => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? tag)
}

/**
 * Each font file of the build, by the address a page asks for it at, with the
 * faces it is: the family, the weight and `italic` when it is one, read from the
 * `@font-face` rules of the built CSS. A variable file serves two weights and has
 * two names.
 */
function builtFaces(): Map<string, string[]> {
  const faces = new Map<string, string[]>()
  const sheets = readdirSync(join(PUBLIC, '_nuxt')).filter(name => name.endsWith('.css'))

  for (const sheet of sheets) {
    const css = readFileSync(join(PUBLIC, '_nuxt', sheet), 'utf8')

    for (const [, rule = ''] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const value = (property: string): string => (
        new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule)?.[1]?.trim().replaceAll(/["']/g, '') ?? ''
      )
      const file = /url\(["']?[^)"']*\/(_fonts\/[^)"']+)["']?\)/.exec(rule)?.[1]
      // A fallback face is a local font with adjusted metrics: there is no file to preload.
      if (file === undefined) continue

      const name = `${value('font-family')} ${value('font-weight')}${value('font-style') === 'italic' ? ' italic' : ''}`
      faces.set(`/${file}`, [...faces.get(`/${file}`) ?? [], name])
    }
  }

  return faces
}

/** What a preloaded address is, in words a failure can be read by. */
function faceName(faces: ReadonlyMap<string, readonly string[]>, address: string): string {
  return faces.get(address)?.join(' / ') ?? `${address}, which is no face of the built CSS`
}

/** The page as the build wrote it, in each language. */
function builtPages(): { route: string, html: string }[] {
  return pageAddresses().flatMap(address => localeCodes().map((code) => {
    const route = localeUrl(address, code)

    return { route, html: readFileSync(join(PUBLIC, route, 'index.html'), 'utf8') }
  }))
}

test('a page preloads the faces of the bar when it has the bar, and no face when it does not', () => {
  expect(existsSync(PUBLIC), '.output/public does not exist — run `yarn build` first').toBe(true)

  const faces = builtFaces()
  const named = [...faces.values()].flat()
  // The other side: with no face read from the CSS, every address below is unknown and
  // the comparison fails for the wrong reason — and a name nothing is called passes nowhere.
  expect(BAR_FACES.filter(face => !named.includes(face)), 'faces of the bar that the built CSS does not declare').toEqual([])

  const pages = builtPages()
  const withBar = pages.filter(({ html }) => /<header\b[^>]*\bclass="nav"/.test(html))
  // Both kinds have to be there, or one half of the rule is asked of no page.
  expect(withBar.length, 'no built page has the bar').toBeGreaterThan(0)
  expect(pages.length - withBar.length, 'every built page has the bar: nothing checks a page without it').toBeGreaterThan(0)

  const problems = pages.flatMap(({ route, html }) => {
    const early = earlyFonts(html).map(address => faceName(faces, address)).sort()
    const expected = withBar.some(page => page.route === route) ? [...BAR_FACES].sort() : []

    return early.join() === expected.join()
      ? []
      : [`${route} preloads [${early.join(', ')}], and it should preload [${expected.join(', ')}]`]
  })

  expect(problems).toEqual([])
})

for (const { route, html } of existsSync(PUBLIC) ? builtPages() : []) {
  /**
   * The page with its font preloads taken out and JavaScript off asks for the
   * faces its first paint needs, and for nothing else: what it preloads has to be
   * among them. A preload of anything else — another subset of the same weight,
   * a weight the page stopped using — is a download ahead of everything for a
   * file nobody draws with, and its name alone would not say so.
   */
  test(`${route}: every face it preloads is one it asks for by itself`, async ({ browser, baseURL }) => {
    if (baseURL === undefined) throw new Error('no baseURL')

    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, serviceWorkers: 'block' })

    try {
      const page = await context.newPage()
      const asked = new Set<string>()
      page.on('request', (request) => {
        const { pathname } = new URL(request.url())
        if (pathname.startsWith('/_fonts/')) asked.add(pathname)
      })
      let rewritten = 0
      await page.route(route, async (document) => {
        const response = await document.fetch()
        rewritten += 1
        await document.fulfill({ response, body: (await response.text()).replaceAll(EARLY_FONT, '') })
      })

      await page.goto(route)
      await page.evaluate(() => document.fonts.ready.then(() => undefined))

      // The other side, twice. A page that did not come through the route above still
      // has its preloads, and each of them is a request for the face: all of them "used".
      expect(rewritten, 'the page was not served through the test, so its preloads were never taken out').toBe(1)
      // And a spy that saw no font would call every preload unused.
      expect(asked.size, 'the page asked for no font at all').toBeGreaterThan(0)

      const faces = builtFaces()
      expect(
        earlyFonts(html).filter(address => !asked.has(address)).map(address => faceName(faces, address)),
        'faces the page preloads and does not use',
      ).toEqual([])
    }
    finally {
      await context.close()
    }
  })
}
