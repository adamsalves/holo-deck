/**
 * Contraste WCAG 2.1, para o tema ser verificado e não apenas afirmado.
 *
 * Mora em `shared/` porque tem dois leitores que precisam concordar: o portão de
 * tema, que reprova o build, e o espelho em `/styleguide`, que mostra a razão ao
 * lado de cada papel. Enquanto a conta estava só no teste, o espelho exibia
 * números escritos à mão — e um número escrito à mão não acompanha a paleta.
 *
 * Nada aqui depende de DOM: a razão de contraste é aritmética sobre dois hex.
 */

/** Limiar AA para texto normal. */
export const AA_NORMAL = 4.5

/** Limiar AA para texto grande (≥ 18.66px negrito, ou ≥ 24px). */
export const AA_LARGE = 3

/**
 * Limiar do critério 1.4.11 — contraste de elemento não textual.
 *
 * Vale 3, o mesmo número de `AA_LARGE`, e mesmo assim é uma constante separada:
 * são critérios diferentes sobre coisas diferentes — um mede texto grande, o
 * outro mede contorno de componente e limite de controle, como o anel de foco.
 * Escrever `AA_LARGE` num anel de foco daria o número certo pelo motivo errado,
 * e no dia em que um dos dois mudar o outro iria junto sem ninguém notar.
 */
export const NON_TEXT = 3

type Channels = [number, number, number]

function byte(pair: string): number {
  return Number.parseInt(pair, 16)
}

/** Hex curto ou longo → os três canais em 0..255. `null` no que não for hex. */
export function parseHex(hex: string): Channels | null {
  const trimmed = hex.trim()

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed)
  if (short !== null) {
    const [, r, g, b] = short
    if (r === undefined || g === undefined || b === undefined) return null

    return [byte(r + r), byte(g + g), byte(b + b)]
  }

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(trimmed)
  if (long === null) return null

  const [, r, g, b] = long
  if (r === undefined || g === undefined || b === undefined) return null

  return [byte(r), byte(g), byte(b)]
}

function channelLuminance(channel: number): number {
  const s = channel / 255

  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: Channels): number {
  return 0.2126 * channelLuminance(r)
    + 0.7152 * channelLuminance(g)
    + 0.0722 * channelLuminance(b)
}

/** Razão de contraste entre duas cores hex. Simétrica, de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a)
  const second = parseHex(b)
  if (first === null || second === null) return Number.NaN

  const la = relativeLuminance(first)
  const lb = relativeLuminance(second)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
