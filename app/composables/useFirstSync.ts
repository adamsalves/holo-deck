import { useNuxtApp, useState } from 'nuxt/app'
import type { Ref } from 'vue'
import type { SaveData } from '~~/shared/save/schema'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import { markSyncedWith, markWrite } from '~~/app/utils/last-write'

/** Os dois lados da tela *Duas coleções*, com o que ela precisa mostrar. */
export interface PendingChoice {
  /**
   * O save da conta, já migrado — ver `HttpDriver.fetchRemote`.
   *
   * **O lado local não está aqui, e a ausência é a correção de um defeito.** Ele
   * era um retrato tirado no boot, e a tela é `position: fixed` por cima de uma
   * página que continua montada e viva: um `resume` de batalha pagando moedas
   * enquanto o modal está de pé mudava as stores e não o retrato, e escolher
   * *Neste aparelho* subia o estado velho. A tela lê as stores, e quem aplica
   * recompõe o documento na hora do clique.
   */
  readonly remote: SaveData
  /** ISO do servidor, para a coluna da conta. */
  readonly remoteUpdatedAt: string
  /** Instante da última gravação **deste aparelho**, ou nulo se não se sabe. */
  readonly localAt: number | null
  /** De quem é a conta — o que fica marcado quando a escolha se resolve. */
  readonly userId: string
}

export type ChoiceSide = 'local' | 'remote'

/**
 * A escolha pendente do primeiro login.
 *
 * Estado e não rota: `/duas-colecoes` seria um endereço que só faz sentido com
 * dois saves carregados na memória, e que um `F5` — ou um link colado — abriria
 * vazio. A tela é um estado do boot, como o aviso de save recuperado, e mora
 * acima do layout pelo mesmo motivo.
 */
export function useFirstSync(): { pending: Ref<PendingChoice | null>, choose: (side: ChoiceSide) => Promise<void> } {
  const pending = useState<PendingChoice | null>('first-sync', () => null)

  /**
   * A perdedora já foi guardada nesta tela.
   *
   * **Arquivar uma vez por tela, e não uma por clique.** `choose` pode falhar — a
   * rede cai no `PUT` — e a tela fica de pé para tentar de novo; sem esta marca,
   * três tentativas gravavam três cópias da mesma coleção perdedora e o anel de
   * `MAX_BACKUPS = 3` esvaziava junto, levando cópias anteriores de recuperação
   * de save que ninguém pediu para apagar.
   */
  const archived = useState<boolean>('first-sync-archived', () => false)

  /**
   * Aplica a escolha, e **guarda a perdedora antes**.
   *
   * A prancha promete que "a outra não é apagada, fica guardada no backup deste
   * aparelho", e é o painel *Cópias de segurança* de `/settings` que a devolve —
   * não o *Importar*, que pede arquivo. O rodapé da prancha dizia *Importar* e
   * foi corrigido no canvas antes deste código existir.
   *
   * **Escolher a conta encerra a batalha em andamento**, e a tela avisa antes.
   * O `remote` chega com `battle` nula por construção — ela nunca sobe —, então
   * hidratá-lo já descarta a luta. É a mesma regra que `engineVersion` e
   * `dexVersion` aplicam: perder uma luta é aceitável, perder coleção não.
   */
  async function choose(side: ChoiceSide): Promise<void> {
    const choice = pending.value
    if (choice === null) return

    const app = useNuxtApp()
    const local = app.$saveDriver
    const remote = app.$httpDriver

    if (side === 'local') {
      // A perdedora é a do servidor, e ela não tem "texto no disco": arquiva-se
      // o documento serializado, que é o que o painel de cópias sabe restaurar.
      if (!archived.value) {
        local.archive(JSON.stringify(choice.remote))
        archived.value = true
      }

      // Recomposto agora, e não o retrato do boot: ver `PendingChoice.remote`.
      const doc = composeSave(app.$pinia)
      const written = await remote.write(doc)

      // O sync contínuo começa do acerto que acabou de acontecer.
      app.$sync.begin({ base: written.version, pending: 0, syncedAt: written.updatedAt }, doc)
    }
    else {
      // A perdedora é a deste aparelho, e dela existe o texto original — que é o
      // que se quer preservar, não o resultado migrado.
      if (!archived.value) {
        const raw = local.readRaw()
        if (raw !== null) local.archive(raw)
        archived.value = true
      }

      hydrateSave(choice.remote, app.$pinia)
      await local.save(composeSave(app.$pinia))
      markWrite()

      // A versão é a que o `GET` do boot leu — o driver HTTP a guardou.
      app.$sync.begin({ base: remote.version, pending: 0, syncedAt: choice.remoteUpdatedAt }, choice.remote)
    }

    // Só aqui, e não antes: um acerto marcado antes de a escrita dar certo
    // faria o boot seguinte pular a pergunta com os dois lados ainda em
    // desacordo — perdendo a única tela que sabe resolvê-lo.
    markSyncedWith(choice.userId)
    pending.value = null
  }

  return { pending, choose }
}
