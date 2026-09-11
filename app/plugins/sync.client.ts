import type { useNuxtApp } from 'nuxt/app'
import { defineNuxtPlugin } from 'nuxt/app'
import { nextTick } from 'vue'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import { HttpDriver } from '~~/app/utils/save-http'
import { SyncDriver } from '~~/app/utils/save-sync'
import { readSyncState, writeSyncState } from '~~/app/utils/sync-state'
import { lastWrite, markSyncedWith, markWrite, syncedWith } from '~~/app/utils/last-write'
import { decideFirstSync } from '~~/shared/save/sync'
import { useAccount } from '~~/app/composables/useAccount'
import { useFirstSync } from '~~/app/composables/useFirstSync'
import { useSync } from '~~/app/composables/useSync'

/**
 * A rede do save: a decisão do primeiro login e, depois dela, o sync contínuo.
 *
 * **Roda depois do `save.client`**, por `dependsOn` e não pela ordem alfabética
 * dos arquivos: a dependência é real — o boot local hidrata as stores, e este
 * plugin compara o que elas têm com o que o servidor tem —, e mantê-la por
 * acidente de nome é como ela se perde num rename.
 *
 * O sync contínuo é o `SyncDriver`, e as regras dele moram lá, afirmadas sem
 * navegador. Aqui fica só o que é deste ambiente: o hook que entrega cada
 * gravação local, os três eventos do navegador que a prancha *Sync* nomeia —
 * `online`, `visibilitychange` e `pagehide` — e a tradução do estado para as
 * duas coisas que a tela mostra, o indicador e o aviso de conflito.
 */
export default defineNuxtPlugin({
  name: 'holo-deck:sync',
  dependsOn: ['holo-deck:save'],

  /**
   * **O tipo de retorno é escrito, e não inferido.** O `setup` usa
   * `nuxtApp.$saveDriver`, e o tipo de `nuxtApp` inclui o que este próprio plugin
   * provê: inferir o retorno daqui fecha um ciclo, e o TypeScript o resolve como
   * tipo de erro em todo `$` do app — o ESLint acusou os 14 usos de `useFirstSync`,
   * inclusive os que existiam antes deste plugin tocar no driver local.
   */
  setup(nuxtApp): { provide: { httpDriver: HttpDriver, sync: SyncDriver } } {
    const http = new HttpDriver()
    const { status, conflict } = useSync()

    const sync = new SyncDriver({
      remote: http,
      compose: () => composeSave(nuxtApp.$pinia),
      hydrate: (data) => {
        hydrateSave(data, nuxtApp.$pinia)
      },
      archive: (raw) => {
        nuxtApp.$saveDriver.archive(raw)
      },
      state: { read: readSyncState, write: writeSyncState },
      settle: () => nextTick(),
      online: () => navigator.onLine,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms)
        return () => {
          clearTimeout(timer)
        }
      },
      onStatus: (next) => {
        status.value = next
      },
      onConflict: (won) => {
        conflict.value = { won }
      },
    })

    // Cada gravação local, anunciada pelo plugin de save. Sem conta, ou antes do
    // acerto, o driver não está rodando e ignora — o jogo local não muda em nada.
    nuxtApp.hook('holodeck:saved', (doc) => {
      sync.noteSaved(doc)
    })

    // "A fila sobe sozinha ao reconectar", como a prancha escreve.
    window.addEventListener('online', () => {
      sync.retry()
    })

    // O envio garantido de quem sai: aba escondida e página descarregada. Os dois
    // porque nenhum sozinho cobre tudo — o celular troca de app sem descarregar a
    // página, e fechar a aba no computador nem sempre passa pelo primeiro.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void sync.flush({ keepalive: true })
    })
    window.addEventListener('pagehide', () => {
      void sync.flush({ keepalive: true })
    })

    /**
     * **Disparada sem `await`, e é o ponto inteiro desta forma.**
     *
     * O Nuxt espera os plugins antes de montar o app, então um `setup` assíncrono
     * faz todo boot aguardar uma ida à rede — o contrário do que o plano fecha
     * por escrito: *"lê `localStorage` e renderiza na hora; instantâneo, funciona
     * offline, não espera rede"*. Apareceu como instabilidade em testes antigos
     * sensíveis a tempo, não como erro.
     *
     * **O `catch` não é decoração.** Disparar sem `await` é disparar sem ninguém
     * para pegar a rejeição, e nada aqui pode derrubar o boot de um jogo que
     * funciona inteiro sem rede.
     *
     * **E `runWithContext` porque `reconcile` continua depois de `await`s.** O
     * `useState` da tela de escolha precisa da instância do Nuxt, e fora do
     * contexto ele cai na instância global — que no cliente é a mesma, hoje, por
     * acidente.
     */
    void nuxtApp.runWithContext(() => reconcile(nuxtApp, http, sync)).catch((error: unknown) => {
      console.warn('[holo-deck] a sincronização de entrada não concluiu', error)
    })

    return { provide: { httpDriver: http, sync } }
  },
})

