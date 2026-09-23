import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import * as uiLocales from '@nuxt/ui/locale'
import { LOCALE_KEY, ROOT_GUARD_ID } from '../../app/utils/locale-preference.ts'
import { LOCALES } from '../../app/utils/locales.ts'
import { defaultLocale, label, localeUrl } from '../support/locales.ts'
import { navLabel, pathPattern } from './support.ts'

/**
 * The language selector in *Settings*, the root that follows it, and what does
 * not follow it — decided in the 4d plan (21/09/2026): **the choice is
 * remembered on this device, and it applies at the root only.**
 *
 * The disk half is `test/e2e/locale-head.spec.ts`, which reads the head of every
 * built page. What only a browser can say is here: that the root is sent on
 * before it paints, that the guard does not come back on a client-side
 * navigation, and that the head follows a language switched without a reload.
 */

/** The selector, found by the name its group carries in `code`. */
function selector(page: Page, code: string) {
  return page.getByRole('group', { name: label('settings.prefs.languageTitle', code), exact: true })
}

/** The segment of the selector that leads to `code`, as the board labels it. */
function segment(page: Page, from: string, to: string) {
  return selector(page, from).getByRole('link', { name: to.toUpperCase(), exact: true })
}

/** What this device remembers — `null` when nothing was chosen. */
function remembered(page: Page): Promise<string | null> {
  return page.evaluate(key => window.localStorage.getItem(key), LOCALE_KEY)
}

type Language = (typeof LOCALES)[number]

/** The root's language — found by code, not assumed to be first in the list. */
function rootLanguage(): Language {
  const root = LOCALES.find(locale => locale.code === defaultLocale())
  if (root === undefined) throw new Error(`the default locale ${defaultLocale()} is not in the list`)

  return root
}

/** A language of the game that is not the root's. */
function otherLanguage(): Language {
  const other = LOCALES.find(locale => locale.code !== defaultLocale())
  if (other === undefined) throw new Error('the game speaks one language: nothing to switch to')

  return other
}

/** Chooses `to` through the selector, starting from `/settings` in `from`. */
async function choose(page: Page, from: string, to: string): Promise<void> {
  await page.goto(localeUrl('/settings', from))
  await segment(page, from, to).click()
  await expect(page).toHaveURL(pathPattern(localeUrl('/settings', to)))
}

test('the selector moves this page to each language, and the document goes with it', async ({ page }) => {
  // The other side of the loop: one language has nowhere to go.
  expect(LOCALES.length).toBeGreaterThan(1)

  await page.goto(localeUrl('/settings', defaultLocale()))

  // Every language, in the order the board draws them — and nothing chosen yet.
  await expect(selector(page, defaultLocale()).getByRole('link'))
    .toHaveText(LOCALES.map(locale => locale.code.toUpperCase()))
  expect(await remembered(page)).toBeNull()

  // Away through every other language, and back to the root's: every click is a
  // client-side navigation, which is the case the prerendered head cannot show.
  const tour = [...LOCALES.filter(locale => locale.code !== defaultLocale()), rootLanguage()]
  let from = defaultLocale()

  for (const target of tour) {
    await segment(page, from, target.code).click()

    await expect(page).toHaveURL(pathPattern(localeUrl('/settings', target.code)))
    await expect(page.locator('html')).toHaveAttribute('lang', target.language)
    await expect(page.locator('link[rel="canonical"]'))
      .toHaveAttribute('href', new RegExp(`^https://[^/]+${localeUrl('/settings', target.code)}$`))

    // The segment of the language on screen is the current one, and only it.
    await expect(selector(page, target.code).locator('[aria-current="page"]'))
      .toHaveText(target.code.toUpperCase())
    expect(await remembered(page), `after choosing ${target.code}`).toBe(target.code)

    from = target.code
  }
})

