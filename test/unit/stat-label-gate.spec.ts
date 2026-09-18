import { describe, expect, it } from 'vitest'
import { AILMENT_NAMES, DAMAGE_CLASS_NAMES, STAT_NAMES } from '~~/shared/types/dex'
import { conditionKey, damageClassKey, statKey, statNameKey } from '~~/shared/types/game'
import { label, leafEntries, localeCodes, readLocale, repeated } from '../support/locales'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * The six stat abbreviations, in every locale, spelled in exactly one place.
 *
 * Two defects live here, and the first one shipped. The *Detail* board writes
 * six badges next to six bars, and two of them — `SpD` for special defense and
 * `SPD` for speed — differed **only by case**: the same three letters to anyone
 * reading fast, and literally the same sequence to a screen reader. Issue #20
 * carries the finding, and it was alive in three components at once
 * (`dex/DexStatBars`, `deck/Slot`, `battle/Combatant`), each with its own
 * hand-written list.
 *
 * Three hand-written lists is the second defect, and it is the one a second
 * language turns from untidy into visible: translating the Pokédex alone would
 * have made one screen say `PV` while the deck and the battle HUD said `HP`, in
 * the same document, in the same language. So the abbreviations became locale
 * keys derived from `STAT_NAMES`, and this file is what keeps them there.
 *
 * It asks five questions, and they fail in different ways on purpose:
 *
 * 1. the twelve addresses exist, derived from the tuple rather than listed here;
 * 2. no two abbreviations of one locale collide **once case is folded**, which
 *    is the #20 defect and the reason `repeated()` alone is not enough — the
 *    `i18n-gate` compares labels exactly, and `SpD` against `SPD` passes it;
 * 3. no abbreviation collides with a badge that shares a screen with it;
 * 4. nobody spells one by hand in the source;
 * 5. nobody spells one by hand **inside a locale value** either — which is where
 *    the second defect of this PR actually lived: `SPD` was written into the
 *    three `battle.initiative` messages, and a sweep of the source cannot see a
 *    string that ships in `pt-BR.json`.
 */

/** The twelve addresses, mapped through the very functions the screens call. */
const SHORT_KEYS: readonly string[] = STAT_NAMES.map(name => statKey(name))
const LONG_KEYS: readonly string[] = STAT_NAMES.map(name => statNameKey(name))

const CODES: readonly string[] = localeCodes()

/**
 * What the reader's eye and a screen reader both do to these badges.
 *
 * `SpD` and `SPD` are one label in both, and the collision they made is what
 * this gate was written for. Every comparison below folds case for that reason,
 * and a comparison that did not would have let the original defect back in
 * while reporting success.
 */
function folded(values: readonly string[]): string[] {
  return values.map(value => value.toUpperCase())
}

/**
 * The badges drawn on the same screen as a stat abbreviation.
 *
 * `/battle/[gymId]` renders `BattleCombatant` and `BattleMoveCard` at once, so
 * the move's damage class (`SPC`, `PHY`) and the condition badge (`PAR`, `BRN`)
 * are three-letter neighbors of the HUD's stat line. This is not a theory: the
 * English damage class was `SPE` until this PR, which is the abbreviation the
 * *Detail* board specifies for **speed** — the #20 collision, reintroduced from
 * a different file and caught here rather than on screen.
 *
 * Built from the id tuples for the same reason as everything else in this file:
 * a fifth condition or a fourth damage class joins the comparison by existing.
 */
const NEIGHBOR_KEYS: readonly string[] = [
  ...DAMAGE_CLASS_NAMES.map(name => damageClassKey(name)),
  ...AILMENT_NAMES.map(name => conditionKey(name)),
]

/**
 * What the sweep walks, and what it deliberately does not.
 *
 * `ROOTS` reads like the entry list this repository has been burned by three
 * times, so `EXCLUDED_ROOTS` is what makes it safe: every other top-level directory is
 * named here, and `covers every top-level directory` below fails when one
 * appears in neither list. A `composables/` added tomorrow does not get swept
 * silently — it stops the gate until somebody says which side it is on.
 *
 * `test/` is out because this very file, and the e2e beside it, spell every
 * abbreviation on purpose. The rest hold no rendered badge: `server/` and
 * `scripts/` never render, `i18n/` is the source the badges come *from* — and it
 * gets its own question below, because that is where a hand-written badge hides
 * best.
 */
