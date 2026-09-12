import { useState } from 'nuxt/app'
import type { Ref } from 'vue'
import { authClient } from '~~/app/utils/auth-client'
import { markInviteSeen } from '~~/app/utils/invite'
import { clearSyncedWith } from '~~/app/utils/last-write'
import { clearSyncState } from '~~/app/utils/sync-state'

/** Por que a exclusão de conta não excluiu — ou que excluiu. Ver `deleteAccount`. */
export type AccountRemoval = 'deleted' | 'stale-session' | 'failed'

/** Quem está logado, do jeito que a barra precisa mostrar. */
export interface Account {
  readonly id: string
  readonly name: string
  /** O e-mail da conta — a linha principal do painel de conta em Ajustes, como a prancha desenha. */
  readonly email: string
  /** A foto do provedor, quando há uma. A barra cai nas iniciais sem ela. */
  readonly image: string | null
}

/**
 * A sessão do navegador, lida **uma vez por boot** e compartilhada.
 *
 * **Um lugar só porque é uma requisição só.** Dois consumidores querem a sessão —
 * o canto da barra, para saber se mostra *Entrar* ou a conta, e o plugin de
 * sincronização, para decidir o primeiro login. Cada um chamando
 * `authClient.getSession()` seria uma ida à rede a mais em todo boot, inclusive
 * no de quem nunca vai criar conta, que é a maioria dos boots deste jogo.
 *
 * **E por que não evitar a ida também no boot anônimo:** o cookie de sessão do
 * `better-auth` é `httpOnly`, então o cliente não tem como perguntar ao
 * `document.cookie` se existe sessão antes de tentar. A alternativa seria uma
 * marca local de "este navegador já entrou", e ela falha exatamente onde a conta
 * existe para proteger — navegador limpo com o cookie ainda válido deixaria de
 * sincronizar em silêncio. O custo medido do caminho anônimo é uma requisição
 * sem consulta ao banco: sem cookie, o `better-auth` responde nulo antes de
 * tocar no Postgres.
 *
 * `known` separa "ainda não se sabe" de "não há conta", que é o que evita a barra
 * piscar *Entrar* antes da resposta chegar.
 */
export function useAccount(): {
  account: Ref<Account | null>
  known: Ref<boolean>
  load: () => Promise<Account | null>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<AccountRemoval>
} {
  const account = useState<Account | null>('account', () => null)
  const known = useState<boolean>('account-known', () => false)

  async function load(): Promise<Account | null> {
    if (known.value) return account.value

    try {
      const session = await authClient.getSession()
      const user = session.data?.user

      account.value = user === undefined
        ? null
        : { id: user.id, name: user.name, email: user.email, image: user.image ?? null }

      // Um aparelho que já viu uma conta deixou de ser o de quem nunca teve
      // uma, e o convite existe só para esse. Marcar aqui cobre os dois casos em
      // que ele mentiria depois: a sessão que não pôde ser lida — sem rede, a
      // conta parece não existir — e o logout, que devolve o aparelho ao modo
      // sem conta com a coleção que a conta já guarda.
      if (account.value !== null) markInviteSeen()
    }
    catch {
      // Sem sessão legível o jogo é o de quem não tem conta — que é um modo
      // completo, não um erro. Ver o docblock de `reconcile`.
      account.value = null
    }

    known.value = true
    return account.value
  }

  /**
   * Sai da conta e **recarrega**, de propósito.
   *
   * As stores continuariam com a coleção que a conta trouxe, e o plugin de boot
   * não roda duas vezes — sem a recarga, sair deixaria a tela mostrando o estado
   * de dentro da conta com a barra dizendo *Entrar*. Recarregar é o caminho que
   * já existe e que o jogo sabe fazer: ele lê o `localStorage` e renderiza.
   */
  async function signOut(): Promise<void> {
    try {
      await authClient.signOut()
    }
    finally {
      // Mesmo se o `signOut` falhar: ver `forget`.
      forget()
    }
  }

  /**
   * Exclui a conta e o save do servidor — o `deleteUser` do `better-auth`.
   *
   * Devolve por que não excluiu, quando não excluiu: conta sem senha — todas aqui
   * — só se exclui com sessão de menos de um dia (`freshAge`), e a resposta a isso
   * é entrar de novo, não tentar de novo. A tela diz qual das duas.
   *
   * **O save deste aparelho fica.** Excluir a conta não é *Apagar save deste
   * aparelho*: a coleção continua jogável aqui, sem conta, como antes de entrar.
   * O que sai é o acerto com a conta, pelo mesmo caminho do logout.
   */
  async function deleteAccount(): Promise<AccountRemoval> {
    try {
      const { error } = await authClient.deleteUser()
      if (error) return error.code === 'SESSION_EXPIRED' ? 'stale-session' : 'failed'
    }
    catch {
      return 'failed'
    }

    forget()
    return 'deleted'
  }

  /**
   * Esquece a conta neste aparelho, e recarrega.
   *
   * A marca de acerto é local, e um acerto registrado sem conta do outro lado é
   * o que faria a pergunta do primeiro login nunca mais aparecer. O estado de sync
   * vai junto: ele descreve este aparelho diante desta conta, e sem a conta não
   * descreve nada. A recarga é a de `signOut`, pelo motivo escrito lá.
   */
  function forget(): void {
    clearSyncedWith()
    clearSyncState()
    account.value = null
    known.value = true

    if (typeof window !== 'undefined') window.location.assign('/')
  }

  return { account, known, load, signOut, deleteAccount }
}
