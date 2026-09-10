import type { useNuxtApp } from 'nuxt/app'
import { defineNuxtPlugin } from 'nuxt/app'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import { authClient } from '~~/app/utils/auth-client'
import { HttpDriver } from '~~/app/utils/save-http'
import { lastWrite, markSyncedWith, markWrite, syncedWith } from '~~/app/utils/last-write'
import { decideFirstSync } from '~~/shared/save/sync'
import { useFirstSync } from '~~/app/composables/useFirstSync'

/**
 * O primeiro `GET` depois de entrar — e só ele.
 *
 * **Roda depois do `save.client`**, por `dependsOn` e não pela ordem alfabética
 * dos arquivos: a dependência é real — o boot local hidrata as stores, e este
 * plugin compara o que elas têm com o que o servidor tem —, e mantê-la por
 * acidente de nome é como ela se perde num rename.
 *
 * O sync contínuo — fila offline, debounce, 409 com reaplicação — é o PR 2.
 * Aqui existe só a decisão de entrada, que é a que pode custar uma coleção.
 */
export default defineNuxtPlugin({
  name: 'holo-deck:sync',
  dependsOn: ['holo-deck:save'],

  setup(nuxtApp) {
    const http = new HttpDriver()

    /**
     * **Disparada sem `await`, e é o ponto inteiro desta forma.**
     *
     * O Nuxt espera os plugins antes de montar o app, então um `setup` assíncrono
     * faz todo boot aguardar uma ida à rede — o contrário do que o plano fecha
     * por escrito: *"lê `localStorage` e renderiza na hora; instantâneo, funciona
     * offline, não espera rede"*. Com o `.env` local isso era uma viagem até o
     * Neon a cada abertura de página, e apareceu como instabilidade em testes
     * antigos sensíveis a tempo, não como erro.
     *
     * O plano descreve exatamente esta forma: *"com sessão — `GET` em segundo
     * plano"*. A tela de escolha entra por estado reativo quando a resposta
     * chega, e até lá o jogo já está jogável.
     */
    void reconcile(nuxtApp, http)

    return { provide: { httpDriver: http } }
  },
})

async function reconcile(nuxtApp: ReturnType<typeof useNuxtApp>, http: HttpDriver): Promise<void> {
  /**
   * A sessão, e **nada aqui pode derrubar o boot**.
   *
   * O jogo é local-first: sem rede, sem banco, sem conta, ele abre e funciona
   * inteiro. Um plugin que lançasse aqui levaria junto a coleção que já estava
   * na tela — trocando "a sincronização não subiu" por "o jogo não abre".
   * Conferido rodando a suíte E2E inteira sem `.env`, que é a condição do CI.
   */
  let userId: string
  try {
    const session = await authClient.getSession()
    if (!session.data) return

    userId = session.data.user.id
  }
  catch {
    return
  }

  // Aparelho já acertado com esta conta não repete a pergunta do primeiro
  // login: sem esta linha, escolher "neste aparelho" sobe o local, e no boot
  // seguinte os dois lados cheios devolvem `ask` outra vez — para sempre. O
  // que roda daqui em diante é o sync contínuo, que é o PR 2.
  if (syncedWith() === userId) return

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

  const local = composeSave(nuxtApp.$pinia)

  const decision = decideFirstSync(local, remote?.data ?? null)

  switch (decision) {
    // `idle` e `push` terminam iguais: os dois deixam este aparelho acertado
    // com a conta. A diferença é só se havia algo a subir — e um `PUT` de save
    // vazio queimaria uma versão sem dizer nada a ninguém.
    case 'idle':
    case 'push':
      if (decision === 'push') await http.save(local)
      markSyncedWith(userId)
      break

    case 'adopt':
      if (remote) {
        hydrateSave(remote.data, nuxtApp.$pinia)
        markWrite()
      }
      markSyncedWith(userId)
      break

    case 'ask':
      if (remote) {
        useFirstSync().pending.value = {
          local,
          remote: remote.data,
          remoteUpdatedAt: remote.updatedAt,
          localAt: lastWrite(),
          userId,
        }
      }
      break
  }
}
