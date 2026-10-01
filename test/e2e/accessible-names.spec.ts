import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { GYM_LEADERS } from '../../shared/game/gyms.ts'
import { isIndexData } from '../../shared/types/dex.ts'
import { REGION_LABELS } from '../../shared/types/game.ts'
import {
  defaultLocale,
  defaultOnlyLabels,
  foreignPhrases,
  label,
  localeCodes,
  unwrittenWords,
  wordsOf,
  writtenWords,
} from '../support/locales'
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
 * source spoke Portuguese, the deck's card links.
 *
 * **Two questions are asked of each name, and the second is the one that holds.**
 * The first is the one every language sweep asks: does it spell a label of the
 * other language (`defaultOnlyLabels`)? Only 2 of the 142 values matched it —
 * through a label one letter long, the *e* of `rules.league.and` —, and it is a
 * list of who comes in: it holds whole labels with no placeholder, so *Escalar
 * #0002 Ivysaur* is not on it, and neither is anything typed into a component.
 * That is the very shape the defect had, and *líder de ginásio* planted on a
 * gym's name passed. The second names who goes out: a word that neither the
 * locale of the page nor the game's data writes (`writtenWords`). Measured on
 * 01/10/2026 over the 153 values of `/en`: every word is the locale's or a name
 * of the game's, but for one name a library writes.
 *
 * The states are `sceneList`, the same that the ring and the census walk.
 */

const PREFIXED = localeCodes().filter(code => code !== defaultLocale())

/**
 * The names the game's data writes, as words — proper nouns, the same in every
 * language: the 1025 species, the nine regions and the nine leaders. From the
 * values themselves, so a tenth leader is known the day it is written.
 */
function gameWords(): string[] {
  const index: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/index.json', import.meta.url)), 'utf8'))
  if (!isIndexData(index)) throw new Error('index.json did not pass its guard: run `yarn data:build`')

  return [
    ...index.map(entry => entry.displayName),
    ...Object.values(REGION_LABELS),
    ...GYM_LEADERS.map(leader => leader.name),
  ].flatMap(wordsOf)
}

/**
 * Names a library writes, whole and with the reason: no locale of the game has
 * their words, and no message of ours could. Each has to be read on a screen —
 * an entry for a name that is gone is one for nothing.
 */
