import { expect, test } from '@playwright/test'

/**
 * The app's icons as the head names them once the app has booted — one link
 * each, whatever the server wrote.
 *
 * The server writes the SVG's address from the root and the client from the
 * bundle's own URL, absolute: two hrefs for one file. unhead tells links apart
 * by the href, and without the `key` in `app.vue` it kept both — measured on the
 * preview of PR #68, where the booted page named the SVG twice. Read from the
 * built HTML, the head is right either way; only a browser shows the second tag.
 */
test('the head names each of the app\'s icons once, after the app boots', async ({ page }) => {
  await page.goto('/')

  // The client's href is absolute: once a link carries it, the client has taken
  // the head over, and a second tag would have arrived with it.
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"][href^="http"]')).toHaveCount(1)

  // Every link whose rel names an icon, not only the two rels `app.vue` writes:
  // a third kind — `shortcut icon`, `mask-icon` — would slip past a list of two.
  const named = await page.locator('link[rel*="icon" i]').evaluateAll(links => links.map((link) => {
    const path = new URL(link.getAttribute('href') ?? '', location.href).pathname

    return `${link.getAttribute('rel') ?? ''} ${path.replace(/\.[\w-]+\.svg$/, '.svg')}`
  }))

  expect(named.sort()).toEqual([
    'apple-touch-icon /apple-touch-icon.png',
    'icon /_nuxt/app-icon.svg',
    'icon /favicon.ico',
  ])
})

/**
 * The bar's brand reads `HOLO/DECK`, one word, as every board writes it. The
 * link is a flex row with an 11 px gap, and the name loose in it was three
 * items — `HOLO`, the slash and `DECK` — with the gap between them, on screen
 * and in the link's accessible name. `offline.spec.ts` finds the link by this
 * name too, but inside the worker's suite, where losing it reads as a timeout.
 */
test('the bar writes HOLO/DECK as one word, as the boards do', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.nav__brand')).toHaveAccessibleName('HOLO/DECK')
})
