import { browserStorage } from './save-driver'

/**
 * O que este aparelho sabe do servidor, e o que ele ainda não mandou.
 *
 * **Chave local, fora do save**, pela mesma razão de `holodeck:lastWrite` e
 * `holodeck:syncedWith`: o estado descreve **este aparelho** diante da conta, e
 * sincronizado ele descreveria o outro. Vale só enquanto `syncedWith` for a conta
 * logada; o logout apaga os dois juntos.
 */
export interface SyncState {
  /** A versão do servidor em que o save local se baseia. Zero: nunca subiu. */
  readonly base: number
  /**
   * Mudanças locais desde a última gravação aceita — o "3 mudanças na fila" da
   * prancha *Sync*. **Acima de zero é o flag de sujo** que decide o conflito:
   * local com mutação pendente vence; local limpo aceita o servidor.
   */
  readonly pending: number
  /** O `updatedAt` do servidor na última vez que os dois bateram. */
  readonly syncedAt: string | null
  /**
   * A impressão do último documento enviado e ainda sem resposta.
   *
   * **É o que separa conflito de verdade da própria gravação que chegou sem
   * volta.** O envio garantido de `pagehide` sai com `keepalive` e a aba fecha
   * antes da resposta: no boot seguinte o servidor está uma versão à frente, e sem
   * isto o jogo acusaria "outro aparelho gravou antes" diante do próprio save.
   */
  readonly sent: string | null
}

export const SYNC_STATE_KEY = 'holodeck:syncState'

/**
 * O estado guardado, ou `null` quando não há um legível.
 *
 * **`null` não é "limpo".** Um aparelho acertado pelo PR 1 tem `syncedWith` e
 * nenhum estado — e jogou depois do primeiro login, sem nada subir. Tratá-lo como
 * limpo adotaria o servidor e apagaria essas jogadas; quem decide o que fazer com
 * a ausência é o `SyncDriver`, que compara os dois documentos.
 */
export function readSyncState(): SyncState | null {
  try {
    const raw = browserStorage()?.getItem(SYNC_STATE_KEY)
    if (raw === null || raw === undefined) return null

    const parsed: unknown = JSON.parse(raw)
    return isSyncState(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

export function writeSyncState(state: SyncState): void {
  try {
    browserStorage()?.setItem(SYNC_STATE_KEY, JSON.stringify(state))
  }
  catch {
    // Sem armazenamento, o estado vive só na memória da sessão — e sem
    // armazenamento também não há save local para ele descrever.
  }
}

export function clearSyncState(): void {
  try {
    browserStorage()?.removeItem(SYNC_STATE_KEY)
  }
  catch { /* mesmo raciocínio de `writeSyncState` */ }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isSyncState(value: unknown): value is SyncState {
  if (typeof value !== 'object' || value === null) return false
  if (!('base' in value) || !('pending' in value) || !('syncedAt' in value) || !('sent' in value)) return false

  return isCount(value.base) && isCount(value.pending)
    && (value.syncedAt === null || typeof value.syncedAt === 'string')
    && (value.sent === null || typeof value.sent === 'string')
}
