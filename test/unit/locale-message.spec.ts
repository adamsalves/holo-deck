import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import {
  defaultLocale,
  label,
  leafEntries,
  localeCodes,
  message,
  messagePattern,
  pluralForm,
  readLocale,
} from '../support/locales'

/**
 * The helper that renders a message for a test, measured against the library
 * that renders it for a player.
 *
 * The locale readers are what let the e2e assert on a sentence without carrying
 * a copy of it: 42 call sites under `test/e2e/`, several of them inside a loop
 * over both locales — 14 of `message()` and `messagePattern()`, the two that go
 * through `pluralForm`, and 28 of `label()` and `navLabel()`, which do not.
 * That makes them infrastructure: those assertions are only as true as this file.
 * And `pluralForm` inside them is a **reimplementation of somebody else's rule**
 * — the one thing the `CLAUDE.md` says a test may not quietly own, because a
 * copy that drifts fails by naming the screen instead of itself.
 *
 * So the plural case is not restated here. It is driven against the real
 * `vue-i18n`, fed the same raw string from the same locale file, and the two are
 * compared. When vue-i18n changes its rule, this goes red — which is the only
 * arrangement under which the copy is allowed to exist.
 *
 * The three `throw`s get tests for the reason the `CLAUDE.md` gives about gates:
 * a failure path whose message has never been seen is a failure path nobody has
 * proven exists.
 */

/** A message with more than one form, as the locale file spells it. */
function pluralKeys(code: string): string[] {
  return leafEntries(readLocale(code))
    .filter(([, value]) => typeof value === 'string' && value.includes('|'))
    .map(([key]) => key)
}

/**
 * The placeholders a message asks for, read **from the message**.
 *
 * It was a written-out fixture — `{ count, name, dust }` — and the battle
 * screens brought the first plural message with three placeholders in it, which
 * that list did not have. It failed with *sem valor para `{gym}`*: a fixture
 * that ages next to the file it feeds, which is the mistake the docblock above
 * already describes in its other form. Derived, a new placeholder arrives
 * already covered.
 *
 * The value of a placeholder is its own name, and `count` is the exception
 * because the branch depends on it. Both sides of the comparison are handed the
 * same values, so what is being measured is the **branch**, never the filling.
 */
function valuesFor(raw: string, count: number): Record<string, string | number> {
  const names = [...raw.matchAll(/\{(\w+)\}/g)].map(match => match[1] ?? '')

  return { ...Object.fromEntries(names.map(name => [name, name])), count }
}

/** The counts that separate the two plural rules, `0` first. */
const COUNTS: readonly number[] = [0, 1, 2, 5]

/**
 * The same message, rendered by the library the player's screen uses.
 *
 * Named for the library's role and not for `vue-i18n` by name: the identifier
 * gate does not know the word `vue`, and widening its tooling list for one local
 * helper would buy a name at the cost of a rule.
 */
function renderedByLibrary(code: string, key: string, raw: string, count: number): string {
  const i18n = createI18n({
    legacy: false,
    locale: code,
    // Flat, and the key sunk one level: a dotted key in a nested object would be
    // read as a path, and this compares one message at a time on purpose.
    messages: { [code]: { subject: raw } },
  })

  return i18n.global.t('subject', valuesFor(raw, count), count)
}

