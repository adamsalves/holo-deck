import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, ignoredDirectories, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * No figure of the game is written in a language the player did not choose.
 *
 * Issue #49: the two helpers in `shared/game/progress.ts` called
 * `toLocaleString('pt-BR')`, and four places did `toFixed(1).replace('.', ',')`
 * by hand. Inside `/en` that wrote `1.600`, which an English reader takes for
 * 1.6, and `4,5%` and `0,7 m`, whose comma English does not read as a decimal.
 * A sweep for *words* cannot find it, because there is none; the defect is a
 * **value read wrong**, and it passed every other gate for as long as the pages
 * were Portuguese.
 *
 * It charges four forms — the first three in `app/` and in `shared/`, the last
 * in `app/`:
 *
 * 1. **A locale-sensitive formatter given a locale written in the code, or none.**
 *    `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`,
 *    `Intl.NumberFormat` and `Intl.DateTimeFormat`. A literal fixes the language
 *    for every page; no argument hands it to the *device*, which is neither the
 *    URL's choice nor the one the page was prerendered in.
 * 2. **The decimal separator swapped by hand** — a `.` replaced by a `,`, in any
 *    quotes and as a string or a regular expression, through `replace` or
 *    `replaceAll`. It is the same defect as the first, written without `Intl`.
 * 3. **`toFixed`**, outside the named exceptions. It writes a dot in every
 *    language, and the way out of it is the way out of the second form.
 * 4. **A helper of `shared/game/progress.ts` named outside `useGameNumbers`.**
 *    The helpers take the language as an argument, so a screen that called one
 *    could write the tag in place: `gameNumber(coins, 'pt-BR')` is none of the
 *    forms above, and it is the first one with a function in between.
 *
 * The argument of a formatter is judged by its **shape**: a quoted string, an
 * array of one, `undefined` or nothing is wrong, and anything else is taken to be
 * the language. So a locale written once into a constant and passed by its name
 * would walk past. `shared-text-gate` closes that door under `shared/` for a tag
 * with a capital in it — `'pt-BR'` is screen text there, and not exempt any more.
 * A lowercase one, `'en'`, reads as an identifier to that gate and walks past
 * both. What holds the three helpers against it is `progress.spec.ts`: the
 * figures are asserted in two languages, and the language parameter is asserted
 * to have no default. Nothing in `app/` hands a formatter a constant of that kind
 * today.
 *
 * **It is built the way this repository's gates are, and each choice answers a
 * failure that has happened:**
 *
 * - It enumerates what **leaves**. The roots it reads are named, and every other
 *   top-level directory is named too, with the reason; one added tomorrow stops
 *   the gate until somebody says which side it is on. Inside the roots it reads
 *   every file except the extensions that cannot hold code.
 * - Its lists come from the disk, and the side that must pass is answered by the
 *   same reader as the side that must fail: the calls that take the language as a
 *   variable — the helpers, and the two dates — are **seen**, and a sweep that
 *   saw none would say `[] === []` and look healthy. Each root is held to a file
 *   of its own, by name, because a floor on the total survives one root going
 *   blind.
 * - An exception that stopped applying fails: the entry for `useFoil.ts` goes the
 *   day its `toFixed` does, instead of excusing the next one written beside it.
 *
 * Disk does not reach the screen: `test/e2e/` reads the figures off the rendered
 * pages in both languages, with the separators written in the test.
 */

/** The code a player's screen runs. The other top-level directories are below. */
const ROOTS = ['app', 'shared'] as const

/**
 * The top-level directories the sweep does not read, and why.
 *
 * `ROOTS` is the shape that fails silently — a list of who gets in — and this is
 * what keeps it honest: `covers every top-level directory` fails when a
 * directory is on neither list.
 */
const EXCLUDED_ROOTS: Readonly<Record<string, string>> = {
  docs: 'prose, which quotes the forms it forbids',
  drizzle: 'SQL migrations',
  i18n: 'the messages themselves: text with placeholders, and no code that formats one',
  public: 'the generated dex, the sprites and the manifest: data, not code',
  scripts: 'build tooling, whose output the developer reads in a terminal',
  server: 'HTTP handlers, which answer JSON and write no screen text',
  test: 'plants each of these forms on purpose, to prove the gate sees them',
}

const CLASSIFIED: readonly string[] = [...ROOTS, ...Object.keys(EXCLUDED_ROOTS)]

/**
 * What, inside the roots, cannot hold code — enumerated, because the extension a
 * sweep *does* read is a list of who gets in, and a `.mjs` or a `.js` would fall
 * outside `['.ts', '.vue']` without a word.
 */
const NOT_SOURCE: readonly string[] = ['.css', '.png', '.svg', 'LICENSE']

