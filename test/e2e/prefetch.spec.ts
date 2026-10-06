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
 * The test asks it of a screen with no cards, `/settings`, whose body has one
 * link that is prefetched on purpose — the language selector's, to the same page
 * in each other language. **Whatever else it prefetches is the bar's doing, and
 * the list below is what the bar may.** The bar's links are `custom`, which Nuxt
 * does not watch, so only the coins link and any link added to the bar later are
 * in play — and one that starts to prefetch is a name nobody listed, which fails
 * here by its address.
 *
 * **Both sides are asked of the same instrument, and the good one first.** The
 * selector's payloads have to come in before the list is read — they are the
 * witness of `payloadsAsked`, below — and the page's own has to be in it. And on
 * a grid of cards — `/pokedex/1` — the payloads of the species have to come in,
 * because the cards are still prefetched on purpose: the cards are what the
 * player opens next, and the decision of issue #14 was to leave them on
 * `visibility`.
 */

/**
 * The payloads the bar may prefetch, by route — none today. A route goes here
 * with the reason beside it, and as a decision of the PR that adds it: this is a
 * list of what the bar is allowed to cost, not of what it happens to.
 */
const ALLOWED_FROM_THE_BAR: readonly string[] = []

const PAYLOAD = '_payload.json'

/** One idle callback, then two frames: what was queued before the call has run. */
function idleThenPainted(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => {
    requestIdleCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }))
}

/**
 * Every payload the page has asked for by the time the `witnesses` came in, by
 * path — its own included, which it asks for itself with a `<link rel="preload">`.
 *
 * **An absence is read after a witness, and not after a wait.** A link's payload
 * comes at the end of a chain: an idle callback once the app is up, another of
 * the link's own, the observer's answer after a frame, and the app manifest over
 * the network. How long that takes is the machine's business. This used to read
 * the list once the network had been quiet, and `waitForLoadState('networkidle')`
 * answers at once when that already happened while the page was still hydrating:
 * with the coins link prefetching again and the page's CPU slowed ten times, the
 * list was read before the payload was asked for and the test passed, 8 times in
 * 20; slowed twenty times, 20 in 20.
 *
 * So it waits for payloads that only come out of that same chain, from links of
 * the page's body. Every link waits on the one manifest, so the bar's request
 * leaves within milliseconds of the witness's — ahead of it, in every run
 * measured. The two rounds that follow are for the day it comes behind: what is
 * left of a link's way once the manifest is in is an idle callback, the
 * observer's frame and a task, and the second round only begins with the page
 * idle again. With the defect planted it failed 10 times in 10 with the CPU
 * slowed ten times and twenty, and 40 in 40 under real load, where the old wait
 * passed; the good build passed them all.
 */
async function payloadsAsked(page: Page, path: string, witnesses: readonly string[]): Promise<string[]> {
  const asked = new Set<string>()
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.endsWith(`/${PAYLOAD}`)) asked.add(pathname)
  })

  await page.goto(path)
  // The link whose prefetch is denied has to be on screen to be denied.
  await expect(page.locator('.nav__coins')).toBeVisible()

  await expect.poll(
    () => witnesses.filter(witness => !asked.has(witness)),
    { message: 'the language selector did not prefetch the page in its other languages: with no witness, an empty list proves nothing' },
  ).toEqual([])
  await idleThenPainted(page)
  await idleThenPainted(page)

  return [...asked].sort()
}

for (const code of localeCodes()) {
  const settings = localeUrl('/settings', code)

  test(`${settings} prefetches itself in the other languages, and from the bar only what the list allows`, async ({ page }) => {
    const own = `${settings}/${PAYLOAD}`
    const twins = localeCodes()
      .filter(other => other !== code)
      .map(other => `${localeUrl('/settings', other)}/${PAYLOAD}`)
    // With one language the selector links nowhere else, and there is no witness.
    expect(twins.length).toBeGreaterThan(0)

    const asked = await payloadsAsked(page, settings, twins)

    // The other side: a spy that saw nothing would agree with any list.
    expect(asked, `the spy did not see the page's own payload, ${own}`).toContain(own)

    expect(
      asked.filter(address => address !== own && !twins.includes(address)),
      'payloads prefetched from the bar: an allowed one is a decision, in ALLOWED_FROM_THE_BAR',
    ).toEqual(ALLOWED_FROM_THE_BAR.map(route => `${localeUrl(route, code)}/${PAYLOAD}`).sort())
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
