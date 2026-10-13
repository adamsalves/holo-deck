import { expect, test } from '@playwright/test'
import { TURN_STEPS, turnStepKey } from '../../app/utils/turn-order.ts'
import { PITY_THRESHOLD } from '../../shared/game/packs.ts'
import { PARALYSIS_SKIP_CHANCE } from '../../shared/game/status.ts'
import { foreignPhrases, label, localeCodes, localeUrl, namespaceLabels, perLocale } from '../support/locales.ts'
import { hydrated, screenText } from './support.ts'

/**
 * `/rules` in a browser, which is the half no gate on disk can reach.
 *
 * `test/unit/rules-gate.spec.ts` proves the page writes no calibrated number by
 * hand, and `test/unit/i18n-gate.spec.ts` proves every key `turnStepKey` builds
 * is translated. What neither can see is **what rendered**, and the gap is
 * precise: the gate asks `turn-order.ts` for the keys, the page asks it for the
 * same keys, and nothing on disk checks that the page went on using the answer.
 * A keypath spelled inline in the template — or a slot that never matched a
 * placeholder — leaves both gates green while vue-i18n paints the key itself on
 * the panel, *rules.battle.step.pp* where a sentence should be. Measured: with
 * the prefix mistyped in the page, this test reports the key it found on screen
 * and the language sweep below reports the panel that stayed Portuguese.
 *
 * It runs against `yarn preview`, so against the prerendered build.
 */

test('the turn order renders six whole sentences, one per step of the engine', async ({ page }) => {
  const codes = localeCodes()

  // The other side of the loop: with one locale this proves nothing about
  // language, and with none it would not run at all.
  expect(codes.length).toBeGreaterThan(1)

  const rendered = new Map<string, string[]>()

  for (const code of codes) {
    await page.goto(localeUrl('/rules', code))

    const steps = page.locator('[data-panel="battle"] .rules__steps li')

    // The other side of the scope: a renamed class or a dropped step would leave
    // every assertion below iterating over an empty list.
    await expect(steps).toHaveCount(TURN_STEPS.length)

    const texts: string[] = []

    for (const [index, step] of TURN_STEPS.entries()) {
      const line = steps.nth(index)
      const text = ((await line.innerText()).split('\n').at(-1) ?? '').trim()

      // The failure this test exists for: an unresolved keypath renders as the
      // key, and a key is the one string that looks the same in every language.
      expect(text, `${step} in ${code}`).not.toContain('rules.battle')
      expect(text, `${step} in ${code} is empty`).not.toBe('')

      // Measured as **shape** and not against the file the page reads: a message
      // with a placeholder may not reach the screen as written, or the value
      // never arrived. Comparing to the locale would agree with either.
      const raw = label(turnStepKey(step), code)
      if (raw.includes('{')) {
        expect(text, `${step} in ${code} kept its placeholder`).not.toContain('{')
        expect(text, `${step} in ${code} did not interpolate`).not.toBe(raw)
      }

      texts.push(text)
    }

    rendered.set(code, texts)
  }

  // And the other language, which is where a hard-coded literal shows up: the
  // six sentences of one locale may share nothing with another's. A page that
  // spelled them in the template would render the same six everywhere.
  for (const [code, texts] of rendered) {
    for (const [other, otherTexts] of rendered) {
      if (other === code) continue

      expect(
        texts.filter(text => otherTexts.includes(text)),
        `${code} and ${other} write the same step`,
      ).toEqual([])
    }
  }
})

test('every panel speaks the language of the URL, read from the other one', async ({ page }) => {
  const codes = localeCodes()
  expect(codes.length).toBeGreaterThan(1)

  for (const code of codes) {
    const foreign = codes
      .filter(name => name !== code)
      .flatMap(other => namespaceLabels('rules.', code, other))

    // The other side of the subtraction: if it emptied — every label identical,
    // or the namespace renamed — the loop below would assert nothing at all.
    expect(foreign.length, `nothing foreign to look for against ${code}`)
      .toBeGreaterThan(20)

    await page.goto(localeUrl('/rules', code))
    // `screenText` and neither of the two obvious readings: `innerText` loses
    // the labels the CSS uppercases, `textContent` loses the word borders that
    // `spells` matches on. Its docblock carries the measurement.
    const text = await screenText(page.locator('.rules'))

    expect(
      foreignPhrases(text, foreign),
      `/rules in ${code} wrote a sentence from another language`,
    ).toEqual([])
  }
})

test('the calibrated numbers reach the screen, in both languages', async ({ page }) => {
  for (const code of localeCodes()) {
    await page.goto(localeUrl('/rules', code))

    // Pity is the number the gate on disk can only prove *absent* from the
    // source. That it arrives — from `shared/game/packs.ts`, through the message
    // — is a thing only the rendered page says.
    await expect(
      page.locator('[data-panel="packs"] .rules__line', { hasText: label('rules.packs.pity', code) }),
      `pity in ${code}`,
    ).toContainText(String(PITY_THRESHOLD))

    // The number from the module and the sign written here, and not the formatter
    // the page uses: a test that asked it would agree with whatever it did. Whole
    // percents are the same in both languages, so one spelling serves the loop.
    // Rounded, because the product of a fraction and 100 is not always the whole
    // number it stands for: `0.07 * 100` is `7.000000000000001`.
    await expect(
      page.locator('[data-panel="conditions"] dd').first(),
      `paralysis in ${code}`,
    ).toContainText(`${Math.round(PARALYSIS_SKIP_CHANCE * 100)}%`)
  }
})

/**
 * The multipliers on `/rules`, in the decimal separator of the URL — `×1,5` and `×1.5`.
 *
 * The two came from a helper of this very page that did `toFixed(1)` and swapped
 * the dot by hand, so `/en/rules` wrote `STAB ×1,5` (issue #49). The chip and the
 * first condition are two of the helper's four call sites, and both are asked.
 *
 * Written by hand, in each language, and read off the rendered page: the page
 * formats with `Intl`, and an expectation built from `Intl` would agree with
 * whatever the page did. The words around the figure (`STAB`) are the same in both
 * languages, which is why the chip can be asserted whole; the condition carries a
 * translated stat name, so only the figure is. Both are read after the client
 * took the page over, or the answer is the static file's.
 */
const MULTIPLIERS: Readonly<Record<string, { stab: string, paralysis: string }>> = {
  'pt-BR': { stab: 'STAB ×1,5', paralysis: '×0,5' },
  'en': { stab: 'STAB ×1.5', paralysis: '×0.5' },
}

test('the multipliers are written with the decimal separator of the URL', async ({ page }) => {
  for (const [code, expected] of perLocale(MULTIPLIERS)) {
    await page.goto(localeUrl('/rules', code))
    await hydrated(page)

    await expect(
      page.locator('[data-panel="battle"] .rules__chip').first(),
      `the STAB chip in ${code}`,
    ).toHaveText(expected.stab)
    await expect(
      page.locator('[data-panel="conditions"] dd').first(),
      `the paralysis line in ${code}`,
    ).toContainText(expected.paralysis)
  }
})
