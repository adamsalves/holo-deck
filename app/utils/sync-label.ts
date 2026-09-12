import type { SyncStatus } from './sync-status'
import { agoLabel } from './relative-time'

/**
 * O que o sync escreve para o jogador — no chip da barra e na linha da conta em
 * Ajustes, que as pranchas desenham com a mesma frase.
 *
 * **Um lugar só porque são duas telas dizendo a mesma coisa**, e duas cópias da
 * frase são como uma passa a escrever "3 mudanças" enquanto a outra escreve "3
 * alterações". O texto dos três estados é o da prancha *Estados de sync*.
 */
export function syncLabel(status: SyncStatus, now: Date): string {
  if (status.phase === 'sending') return 'enviando…'

  if (status.phase === 'queued') {
    return `${status.pending} ${status.pending === 1 ? 'mudança' : 'mudanças'} na fila`
  }

  const ago = status.syncedAt === null ? null : agoLabel(status.syncedAt, now)
  return ago === null ? 'sincronizado' : `sincronizado ${ago}`
}
