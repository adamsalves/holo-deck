import { expect, test, type Page } from '@playwright/test'
import { defaultLocale, label } from '../support/locales'
import { ICON_REQUEST, iconProblems } from './support'

/**
 * **The search palette draws its icons, at every step, without asking the
 * network for one.**
 *
 * Its six icons — the field's, the close button's, the loading one, and the three
 * it keeps for a selected row, a group and the way back — were asked of the
 * server's icon route, and of a public API behind it, on the first opening:
 * requests nothing in the suite watched, and a blank square where the glyph goes
 * when one fails. They are files of the repository now (`app/assets/icons/lucide/`),
 * embedded in the code by `nuxt.config.ts`.
 *
 * **Two things are asked at each step, from two sources.** The requests are the
 * browser's own — every one whose address looks like an icon's; the pictures are
 * the page's — each `.iconify` span that is on screen has to carry a `mask-image`.
 * A check of the first alone passes with an icon that never loaded, and one of the
 * second alone passes with an icon fetched in the background. The icons the step
 * draws are asked for **by name**, so a page with no icon at all fails too.
 *
 * The same palette offline, on its first opening, is in `offline.spec.ts`.
 */

/**
 * Waits for the icons a step draws, and for no icon on screen to be a blank
 * square: they are asked of the page as it settles, since the picture of an icon
 * is written by the module a tick after its span is.
 */
async function expectIcons(page: Page, step: string, names: readonly string[]): Promise<void> {
  await expect.poll(() => iconProblems(page, names), { message: `the icons ${step}` }).toEqual({ missing: [], bare: [] })
}

test('the search palette draws its icons at every step, and asks the network for none', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (ICON_REQUEST.test(request.url())) asked.push(request.url())
  })

  // The index is held back, so the palette is on screen *while it loads* and the
  // loading icon — the one a fast machine would show for a few milliseconds — is
  // drawn long enough to be asked about.
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/data/index.json*', async (route) => {
    await held
    await route.continue()
  })

  await page.goto('/pokedex/1')
  // The shortcut and the trigger work after hydration, which the grid shrinking
  // from the 151 the server sent to the few the virtualizer keeps is the first
  // sign of — see the search test of `pokedex.spec.ts`.
  await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)

  await page.locator('.dex-search__trigger').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectIcons(page, 'while the index loads', ['i-lucide:loader-circle', 'i-lucide:x'])

  release()
  await expect(dialog.getByRole('option').first()).toBeVisible()
  await expectIcons(page, 'once the index is in', ['i-lucide:search', 'i-lucide:x'])

  const field = dialog.getByPlaceholder(label('dex.search.placeholder', defaultLocale()))
  await field.fill('char')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expectIcons(page, 'after typing and the arrow keys', ['i-lucide:search', 'i-lucide:x'])

  await field.fill('zzzzzz')
  await expect(dialog.getByRole('option')).toHaveCount(0)
  await expectIcons(page, 'with no result', ['i-lucide:search', 'i-lucide:x'])

  // Closed and opened again: the second opening draws from what the first left.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.locator('.dex-search__trigger').click()
  await expect(dialog).toBeVisible()
  await expectIcons(page, 'on the second opening', ['i-lucide:search', 'i-lucide:x'])

  await field.fill('gengar')
  await dialog.getByRole('option', { name: /Gengar/ }).first().click()
  await expect(page).toHaveURL(/\/pokemon\/gengar$/)

  expect(asked, 'the palette asked the network for an icon').toEqual([])
})

/**
 * The two instruments, asked about what they exist to see — the other side of
 * the test above. A spy that watches nothing and an icon reader that cannot say
 * *blank* both report a clean page.
 */
test('the request spy and the icon reader can see a defect when there is one', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (ICON_REQUEST.test(request.url())) asked.push(request.url())
  })

  // A page with no palette, so nothing of the page's own gets in the way.
  await page.goto('/rules')

  // One request of each shape the spy looks for — the server's route, the public
  // API, the address built with no endpoint —, each spelled so that only its own
  // alternative of `ICON_REQUEST` matches it: one address that matched two would
  // go on being seen with either of them gone.
  const shapes = [
    '/api/_nuxt_icon/ph.json?icons=star',
    'https://api.iconify.design/ph.json?icons=star',
    'undefined/lucide.json?icons=search',
  ].map(shape => new URL(shape, page.url()).href)
  await page.route(url => shapes.includes(url.href), route => route.fulfill({ status: 204 }))
  for (const shape of shapes) {
    await page.evaluate(address => fetch(address, { mode: 'no-cors' }).then(() => undefined, () => undefined), shape)
  }
  expect(asked, 'the spy did not see every shape of request it exists to see').toEqual(shapes)

  await page.evaluate(() => {
    const span = document.createElement('span')
    span.className = 'iconify i-lucide:not-embedded'
    document.body.append(span)
  })
  expect(await iconProblems(page, ['i-lucide:not-embedded'])).toEqual({
    missing: ['i-lucide:not-embedded'],
    bare: ['i-lucide:not-embedded'],
  })
})
