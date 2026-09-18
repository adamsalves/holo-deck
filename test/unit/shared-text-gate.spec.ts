import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GYM_LEADERS } from '~~/shared/game/gyms'
import { GENERATION_COUNT } from '~~/shared/types/dex'
import { generationNumeral, REGION_LABELS } from '~~/shared/types/game'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * `shared/` writes no word the player reads.
 *
 * The layer holds the rule and the ids; the sentence belongs to whoever is
 * rendering, because only the screen knows which language it is in. Every label
 * map that used to live here became a key — `rarityKey`, `typeKey`,
 * `ailmentKey`, `conditionKey`, `habitatKey` — and `describeEvolution` takes the
 * translator as a parameter for the same reason. Issue #38 inventoried them and
 * this is the gate it asked for; it could not be written before the last map
 * left, because a gate that starts red is a gate nobody can tell from a broken
 * one.
 *
 * **What it is not:** `shared-purity` asks what `shared/` may import and call.
 * This asks what it may *say*. The two sweep the same directory and would read
 * as one rule if they shared a file, so they do not.
 *
 * Disk does not reach the screen: `test/e2e/pokedex.spec.ts` walks `/en` and
 * reads the rendered panel, which is the half a file reader cannot take.
 */

const SCANNED = 'shared'
const SKIP = new Set(['node_modules'])

/**
 * What under `shared/` the sweep deliberately does not read — enumerated,
 * because the extension it *does* read is a list of who gets in.
 *
 * `hasExtension(['.ts'])` alone is that shape, and it fails the way an entry
 * list always fails: silently. A `planted.vue` or a `planted.mts` holding
 * `'Caverna Escura'` is not an offender to it, it is not a file at all. The
 * layer is `.ts` today and a `.vue` here would break other rules first — but
 * "would break something else first" is what an unguarded rule always says.
 *
 * So the walk below reads everything and this list says what is allowed to be
 * skipped. A tenth extension under `shared/` fails the assertion until someone
 * decides which side it belongs on, which is the decision the entry list was
 * making by omission.
 */
const NOT_SOURCE: readonly string[] = ['.json', '.md', '.snap']

/**
 * A string literal, as the file spells it, with where it starts.
 *
 * The offset is what lets the throw-excuse below work on ranges instead of on
 * lines: `throw new Error(...)` is written over four lines twice in
 * `engine.ts`, and a line-based reader would excuse the first line and accuse
 * the rest.
 */
interface Literal {
  readonly file: string
  readonly at: number
  /** The text between the quotes, unescaped one level. */
  readonly text: string
}

/**
 * Every string literal in one source, read character by character.
 *
 * **Escape-aware, and that is the whole reason this is not a regex.** The
 * obvious `/'([^'\n]*)'/` splits `'Beira d\'água'` at the escaped quote: the
 * real literal stops matching and a *phantom* one — `água` — appears in its
 * place. Measured on this very tree before the sweep was written, and it fails
 * in the expensive direction, because the offender leaves the sweep instead of
 * failing it: seven of the nine habitat labels were invisible to the first
 * draft, and the one thing it did report was a fragment that exists nowhere in
 * the file.
 *
 * Template literals are read the same way and kept whole, interpolations
 * included — `classify` is what decides that `${…}` is not text.
 */
function literalsIn(file: string, source: string): Literal[] {
  const found: Literal[] = []
  let index = 0

  while (index < source.length) {
    const quote = source[index]

    if (quote !== '\'' && quote !== '"' && quote !== '`') {
      index += 1
      continue
    }

    const text: string[] = []
    let cursor = index + 1

    while (cursor < source.length) {
      const char = source[cursor]

      if (char === '\\') {
        text.push(source[cursor + 1] ?? '')
        cursor += 2
        continue
      }
      // An unterminated quote is a syntax error the compiler already refuses;
      // stopping at the newline keeps one from swallowing the rest of the file
      // and taking every literal after it out of the sweep.
      if (char === quote || (quote !== '`' && char === '\n')) break

      text.push(char ?? '')
      cursor += 1
    }

    found.push({ file, at: index, text: text.join('') })
    index = cursor + 1
  }

  return found
}

/**
 * Where a call runs, from its name to its closing parenthesis.
 *
 * Parentheses are balanced rather than counted to the first `)`, because every
 * message this excuses is a template with a call inside it —
 * `` `espécie ${id} não está no dex` `` is the short one. Quotes are skipped
 * whole on the way, so a `)` inside a message does not close the range early.
 */
function callRanges(source: string, opening: RegExp): [number, number][] {
  return [...source.matchAll(opening)].map((match) => {
    let depth = 1
    let cursor = match.index + match[0].length

    while (cursor < source.length && depth > 0) {
      const char = source[cursor]

      if (char === '\'' || char === '"' || char === '`') {
        const quote = char
        cursor += 1
        while (cursor < source.length) {
          if (source[cursor] === '\\') {
            cursor += 2
            continue
          }
          if (source[cursor] === quote) break
          cursor += 1
        }
      }
      else if (char === '(') depth += 1
      else if (char === ')') depth -= 1

      cursor += 1
    }

    return [match.index, cursor]
  })
}