const FROM_A_LIBRARY: Readonly<Record<string, string>> = {
  'Notifications (F8)': 'the toast region `UApp` draws on every page: Reka writes its label, and no locale of Nuxt UI translates it',
}

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
    const game = gameWords()
    const written = new Set([...writtenWords(code), ...game])
    const strangers = (text: string): string[] => unwrittenWords(text, written)

    // The detectors, on both kinds of input. The first has to see the word the
    // slot label used to hard-code — the case it exists for — and to stay quiet on
    // the sentence that is right, or a gate that always cries gets switched off.
    expect(foreign, `nothing differs between ${defaultLocale()} and ${code}`).not.toEqual([])
    expect(
      foreignPhrases('Bulbasaur, slot 1, Grass e Poison, Common', foreign),
      'the sweep cannot see the conjunction the slot label used to hard-code',
    ).toContain('e')
    expect(foreignPhrases('Bulbasaur, slot 1, Grass and Poison, Common', foreign)).toEqual([])

    // The second, on what the first walked past: a sentence with a placeholder in
    // it, a word typed into a component, a library's label in the other language.
    expect(game.length, 'the game\'s data gave no name').toBeGreaterThan(0)
    for (const typed of [
      'Challenge Brock, gym 1, líder de ginásio',
      'Escalar #0002 Ivysaur',
      'Tirar Ivysaur do slot 4',
      'Trocar para Squirtle',
      'Fechar',
      'Bulbasaur, slot 1, Grass e Poison, Common',
    ]) {
      expect(strangers(typed), `the sweep sees no word of ${defaultLocale()} in “${typed}”`).not.toEqual([])
    }
    for (const right of [
      'Challenge Brock, gym 1',
      'Field #0002 Ivysaur',
      'Remove Ivysaur from slot 4',
      'Bulbasaur, slot 1, Grass and Poison, Common',
      'Jangmo-o, Common',
      'Progress in Paldea: 8 / 120',
    ]) {
      expect(strangers(right), `the sweep cries over “${right}”, which is right`).toEqual([])
    }

    const fights = await recordFights(browser, baseURL)
    const scenes = sceneList(fights)
    expect(scenes.length, 'no scene to sweep').toBeGreaterThan(0)

    // What was read, by source and by name: a count over the sum stays green with
    // a whole kind of attribute gone from every page.
    const read = { 'aria-label': 0, 'alt': 0 }
    const library = new Set<string>()

    for (const scene of scenes) {
      // A context of its own each, so a route, a session or a save never outlives
      // its scene.
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.setViewportSize({ width: 1280, height: 900 })
      await openScene(page, scene, { origin, locale: code })

      const names = await namesOf(page)
      for (const name of names) {
        read[name.attribute]++
        if (name.value in FROM_A_LIBRARY) library.add(name.value)
      }

      // The other side, per state: a state that reads nothing measured nothing.
      expect.soft(names.length, `${scene.name} in ${code}: no aria-label or alt was read`).toBeGreaterThan(0)
      expect.soft(
        names
          .filter(name => foreignPhrases(name.value, foreign).length > 0)
          .map(name => `${name.attribute} of ${name.element}: “${name.value}” spells ${foreignPhrases(name.value, foreign).join(', ')}`),
        `${scene.name} in ${code}`,
      ).toEqual([])
      expect.soft(
        names
          .filter(name => !(name.value in FROM_A_LIBRARY) && strangers(name.value).length > 0)
          .map(name => `${name.attribute} of ${name.element}: “${name.value}” has ${strangers(name.value).join(', ')}`),
        `${scene.name} in ${code}: words that neither the locale nor the game's data writes`,
      ).toEqual([])

      await context.close()
    }

    expect(read['aria-label'], 'no aria-label was read in any state').toBeGreaterThan(0)
    expect(read.alt, 'no alt was read in any state').toBeGreaterThan(0)
    for (const [name, reason] of Object.entries(FROM_A_LIBRARY)) {
      expect.soft(library.has(name), `“${name}” is on no screen now, and its entry goes (${reason})`).toBe(true)
    }
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

/**
 * The two names this PR made hold what their control draws (WCAG 2.5.3, *Label in
 * name*) — a pick, which draws `#0002 Ivysaur`, and the scrap line, which draws
 * `2 dup · 10 pó` — in **every** language.
 *
 * `deck.spec.ts` and `collection.spec.ts` ask it where they first met the two, in
 * the default locale, and a name is a message of its own in each: `dups` typed
 * over `dup` in the English one drew *2 dup · 10 dust* under a button called *2
 * dups · 10 dust, …*, and nothing asked.
 */
const HOLD_WHAT_THEY_DRAW: Readonly<Record<string, string>> = {
  '.deck__pick': '/deck',
  '.binder-card__scrap': '/collection',
}

for (const code of localeCodes()) {
  test(`a pick and a scrap line are named after what they draw, in ${code}`, async ({ browser, baseURL }) => {
    if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
    const origin = new URL(baseURL).origin

    for (const [control, address] of Object.entries(HOLD_WHAT_THEY_DRAW)) {
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
      const page = await context.newPage()
      await openScene(page, pageScene(address), { origin, locale: code })

      const drawn = await page.locator(control).evaluateAll(controls => controls.map(element => ({
        name: element.getAttribute('aria-label') ?? '',
        text: element instanceof HTMLElement ? element.innerText.replaceAll(/\s+/g, ' ').trim() : '',
      })))

      // The other side, by source: a control that is not on its page measured nothing.
      expect.soft(drawn.length, `${address} in ${code} draws no ${control}`).toBeGreaterThan(0)
      expect.soft(drawn.filter(item => item.text === ''), `${control} in ${code} draws no text to hold`).toEqual([])
      expect.soft(
        drawn.filter(item => !item.name.includes(item.text)).map(item => `“${item.name}” over “${item.text}”`),
        `${control} in ${code}: names that do not hold what is drawn`,
      ).toEqual([])

      await context.close()
    }
  })
}
