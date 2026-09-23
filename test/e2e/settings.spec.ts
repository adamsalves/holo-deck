import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { RECOVERY_REASONS, recoveryMessageKey } from '../../app/utils/recovery-reason.ts'
import type { RecoveryReason } from '../../shared/save/schema.ts'
import { SCHEMA_VERSION } from '../../shared/save/schema.ts'
import { foreignPhrases, label, localeCodes, localeUrl, message, namespaceLabels } from '../support/locales.ts'
import { fakeSync, openWelcomePack, saveWith, screenText, seedLocalSave, seedSynced } from './support.ts'

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

/** Three species, and the server's previous version holds the same save. */
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

    // `screenText` and neither of the two obvious readings: `innerText` loses
    // the labels the CSS uppercases, `textContent` loses the word borders that
    // `spells` matches on. Its docblock carries the measurement.
    const text = await screenText(page.locator('.settings'))

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

    const text = await screenText(chip)
    expect(foreignPhrases(text, foreign), `sync chip in ${code} wrote another language`)
      .toEqual([])
  }
})

/**
 * The instant stamped on a backup — the only thing this screen writes that is
 * neither a key nor a number.
 *
 * `backupLabel` formatted with `'pt-BR'` written by hand, and inside `/en` the
 * same backup read `05/09, 14:22` where English reads `09/05, 02:22 PM`: not an
 * odd-looking date, a **wrong** one. Nothing measured it — no unit test calls
 * the function, and no suite seeded a backup, so the whole panel never rendered
 * and putting the hard-coded locale back stayed green everywhere.
 *
 * **Measured as shape, in the other language.** Reading the stamp and comparing
 * it against `Intl` with the same locale would agree with the hard-coded string
 * just as happily — both sides would move together. What tells them apart is
 * that the two URLs have to disagree. Not *all* locales pairwise: a third
 * language may legitimately share a date format with one of these, and a gate
 * that cries on a correct page is a gate someone switches off.
 */
test('a backup is stamped in the date format of the URL, not one language for both', async ({ page }) => {
  const codes = localeCodes()
  expect(codes.length).toBeGreaterThan(1)

  const stamps: string[] = []

  for (const code of codes) {
    await page.goto(localeUrl('/', code))
    await page.evaluate((raw) => {
      window.localStorage.setItem('holodeck:backup:1757085720000', raw)
    }, JSON.stringify(CURRENT))
    await page.goto(localeUrl('/settings', code))

    const panel = page
      .locator('.settings__panel')
      .filter({ hasText: label('settings.backups.title', code) })

    await expect(panel, `no backups panel in ${code}`).toBeVisible()

    const stamp = ((await panel.locator('.settings__row-title').first().textContent()) ?? '').trim()

    // The other side: an empty stamp would make every language agree, and the
    // assertion below would call that a pass.
    expect(stamp, `the backup in ${code} is stamped with nothing`).not.toBe('')
    stamps.push(stamp)
  }

  expect(
    new Set(stamps).size,
    `the backup reads ${stamps.join(' and ')} — the same in every language`,
  ).toBeGreaterThan(1)
})

/**
 * The boot notice, in both languages and for all three reasons.
 *
 * It renders from `app.vue` for a save the game refused to load, so it is the
 * one screen text a player meets **before** choosing a screen. Driven by
 * seeding a save the loader refuses rather than by calling the component,
 * because what is being measured is that the plugin, the component and the
 * locale agree.
 *
 * **All three reasons, and the first version drove one.** It seeded `{ not
 * json` and asserted the `corrupt` sentence, looping over the locales only —
 * the `RECOVERY_REASONS.length` it checked was a count beside the loop, not
 * the other side of it, so a notice that always wrote `save.recovery.corrupt`
 * kept it green. The seeds come from `migrate()`: over `SCHEMA_VERSION` is a
 * save from a newer build, and a v1 save runs the chain and fails the guard at
 * the end of it.
 */
const REFUSED: Record<RecoveryReason, string> = {
  // Not a record at all — the driver's own `JSON.parse` is what refuses this.
  'corrupt': '{ not json',
  'unknown-version': JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }),
  'failed-migration': JSON.stringify({ schemaVersion: 1 }),
}

test('the recovery notice speaks the language of the URL, for every reason', async ({ page }) => {
  // The other side of the loop: an empty list would assert nothing and say so
  // by passing. `REFUSED` is a `Record` over the enum, so a fourth reason stops
  // the compiler here rather than quietly going unmeasured.
  expect(RECOVERY_REASONS.length).toBeGreaterThan(0)

  for (const reason of RECOVERY_REASONS) {
    for (const code of localeCodes()) {
      // Seeded by navigating first and reloading, not by `addInitScript`: init
      // scripts stack for the life of the page, and six of them setting the
      // same key would leave the run depending on the order they were added.
      await page.goto(localeUrl('/', code))
      await page.evaluate((raw) => {
        window.localStorage.setItem('holodeck:save', raw)
      }, REFUSED[reason])
      await page.reload()

      const notice = page.locator('.save-notice')
      await expect(notice, `no recovery notice for ${reason} in ${code}`).toBeVisible()

      await expect(notice, `recovery notice for ${reason} in ${code}`)
        .toContainText(message(recoveryMessageKey(reason), code))
      await expect(notice, `dismiss button in ${code}`)
        .toContainText(label('save.recovery.dismiss', code))
    }
  }
})

/**
 * A save a newer build wrote, and this build's first move after reading it. The
 * service worker made this a path every player can take — offline, the old
 * build's shell answers while the new build's worker waits for the old tabs to
 * close —, and the session plays in memory: the save on disk stays the newer
 * one, for the new build to find (see `holdsNewerSave`).
 *
 * The corrupt save is the other side: the same move over a save this build
 * refused for any other reason is written and stamped, which is what shows the
 * move reached the disk at all. The barrier is the opening on screen — the
 * save's watcher runs before the render that shows it.
 */
test('a save from a newer build stays on disk as it was while this build plays', async ({ page }) => {
  for (const [reason, keptAsItWas] of [['unknown-version', true], ['corrupt', false]] as const) {
    const seed = REFUSED[reason]
    await page.goto('/')
    await page.evaluate((raw) => {
      window.localStorage.setItem('holodeck:save', raw)
      // The last-play stamp `markWrite` keeps beside the save.
      window.localStorage.removeItem('holodeck:lastWrite')
    }, seed)

    await openWelcomePack(page)
    const { onDisk, stamp } = await page.evaluate(() => ({
      onDisk: window.localStorage.getItem('holodeck:save'),
      stamp: window.localStorage.getItem('holodeck:lastWrite'),
    }))

    if (keptAsItWas) {
      expect(onDisk, 'the newer save was written over').toBe(seed)
      expect(stamp, 'a session that wrote nothing stamped a last play').toBeNull()
    }
    else {
      expect(onDisk, 'the move never reached the disk').not.toBe(seed)
      expect(stamp, 'the move was never stamped').not.toBeNull()
    }
  }
})
