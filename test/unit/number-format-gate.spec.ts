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
 * It charges five forms — the first four in `app/` and in `shared/`, the last
 * in `app/`:
 *
 * 1. **A locale-sensitive formatter given a locale written in the code, or none.**
 *    `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` and every
 *    member of `Intl` that is called. A literal fixes the language for every
 *    page; no argument hands it to the *device*, which is neither the URL's
 *    choice nor the one the page was prerendered in.
 * 2. **A formatter called anywhere but in the files named for it**, whatever it
 *    is given. See below: it is what the first form cannot see.
 * 3. **The decimal separator swapped by hand** — anything replaced by a `,`, in
 *    any quotes and as a string, a regular expression or a name, through
 *    `replace` or `replaceAll`, and a `split('.')` joined by one. It is the same
 *    defect as the first, written without `Intl`.
 * 4. **`toFixed` and `toPrecision`**, outside the named exceptions. They write a
 *    dot in every language, and the way out of them is the way out of the third
 *    form.
 * 5. **A function of `shared/` that formats, named outside `useGameNumbers`.**
 *    Such a function takes the language as an argument, so a screen that called
 *    one could write the tag in place: `gameNumber(coins, 'pt-BR')` is none of
 *    the forms above, and it is the first one with a function in between. The
 *    functions are found by what they do and not listed by name, so a fourth
 *    one is held the day it is written.
 *
 * The argument of a formatter is judged by its **shape**: a quoted string, an
 * array of one, `undefined` or nothing is wrong, and anything else *looks like*
 * the language. A look is all it is — `DEFAULT_LOCALE`, `navigator.language` and
 * `language ?? 'pt-BR'` have the same shape as `localeProperties.value.language`,
 * and each of them is the defect. So the shape only sorts the calls, and the
 * second form is what decides: the files that call a formatter with something
 * that looks like the language are compared, as a set, with `LANGUAGE_AWARE`.
 * A screen that formats in place fails there whatever it passes, and the way out
 * is `useGameNumbers()`. Inside the named files the argument is read by a
 * person, when the file is named; `progress.spec.ts` holds the helpers besides,
 * with the figures asserted in two languages and the language parameter asserted
 * to have no default.
 *
 * What it does not see: a replacement passed by name (`replace('.', SEPARATOR)`),
 * and a number put together digit by digit. Those are the screen's to catch, and
 * `test/e2e/` reads it.
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
 *   variable — the helpers, the two dates and the list of types — are **seen**,
 *   and a sweep that saw none would say `[] === []` and look healthy. Each root
 *   is held to a file of its own, by name, because a floor on the total survives
 *   one root going blind.
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
 * directory is on neither list. A *file* at the top level is on neither, and is
 * not read: they are the configuration of the tools, and none of them is rendered.
 */
