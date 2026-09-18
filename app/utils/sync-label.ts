import type { Translate } from '~~/shared/types/game'
import type { SyncStatus } from './sync-status'
import { agoLabel } from './relative-time'

/**
 * O que o sync escreve para o jogador — no chip da barra e na linha da conta em
 * Ajustes, que as pranchas desenham com a mesma frase.
 *
 * **Um lugar só porque são duas telas dizendo a mesma coisa**, e duas cópias da
 * frase são como uma passa a escrever "3 mudanças" enquanto a outra escreve "3
 * alterações". O texto dos três estados é o da prancha *Estados de sync*.
 *
 * **This is the one screen text that renders on every other screen**, through
 * `SyncIndicator` inside the global bar — so it translates with Settings and not
 * after it. Left in Portuguese, `/en` would carry *3 mudanças na fila* across
 * the whole game while each individual screen looked finished.
 *
 * The queued count travels twice — as the value that fills the sentence and as
 * the form that picks it. Handing vue-i18n only the value renders the pipe and
 * both halves, on screen.
 */
export function syncLabel(status: SyncStatus, now: Date, t: Translate): string {
  if (status.phase === 'sending') return t('sync.sending')

  if (status.phase === 'queued') {
    return t('sync.queued', { count: status.pending }, status.pending)
  }

  const ago = status.syncedAt === null ? null : agoLabel(status.syncedAt, now, t)
  return ago === null ? t('sync.synced') : t('sync.syncedAgo', { ago })
}
