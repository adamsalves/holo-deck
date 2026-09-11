import { describe, expect, it } from 'vitest'
import { agoLabel } from '~~/app/utils/relative-time'

/**
 * O `há 2 min` do indicador de sync.
 *
 * O caso que importa é o do relógio: o instante vem do servidor e o "agora" vem
 * do aparelho, e os dois não precisam concordar.
 */

const SYNCED_AT = '2026-09-11T12:00:00.000Z'

function after(ms: number): Date {
  return new Date(Date.parse(SYNCED_AT) + ms)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('quanto tempo desde a última sincronização', () => {
  it('abaixo de um minuto é agora', () => {
    expect(agoLabel(SYNCED_AT, after(0))).toBe('agora')
    expect(agoLabel(SYNCED_AT, after(59_999))).toBe('agora')
  })

  /**
   * O relógio do aparelho atrás do do servidor. Sem o piso, a tela escreveria
   * `há -3 min` — e é justamente o relógio de aparelho que o plano não deixa
   * decidir nada.
   */
  it('relógio do aparelho atrás do servidor também é agora, e nunca negativo', () => {
    expect(agoLabel(SYNCED_AT, after(-3 * MINUTE))).toBe('agora')
  })

  it('minutos, horas e dias, com a unidade trocando na virada', () => {
    expect(agoLabel(SYNCED_AT, after(2 * MINUTE))).toBe('há 2 min')
    expect(agoLabel(SYNCED_AT, after(59 * MINUTE))).toBe('há 59 min')
    expect(agoLabel(SYNCED_AT, after(HOUR))).toBe('há 1 h')
    expect(agoLabel(SYNCED_AT, after(23 * HOUR + 59 * MINUTE))).toBe('há 23 h')
    expect(agoLabel(SYNCED_AT, after(DAY))).toBe('há 1 dia')
    expect(agoLabel(SYNCED_AT, after(3 * DAY))).toBe('há 3 dias')
  })

  it('instante ilegível não vira "agora"', () => {
    expect(agoLabel('ontem', after(0))).toBeNull()
  })
})
