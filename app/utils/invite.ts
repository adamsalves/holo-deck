import { browserStorage } from './save-driver'

/**
 * O convite de conta já apareceu neste aparelho.
 *
 * **Chave local, fora do save** — a decisão 1 da Fase 7, a mesma de
 * `holodeck:lastWrite`. O convite só existe para quem não tem conta, e cada
 * navegador sem conta guarda uma coleção que só ele tem: "aparece uma vez" é por
 * aparelho. Dentro do save, a marca subiria junto com a coleção no dia em que o
 * jogador entrasse, e passaria a valer para o outro aparelho também.
 *
 * Guarda o instante, e não um booleano: é o que um relato de "o convite apareceu
 * de novo" precisa para ser conferido.
 */
export const INVITE_KEY = 'holodeck:invite'

export function inviteSeen(): boolean {
  try {
    const storage = browserStorage()
    // Sem armazenamento não há coleção local para proteger — e um convite que
    // voltasse a cada boot, sem ter onde se marcar, seria o portão que a prancha
    // recusa.
    if (storage === null) return true

    return storage.getItem(INVITE_KEY) !== null
  }
  catch {
    return true
  }
}

export function markInviteSeen(at: number = Date.now()): void {
  try {
    browserStorage()?.setItem(INVITE_KEY, String(at))
  }
  catch {
    // Mesmo raciocínio de `inviteSeen`: sem armazenamento, nada a marcar.
  }
}