const SKIP = ignoredDirectories()

/**
 * The files whose `toFixed` is meant, each with why.
 *
 * Named by file and not by line, so an addition to one of them is excused too —
 * which is why the reasons say what the file's `toFixed` is *for*, and why the
 * last test below fails when the file stops calling it at all.
 */
const TO_FIXED_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    'app/composables/useFoil.ts',
    'writes CSS custom properties (`--foil-x: 12.34%`): a stylesheet parses a dot in every language, and a comma would break the value',
  ],
  [
    'app/pages/styleguide.vue',
    'a contrast ratio in a design specimen, on a page that exists only in `yarn dev` — the build removes it, and it is not a screen of the game',
  ],
])

/**
 * Where the good side lives, by name: a file in each root that formats with the
 * language as a variable, and that the sweep has to see doing it.
 *
 * `progress.ts` holds the three helpers, which receive the language as a
 * parameter; the other two format a date with `localeProperties.value.language`.
 * Naming them is what makes each root provably swept — a count over the total
 * would stay green with `shared/` read by nobody.
 */
const LANGUAGE_AWARE: readonly string[] = [
  'shared/game/progress.ts',
  'app/pages/settings.vue',
  'app/components/SaveChoice.vue',
]

/**
 * The one file of `app/` that may name a helper of `shared/game/progress.ts`: it
 * is where the language of the URL is read and handed over.
 */
const HELPER_CALLER = 'app/composables/useGameNumbers.ts'

/**
 * A helper by its name, anywhere in the code — an import, a call, a member of a
 * namespace import. The name and not the import line, because `shared/game/` is
 * not auto-imported and so a name in code is a use, however it was brought in.
 */
const HELPER_NAME = /\b(?:gameNumber|gamePercent|gameDecimal)\b/

/** Whether a file names a helper outside its comments. */
function namesHelper(source: string): boolean {
  return HELPER_NAME.test(stripComments(source))
}

/** One place in a file, as a failure message names it. */
interface Sighting {
  readonly file: string
  readonly line: number
  /** The call as written, whitespace collapsed. */
  readonly text: string
}

interface Reading {
  readonly file: string
  /** A formatter given a locale written in the code, or no locale at all. */
  readonly fixedLocale: Sighting[]
  /** A formatter given the language as a variable — the side that must pass. */
  readonly givenLanguage: Sighting[]
  /** A `.` swapped for a `,` by hand. */
  readonly swappedSeparator: Sighting[]
  readonly toFixed: Sighting[]
}

/**
 * A formatter, with its first argument captured as written — up to the first
 * comma or closing parenthesis, which is all the question needs.
 */
const LOCALE_CALL = /(\.toLocale(?:Date|Time)?String|\bIntl\.(?:NumberFormat|DateTimeFormat))\s*\(\s*([^,)]*)/g

/**
 * `replace('.', ',')` in any quotes, and `replace(/\./g, ',')`, with `replaceAll`
 * for either. The comma is the part that makes it the defect: `replace('.', '')`
 * strips a separator and `replace(',', '.')` parses one.
 */