const EXCLUDED_ROOTS: Readonly<Record<string, string>> = {
  docs: 'prose, which quotes the forms it forbids',
  drizzle: 'SQL migrations',
  i18n: 'the messages themselves: text with placeholders, and no code that formats one',
  public: 'the generated dex, the sprites and the manifest: data, not code',
  scripts: 'build tooling, read in a terminal — and the service worker, which does run in the player\'s browser, '
    + 'and answers requests without writing a figure',
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
 * Every file that calls a formatter, by name — the good side, and the whole of it.
 *
 * `progress.ts` holds the helpers, which receive the language as a parameter;
 * `settings.vue` and `SaveChoice.vue` format a date with
 * `localeProperties.value.language`, and `Slot.vue` joins a list of types with
 * `locale.value`. Naming them is what makes each root provably swept — a count
 * over the total would stay green with `shared/` read by nobody — and comparing
 * the **set** is what makes a formatter written anywhere else fail, whatever it
 * was given.
 */
const LANGUAGE_AWARE: readonly string[] = [
  'shared/game/progress.ts',
  'app/pages/settings.vue',
  'app/components/SaveChoice.vue',
  'app/components/deck/Slot.vue',
]

/**
 * The one file of `app/` that may name a function of `shared/` that formats: it
 * is where the language of the URL is read and handed over.
 */
const HELPER_CALLER = 'app/composables/useGameNumbers.ts'

/**
 * Whether a file names one of `names` outside its comments — an import, a call,
 * a member of a namespace import. The name and not the import line, because
 * `shared/game/` is not auto-imported and so a name in code is a use, however it
 * was brought in.
 */
function namesHelper(source: string, names: readonly string[]): boolean {
  // No name is no helper: an empty alternation would match every file there is.
  return names.length > 0 && new RegExp(`\\b(?:${names.join('|')})\\b`).test(stripComments(source))
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
  /** A formatter given something with the shape of the language — the side that is compared by file. */
  readonly givenLanguage: Sighting[]
  /** A `.` swapped for a `,` by hand. */
  readonly swappedSeparator: Sighting[]
  readonly toFixed: Sighting[]
}

/**
 * A formatter, with its first argument captured as written — up to the first
 * comma or closing parenthesis, which is all the question needs — and whichever
 * of the two ended it.
 *
 * Any member of `Intl` that is called, and not a list of the two the code used:
 * `Intl.RelativeTimeFormat('pt-BR')` is the same defect, and a list of
 * constructors is a list of who gets in. The call may be optional (`?.(`).
 */
const LOCALE_CALL = /(\.toLocale(?:Date|Time)?String|\bIntl\.\w+)\s*(?:\?\.)?\s*\(\s*([^,)]*)([,)]?)/g

/**
 * `Intl` without a member after it — `const { NumberFormat } = Intl` — which
 * takes the constructor to where `LOCALE_CALL` does not follow it.
 */
const NAMESPACE_TAKEN_APART = /\bIntl\b(?!\s*\.)/g

/** One alternative per quote, each closing with the quote it opened with. */
function quoted(body: (quote: string) => string): string {
  return ['\'', '"', '`'].map(quote => `${quote}${body(quote)}${quote}`).join('|')
}

/** What a `replace` may be handed first: a string, a regular expression, or a name. */
const SEARCHED = [
  quoted(quote => `[^${quote}\\n]*`),
  String.raw`\/(?:\\.|\[[^\]\n]*\]|[^/\\\n])+\/[a-z]*`,
  String.raw`[\w$.]+`,
].join('|')

/**
 * A replacement that is a comma with a digit to follow: `','` and `',$1'`, and
 * not `', '`, which separates the items of a list.
 */
const COMMA_FIRST = quoted(quote => `,(?!\\s)[^${quote}\\n]*`)

/**
 * **Anything** replaced by a comma, through `replace` or `replaceAll`, and a
 * `split('.')` joined by one.
 *
 * The comma is the part that makes it the defect, and so it is the only part
 * that is asked: `replace('.', '')` strips a separator and `replace(',', '.')`
 * parses one. What is replaced is not asked, because `/[.]/`, `/\.(\d)/` and a
 * name are the dot written three other ways — and nothing in `app/` or `shared/`
 * replaces anything by a comma for another reason.
 */
const SWAPPED_SEPARATOR = new RegExp(
  String.raw`\.replace(?:All)?\(\s*(?:${SEARCHED})\s*,\s*(?:${COMMA_FIRST})\s*,?\s*\)`
  + String.raw`|\.split\(\s*(?:${quoted(() => String.raw`\.`)})\s*\)\s*\.join\(\s*(?:${quoted(() => ',')})\s*\)`,
  'g',
)

