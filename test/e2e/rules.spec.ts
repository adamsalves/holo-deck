import { expect, test } from '@playwright/test'
import { TURN_STEPS, turnStepKey } from '../../app/utils/turn-order.ts'
import { PITY_THRESHOLD } from '../../shared/game/packs.ts'
import { gamePercent } from '../../shared/game/progress.ts'
import { PARALYSIS_SKIP_CHANCE } from '../../shared/game/status.ts'
import { label, localeCodes, localeUrl, namespaceLabels, spells } from '../support/locales.ts'

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
    const text = await page.locator('.rules').innerText()

    expect(
      foreign.filter(phrase => spells(text, phrase)),
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

    await expect(
      page.locator('[data-panel="conditions"] dd').first(),
      `paralysis in ${code}`,
    ).toContainText(gamePercent(PARALYSIS_SKIP_CHANCE))
  }
})
