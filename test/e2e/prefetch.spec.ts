import { expect, test, type Page } from '@playwright/test'
import { localeCodes, localeUrl } from '../support/locales'

/**
 * **What a page fetches that nobody asked for yet.** A `NuxtLink` the browser can
 * see is watched, and Nuxt fetches the target's `_payload.json` before the link is
 * clicked — the data of a prerendered page, so the click finds it. It is the right
 * thing for a card that the player is about to open, and the wrong one for a link
 * that sits on every page: the coins in the bar pointed at `/packs`, whose payload
 * is 156 KB raw, and every first load of a screen with the bar paid for it.
 *
 * The test asks it of a screen with no cards, `/rules`, where nothing in the body
 * links anywhere: **what it prefetches is the bar's doing, and the list below is
 * what it may.** The bar's links are `custom`, which Nuxt does not watch, so only
 * the coins link and any link added to the bar later are in play — and one that
 * starts to prefetch is a name nobody listed, which fails here by its address.
 *
 * **Both sides are asked of the same instrument.** On `/rules` the spy has to
 * have seen the page's own payload, or an empty answer is a spy that watched
 * nothing; and on a grid of cards — `/pokedex/1` — the payloads of the species
 * have to come in, because the cards are still prefetched on purpose: the cards
 * are what the player opens next, and the decision of issue #14 was to leave them
 * on `visibility`.
 */

/**
 * The payloads a screen with no cards may prefetch, by route — none today. A
 * route goes here with the reason beside it, and as a decision of the PR that adds
 * it: this is a list of what the bar is allowed to cost, not of what it happens to.
 */
const ALLOWED_WITHOUT_CARDS: readonly string[] = []

const PAYLOAD = '_payload.json'

/**
 * Every payload the page asks for while it settles, by path — its own included,
 * which it asks for itself with a `<link rel="preload">`.
 *
 * "Settled" is not a timer. The app is up when the client-only coins link is on
 * screen; Nuxt starts watching a link in an idle callback after that, and the
 * observer answers on a frame — both let through before the network is asked to
 * be quiet.
 */
async function payloadsAsked(page: Page, path: string): Promise<string[]> {
  const asked = new Set<string>()
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.endsWith(`/${PAYLOAD}`)) asked.add(pathname)
  })

  await page.goto(path)
  await expect(page.locator('.nav__coins')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestIdleCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }))
  await page.waitForLoadState('networkidle')

  return [...asked].sort()
}

for (const code of localeCodes()) {
  const rules = localeUrl('/rules', code)

  test(`${rules} prefetches the payloads the list allows, and no other`, async ({ page }) => {
    const asked = await payloadsAsked(page, rules)
    const own = `${rules}/${PAYLOAD}`

    // The other side: a spy that saw nothing would agree with any list.
    expect(asked, `the spy did not see the page's own payload, ${own}`).toContain(own)

    expect(
      asked.filter(address => address !== own),
      'payloads prefetched on a screen with no cards: an allowed one is a decision, in ALLOWED_WITHOUT_CARDS',
    ).toEqual(ALLOWED_WITHOUT_CARDS.map(route => `${localeUrl(route, code)}/${PAYLOAD}`).sort())
  })
}

test('the cards of a grid are still prefetched, on purpose', async ({ page }) => {
  const asked = new Set<string>()
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/^\/pokemon\/[^/]+\/_payload\.json$/.test(pathname)) asked.add(pathname)
  })

  await page.goto('/pokedex/1')
  // The cards are watched once the app is up; the grid shrinking from the 151 the
  // server sent to the few the virtualizer keeps is the first sign of it.
  await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)

  await expect.poll(() => asked.size, { message: 'no species payload was prefetched from the grid' }).toBeGreaterThan(0)
})