const SWAPPED_SEPARATOR = /\.replace(?:All)?\(\s*(?:(['"`])\.\1|\/\\\.\/[a-z]*)\s*,\s*(['"`]),\2\s*,?\s*\)/g

const TO_FIXED = /\.toFixed\s*\(/g

/** Whether the first argument of a formatter is the language, and not a locale written in place. */
function takesLanguage(first: string): boolean {
  const text = first.trim()

  if (text === '' || text === 'undefined') return false
  if (/^\[?\s*['"]/.test(text)) return false

  return !(text.startsWith('`') && !text.includes('${'))
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}

/**
 * One file read for the three forms.
 *
 * Comments are blanked first — keeping the newlines, so the line in a message is
 * the line in the file — because a rule that accuses whoever explains it is worse
 * than no rule: this very docblock quotes all three forms.
 */
function read(file: string, source: string): Reading {
  const code = stripComments(source)
  const fixedLocale: Sighting[] = []
  const givenLanguage: Sighting[] = []

  for (const match of code.matchAll(LOCALE_CALL)) {
    const call = match[1] ?? ''
    const first = (match[2] ?? '').trim()
    const sighting = { file, line: lineOf(code, match.index), text: first === '' ? `${call}()` : `${call}(${first}` }

    if (takesLanguage(first)) givenLanguage.push(sighting)
    else fixedLocale.push(sighting)
  }

  const plain = (pattern: RegExp): Sighting[] => [...code.matchAll(pattern)].map(match => ({
    file,
    line: lineOf(code, match.index),
    text: match[0].replaceAll(/\s+/g, ' '),
  }))

  return {
    file,
    fixedLocale,
    givenLanguage,
    swappedSeparator: plain(SWAPPED_SEPARATOR),
    toFixed: plain(TO_FIXED),
  }
}

function sweep(root: string): string[] {
  return walkFiles(join(REPO_ROOT, root), SKIP, name => !hasExtension(NOT_SOURCE)(name))
}

const SWEPT: ReadonlyMap<string, readonly string[]> = new Map(ROOTS.map(root => [root, sweep(root)]))

const READINGS: readonly Reading[] = [...SWEPT.values()]
  .flat()
  .map(file => read(file, readFileSync(join(REPO_ROOT, file), 'utf8')))

function named(sightings: readonly Sighting[]): string[] {
  return [...new Set(sightings.map(one => `${one.file}:${one.line} → ${one.text}`))].sort()
}

describe('what the reader sees', () => {
  /**
   * Every spelling of the first form, planted — the forms the code actually used
   * (`'pt-BR'` with and without options) and the ones it could have.
   *
   * Compared as the **lines** flagged and not as a count. The last call spans
   * four lines of source, and the line of its opening is the one a message has
   * to point at.
   */
  it('flags a formatter given a locale written in the code, or none', () => {
    const source = [
      'const a = value.toLocaleString(\'pt-BR\')',
      'const b = value.toLocaleString("en-US", { style: \'percent\' })',
      'const c = new Intl.NumberFormat(\'pt-BR\').format(value)',
      'const d = Intl.DateTimeFormat([\'pt-BR\', \'en\'])',
      'const e = date.toLocaleDateString(`pt-BR`)',
      'const f = date.toLocaleTimeString()',
      'const g = value.toLocaleString()',
      'const h = new Intl.NumberFormat(undefined, { style: \'percent\' })',
      'const i = value.toLocaleString(',
      '  \'pt-BR\',',
      '  { maximumFractionDigits: 1 },',
      ')',
    ].join('\n')

    const reading = read('planted.ts', source)

    expect(reading.fixedLocale.map(one => one.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(reading.givenLanguage).toEqual([])
  })

  /**
   * And the same mechanism answers for the other side — the good input, which the
   * tree has to be seen passing. A reader that flagged everything would pass the
   * test above and fail this one.
   */
  it('leaves a formatter alone when the language is a variable', () => {
    const source = [
      'const a = value.toLocaleString(language)',
      'const b = value.toLocaleString(localeProperties.value.language, { dateStyle: \'short\' })',
      'const c = new Intl.DateTimeFormat(locale.value).format(date)',
      'const d = value.toLocaleString(`${prefix}-${region}`)',
      'const e = value.toLocaleString(languageOf(route), { style: \'percent\' })',
    ].join('\n')

    const reading = read('planted.ts', source)

    expect(reading.fixedLocale).toEqual([])
    expect(reading.givenLanguage.map(one => one.line)).toEqual([1, 2, 3, 4, 5])
  })

  it('flags the decimal separator swapped by hand, in any quotes', () => {
    const source = [
      'const a = value.toFixed(1).replace(\'.\', \',\')',
      'const b = value.replace(".", ",")',
      'const c = value.replace(`.`, `,`)',
      'const d = value.replace(\'.\', ",")',
      'const e = value.replaceAll(\'.\', \',\')',
      'const f = value.replace(/\\./, \',\')',
      'const g = value.replace(/\\./g, \',\')',
      'const h = value.replace(\n  \'.\',\n  \',\',\n)',
    ].join('\n')

    expect(read('planted.ts', source).swappedSeparator.map(one => one.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('leaves alone the replacements that are not a decimal comma', () => {
    const source = [
      'const a = value.replace(\',\', \'.\')',
      'const b = value.replace(\'.\', \'\')',
      'const c = value.replace(/-/g, \',\')',
      'const d = value.replace(\'.\', \', \')',
      'const e = value.replace(\'a\', \'b\')',
    ].join('\n')

    expect(read('planted.ts', source).swappedSeparator).toEqual([])
  })

  it('flags every toFixed, and only a call to it', () => {
    const source = [
      'const a = value.toFixed(1)',
      'const b = (value * 100).toFixed (2)',
      'const c = value.toFixedValue(3)',
      'const toFixedDigits = 4',
    ].join('\n')

    expect(read('planted.ts', source).toFixed.map(one => one.line)).toEqual([1, 2])
  })

  it('sees a helper named in code, however it was brought in, and not in a comment', () => {
    expect(namesHelper('import { gameNumber } from \'~~/shared/game/progress\'')).toBe(true)
    expect(namesHelper('<span>{{ gamePercent(rate, \'pt-BR\') }}</span>')).toBe(true)
    expect(namesHelper('const text = progress.gameDecimal(value, \'pt-BR\')')).toBe(true)

    expect(namesHelper('// gameNumber(value, \'pt-BR\') is what this replaced')).toBe(false)
    expect(namesHelper('const { formatNumber } = useGameNumbers()')).toBe(false)
  })

  /**
   * A comment may quote what it forbids — this file's docblock does, and so do the
   * helpers' in `shared/game/progress.ts`.
   */
  it('reads past a comment', () => {
    const source = [
      '// value.toLocaleString(\'pt-BR\') is what this replaced',
      '/* value.toFixed(1).replace(\'.\', \',\') */',
      '<!-- value.toLocaleString() -->',
    ].join('\n')

    const reading = read('planted.vue', source)

    expect([reading.fixedLocale, reading.givenLanguage, reading.swappedSeparator, reading.toFixed].flat()).toEqual([])
  })
})

describe('the tree', () => {
  /**
   * The entry list, guarded by an exit list: every top-level directory is on
   * exactly one of the two, so one added tomorrow stops the gate until somebody
   * says which side it belongs on instead of being skipped in silence. And an exit
   * for a directory that is gone is a ghost, so that fails too.
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
    expect(
      Object.keys(EXCLUDED_ROOTS).filter(name => !tracked.includes(name)).sort(),
      'a directory the gate excludes that is not there any more',
    ).toEqual([])
  })

  /**
   * The other side of the sweep. With nothing read, or with no good call seen, the
   * three assertions after this one would be empty forever.
   */
  it('reads both roots, and sees the formatters that take the language in each', () => {
    for (const root of ROOTS) {
      expect(SWEPT.get(root)?.length ?? 0, `nothing was read under ${root}/`).toBeGreaterThan(0)
      expect(
        LANGUAGE_AWARE.some(file => file.startsWith(`${root}/`)),
        `no file under ${root}/ is named as formatting with the language`,
      ).toBe(true)
    }

    const seen = READINGS.filter(one => one.givenLanguage.length > 0).map(one => one.file)

    expect(
      LANGUAGE_AWARE.filter(file => !seen.includes(file)),
      'a file that formats with the language as a variable, and that the sweep no longer sees',
    ).toEqual([])
  })

  it('gives no formatter in app/ or shared/ a locale written in the code, or none', () => {
    expect(
      named(READINGS.flatMap(one => one.fixedLocale)),
      'a formatter that fixes the language, or leaves it to the device — take it from useGameNumbers() for a figure, '
      + 'and from localeProperties.value.language for a date',
    ).toEqual([])
  })

  it('swaps no decimal separator by hand', () => {
    expect(
      named(READINGS.flatMap(one => one.swappedSeparator)),
      'a figure written with a comma inside /en reads as a different number — use formatDecimal from useGameNumbers()',
    ).toEqual([])
  })

  it('calls toFixed only where an exception names the file', () => {
    expect(
      named(READINGS.filter(one => !TO_FIXED_EXCEPTIONS.has(one.file)).flatMap(one => one.toFixed)),
      'toFixed writes a dot in every language — use formatDecimal, or name the file in TO_FIXED_EXCEPTIONS with the reason',
    ).toEqual([])
  })

  /**
   * Compared as the set of files, so both sides are one answer: the composable
   * has to be **seen** naming the helpers, or an empty list would pass with the
   * reader blind, and nobody else may.
   */
  it('names the helpers of shared/game/progress.ts in the composable, and nowhere else in app/', () => {
    const callers = (SWEPT.get('app') ?? [])
      .filter(file => namesHelper(readFileSync(join(REPO_ROOT, file), 'utf8')))
      .sort()

    expect(
      callers,
      'a file of app/ that names gameNumber, gamePercent or gameDecimal — a screen takes formatNumber, formatPercent '
      + 'and formatDecimal from useGameNumbers(), which is where the language of the URL is read',
    ).toEqual([HELPER_CALLER])
  })

  /**
   * An exception that stopped being needed is one that rots: it would go on
   * excusing whatever gets written in that file next. Each one fails naming the
   * entry to delete.
   */
  it('keeps no exception for a file that has nothing left to excuse', () => {
    const stale: string[] = []

    for (const file of TO_FIXED_EXCEPTIONS.keys()) {
      const reading = READINGS.find(one => one.file === file)

      if (reading === undefined) stale.push(`${file} is no file under app/ or shared/`)
      else if (reading.toFixed.length === 0) stale.push(`${file} has no toFixed left to excuse`)
    }

    expect(stale, 'an exception with nothing left to forgive').toEqual([])
  })
})
