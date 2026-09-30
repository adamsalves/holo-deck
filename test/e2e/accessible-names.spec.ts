import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { defaultLocale, defaultOnlyLabels, foreignPhrases, label, localeCodes } from '../support/locales'
import { openScene, pageScene, recordFights, sceneList } from './support'

/**
 * Every accessible name of a translated screen is in its language: the
 * `aria-label` and the `alt` of every element, on every state the game draws.
 *
 * **Nothing read them.** The language sweeps read text, and a name is an
 * attribute: the card links of the deck said *Grass e Poison* in English, and
 * every sweep of the suite was green over it. `Slot.vue` wrote `slot ${n}` and
 * joined the types with `' e '` itself, where the other three card labels take
 * both from the locale.
 *
 * Measured on 30/09/2026, before this was written, on the build of `main`: 24
 * states of `/en` hold 321 `aria-label`s and 41 `alt`s with something in them,
 * 142 different values among them, plus 163 empty `alt`s (decoration). One
 * source spoke Portuguese, the deck's card links. The list to look for is the one
 * every language sweep uses, `defaultOnlyLabels`, and only 2 of the 142 values
 * match it — through a label one letter long, the *e* of `rules.league.and`. So
 * the detector is asked, below, whether it still sees that word: a sweep whose
 * only catch hangs on one letter is one translator away from seeing nothing.
 *
 * The states are `sceneList`, the same that the ring and the census walk.
 */

const PREFIXED = localeCodes().filter(code => code !== defaultLocale())

/** Every `aria-label` and non-empty `alt` on the page, and the element that carries it. */
interface Name {
  readonly attribute: 'aria-label' | 'alt'
  readonly value: string
  readonly element: string
}

function namesOf(page: Page): Promise<Name[]> {
  return page.evaluate(() => {
    const found: { attribute: 'aria-label' | 'alt', value: string, element: string }[] = []

    for (const element of Array.from(document.querySelectorAll('[aria-label], [alt]'))) {
      const classes = Array.from(element.classList).join('.')

      // `alt=""` is how an image says it is decoration: nothing to read.
      for (const attribute of ['aria-label', 'alt'] as const) {
        const value = element.getAttribute(attribute)
        if (value !== null && value !== '') found.push({ attribute, value, element: `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`}` })
      }
    }

    return found
  })
}

// The other side of the loop below: with no translated locale it visits nothing.
test('there is a translated locale to sweep', () => {
  expect(PREFIXED.length).toBeGreaterThan(0)
})

for (const code of PREFIXED) {
  test(`every aria-label and alt of ${code} is written in ${code}`, async ({ browser, baseURL }) => {
    test.setTimeout(300_000)
    if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
    const origin = new URL(baseURL).origin

    const foreign = defaultOnlyLabels(code)

    // The detector, on both kinds of input. It has to see the word the slot label
    // used to hard-code — the case it exists for — and it has to stay quiet on
    // the sentence that is right, or a gate that always cries gets switched off.
    expect(foreign, `nothing differs between ${defaultLocale()} and ${code}`).not.toEqual([])
    expect(
      foreignPhrases('Bulbasaur, slot 1, Grass e Poison, Common', foreign),
      'the sweep cannot see the conjunction the slot label used to hard-code',
    ).toContain('e')
    expect(foreignPhrases('Bulbasaur, slot 1, Grass and Poison, Common', foreign)).toEqual([])

    const fights = await recordFights(browser, baseURL)
    const scenes = sceneList(fights)
    expect(scenes.length, 'no scene to sweep').toBeGreaterThan(0)

    // What was read, by source and by name: a count over the sum stays green with
    // a whole kind of attribute gone from every page.
    const read = { 'aria-label': 0, 'alt': 0 }

    for (const scene of scenes) {
      // A context of its own each, so a route, a session or a save never outlives
      // its scene.
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.setViewportSize({ width: 1280, height: 900 })
      await openScene(page, scene, { origin, locale: code })

      const names = await namesOf(page)
      for (const name of names) read[name.attribute]++

      // The other side, per state: a state that reads nothing measured nothing.
      expect.soft(names.length, `${scene.name} in ${code}: no aria-label or alt was read`).toBeGreaterThan(0)
      expect.soft(
        names
          .filter(name => foreignPhrases(name.value, foreign).length > 0)
          .map(name => `${name.attribute} of ${name.element}: “${name.value}” spells ${foreignPhrases(name.value, foreign).join(', ')}`),
        `${scene.name} in ${code}`,
      ).toEqual([])

      await context.close()
    }

    expect(read['aria-label'], 'no aria-label was read in any state').toBeGreaterThan(0)
    expect(read.alt, 'no alt was read in any state').toBeGreaterThan(0)
  })
}

/**
 * The deck's card links, whole — the form, and not only the absence of a word.
 *
 * The sweep above sees a Portuguese word, and `slot` is the same word in both
 * languages: written into the component instead of the locale, it would read the
 * same in `/en` and pass. So the sentence is measured as English writes it, with
 * its pieces taken from the locale's own type and rarity names and the two words
 * that are not in any locale typed here — the *and* between two types, which is
 * what `Intl.ListFormat` says in English and `' e '` did not, and the *slot*.
 */
test('the deck\'s card links name the slot the way English does', async ({ browser, baseURL }) => {
  if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
  const origin = new URL(baseURL).origin

  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await openScene(page, pageScene('/deck'), { origin, locale: 'en' })

  const type = (name: string): string => label(`type.${name}`, 'en')
  const common = label('rarity.common', 'en')

  // The five species of the scene's deck, in the order it fields them.
  const links = (await namesOf(page))
    .filter(name => name.element.startsWith('a.poke-card__link'))
    .map(name => name.value)

  expect(links).toEqual([
    `Bulbasaur, slot 1, ${type('grass')} and ${type('poison')}, ${common}`,
    `Charmander, slot 2, ${type('fire')}, ${common}`,
    `Squirtle, slot 3, ${type('water')}, ${common}`,
    `Caterpie, slot 4, ${type('bug')}, ${common}`,
    `Pidgey, slot 5, ${type('normal')} and ${type('flying')}, ${common}`,
  ])

  await context.close()
})
