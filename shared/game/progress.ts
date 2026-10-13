/**
 * O progresso de coleção — a fração capturada, e o degrau que ela pinta.
 *
 * A regra mora aqui, e não no CSS, pelo mesmo motivo que os limiares de raridade
 * moram em `rarity.ts`: uma faixa declarada só em folha de estilo é uma faixa
 * que nenhum portão alcança, e a página `/rules` da Fase 6 não teria de onde
 * lê-la. O CSS publica as três cores; quem decide qual delas é esta função.
 */

/**
 * Os dois limiares, em fração.
 *
 * As pranchas *Coleção* e *Hub* desenham três pontos — Kanto a 65% em verde,
 * Johto a 31% em azul, Hoenn a 7% em neutro — e é só isso que o canvas fixa. Os
 * cortes em 50% e 15% são a escolha mais simples que reproduz os três: metade do
 * dex da região é o marco que separa "adiantado" de "no meio", e 15% separa
 * "começou" de "mal encostou".
 *
 * Fração e não porcentagem, pela mesma razão que `RngCursor.chance`: a conta é
 * feita em fração, a tela é que multiplica por 100, e um único número que aceite
 * as duas unidades é como alguém passa `50` querendo metade.
 */
export const PROGRESS_THRESHOLDS = { high: 0.5, mid: 0.15 } as const

/**
 * Os quatro estados da barra. `empty` é um deles, e não a ausência dos outros: a
 * prancha desenha Sinnoh em diante com a trilha **vazia**, sem preenchimento
 * nenhum, e um degrau `low` de largura zero seria a mesma coisa na tela e uma
 * coisa diferente no código — o que apareceria no dia em que o degrau baixo
 * ganhasse borda ou brilho.
 */
export type ProgressStep = 'empty' | 'low' | 'mid' | 'high'

/**
 * A fração capturada de um conjunto.
 *
 * Devolve 0 para um total de zero em vez de `NaN`. Não é defensividade solta:
 * uma região sem espécie não existe no dex de hoje, mas a mesma função conta
 * tier no binder, e um tier vazio — mítico antes do primeiro mítico — é o caso
 * normal, não o excepcional.
 */
export function progressRatio(owned: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, owned / total))
}

export function progressStep(ratio: number): ProgressStep {
  if (ratio <= 0) return 'empty'
  if (ratio >= PROGRESS_THRESHOLDS.high) return 'high'
  if (ratio >= PROGRESS_THRESHOLDS.mid) return 'mid'
  return 'low'
}

/** O que a tela escreve: `98 / 151`. Existe para a formatação não se repetir. */
export function progressLabel(owned: number, total: number): string {
  return `${owned} / ${total}`
}

/**
 * The unit a decimal figure may carry. One for now: the weight of the thumbnails,
 * in *Settings*.
 */
export type GameUnit = 'megabyte'

/**
 * A figure of the game as `language` writes it — `1.600` in pt-BR, `1,600` in
 * English.
 *
 * The board *Coleção* draws `custa 1.600 pó` and `FALTAM 1.260 PÓ` with the dot,
 * and `1600` in the table beside them. That is the mockup disagreeing with itself
 * and not a decision, so the grouping applies everywhere: two spellings of one
 * value on one screen is worse than departing from one corner of the board. The
 * pt-BR spelling is the board's; the English one is the same figure in the
 * format of its own language, recorded in `docs/canvas-divergences.md`.
 *
 * **The language is a parameter, and it has no default.** This helper used to
 * fix `pt-BR`, on the argument that the figure sits in the middle of a sentence
 * in Portuguese and a device set to English would read `1,600` inside it. The
 * argument held while every page was Portuguese. Inside `/en` it wrote `1.600`,
 * which an English reader takes for 1.6 — a wrong value, not an odd-looking one
 * (issue #49). A default would bring the defect back for whoever forgets the
 * argument, so leaving it out does not compile. Screens do not pass it by hand:
 * `useGameNumbers()` supplies the language of the URL.
 */
export function gameNumber(value: number, language: string): string {
  return value.toLocaleString(language)
}

/**
 * A rate of the game as a percentage, from the **fraction** — `0.25` becomes
 * `25%`, and `0.045` becomes `4,5%` in pt-BR and `4.5%` in English.
 *
 * `Intl` with `style: 'percent'`, and not a multiplication by 100 followed by
 * `toFixed`, for two reasons that add up:
 *
 * - **The decimal shows only when it exists.** `25%` and `4.5%`, without the
 *   `25.0%` a fixed `toFixed(1)` would write and without the `4%` a
 *   `toFixed(0)` would cut.
 * - **Nobody writes `100`.** The page `/rules` is contracted to hold no
 *   calibrated number, and `GYM_REWARD_STEP` is exactly 100 — the base of a
 *   percentage written by hand collided with it, and the gate cannot tell the
 *   two apart. With the formatter the collision does not exist.
 *
 * The language is a parameter for the reason `gameNumber` gives.
 */
export function gamePercent(fraction: number, language: string): string {
  return fraction.toLocaleString(language, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
}

/**
 * A figure with a fixed count of decimals — `1,5` in pt-BR and `1.5` in English.
 *
 * It replaces `toFixed(places)` followed by a `.replace('.', ',')` written by
 * hand, which put the pt-BR comma on the English pages: `0,8% of the dex`,
 * `0,7 m`, `×1,5`. The same rule as the other two, for the same reason: the
 * language is a parameter, with no default.
 *
 * `unit` is for the one figure that carries its own: the thumbnails' weight in
 * *Settings*, which the board writes as `6,0 MB` and `6.0 MB`.
 */
export function gameDecimal(value: number, language: string, places = 1, unit?: GameUnit): string {
  return value.toLocaleString(language, {
    ...(unit === undefined ? {} : { style: 'unit', unit }),
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}
