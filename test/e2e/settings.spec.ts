import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { RECOVERY_REASONS, recoveryMessageKey } from '../../app/utils/recovery-reason.ts'
import { foreignPhrases, label, localeCodes, localeUrl, message, namespaceLabels } from '../support/locales.ts'
import { fakeSync, saveWith, seedLocalSave, seedSynced } from './support.ts'

/**
 * `/settings` in the language of the URL — and the two texts on it that render
 * on **every other screen**.
 *
 * `test/e2e/account-settings.spec.ts` drives the account half of this screen in
 * the default locale; what is missing from disk is the other language. Two of
 * the sentences here are not this screen's alone: the sync chip lives in the
 * global bar through `SyncIndicator`, and the recovery notice is mounted in
 * `app.vue`. A literal left in either of them is a Portuguese sentence on the
 * Hub, the binder and the battle at once, which no per-screen assertion would
 * ever name.
 *
 * Most of this page is inside `<ClientOnly>`, so every assertion waits for
 * something the server did not render.
 */

/** Six species on the account, three on the server's previous version. */
const CURRENT = saveWith({
  dust: 100,
  collection: { 1: { c: 1, s: 0 }, 4: { c: 1, s: 0 }, 7: { c: 1, s: 0 } },
})

async function signedIn(page: Page): Promise<void> {
  await fakeSync(page, CURRENT, { previous: CURRENT })
  await seedLocalSave(page, CURRENT)
  await seedSynced(page, { base: 2 })
}

test('every panel speaks the language of the URL, read from the other one', async ({ page }) => {
  const codes = localeCodes()

  // The other side of the loop: one locale proves nothing about language.
  expect(codes.length).toBeGreaterThan(1)

  for (const code of codes) {
    const foreign = codes
      .filter(name => name !== code)
      .flatMap(other => namespaceLabels('settings.', code, other))

    // The other side of the subtraction: if it emptied — every label identical,
    // or the namespace renamed — the assertion below would read nothing.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(20)

    await signedIn(page)
    await page.goto(localeUrl('/settings', code))

    // The panels are behind `<ClientOnly>`: without this the sweep reads the
    // loading line and passes over a page that never rendered.
    await expect(page.locator('.settings__panel--danger')).toBeVisible()

    // `textContent` and not `innerText`: the CSS uppercases the small labels,
    // and the rendered text would not match the locale's sentence case.
    const text = (await page.locator('.settings').textContent()) ?? ''

    expect(
      foreignPhrases(text, foreign),
      `/settings in ${code} wrote a sentence from another language`,
    ).toEqual([])
  }
})

/**
 * The sync chip, which is the sentence that reaches every screen.
 *
 * Asserted on `/collection` and not on `/settings`: the point is that the chip
 * carries the locale **where it is a passenger**, and the screen it belongs to
 * is the one place where a page-scoped fix would hide the defect.
 *
 * **Measured as absence of the other language, not presence of this one**, and
 * the first draft got that wrong in a way worth writing down. It asserted the
 * chip contained `sync.synced` — *synced* — and the chip here renders
 * `sync.syncedAgo`, *synced 2 min ago*, which contains it. So a `sincronizado`
 * hard-coded back into the `synced` branch left the test green: it named a
 * branch it never reached. Sweeping the foreign `sync.*` phrases catches
 * whichever branch is on screen, which is the only one that can be wrong.
 */
test('the sync chip speaks the language of the URL, on a screen that is not settings', async ({ page }) => {
  const codes = localeCodes()
  expect(codes.length).toBeGreaterThan(1)

  for (const code of codes) {
    const foreign = codes
      .filter(name => name !== code)
      .flatMap(other => namespaceLabels('sync.', code, other))

    // The other side of the subtraction: `sync.*` is four messages and two of
    // them interpolate, so an empty set here would mean nothing is being asked.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(0)

    await signedIn(page)
    await page.goto(localeUrl('/collection', code))

    const chip = page.locator('.sync')
    await expect(chip).toBeVisible()

    // It says something, and what it says is this language's: the positive half
    // keeps an empty chip from passing the sweep below.
    await expect(chip, `sync chip in ${code}`).not.toBeEmpty()

    const text = (await chip.textContent()) ?? ''
    expect(foreignPhrases(text, foreign), `sync chip in ${code} wrote another language`)
      .toEqual([])
  }
})

/**
 * The boot notice, in both languages and for all three reasons.
 *
 * It renders from `app.vue` for a save the game refused to load, so it is the
 * one screen text a player meets **before** choosing a screen. Driven by
 * seeding an unreadable save rather than by calling the component, because what
 * is being measured is that the plugin, the component and the locale agree.
 */
test('the recovery notice speaks the language of the URL, for every reason', async ({ page }) => {
  // The other side of the loop: a dropped reason would leave this asserting
  // over a shorter list without saying so.
  expect(RECOVERY_REASONS.length).toBe(3)

  for (const code of localeCodes()) {
    await page.addInitScript(() => {
      window.localStorage.setItem('holodeck:save', '{ not json')
    })
    await page.goto(localeUrl('/', code))

    const notice = page.locator('.save-notice')
    await expect(notice).toBeVisible()

    await expect(notice, `recovery notice in ${code}`)
      .toContainText(message(recoveryMessageKey('corrupt'), code))
    await expect(notice, `dismiss button in ${code}`)
      .toContainText(label('save.recovery.dismiss', code))
  }
})
