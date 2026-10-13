import type { GameUnit } from '~~/shared/game/progress'
import { gameDecimal, gameNumber, gamePercent } from '~~/shared/game/progress'

/**
 * The game's figures, written the way the language of the URL writes them.
 *
 * The three helpers in `shared/game/progress.ts` take the language as a required
 * parameter, because `shared/` has no way to know it. This is what knows, and it
 * is the only file in `app/` that imports them: a screen asks for the three
 * functions below and never passes a language. `number-format-gate` holds that:
 * a screen that named a helper and wrote the tag by hand would still compile, so
 * a helper named in any other file of `app/` fails there.
 *
 * - `formatNumber` — a whole figure, grouped: `1.600` in pt-BR, `1,600` in English.
 * - `formatPercent` — a rate, from the **fraction**: `4,5%` and `4.5%`.
 * - `formatDecimal` — a fixed count of decimals, one by default: `1,5` and `1.5`.
 *
 * **The language is read when the function is called, and not once at setup.**
 * A template or a `computed` that calls one of these tracks the locale, so the
 * figure follows it; capturing the tag in a constant would freeze it to the
 * language the component was created in.
 *
 * **It is `localeProperties.language` and not `locale`**, the same choice
 * `backupLabel` and `stamp` make for the dates: the first is the BCP-47 tag the
 * config declares — `en-US`, not the `en` that names the route — and the one
 * `<html lang>` carries. The module types it as optional, and the config
 * declares it for every locale; the route's code stands in only to keep the type
 * a plain `string`, since a missing tag must not fall to the device's own locale,
 * which is the defect this composable exists to end.
 *
 * Call it in the setup, before any `await`, like `useI18n()` beside it.
 */
export function useGameNumbers() {
  const { locale, localeProperties } = useI18n()

  const language = (): string => localeProperties.value.language ?? locale.value

  return {
    formatNumber: (value: number): string => gameNumber(value, language()),
    formatPercent: (fraction: number): string => gamePercent(fraction, language()),
    formatDecimal: (value: number, places = 1, unit?: GameUnit): string =>
      gameDecimal(value, language(), places, unit),
  }
}