/** `throw new Error(…)` and `throw new TypeError(…)`, with the message inside. */
const THROWN = /\bthrow\s+new\s+\w*Error\s*\(/g

/**
 * `assertNever(value, 'ação de batalha')` — the context of an unhandled case.
 *
 * It is excused for the same reason a thrown message is: it is handed to
 * `assertNever`, which throws it. Without this the one call in `engine.ts`
 * would be the single offender left on a clean tree, and the only way to keep
 * the gate green would be to translate a developer's sentence into the locale
 * files, where it would sit in front of every translator forever.
 */
const ASSERTED = /\bassertNever\s*\(/g

/** Where a module says what it imports — a path, never a sentence. */
const SPECIFIER = /^\s*(?:import|export)\s[^\n]*?from\s*(?:'[^']*'|"[^"]*")|^\s*import\s*(?:'[^']*'|"[^"]*")/gm

/** What a `${…}` leaves behind: only the static halves reach the screen as words. */
const INTERPOLATION = /\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g

/**
 * A letter, and `×` is not one.
 *
 * The obvious `[A-Za-zÀ-ÿ]` calls `×½` text, because Latin-1 Supplement puts the
 * multiplication sign at U+00D7 and the division sign at U+00F7 — inside the
 * range, between the accented letters. `multiplierLabel()` writes six of those
 * symbols and they are the same in every language; with the naive range they
 * were six offenders that could only be answered with six exceptions, each one
 * a place for a real label to hide later.
 */
const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/

/** A locale key, whole (`rarity.common`) or built (`` `rarity.${rarity}` ``). */
const KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]*)+$/

/** An identifier or a slug — what the code compares itself against. */
const CODE = /^[a-z][a-zA-Z0-9]*$|^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A module path or a URL. */
const PATH = /^(?:[a-z]+:)?\/\/|^\.{0,2}\//

/**
 * The words that are data, not language — named because they are the exception.
 *
 * The first two groups are **built from the source they excuse**, so they cannot
 * age beside it: a tenth region or a tenth leader is exempt the day it is
 * written, and a name that changes changes here too. A hand-copied list of
 * eighteen proper nouns is exactly the list that would still say `Kanto` after
 * someone renamed it.
 *
 * **Proper nouns stay in `shared/`, and the nine gym leaders are why.** `Kanto`
 * and `Brock` read the same in both languages; sending them to the locale would
 * write eighteen identical translations and put the game's own cast behind a
 * key. The alternative was moving the regions out and leaving the leaders here,
 * which is the same debt with a gate that no longer mentions it.
 *
 * The rest is code that happens to be spelled with a capital: `GymBand` is the
 * three-letter union of `gyms.ts`, and the three brand tags exist only in a type
 * position. `pt-BR` is the exception that is a real defect — issue #49 owns it,
 * and naming it here is what keeps it from being read as settled.
 */
const EXEMPT: readonly string[] = [
  ...Object.values(REGION_LABELS),
  ...GYM_LEADERS.map(leader => leader.name),
  ...Array.from({ length: GENERATION_COUNT }, (_, index) => generationNumeral(index + 1)),
  'A',
  'B',
  'C',
  'SpeciesId',
  'MoveId',
  'GymId',
  'pt-BR',
]

/** Whether a literal is a word the player could read. */
function isScreenText(text: string): boolean {
  const staticText = text.replaceAll(INTERPOLATION, '')

  if (!LETTER.test(staticText)) return false
  if (PATH.test(text) || KEY.test(staticText) || CODE.test(text)) return false

  return !EXEMPT.includes(text)
}

/** Every `.ts` file under `shared/`, with comments and imports blanked out. */
function sources(): { file: string, code: string }[] {
  return walkFiles(join(REPO_ROOT, SCANNED), SKIP, hasExtension(['.ts'])).map((file) => {
    const raw = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

    // Blanked and not removed: every offset below is an offset into the real
    // file, and a reader that shortened the text would excuse the literal that
    // happens to land where a comment used to be.
    return { file, code: raw.replaceAll(SPECIFIER, match => match.replaceAll(/[^\n]/g, ' ')) }
  })
}

/** Every literal under `shared/`, split into what is excused and what is not. */
function sweep(): { offenders: string[], thrown: string[] } {
  const offenders: string[] = []
  const thrown: string[] = []

  for (const { file, code } of sources()) {
    const excused = [...callRanges(code, THROWN), ...callRanges(code, ASSERTED)]

    for (const literal of literalsIn(file, code)) {
      if (!isScreenText(literal.text)) continue

      const inside = excused.some(([start, end]) => start <= literal.at && literal.at < end)

      if (inside) thrown.push(`${file} → ${literal.text}`)
      else offenders.push(`${file} → ${literal.text}`)
    }
  }

  return { offenders, thrown }
}