async function reconcile(
  nuxtApp: ReturnType<typeof useNuxtApp>,
  http: HttpDriver,
  sync: SyncDriver,
): Promise<void> {
  /**
   * A sessão, e **nada aqui pode derrubar o boot**.
   *
   * A leitura é do `useAccount`, que a faz **uma vez** e a compartilha com o
   * canto da barra: duas chamadas a `getSession()` seriam duas idas à rede em
   * todo boot, inclusive no de quem nunca vai criar conta.
   */
  const account = await useAccount().load()
  if (account === null) return

  const userId = account.id

  // Aparelho já acertado com esta conta: a pergunta do primeiro login não se
  // repete — sem esta linha, escolher "neste aparelho" subiria o local e o boot
  // seguinte veria os dois lados cheios outra vez, para sempre. Daqui em diante
  // quem decide é o sync contínuo, que lê o servidor e sobe ou adota.
  if (syncedWith() === userId) {
    await sync.start()
    return
  }

  let remote
  try {
    remote = await http.fetchRemote()
  }
  catch {
    // Rede fora não é "não há save no servidor": seguir em frente e subir o
    // local por cima seria apagar a coleção da conta por causa de um cabo. Sem
    // resposta, o jogo segue local — que é exatamente o que ele já era.
    return
  }

  /**
   * Save que existe e não pôde ser migrado: **não se faz nada**.
   *
   * O caso é o de uma build mais nova ter gravado nesta conta — um aparelho
   * atualizado, este com o bundle antigo em cache. Adotar hidrataria store com
   * dado que este código não entende; subir sobrescreveria a coleção boa;
   * perguntar mostraria um dos lados como "nenhuma carta". **E não marca acerto
   * nenhum**: no boot seguinte, já com o bundle novo, a decisão acontece.
   */
  if (remote !== null && remote.recovered !== null) {
    console.warn('[holo-deck] o save da conta é de outra versão deste jogo; nada foi alterado')
    return
  }

  const local = composeSave(nuxtApp.$pinia)

  switch (decideFirstSync(local, remote?.data ?? null)) {
    // Nada a subir, e um `PUT` de save vazio queimaria uma versão sem dizer nada a
    // ninguém. A primeira jogada sobe como quem nunca subiu.
    case 'idle':
      markSyncedWith(userId)
      sync.begin({ base: 0, pending: 0, syncedAt: null }, local)
      break

    case 'push': {
      const written = await http.write(local)
      markSyncedWith(userId)
      sync.begin({ base: written.version, pending: 0, syncedAt: written.updatedAt }, local)
      break
    }

    case 'adopt':
      if (remote) {
        hydrateSave(remote.data, nuxtApp.$pinia)
        markWrite()
        markSyncedWith(userId)
        sync.begin({ base: remote.version, pending: 0, syncedAt: remote.updatedAt }, remote.data)
      }
      break

    // A tela *Duas coleções* decide, e é ela que começa o sync — ver
    // `useFirstSync().choose`.
    case 'ask':
      if (remote) {
        useFirstSync().pending.value = {
          remote: remote.data,
          remoteUpdatedAt: remote.updatedAt,
          localAt: lastWrite(),
          userId,
        }
      }
      break
  }
}
