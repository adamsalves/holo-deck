import { browserStorage } from './save-driver'
// A forma mora em `sync-status.ts`, e este arquivo é só quem a lê e grava: é o
// que impede o `import type` do `SyncDriver` de arrastar o `browserStorage`
// acima — e com ele o `window` — para o typecheck de um módulo sem navegador.
import type { SyncState } from './sync-status'

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