describe('locale message helper', () => {
  /**
   * The cross-check, and the reason this file exists.
   *
   * Every plural message of every locale, at the counts that separate the two
   * rules: `0` (where a hand-written `=== 1` is most likely to get it backwards),
   * `1`, and two plurals. Built from the locale files, never listed here — a
   * fourth plural message is measured by being written.
   *
   * **And the completeness check is a set, which it was not.** It read
   * `expect(checked.length).toBe(localeCodes().length * 3 * 4)`, where the `3`
   * was a hand-written count of plural keys — the list the `CLAUDE.md` forbids,
   * contradicting the paragraph right above it. It failed a **fourth plural
   * message written correctly in both locales** with `expected 32 to be 24`, and
   * a gate that reprimands good input is a gate someone switches off.
   *
   * The pairs come from the default locale and are demanded of every locale, so
   * the set cannot shrink to fit the defect: derived per locale, a message that
   * stopped being plural in `en` would simply leave both sides of the comparison
   * and pass. That a locale must keep the same plural forms as the default is one
   * rule with one owner — `i18n-gate`, which names the key — and this file does
   * not keep a second, weaker copy of it.
   */
  it('picks the same plural branch vue-i18n picks, message by message', () => {
    const checked: string[] = []
    const expected = localeCodes().flatMap(
      code => pluralKeys(defaultLocale()).flatMap(
        key => COUNTS.map(count => `${code} ${key} ${count}`),
      ),
    )

    for (const code of localeCodes()) {
      for (const key of pluralKeys(defaultLocale())) {
        const raw = label(key, code)

        for (const count of COUNTS) {
          expect(
            message(key, code, valuesFor(raw, count), count),
            `${key} (${code}) com count=${count}`,
          ).toBe(renderedByLibrary(code, key, raw, count))

          checked.push(`${code} ${key} ${count}`)
        }
      }
    }

    // `[] === []` passes: a locale that stopped yielding plural messages would
    // leave the loop above comparing nothing and looking healthy for it.
    expect(expected).not.toEqual([])
    expect(checked.sort()).toEqual([...expected].sort())
  })

  /**
   * And the branch the helper would have taken with three forms is the wrong
   * one — which is why it refuses instead of guessing.
   *
   * This is the divergence measured, not assumed: at `count === 1` vue-i18n
   * renders the middle form and the helper's `=== 1 ? first : last` renders the
   * first. The guard is what keeps that from ever reaching an assertion.
   */
  it('refuses a three-form message rather than diverge on it', () => {
    const raw = 'nenhuma cópia | uma cópia | {count} cópias'

    expect(renderedByLibrary('pt-BR', 'sample', raw, 1)).toBe('uma cópia')
    expect(() => pluralForm('sample', 'pt-BR', raw.split('|').map(form => form.trim()), 1))
      .toThrow(/três formas|3 formas/)
  })

  /** Two forms is the shape it does own, and it owns it in both directions. */
  it('takes the singular at exactly one, and the plural at zero', () => {
    const forms = ['uma cópia', '{count} cópias']

    expect(pluralForm('sample', 'pt-BR', forms, 1)).toBe('uma cópia')
    expect(pluralForm('sample', 'pt-BR', forms, 0)).toBe('{count} cópias')
    expect(pluralForm('sample', 'pt-BR', forms, 2)).toBe('{count} cópias')
  })

  /**
   * The three failure paths, each with its message seen.
   *
   * A missing key is the one that matters most on a screen: without the throw,
   * the e2e would look for a link named `nav.collection` and report that the bar
   * disappeared, when what was missing was a translation.
   */
  it('says which key is missing, instead of handing back the key', () => {
    expect(() => message('collection.nope', defaultLocale())).toThrow(/collection\.nope/)
  })

  it('says which placeholder had no value, instead of rendering the braces', () => {
    expect(() => message('collection.forge.cost', defaultLocale())).toThrow(/\{dust\}/)
  })

  it('says a message has a plural, instead of joining both halves with a pipe', () => {
    expect(() => message('collection.card.copies', defaultLocale(), { count: 2 }))
      .toThrow(/plural/)
  })

  /**
   * The pattern keeps everything it does know.
   *
   * A gap for the value the caller cannot name, and the sentence around it
   * escaped — so the pattern still goes red when the wording changes, which is
   * the entire reason the e2e reads it from the locale instead of typing it.
   */
  it('leaves a gap only where the caller omitted a value, and escapes the rest', () => {
    const pattern = messagePattern('packs.opening.revealed', defaultLocale(), { total: 10 })
    const rendered = message('packs.opening.revealed', defaultLocale(), { revealed: 3, total: 10 })

    expect(pattern.test(rendered)).toBe(true)
    expect(pattern.test(rendered.replace('/', 'de'))).toBe(false)
  })
})
