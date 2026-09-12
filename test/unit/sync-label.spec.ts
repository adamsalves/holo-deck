import { describe, expect, it } from 'vitest'
import { syncLabel } from '~~/app/utils/sync-label'

/** O texto dos três estados que não falam com o jogador — a prancha *Estados de sync*. */

const NOW = new Date('2026-09-11T12:02:00.000Z')

describe('o que o indicador de sync escreve', () => {
  it('enviando, sem número: o que está no ar é um envio só', () => {
    expect(syncLabel({ phase: 'sending', pending: 3, syncedAt: null }, NOW)).toBe('enviando…')
  })

  it('a fila conta as mudanças, no singular e no plural', () => {
    expect(syncLabel({ phase: 'queued', pending: 1, syncedAt: null }, NOW)).toBe('1 mudança na fila')
    expect(syncLabel({ phase: 'queued', pending: 3, syncedAt: null }, NOW)).toBe('3 mudanças na fila')
  })

  it('sincronizado diz há quanto tempo, pelo instante do servidor', () => {
    expect(syncLabel({ phase: 'synced', pending: 0, syncedAt: '2026-09-11T12:00:00.000Z' }, NOW))
      .toBe('sincronizado há 2 min')
  })

  /**
   * A conta nova sem nada a subir — `idle` no primeiro login — não tem instante
   * nenhum no servidor, e inventar um seria afirmar uma gravação que não houve.
   */
  it('sem instante do servidor, só sincronizado', () => {
    expect(syncLabel({ phase: 'synced', pending: 0, syncedAt: null }, NOW)).toBe('sincronizado')
    expect(syncLabel({ phase: 'synced', pending: 0, syncedAt: 'ontem' }, NOW)).toBe('sincronizado')
  })
})
