import { useNuxtApp, useState } from 'nuxt/app'
import type { Ref } from 'vue'
import type { SaveData } from '~~/shared/save/schema'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import type { LocalStorageDriver } from '~~/app/utils/save-driver'
import type { HttpDriver } from '~~/app/utils/save-http'
import { markWrite } from '~~/app/utils/last-write'

/** Os dois lados da tela *Duas coleções*, com o que ela precisa mostrar. */
export interface PendingChoice {
  readonly local: SaveData
  readonly remote: SaveData
  /** ISO do servidor, para a coluna da conta. */
  readonly remoteUpdatedAt: string
  /** Instante da última gravação **deste aparelho**, ou nulo se não se sabe. */
  readonly localAt: number | null
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
    const local = app.$saveDriver satisfies LocalStorageDriver
    const remote = app.$httpDriver satisfies HttpDriver

    if (side === 'local') {
      // A perdedora é a do servidor, e ela não tem "texto no disco": arquiva-se
      // o documento serializado, que é o que o painel de cópias sabe restaurar.
      local.archive(JSON.stringify(choice.remote))
      await remote.save(choice.local)
    }
    else {
      // A perdedora é a deste aparelho, e dela existe o texto original — que é o
      // que se quer preservar, não o resultado migrado.
      const raw = local.readRaw()
      if (raw !== null) local.archive(raw)

      hydrateSave(choice.remote, app.$pinia)
      await local.save(composeSave(app.$pinia))
      markWrite()
    }

    pending.value = null
  }

  return { pending, choose }
}
