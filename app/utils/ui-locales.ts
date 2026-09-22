import { en, pt_br } from '@nuxt/ui/locale'
import type { LocaleCode } from './locales'

/**
 * The Nuxt UI primitives in each language of the game — closing a modal,
 * paging, the date picker.
 *
 * Nuxt UI ships 128 locales, so nothing here is translated by hand; what is
 * missing is the wire between a locale of `@nuxtjs/i18n` and the `:locale` of
 * `UApp`.
 *
 * **The map is written out because the two sides name a locale differently.**
 * Nuxt UI exports `pt_br` — snake_case, an identifier — and the code of the
 * locale is `pt-BR`, a BCP 47 tag. The `locales[locale.value]` the documentation
 * shows returns `undefined` for this project's default. Named imports and not the
 * namespace, too: iterating `import * as` would pull all 128 into the bundle.
 *
 * **A `Record` over `LocaleCode`, and that is the gate issue #40 asked for.**
 * The map used to live in `app.vue` as a plain object with a fallback to
 * Portuguese, and nothing compared it with the config: a third language added
 * to both the config and `i18n/locales/` passed every test and drew its
 * primitives in Portuguese. Now the codes come from the same list the config
 * reads, and a language missing here is a compile error. What the compiler
 * cannot see — `'pt-BR': en`, a map that is complete and wrong — is asked by
 * `test/unit/ui-locales.spec.ts`.
 */
export const UI_LOCALES: Readonly<Record<LocaleCode, typeof en>> = {
  'pt-BR': pt_br,
  'en': en,
}