/**
 * A click that opens the other language somewhere else is not a choice.
 *
 * With a modifier the segment opens the page in a new tab and leaves this one
 * where it was — the player looked, and did not choose. Remembered, that look
 * would become the language the root opens in from then on.
 *
 * **Two barriers, one on each side of the click.** Before it, hydration: the
 * segment is served markup until then, a click on it runs no handler at all,
 * and a modified click landing that early would remember nothing whatever the
 * code says — this test would pass over the defect. A plain click on the
 * language already on screen is a real choice that records only once the
 * handler exists, so it is retried until it does. After the modified click,
 * the new tab: the browser opens it once the click's handlers have run.
 */
test('a click that opens the other language in a new tab is not a choice', async ({ page, context }) => {
  const root = defaultLocale()
  const other = otherLanguage()

  await page.goto(localeUrl('/settings', root))

  await expect(async () => {
    await segment(page, root, root).click()
    expect(await remembered(page)).toBe(root)
  }).toPass({ timeout: 15_000 })

  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    segment(page, root, other.code).click({ modifiers: ['ControlOrMeta'] }),
  ])

  await expect(opened).toHaveURL(pathPattern(localeUrl('/settings', other.code)))
  await expect(page).toHaveURL(pathPattern(localeUrl('/settings', root)))
  expect(await remembered(page), 'a look in a new tab is not a choice').toBe(root)
})

/**
 * Before it paints — measured, not inferred from the script being first in the
 * head.
 *
 * Every document records that it started and, if it gets there, that it painted
 * text. The root's document has to start and never paint: a guard written as a
 * plugin — which is what the plan refused — runs after the prerendered Hub has
 * been drawn in Portuguese, and the root would show up among the painted.
 *
 * **The answer for the other language is held back, as a real network would.**
 * What keeps the Hub from painting is where the guard sits: from the `<head>`,
 * the navigation stops the parser before there is a `<body>`. Written at the end
 * of the body instead, the screen is already parsed when it runs — and on
 * localhost the answer still arrives before a paint, so that defect passed this
 * test five runs out of five. Held back 600 ms, it failed five out of five.
 */
test('the root opens in the remembered language, without painting the other one', async ({ page }) => {
  const other = otherLanguage()

  await choose(page, defaultLocale(), other.code)

  await page.route(url => url.pathname === localeUrl('/', other.code), async (route) => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.continue()
  })

  await page.addInitScript(() => {
    const note = (key: string): void => {
      const seen: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? '[]')
      const list = Array.isArray(seen) ? seen.map(String) : []
      window.sessionStorage.setItem(key, JSON.stringify([...list, window.location.pathname]))
    }

    note('e2e:started')
    new PerformanceObserver((entries) => {
      if (entries.getEntriesByName('first-contentful-paint').length > 0) note('e2e:painted')
    }).observe({ type: 'paint', buffered: true })
  })

  // `commit`, because the root never reaches `load`: it is replaced while it parses.
  await page.goto(localeUrl('/', defaultLocale()), { waitUntil: 'commit' })
  await expect(page).toHaveURL(pathPattern(localeUrl('/', other.code)))

  const trail = (key: string) => page.evaluate(name => window.sessionStorage.getItem(name), key)

  await expect.poll(() => trail('e2e:painted')).toBe(JSON.stringify([localeUrl('/', other.code)]))
  expect(await trail('e2e:started'), 'the root was opened, and then left')
    .toBe(JSON.stringify([localeUrl('/', defaultLocale()), localeUrl('/', other.code)]))
})

test('the root stays in its own language when that is the one remembered', async ({ page }) => {
  const other = otherLanguage()

  await choose(page, defaultLocale(), other.code)
  await segment(page, other.code, defaultLocale()).click()
  await expect(page).toHaveURL(pathPattern(localeUrl('/settings', defaultLocale())))

  await page.goto(localeUrl('/', defaultLocale()))

  await expect(page.locator('html')).toHaveAttribute('lang', rootLanguage().language)
  await expect(page).toHaveURL(pathPattern(localeUrl('/', defaultLocale())))
})

