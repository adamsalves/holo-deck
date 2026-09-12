import { useState } from 'nuxt/app'
import type { Ref } from 'vue'
import type { SyncStatus } from '~~/app/utils/sync-status'

/** O aviso do estado 04 da prancha *Sync*: quantas mudanças deste aparelho venceram. */
export interface SyncConflict {
  readonly won: number
}

/**
 * O estado do sync para a tela — o indicador da barra e o aviso de conflito.
 *
 * **`status` nulo é "sem conta"**, e a prancha fecha o que isso significa: sem
 * conta, o indicador não existe — não há o que sincronizar, e o jogo não menciona
 * o assunto. Ele só deixa de ser nulo quando o `SyncDriver` começa, depois do
 * acerto entre este aparelho e a conta.
 *
 * O conflito mora à parte porque ele é o único estado que fala com o jogador, e
 * fala **depois** de resolvido: o indicador já voltou a "sincronizado" quando o
 * aviso aparece, e dispensá-lo não mexe em nada além do próprio aviso.
 */
export function useSync(): {
  status: Ref<SyncStatus | null>
  conflict: Ref<SyncConflict | null>
  dismiss: () => void
} {
  const status = useState<SyncStatus | null>('sync-status', () => null)
  const conflict = useState<SyncConflict | null>('sync-conflict', () => null)

  return {
    status,
    conflict,
    dismiss: () => {
      conflict.value = null
    },
  }
}
