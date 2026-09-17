import { describe, expect, it } from 'vitest'
import { AILMENT_NAMES, DAMAGE_CLASS_NAMES, STAT_NAMES } from '~~/shared/types/dex'
import { conditionKey, damageClassKey, statKey, statNameKey } from '~~/shared/types/game'
import { label, localeCodes, repeated } from '../support/locales'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

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
 * It asks four questions, and they fail in different ways on purpose:
 *
 * 1. the twelve addresses exist, derived from the tuple rather than listed here;
 * 2. no two abbreviations of one locale collide **once case is folded**, which
 *    is the #20 defect and the reason `repeated()` alone is not enough — the
 *    `i18n-gate` compares labels exactly, and `SpD` against `SPD` passes it;
 * 3. no abbreviation collides with a badge that shares a screen with it;
 * 4. nobody spells one by hand.
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
 * are three-letter neighbours of the HUD's stat line. This is not a theory: the
 * English damage class was `SPE` until this PR, which is the abbreviation the
 * *Detail* board specifies for **speed** — the #20 collision, reintroduced from
 * a different file and caught here rather than on screen.
 *
 * Built from the id tuples for the same reason as everything else in this file:
 * a fifth condition or a fourth damage class joins the comparison by existing.
 */
const NEIGHBOUR_KEYS: readonly string[] = [
  ...DAMAGE_CLASS_NAMES.map(name => damageClassKey(name)),
  ...AILMENT_NAMES.map(name => conditionKey(name)),
]

const ROOTS = ['app', 'shared'] as const
const SKIP = new Set(['node_modules'])
const SOURCE = hasExtension(['.vue', '.ts'])

/**
 * Who may spell an abbreviation, and which one.
 *
 * A list of **exceptions**, named by file *and* token: a component added
 * tomorrow falls inside by omission and fails loudly, and so does a second
 * abbreviation appearing in a file excused for one. The inverse list — naming
 * who is swept — is the silent failure this repository has paid for three times.
 *
 * Both entries are `HP`, and they are the same accident: `HP` is the stat
 * abbreviation English stamps on the bar **and** the word this game uses for the
 * resource in play, in both languages. *"{name} recovered {healed} HP"* and
 * *"do HP máximo"* are about the quantity, not about the axis of the chart, and
 * pt-BR keeps `PV` on the bar while the prose keeps `HP`. That split was an
 * explicit decision rather than an oversight, and the *Canvas divergences*
 * section of the README carries it.
 *
 * - `rules.vue` spells the resource three times in its own prose. It stops being
 *   an exception when PR 4c moves that page into the locales — and the
 *   assertion below fails if it does, rather than leaving a stale excuse here.
 * - `styleguide.vue` is a numeric-font specimen (`110 HP · 1.600 pó`), not a
 *   screen of the game, and nothing about it is translated.
 */
const ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['app/pages/rules.vue', new Set(['HP'])],
  ['app/pages/styleguide.vue', new Set(['HP'])],
])

/**
 * The abbreviations as the locales spell them, deduplicated.
 *
 * `DEF` is the one both languages agree on, so eleven tokens come out of twelve
 * labels. The set is built from the files rather than written here, which is
 * what makes it follow a locale that renames one.
 */
function abbreviations(): string[] {
  return [...new Set(CODES.flatMap(code => SHORT_KEYS.map(key => label(key, code))))].sort()
}

/**
 * Where a token is spelled with letters or digits on neither side.
 *
 * The border is `[A-Za-z0-9_]` and not `\d`, which is the lesson `rules-gate`
 * paid for: a border that only excludes the class it is matching leaves the
 * value hidden in every other one. `HP` had to be invisible inside
 * `POTION_HP_THRESHOLD` and `maxHp`, and `DEF` inside `stats.defense` — measured
 * on this tree, that border is what separates the seven real sites from the
 * twenty-one a looser one reports.
 *
 * It matches **case sensitively**, unlike every comparison above, and the
 * difference is deliberate: a badge written by hand is written in the case it
 * renders in, while `stats.hp` and `combatant__hp` are not badges at all. Folding
 * case here would report the property access that feeds the badge as if it were
 * the badge.
 */
function sightings(source: string, token: string): number[] {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`, 'g')
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
        expect(label(key, code).trim(), `\`${key}\` vazia no locale ${code}`).not.toBe('')
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

      expect(labels.length, `nada medido no locale ${code}`).toBe(STAT_NAMES.length)
      expect(
        repeated(folded(labels)),
        `o locale ${code} escreve a mesma sigla em dois stats`,
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
    expect(NEIGHBOUR_KEYS.length).toBeGreaterThan(0)

    for (const code of CODES) {
      const shorts = folded(SHORT_KEYS.map(key => label(key, code)))
      const neighbours = folded(NEIGHBOUR_KEYS.map(key => label(key, code)))
      const clash = shorts.filter(short => neighbours.includes(short)).sort()

      expect(
        clash,
        `o locale ${code} dá a mesma sigla a um stat e a um badge da mesma tela`,
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
    expect(abbreviations().length).toBe(11)
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
          found.push(`${file}:${line} escreve \`${token}\` à mão`)
        }
      }
    }

    expect(found.sort(), 'sigla de stat escrita à mão em vez de vinda do locale').toEqual([])
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

    expect(unused.sort(), 'exceção que não tem mais o que desculpar').toEqual([])
  })
})