/** `toFixed`, and `toPrecision` beside it: the two that write a dot whatever the language. */
const TO_FIXED = /\.to(?:Fixed|Precision)\s*\(/g

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
 * One file read for the forms a line can show.
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
    const rest = match[3] === ',' ? ', …' : ''
    const sighting = { file, line: lineOf(code, match.index), text: `${call}(${first}${rest})` }

    if (takesLanguage(first)) givenLanguage.push(sighting)
    else fixedLocale.push(sighting)
  }

  for (const match of code.matchAll(NAMESPACE_TAKEN_APART)) {
    fixedLocale.push({ file, line: lineOf(code, match.index), text: 'Intl, taken apart' })
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

/** A top-level declaration of a file, with the code under it up to the next one. */
interface Declaration {
  readonly file: string
  readonly name: string
  readonly exported: boolean
  /** Where the code starts in the file, comments blanked. */
  readonly start: number
  readonly code: string
}

const DECLARATION = /^(export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm

function declarations(file: string, source: string): Declaration[] {
  const code = stripComments(source)
  const starts = [...code.matchAll(DECLARATION)]

  return starts.map((match, index) => ({
    file,
    name: match[2] ?? '',
    exported: match[1] !== undefined,
    start: match.index,
    code: code.slice(match.index, starts[index + 1]?.index ?? code.length),
  }))
}

/**
 * The declarations that format: the ones that call a formatter, and the ones
 * that name one of those, to the end of the chain.
 *
 * By what the code **does**, and not by the name of a parameter or by a list:
 * `gameNumber`, `gamePercent` and `gameDecimal` were three names written here,
 * and a fourth helper beside them walked past with `'pt-BR'` written at its call
 * (review of #109). A helper that formats *through* another is one too, which is
 * why the chain is followed.
 */
function formatting(all: readonly Declaration[]): Declaration[] {
  const found = new Set(all.filter(one => one.code.search(LOCALE_CALL) !== -1))

  for (let size = -1; size !== found.size;) {
    size = found.size
    const names = [...found].map(one => one.name)

    for (const one of all) {
      // Past its own name, or every declaration would be found naming itself.
      if (namesHelper(one.code.slice(one.code.indexOf(one.name) + one.name.length), names)) found.add(one)
    }
  }

  return all.filter(one => found.has(one))
}

function sweep(root: string): string[] {
  return walkFiles(join(REPO_ROOT, root), SKIP, name => !hasExtension(NOT_SOURCE)(name))
}

const SWEPT: ReadonlyMap<string, readonly string[]> = new Map(ROOTS.map(root => [root, sweep(root)]))

const READINGS: readonly Reading[] = [...SWEPT.values()]
  .flat()
  .map(file => read(file, readFileSync(join(REPO_ROOT, file), 'utf8')))

const SHARED_DECLARATIONS: readonly Declaration[] = (SWEPT.get('shared') ?? [])
  .flatMap(file => declarations(file, readFileSync(join(REPO_ROOT, file), 'utf8')))

const SHARED_FORMATTING: readonly Declaration[] = formatting(SHARED_DECLARATIONS)

/** What a screen may not name: the functions of `shared/` that format, and that leave their file. */
const HELPERS: readonly string[] = SHARED_FORMATTING.filter(one => one.exported).map(one => one.name).sort()

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
      'const j = new Intl.RelativeTimeFormat(\'pt-BR\')',
      'const k = value.toLocaleString?.(\'pt-BR\')',
      'const { NumberFormat } = Intl',
    ].join('\n')

    const reading = read('planted.ts', source)

    expect(reading.fixedLocale.map(one => one.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15])
    expect(reading.givenLanguage).toEqual([])
    expect(reading.fixedLocale.map(one => one.text).slice(0, 2)).toEqual([
      '.toLocaleString(\'pt-BR\')',
      '.toLocaleString("en-US", …)',
    ])
  })

  /**
   * And the same mechanism answers for the other side — the good input, which the
   * tree has to be seen passing. A reader that flagged everything would pass the
   * test above and fail this one.
   *
   * The last three are **not** the language, and they have its shape. A reader of
   * one line cannot tell them from the first five, and it does not try: it sorts
   * them to this side, and `the tree` compares the files on this side by name.
   */
  it('takes anything else for the language, the device and a constant included', () => {
    const source = [
      'const a = value.toLocaleString(language)',
      'const b = value.toLocaleString(localeProperties.value.language, { dateStyle: \'short\' })',
      'const c = new Intl.DateTimeFormat(locale.value).format(date)',
      'const d = value.toLocaleString(`${prefix}-${region}`)',
      'const e = new Intl.ListFormat(languageOf(route), { type: \'conjunction\' })',
      'const f = value.toLocaleString(DEFAULT_LOCALE)',
      'const g = value.toLocaleString(navigator.language)',
      'const h = value.toLocaleString(language ?? \'pt-BR\')',
    ].join('\n')

    const reading = read('planted.ts', source)

    expect(reading.fixedLocale).toEqual([])
    expect(reading.givenLanguage.map(one => one.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  /**
   * The last five are the dot written another way — a class, a group, a name, any
   * other character, and a `split` — and each walked past while the pattern asked
   * for a dot in quotes (review of #109).
   */
  it('flags anything replaced by a comma, in any quotes', () => {
    const source = [
      'const a = value.toFixed(1).replace(\'.\', \',\')',
      'const b = value.replace(".", ",")',
      'const c = value.replace(`.`, `,`)',
      'const d = value.replace(\'.\', ",")',
      'const e = value.replaceAll(\'.\', \',\')',
      'const f = value.replace(/\\./, \',\')',
      'const g = value.replace(/\\./g, \',\')',
      'const h = value.replace(\n  \'.\',\n  \',\',\n)',
      'const i = String(value).replace(/[.]/, \',\')',
      'const j = String(value).replace(/\\.(\\d)/, \',$1\')',
      'const k = String(value).replace(DOT, \',\')',
      'const l = value.replace(/-/g, \',\')',
      'const m = String(value).split(\'.\').join(\',\')',
    ].join('\n')

    expect(read('planted.ts', source).swappedSeparator.map(one => one.line))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16])
  })

  it('leaves alone the replacements that put no comma in a number', () => {
    const source = [
      'const a = value.replace(\',\', \'.\')',
      'const b = value.replace(\'.\', \'\')',
      'const c = value.replace(\'.\', \', \')',
      'const d = value.replace(\'a\', \'b\')',
      'const e = items.map(canonical).join(\',\')',
      'const f = value.split(\',\').join(\'.\')',
    ].join('\n')

    expect(read('planted.ts', source).swappedSeparator).toEqual([])
  })

  it('flags every toFixed and toPrecision, and only a call to one', () => {
    const source = [
      'const a = value.toFixed(1)',
      'const b = (value * 100).toFixed (2)',
      'const c = value.toFixedValue(3)',
      'const toFixedDigits = 4',
      'const d = value.toPrecision(2)',
    ].join('\n')

    expect(read('planted.ts', source).toFixed.map(one => one.line)).toEqual([1, 2, 5])
  })

  it('sees a helper named in code, however it was brought in, and not in a comment', () => {
    const names = ['gameNumber', 'gamePercent', 'gameDecimal']

    expect(namesHelper('import { gameNumber } from \'~~/shared/game/progress\'', names)).toBe(true)
    expect(namesHelper('<span>{{ gamePercent(rate, \'pt-BR\') }}</span>', names)).toBe(true)
    expect(namesHelper('const text = progress.gameDecimal(value, \'pt-BR\')', names)).toBe(true)

    expect(namesHelper('// gameNumber(value, \'pt-BR\') is what this replaced', names)).toBe(false)
    expect(namesHelper('const { formatNumber } = useGameNumbers()', names)).toBe(false)
    expect(namesHelper('import { gameNumber } from \'~~/shared/game/progress\'', [])).toBe(false)
  })

  /**
   * A function is a helper for what it does. `direct` calls its parameter `tag`,
   * `through` is an arrow that formats by calling a function that never leaves
   * the file, and `twice` only calls `through` — the three are found, and
   * `ratio`, which does arithmetic beside them, is not.
   */
  it('finds the functions that format, and the ones that format through them', () => {
    const source = [
      'const PLACES = 1',
      'function plain(value: number, language: string) {',
      '  return value.toLocaleString(language, { maximumFractionDigits: PLACES })',
      '}',
      'export function direct(value: number, tag: string) {',
      '  return new Intl.NumberFormat(tag).format(value)',
      '}',
      'export const through = (value: number, language: string) => `+${plain(value, language)}`',
      'export function twice(value: number, language: string) {',
      '  return through(value, language)',
      '}',
      'export function ratio(owned: number, total: number) {',
      '  return owned / total',
      '}',
    ].join('\n')

    const found = formatting(declarations('planted.ts', source))

    expect(found.map(one => one.name)).toEqual(['plain', 'direct', 'through', 'twice'])
    expect(found.filter(one => one.exported).map(one => one.name)).toEqual(['direct', 'through', 'twice'])
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
   * for a directory that is gone is a ghost, so that fails too. One comparison of
   * the two sets says both, and a root that is gone besides.
   */
  it('covers every top-level directory', () => {
    const present = readdirSync(REPO_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .filter(name => !SKIP.has(name))

    expect(
      present.sort(),
      'the top-level directories on disk are not the ones this gate sorted — one more is neither swept nor '
      + 'deliberately left out, and one fewer is a directory it still names and that is gone',
    ).toEqual([...CLASSIFIED].sort())
  })

  /**
   * The other side of the sweep, and the second form.
   *
   * With nothing read, or with no good call seen, the assertions after this one
   * would be empty forever — so each root has a file named. And the files are
   * compared as a **set**: while the named ones only had to be among the ones
   * seen, `progress.coins.toLocaleString(DEFAULT_LOCALE)` in the global bar passed
   * here and wrote `1.600 COINS` inside `/en` (review of #109). A file more is a
   * formatter called where nobody reads its argument; a file fewer is one the
   * sweep went blind to.
   */
  it('reads both roots, and sees a formatter called in the named files and in no other', () => {
    for (const root of ROOTS) {
      expect(SWEPT.get(root)?.length ?? 0, `nothing was read under ${root}/`).toBeGreaterThan(0)
      expect(
        LANGUAGE_AWARE.some(file => file.startsWith(`${root}/`)),
        `no file under ${root}/ is named as formatting with the language`,
      ).toBe(true)
    }

    expect(
      READINGS.filter(one => one.givenLanguage.length > 0).map(one => one.file).sort(),
      'the files that call a formatter are not the ones LANGUAGE_AWARE names — a file more formats in place: take a '
      + 'figure from useGameNumbers(), or name the file with what it passes; a file fewer is one the sweep no longer sees',
    ).toEqual([...LANGUAGE_AWARE].sort())
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

  it('calls toFixed and toPrecision only where an exception names the file', () => {
    expect(
      named(READINGS.filter(one => !TO_FIXED_EXCEPTIONS.has(one.file)).flatMap(one => one.toFixed)),
      'toFixed and toPrecision write a dot in every language — use formatDecimal, or name the file in '
      + 'TO_FIXED_EXCEPTIONS with the reason',
    ).toEqual([])
  })

  /**
   * What makes the list of helpers the whole of it: a formatter in `shared/` that
   * sits under no declaration — in a file's first lines, before any — belongs to
   * no function, and the next test would not know whose name to look for.
   */
  it('finds every formatter of shared/ inside a function it can name', () => {
    const inside = (file: string, index: number): boolean => SHARED_FORMATTING
      .some(one => one.file === file && index >= one.start && index < one.start + one.code.length)

    const orphans = (SWEPT.get('shared') ?? []).flatMap((file) => {
      const code = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

      return [...code.matchAll(LOCALE_CALL)]
        .filter(match => !inside(file, match.index))
        .map(match => `${file}:${lineOf(code, match.index)}`)
    })

    expect(orphans, 'a formatter under shared/ that no declaration holds').toEqual([])
  })

  /**
   * Compared as the set of files, so both sides are one answer: the composable
   * has to be **seen** naming a helper, or an empty list would pass with the
   * reader blind, and nobody else may. With no helper found at all, nobody is
   * seen and it fails the same way.
   */
  it('names the functions of shared/ that format in the composable, and nowhere else in app/', () => {
    const callers = (SWEPT.get('app') ?? [])
      .filter(file => namesHelper(readFileSync(join(REPO_ROOT, file), 'utf8'), HELPERS))
      .sort()

    expect(
      callers,
      `the files of app/ that name a function of shared/ that formats (${HELPERS.join(', ')}) — a screen takes `
      + 'formatNumber, formatPercent and formatDecimal from useGameNumbers(), which is where the language of the URL is read',
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
