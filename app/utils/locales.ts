/**
 * The languages the game speaks — the one list that the config, the selector,
 * the root guard and the gates all read.
 *
 * **It used to be written inside `nuxt.config.ts`, and that is why it moved.**
 * Three other places need the same codes: the Nuxt UI primitives map
 * (`UI_LOCALES`), the language selector in *Settings*, and the inline script
 * that sends the root to the language this device remembers. With the list
 * inside the config, each of them either kept a copy or read the config as
 * text, and a third language would have reached some and not the others —
 * issue #40 is that failure, written down before it happened.
 *
 * **`as const`, and the type comes from the list.** Adding a language is adding
 * it here, and every `Record<LocaleCode, …>` in the app stops compiling until it
 * is handled. The other direction — an array annotated with a union written by
 * hand — goes short in silence when the union grows: measured in PR #61, where a
 * fourth `RecoveryReason` compiled and the screen would have drawn the raw key.
 *
 * `code` is the internal name: the file under `i18n/locales/` and the URL
 * prefix. `language` is the BCP 47 tag that goes to `lang`, `hreflang` and
 * `og:locale`. They differ for English — `en` against `en-US`.
 *
 * The order is the order the selector draws, and the board draws `PT-BR | EN`.
 *
 * It lives in `app/utils/` and not in `shared/`, which is where a list read by
 * the build and the app would usually go: `shared-text-gate` reads every literal
 * under `shared/` as screen text until something built from a source excuses
 * it, and `en-US` would be the first language tag it met. The one it already
 * excuses, `pt-BR`, is excused **as a marker for issue #49** — a second
 * `pt-BR` written there would keep that exception alive after #49 closes, and
 * the gate would stop saying the defect is still open.
 */
export const LOCALES = [
  { code: 'pt-BR', language: 'pt-BR' },
  { code: 'en', language: 'en-US' },
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

/** The language with no URL prefix: `/collection` is Portuguese, `/en/collection` is not. */
export const DEFAULT_LOCALE: LocaleCode = 'pt-BR'

/**
 * Where `path` lives in `code`: as it is for the default, under `/<code>` for
 * the rest — the `prefix_except_default` strategy the config declares.
 *
 * Inside the app the module answers this (`localePath`, `switchLocalePath`).
 * This exists for the two places that run before or outside it: the config,
 * which lists the prerender routes the crawler cannot reach, and the root guard,
 * which runs before the app exists.
 */
export function pathInLocale(path: string, code: LocaleCode): string {
  if (code === DEFAULT_LOCALE) return path

  return path === '/' ? `/${code}` : `/${code}${path}`
}
