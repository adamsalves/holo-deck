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

/** The icons the board *O ícone do app* sends to the manifest: 192 and 512, each for both purposes. */
const BOARD_ICONS = ['192x192 any', '192x192 maskable', '512x512 any', '512x512 maskable']

interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose: string
}

function isIcon(value: unknown): value is ManifestIcon {
  return typeof value === 'object' && value !== null
    && 'src' in value && typeof value.src === 'string'
    && 'sizes' in value && typeof value.sizes === 'string'
    && 'type' in value && typeof value.type === 'string'
    && 'purpose' in value && typeof value.purpose === 'string'
}

/** A PNG's width, height and color type, from its header — `IHDR` is always the first chunk. */
function imageHeader(body: Buffer): { size: string, colorType: number } {
  expect(body.subarray(0, 8).toString('hex'), 'not a PNG').toBe('89504e470d0a1a0a')
  expect(body.subarray(12, 16).toString('latin1'), 'the first chunk is not IHDR').toBe('IHDR')

  return { size: `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`, colorType: body.readUInt8(25) }
}

/**
 * **The game installs as the board draws it** — the manifest's name, colours
 * and icons, read as a browser gets them.
 *
 * The icons checked are the ones the manifest lists, and the set of sizes and
 * purposes is held against the board's: an icon dropped from the list, or one
 * listed as `"any maskable"`, changes the set. Each file has to be the size it
 * claims, and opaque — a maskable icon shows whatever lies under the mask, and
 * a transparent corner would show the launcher's colour through the deck's
 * background.
 */
test('the manifest installs the game with the board\'s name, colours and icons', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"][href^="http"]')).toHaveCount(1)

  const links = page.locator('link[rel="manifest"]')
  await expect(links).toHaveCount(1)

  const response = await request.get(await links.getAttribute('href') ?? '')
  expect(response.status()).toBe(200)

  const manifest: unknown = await response.json()
  expect(manifest).toMatchObject({
    name: 'Holo Deck',
    short_name: 'Holo Deck',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0D14',
    theme_color: '#0B0D14',
  })

  const listed: unknown = typeof manifest === 'object' && manifest !== null && 'icons' in manifest ? manifest.icons : []
  const icons = (Array.isArray(listed) ? listed : []).filter(isIcon)
  expect(icons.map(icon => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(BOARD_ICONS)

  for (const icon of icons) {
    const file = await request.get(icon.src)
    expect(file.status(), `${icon.src} is not served`).toBe(200)
    expect(file.headers()['content-type'], icon.src).toBe(icon.type)

    // Color type 2 is RGB with no alpha channel at all.
    expect(imageHeader(await file.body()), icon.src).toEqual({ size: icon.sizes, colorType: 2 })
  }
})