const ROOTS = ['app', 'shared'] as const
const EXCLUDED_ROOTS: readonly string[] = [
  'docs', 'drizzle', 'i18n', 'public', 'scripts', 'server', 'test', 'types',
]

/** Every top-level directory that is on one of the two lists. */
const CLASSIFIED: readonly string[] = [...ROOTS, ...EXCLUDED_ROOTS]

/**
 * The directories that are not source, read from `.gitignore` rather than listed.
 *
 * Built from the file for the reason the gate-writing rule gives: a list written
 * here would age beside the one it mirrors. It also keeps the coverage question
 * below **deterministic** — `test-results/` and `playwright-report/` exist after a
 * local e2e run and not on a fresh CI checkout, so a hand-written list would
 * classify them on one machine and fail on the other.
 */
function ignoredDirs(): Set<string> {
  return new Set(
    readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.endsWith('/') && !line.startsWith('#') && !line.startsWith('!'))
      .map(line => line.replace(/\/$/, ''))
      .filter(name => !name.startsWith('.') && !name.includes('/')),
  )
}

const SKIP = ignoredDirs()
const SOURCE = hasExtension(['.vue', '.ts'])

/**
 * Who may spell an abbreviation, and which one.
 *
 * A list of **exceptions**, named by file *and* token: a component added
 * tomorrow falls inside by omission and fails loudly, and so does a second
 * abbreviation appearing in a file excused for one. The inverse list — naming
 * who is swept — is the silent failure this repository has paid for three times.
 *
 * The one entry is `HP`, and the accident behind it is that `HP` is the stat
 * abbreviation English stamps on the bar **and** the word this game uses for the
 * resource in play, in both languages. *"{name} recovered {healed} HP"* and
 * *"do HP máximo"* are about the quantity, not about the axis of the chart, and
 * pt-BR keeps `PV` on the bar while the prose keeps `HP`. That split was an
 * explicit decision rather than an oversight, and the *Canvas divergences*
 * section of the README carries it.
 *
 * - `styleguide.vue` is a numeric-font specimen (`110 HP · 1.600 pó`), not a
 *   screen of the game, and nothing about it is translated.
 *
 * **It had a second entry, and `needs every exception it names` is what removed
 * it.** `rules.vue` spelled the resource in its own prose until this PR moved
 * that page into the locales; the excuse went stale the same commit the text
 * left the file, and the assertion failed instead of the list quietly keeping a
 * permission for a file that no longer needs one. The prose did not stop
 * spelling `HP` — it moved one file over, into the sweep `who spells an
 * abbreviation inside a locale` runs, where `EXCUSED_IN_LOCALES` covers it.
 * A gate that only swept `app/` and `shared/` would have gone green on a
 * translation it can no longer see, which is the review finding of PR #53
 * happening again to a different token.
 */
/**
 * The badge a message may spell, because it is also an ordinary word of the game.
 *
 * `HP` only, and for the same reason `styleguide.vue` is excused in `ALLOWED`:
 * it is the English badge **and** what both languages call the resource in play.
 *
 * Measured, per locale: **10 messages and 11 occurrences** — 7 under
 * `battle.log.*` and 3 under `rules.*`, which arrived with the page this PR
 * translated (*restoring {heal} of max HP*, and the two conditions that drain
 * it). All ten are about the quantity rather than the axis of a chart. The
 * previous count written here said 8 `battle.log.*` messages and there were 7,
 * which is the reason this one names both figures: a count nobody can reproduce
 * is indistinguishable from a count nobody took.
 */
const EXCUSED_IN_LOCALES: ReadonlySet<string> = new Set(['HP'])

const ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['app/pages/styleguide.vue', new Set(['HP'])],
])