describe('shared/ writes no screen text', () => {
  /**
   * The reader tells a label from a key, a path, an identifier and a symbol.
   *
   * Kept as input rather than as an edit to a real module, and every line is a
   * shape that a draft of this gate got wrong: `Caverna` is a single word with
   * no accent and no space — the three things a "looks Portuguese" sweep asks
   * for — and it is a label; `×½` is the accented range's false positive;
   * `rough-terrain` and `minLevel` are the two spellings of an identifier; and
   * the escaped quote is what took `Beira d'água` out of the sweep entirely.
   */
  it('reads a label, and not a key, a path, an identifier or a symbol', () => {
    const source = [
      'const LABELS = { cave: \'Caverna\', edge: \'Beira d\\\'água\' }',
      'const key = `rarity.${rarity}`',
      'const slug = \'rough-terrain\'',
      'const field = \'minLevel\'',
      'const symbol = \'×½\'',
      'const url = \'https://example.com/sprite.png\'',
    ].join('\n')

    const texts = literalsIn('sample.ts', source).filter(one => isScreenText(one.text))

    expect(texts.map(one => one.text)).toEqual(['Caverna', 'Beira d\'água'])
  })

  /**
   * A message that is thrown is a developer's sentence, and it stays in one
   * language on purpose.
   *
   * Twenty of them live under `shared/` and none reaches a screen: they name a
   * broken invariant to whoever is reading a stack trace. Translating them would
   * put twenty engine messages in front of every translator, and the
   * alternative — letting them count as offenders — would be a gate nobody could
   * keep green.
   */
  it('excuses a thrown message, and only while it is inside the throw', () => {
    const source = [
      'if (team.length === 0) throw new Error(\'time vazio não entra em batalha\')',
      'const label = \'Caverna\'',
    ].join('\n')

    const excused = callRanges(source, THROWN)
    const read = literalsIn('sample.ts', source).filter(one => isScreenText(one.text))
    const outside = read.filter(one => !excused.some(([start, end]) => start <= one.at && one.at < end))

    expect(read.map(one => one.text)).toEqual(['time vazio não entra em batalha', 'Caverna'])
    expect(outside.map(one => one.text)).toEqual(['Caverna'])
  })

  /**
   * And a `)` inside the message does not end the call early.
   *
   * `engine.ts` throws two messages built from a template with a call in them;
   * with an unbalanced reader the range closes at the first `)`, the rest of the
   * message falls outside it, and an engine invariant is reported as screen
   * text — a failure that points at the wrong rule, which is the worst way for a
   * gate to be right.
   */
  it('reads a thrown message that carries a call inside it', () => {
    const source = 'throw new Error(`espécie ${String(id)} não está no dex`)'

    const [range] = callRanges(source, THROWN)
    const [literal] = literalsIn('sample.ts', source)

    expect(range?.[1]).toBe(source.length)
    expect(literal?.at).toBeGreaterThan(range?.[0] ?? 0)
    expect(literal?.at).toBeLessThan(range?.[1] ?? 0)
  })

  /**
   * The other side of the sweep: it read the tree, and the excuse did work.
   *
   * `[] === []` passes, so a walk that found no file — a renamed directory, a
   * changed extension — would leave the assertion below measuring nothing and
   * looking healthy for it. The thrown messages are the proof that the excuse is
   * connected: with the range reader broken to find nothing, this empties while
   * the assertion below gains twenty names, and the two failures together say
   * which half moved.
   */
  it('read the whole layer, and excused the messages it should', () => {
    const { thrown } = sweep()

    expect(sources().map(one => one.file)).not.toEqual([])
    expect(thrown).not.toEqual([])
  })

  it('leaves no file under shared/ outside the sweep', () => {
    const everything = walkFiles(join(REPO_ROOT, SCANNED), SKIP, () => true)
    const read = new Set(sources().map(one => one.file))

    expect(everything).not.toEqual([])

    const unread = everything.filter(file => !read.has(file) && !NOT_SOURCE.includes(extname(file)))

    expect(unread, 'a file under shared/ the sweep never opened').toEqual([])
  })

  it('no module under shared/ writes a word the player reads', () => {
    const { offenders } = sweep()

    expect([...new Set(offenders)].sort(), 'screen text under `shared/`').toEqual([])
  })

  /**
   * And an exception that no longer applies is gone.
   *
   * The half that makes the list shrink instead of age: the two derived groups
   * follow their source on their own, and the seven written by hand have to be
   * deleted the day their literal is. Without this, `pt-BR` would outlive issue
   * #49 and go on describing a defect that was already fixed.
   */
  it('and no exception outlives the literal it forgives', () => {
    const written = new Set(sources().flatMap(({ file, code }) =>
      literalsIn(file, code).map(literal => literal.text)))

    expect(EXEMPT.filter(text => !written.has(text))).toEqual([])
  })
})
