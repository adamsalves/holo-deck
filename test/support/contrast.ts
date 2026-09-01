/**
 * Contraste WCAG 2.1, para o tema ser verificado e não apenas afirmado.
 *
 * O escuro-único torna isto barato: existe um fundo só, então toda cor de texto
 * do sistema tem exatamente uma razão de contraste, e ela dá para ser conferida
 * por teste em vez de por inspeção. Foi assim que a dívida de `ink-400` (3.34:1
 * usado como texto 280 vezes nas pranchas) apareceu — e é assim que ela fica
 * consertada.
 */

/** Limiar AA para texto normal. */
export const AA_NORMAL = 4.5

/** Limiar AA para texto grande (≥ 18.66px negrito, ou ≥ 24px). */
export const AA_LARGE = 3

type Channels = [number, number, number]

function byte(pair: string): number {
  return Number.parseInt(pair, 16)
}

/** `#RGB` ou `#RRGGBB` → os três canais em 0..255. `null` no que não for hex. */
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