/**
 * The abbreviations as the locales spell them, plus the all-caps spelling of the
 * ones a locale writes in mixed case.
 *
 * `DEF` is the one both languages agree on, so eleven tokens come out of twelve
 * labels — and `SpA`/`SpD` bring `SPA`/`SPD` with them, which is the whole point.
 * The sweep matches case sensitively (see `sightings`), so without the variant a
 * template could spell `SPD` by hand and stay green: that is the **literal token
 * of issue #20**, the one that used to mean speed, and it would be the one
 * spelling the gate could not see. Measured on this tree, the widened set finds
 * the same zero sites as the narrow one, so it costs nothing today.
 *
 * Folding case in the sweep instead would be the wrong trade: measured, it turns
 * 0 findings into 32, because `hp` is a property, a CSS class and a prop all over
 * `app/`. The variant names the two spellings that are badges; case folding names
 * every spelling that is not.
 *
 * The set is built from the locales rather than written here, which is what makes
 * it follow a locale that renames one.
 */
function abbreviations(): string[] {
  const written = CODES.flatMap(code => SHORT_KEYS.map(key => label(key, code)))

  return [...new Set([...written, ...written.map(badge => badge.toUpperCase())])].sort()
}

/**
 * Where a token is spelled with letters or digits on neither side.
 *
 * The border is the full letter class and not `\d`, which is the lesson
 * `rules-gate` paid for: a border that only excludes the class it is matching
 * leaves the value hidden in every other one. `HP` had to be invisible inside
 * `POTION_HP_THRESHOLD` and `maxHp`, and `DEF` inside `stats.defense`. Measured
 * on this tree, the borders separate like this — 5 real sites, all of them the
 * `HP` of the two excused files:
 *
 * | border | sites |
 * |---|---|
 * | `\p{L}\p{N}_` (this one) | 5 |
 * | `[A-Za-z]` | 9 |
 * | `\d` only | 53 |
 * | substring | 53 |
 *
 * **It is `\p{L}` and not `[A-Za-z]`, and that is the half that bites.** An
 * ASCII-only border does not exclude an accented letter, so `VEL` matches inside
 * `NÍVEL` and `DISPONÍVEL` — plausible words in caps on a screen that already
 * stamps `GOLPE DE STATUS`. That is a gate reprovando entrada boa, and the
 * instinctive repair is to excuse the whole file in `ALLOWED`, which switches off
 * the real check for that token. Measured both ways: `NÍVEL 5 · DISPONÍVEL`
 * reports 2 sites under `[A-Za-z0-9_]` and 0 under this one, while a genuine
 * hand-written `VEL` still reports 1 under both.
 *
 * It matches **case sensitively**, unlike every comparison above, and the
 * difference is deliberate: a badge written by hand is written in the case it
 * renders in, while `stats.hp` and `combatant__hp` are not badges at all. Folding
 * case here would report the property access that feeds the badge as if it were
 * the badge.
 */
