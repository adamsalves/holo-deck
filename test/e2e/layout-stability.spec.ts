import { expect, test, type Browser, type Page } from '@playwright/test'
import { NAV_RULES, NAV_SETTINGS } from '../../app/utils/nav-links.ts'
import { localeCodes, localeUrl } from '../support/locales'
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

    if (javaScriptEnabled) {
      await hydrated(page)
      await expect(page.locator('a.nav__coins'), 'the coins link is not in the hydrated bar').toBeVisible()
      // The account is the last thing the bar learns: read after it, the bar is done.
      await expect(page.locator('.nav .account')).toBeVisible()
    }

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
