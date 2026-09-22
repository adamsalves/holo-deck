import { describe, expect, it } from 'vitest'
import { LOCALES } from '../../app/utils/locales'
import { UI_LOCALES } from '../../app/utils/ui-locales'
import { localeCodes } from '../support/locales'

/**
 * The languages of the game are one list, and three things have to agree with
 * it: the translation files, the Nuxt UI primitives, and the pages the build
 * writes. This file asks the first two. The third is read from the HTML by
 * `test/e2e/locale-head.spec.ts`, and the primitives on screen by
 * `test/e2e/language.spec.ts` — the compiler and this file only see the map.
 *
 * **Issue #40 is what this closes.** The map lived in `app.vue` with a fallback
 * to Portuguese, and nothing compared it with the config: a third language added
 * to the config and to `i18n/locales/` passed every test and drew its modals and
 * command palette in Portuguese. The list moved to `app/utils/locales.ts`, the
 * config reads it, and the map became a `Record` over its codes — a language
 * missing from the map is a compile error now. What is left for a test is what
 * a type cannot say.
 */
describe('the language list', () => {
  const codes = LOCALES.map(locale => locale.code)

  // The other side: with one language every comparison below is about nothing.
  it('has more than one language', () => {
    expect(codes.length).toBeGreaterThan(1)
  })

  /**
   * The list and the directory are two sources, and that is the point of
   * comparing them. A translation file nobody declared is a language the build
   * never writes; a declared language with no file is one the module cannot
   * load. Both directions, as sets.
   */
  it('names every translation file, and every translation file is named', () => {
    expect([...codes].sort(), 'the declared languages and the files in i18n/locales/ disagree')
      .toEqual(localeCodes())
  })

  /**
   * At runtime too, and not only at `yarn typecheck`: the `Record` is what
   * catches a language added to the list, and this is what catches the map
   * growing a key the list does not have, which an object literal only refuses
   * while it stays a literal.
   */
  it('has the primitives of every language, and of no other', () => {
    expect(Object.keys(UI_LOCALES).sort(), 'UI_LOCALES and the language list disagree')
      .toEqual([...codes].sort())
  })

  /**
   * And each language gets its own — the defect a complete map can still carry.
   *
   * `'pt-BR': en` compiles: every key is there and every value has the right
   * type. The code inside each Nuxt UI locale is Nuxt UI's, not this project's,
   * so comparing it with the language it was filed under is a second source and
   * not the map reading itself back.
   */
  it('gives each language the primitives of that language', () => {
    const misfiled = LOCALES
      .filter(locale => UI_LOCALES[locale.code].code !== locale.code)
      .map(locale => `${locale.code} → ${UI_LOCALES[locale.code].code}`)

    expect(misfiled, 'these languages would draw the Nuxt UI primitives of another one').toEqual([])
  })
})