function sightings(source: string, token: string): number[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${token}(?![\\p{L}\\p{N}_])`, 'gu')
  const lines: number[] = []

  for (const match of source.matchAll(pattern)) {
    lines.push(source.slice(0, match.index).split('\n').length)
  }

  return lines
}

function sourceFiles(): string[] {
  return ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root), SKIP, SOURCE))
}

describe('the six stat abbreviations', () => {
  /**
   * The other side of the derivation.
   *
   * A `map` that broke would leave the lists short, the missing ids would never
   * be asked of any locale, and every assertion below would pass over stats
   * nobody checked — the same failure the `i18n-gate` documents for its own
   * vocabulary. Asserting the count against the tuple is what makes it visible.
   */
  it('derives one short and one long key per stat', () => {
    expect(STAT_NAMES.length).toBe(6)
    expect(SHORT_KEYS.length).toBe(STAT_NAMES.length)
    expect(LONG_KEYS.length).toBe(STAT_NAMES.length)
    expect(new Set([...SHORT_KEYS, ...LONG_KEYS]).size).toBe(STAT_NAMES.length * 2)
    expect(SHORT_KEYS.filter(key => !key.startsWith('stat.short.'))).toEqual([])
    expect(LONG_KEYS.filter(key => !key.startsWith('stat.long.'))).toEqual([])
  })

  /**
   * Two namespaces over the same six ids, for the reason `ailment`/`condition`
   * are two: `PV` is not the first two letters of *Pontos de vida*, and deriving
   * either from the other would need a rule per language. The screen shows the
   * badge and hands the spelled-out name to whoever is listening, so both have
   * to be real text in every locale.
   */
  it('has a badge and a spelled-out name in every locale', () => {
    expect(CODES.length).toBeGreaterThan(1)

    for (const code of CODES) {
      for (const key of [...SHORT_KEYS, ...LONG_KEYS]) {
        expect(label(key, code).trim(), `\`${key}\` is empty in locale ${code}`).not.toBe('')
      }
    }
  })

  /**
   * The #20 defect, and the assertion the `i18n-gate` cannot make.
   *
   * It compares six labels of one locale with case folded. `SpD` and `SPD` are
   * two values and one label, which is why the exact comparison next door stayed
   * green over them for two phases.
   */
  it('repeats no abbreviation inside one locale, ignoring case', () => {
    for (const code of CODES) {
      const labels = SHORT_KEYS.map(key => label(key, code))

      expect(labels.length, `nothing measured in locale ${code}`).toBe(STAT_NAMES.length)
      expect(
        repeated(folded(labels)),
        `locale ${code} writes the same abbreviation on two stats`,
      ).toEqual([])
    }
  })

  /**
   * The same collision across panels of one screen instead of rows of one panel.
   *
   * It is the assertion that caught `SPE` meaning *special* on a move card and
   * *speed* on the combatant beside it, and it is why the English damage class
   * reads `SPC` today.
   */
  it('collides with no badge that shares a screen with it', () => {
    expect(NEIGHBOR_KEYS.length).toBeGreaterThan(0)

    for (const code of CODES) {
      const shorts = folded(SHORT_KEYS.map(key => label(key, code)))
      const neighbors = folded(NEIGHBOR_KEYS.map(key => label(key, code)))
      const clash = shorts.filter(short => neighbors.includes(short)).sort()

      expect(
        clash,
        `locale ${code} gives one abbreviation to a stat and to a badge of the same screen`,
      ).toEqual([])
    }
  })
})