/**
 * A link keeps the language of its URL — and so does the way back to the root
 * from it.
 *
 * The second half is the one a refactor would break. The guard lives in the
 * root's prerendered HTML and nowhere else; registered where it runs on every
 * visit — the Hub page's own setup is the natural-looking home for it — the head
 * manager would insert it on a client-side visit to `/`, an inserted script
 * runs, and the player reading a Portuguese page would be thrown into English by
 * clicking *Base*.
 *
 * **Asserting that nothing happened needs a barrier after the point where it
 * would have**, and the network going quiet is not one: `networkidle` was
 * reached when `/rules` loaded, and it answers at once. The barrier is the
 * title. The head manager writes the new route's `<title>` and appends any new
 * script in one synchronous call, so once the title has changed a guard would
 * already be in the document, and already running. The wait and the reading are
 * one `evaluate`, inside the page: a reading taken from outside, a round trip
 * later, could land on the next document and find nothing to count. That is why
 * this document is marked too — a reload is a new `window`, without the mark —
 * and a document replaced mid-wait destroys the context and fails the test.
 */
test('a link keeps the language of its URL, and so does the way back to the root', async ({ page }) => {
  const other = otherLanguage()
  const root = rootLanguage()

  await choose(page, root.code, other.code)

  await page.goto(localeUrl('/rules', root.code))
  await expect(page).toHaveURL(pathPattern(localeUrl('/rules', root.code)))
  await expect(page.locator('html')).toHaveAttribute('lang', root.language)

  const rulesTitle = await page.title()
  await page.evaluate(() => Reflect.set(window, 'e2eSameDocument', true))

  await page.getByRole('navigation', { name: navLabel('nav.sections', root.code) })
    .getByRole('link', { name: navLabel('nav.base', root.code), exact: true })
    .click()

  const arrival = await page.evaluate(({ before, guard }) => new Promise<{
    sameDocument: boolean
    path: string
    guards: number
  }>((resolve) => {
    const look = (): void => {
      if (document.title === before) {
        requestAnimationFrame(look)
        return
      }

      resolve({
        sameDocument: Reflect.get(window, 'e2eSameDocument') === true,
        path: window.location.pathname,
        guards: document.querySelectorAll(`script#${guard}`).length,
      })
    }

    look()
  }), { before: rulesTitle, guard: ROOT_GUARD_ID })

  expect(arrival, 'the Hub reached from a Portuguese page, with English remembered').toEqual({
    sameDocument: true,
    path: localeUrl('/', root.code),
    guards: 0,
  })
})

/**
 * The Nuxt UI primitives follow the language of the page — the screen half of
 * issue #40, which the unit test can only ask of the map.
 *
 * The expected label is looked up in Nuxt UI by the language's own code, and not
 * through `UI_LOCALES`: an expectation read through the map agrees with a map
 * that is wrong. The one primitive with words on a screen of this game is the
 * command palette of the Pokédex search, and its close button is labelled by
 * Nuxt UI alone.
 */
test('the Nuxt UI primitives speak the language of the page', async ({ page }) => {
  const closeLabel = (code: string): string => {
    const found = Object.values(uiLocales).find(locale => locale.code === code)
    if (found === undefined) throw new Error(`Nuxt UI has no locale coded ${code}`)

    return found.messages.commandPalette.close
  }

  for (const { code } of LOCALES) {
    await page.goto(localeUrl('/pokedex/1', code))

    // The trigger works only after hydration, and the grid shrinking from the
    // 151 the server sent to the few the virtualizer keeps is the signal that
    // exists only then — see the search test of `pokedex.spec.ts`.
    await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)
    await page.getByRole('button', { name: label('dex.search.trigger', code), exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: closeLabel(code), exact: true }).first()).toBeVisible()

    for (const { code: another } of LOCALES.filter(locale => locale.code !== code)) {
      await expect(dialog.getByRole('button', { name: closeLabel(another), exact: true }), `${code} → ${another}`)
        .toHaveCount(0)
    }
  }
})
