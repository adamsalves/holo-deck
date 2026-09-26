import { expect, test } from '@playwright/test'
import { localeCodes, localeUrl } from '../support/locales'
import { pageAddresses } from '../support/source-tree'
import { saveWith, seedLocalSave } from './support'

/**
 * Every page has one `<main>`, and one `<h1>` inside it — in every language.
 *
 * A screen reader user lands on a page by its `<main>` and learns where they are
 * from its `<h1>`. Measured on 26/09/2026 against the build of `main`, `/deck`,
 * `/league` and the battle had no `<main>`, and two screens had no `<h1>`: the
 * Hub, and the battle **while it is being fought** — its four `<h1>` lived in the
 * exits. Lighthouse, run on the Hub, the deck and the battle, reported the two
 * missing `<main>` and neither missing heading.
 *
 * The pages come from the disk, so a page added later is measured the day it is
 * written.
 */

/**
 * Six cards, all common: a team the battle can start with, and no invite — a
 * card above rare, or a badge, would open the dialog on the Hub.
 *
 * **The battle is the one page whose landing depends on the save.** Without a
 * team it lands on an exit, and every exit has had its `<h1>` since Phase 4: the
 * gate would count those and stay green over a fight with no heading at all.
 */
const TEAM = [1, 4, 7, 10, 16, 25]

const ADDRESSES = pageAddresses()

test('there are pages to measure, in more than one language', () => {
  // The other side of the loop below: no pages, no measurement.
  expect(ADDRESSES.length).toBeGreaterThan(10)
  expect(localeCodes().length).toBeGreaterThan(1)
})

for (const code of localeCodes()) {
  for (const address of ADDRESSES) {
    const target = localeUrl(address, code)

    test(`${target} has one main, and its one h1 is inside it`, async ({ page, baseURL }) => {
      await seedLocalSave(page, saveWith({
        collection: Object.fromEntries(TEAM.map(id => [id, { c: 1, s: 0 }])),
        deck: TEAM,
      }))
      // Structure does not depend on another host, and waiting for one would
      // make the barrier below as slow as the slowest of them.
      if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
      const origin = new URL(baseURL).origin
      await page.route(url => url.origin !== origin, route => route.abort())

      await page.goto(target)

      // **The client's render is counted too, not only the server's.** Most
      // screens draw what depends on the save inside `<ClientOnly>`, so a second
      // heading drawn there does not exist when the page loads — counted then, it
      // would pass. Nothing is left to render once the network is quiet.
      await page.waitForLoadState('networkidle')

      if (address.startsWith('/battle/')) {
        await expect(page.locator('.combatant'), 'the battle is being fought').toHaveCount(2)
      }

      const main = page.getByRole('main')
      await expect(main, `${target} has one main`).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 }), `${target} has one h1`).toHaveCount(1)
      await expect(main.getByRole('heading', { level: 1 }), `the h1 of ${target} is inside main`)
        .toHaveAccessibleName(/\S/)
    })
  }
}