describe('who spells an abbreviation by hand', () => {
  /**
   * The other side of the sweep: with no files or no tokens it would report
   * nothing wrong forever. Both counts are asserted against the source they come
   * from, so a broken walk or an empty locale read fails here instead of
   * disguising itself as a clean tree.
   */
  it('has files and abbreviations to sweep', () => {
    expect(sourceFiles().length).toBeGreaterThan(100)

    // Compared as a set against the locales, never as a count. A hard `11` is the
    // disguise the gate-writing rule names first: renaming one badge so that both
    // locales agree drops the set to 10 and fails with `expected 10 to be 11`,
    // which names nothing and reads like a broken gate rather than a renamed
    // badge — the opposite of what the docblock above promises.
    const swept = abbreviations()

    expect(swept.length).toBeGreaterThanOrEqual(STAT_NAMES.length)

    for (const code of CODES) {
      expect(
        SHORT_KEYS.map(key => label(key, code)).filter(badge => !swept.includes(badge)),
        `locale ${code} spells a badge the sweep never looks for`,
      ).toEqual([])
    }
  })

  /**
   * The entry list, guarded by an exit list.
   *
   * `ROOTS` names who is swept, which is the shape this repository has been
   * burned by three times. This is what keeps it honest: every top-level
   * directory sits on exactly one of the two lists, so one added tomorrow stops
   * the gate until somebody says which side it is on, instead of being skipped
   * in silence.
   */
  it('covers every top-level directory', () => {
    const tracked = readdirSync(REPO_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .filter(name => !SKIP.has(name))

    expect(tracked.length).toBeGreaterThan(ROOTS.length)
    expect(
      tracked.filter(name => !CLASSIFIED.includes(name)).sort(),
      'a top-level directory that is neither swept nor deliberately left out',
    ).toEqual([])
  })

  /**
   * Nobody writes the badge; everybody asks the locale for it.
   *
   * The sweep covers the **short** labels only, and that floor is written here
   * rather than pretended away: the spelled-out names are ordinary words —
   * *Ataque*, *Defesa* — and `/rules` writes *"Ataque físico ×0,5"* about a rule,
   * not about a chart axis. Policing them would be the `rules-gate` mistake of
   * policing a number that collides with prose. What reaches the long names is
   * `test/e2e/pokedex.spec.ts`, which asks the browser in both languages.
   */
  it('lets no file under app/ or shared/ spell one', () => {
    const tokens = abbreviations()
    const found: string[] = []

    for (const file of sourceFiles()) {
      const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

      for (const token of tokens) {
        if (ALLOWED.get(file)?.has(token) === true) continue

        for (const line of sightings(source, token)) {
          found.push(`${file}:${line} spells \`${token}\` by hand`)
        }
      }
    }

    expect(found.sort(), 'a stat abbreviation spelled by hand instead of read from the locale').toEqual([])
  })

  /**
   * An exception that stopped being needed is an exception that rots.
   *
   * Compared as a whole set, like the `IDENTICAL_LABELS` of the `i18n-gate`: the
   * day PR 4c moves `/rules` into the locales, this fails naming the entry to
   * delete instead of leaving a permanent excuse behind for a file that no
   * longer needs one.
   */
  it('needs every exception it names', () => {
    const unused: string[] = []

    for (const [file, tokens] of ALLOWED) {
      const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

      for (const token of tokens) {
        if (sightings(source, token).length === 0) unused.push(`${file} → \`${token}\``)
      }
    }

    expect(unused.sort(), 'an exception with nothing left to excuse').toEqual([])
  })
})

/**
 * The half of the sweep that lives in the locales, not in the source.
 *
 * **This is where the second defect of this PR actually was.** `SPD` was not
 * written in a template — it was written *inside* three `battle.initiative`
 * messages, in both languages, and shipped that way. While the badge was also
 * hand-written in the HUD the two agreed by coincidence and the screen was
 * right; the moment the badge came from the locale, the same screen would have
 * named speed two ways. No sweep of `app/` and `shared/` can see that string,
 * because it is not in `app/` or `shared/`.
 *
 * `HP` is the one exception, and it is the same accident the source sweep
 * excuses: `HP` is the English badge **and** the word this game uses for the
 * resource in play, in both languages. The 8 `battle.log.*` messages are about
 * the quantity — *"perdeu 20 HP"* — and pt-BR keeps `PV` on the bar while the
 * prose keeps `HP`. That divergence is declared in the *Canvas divergences*
 * section of the README, not tolerated here by accident.
 */
describe('who spells an abbreviation inside a locale', () => {
  /**
   * The other side: with nothing read, or with every token excused, the
   * assertion below would be empty forever. Both are asserted against the
   * locales they come from.
   */
  it('has locale values to sweep', () => {
    for (const code of CODES) {
      const values = leafEntries(readLocale(code)).filter(([, value]) => typeof value === 'string')

      expect(values.length, `locale ${code} read empty`).toBeGreaterThan(100)
    }

    expect(abbreviations().filter(token => !EXCUSED_IN_LOCALES.has(token)).length)
      .toBeGreaterThan(0)
  })

  it('lets no message outside `stat.short.*` spell one', () => {
    const tokens = abbreviations().filter(token => !EXCUSED_IN_LOCALES.has(token))
    const found: string[] = []

    for (const code of CODES) {
      for (const [key, value] of leafEntries(readLocale(code))) {
        if (typeof value !== 'string') continue
        if (key.startsWith('stat.short.') || key.startsWith('stat.long.')) continue

        for (const token of tokens) {
          if (sightings(value, token).length > 0) found.push(`${code} ${key} spells \`${token}\``)
        }
      }
    }

    expect(found.sort(), 'a stat abbreviation written into a message').toEqual([])
  })
})
