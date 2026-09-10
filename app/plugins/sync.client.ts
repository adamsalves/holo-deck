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
 * **Roda depois do `save.client`**, e a ordem não é acidente: o boot local lê e
 * renderiza na hora, sem esperar rede, como o plano manda. Este plugin chega
 * depois com o servidor, e o nome alfabético (`save` antes de `sync`) é o que
 * garante a ordem no Nuxt.
 *
 * O sync contínuo — fila offline, debounce, 409 com reaplicação — é o PR 2.
 * Aqui existe só a decisão de entrada, que é a que pode custar uma coleção.
 */
export default defineNuxtPlugin({
  name: 'holo-deck:sync',
  dependsOn: ['holo-deck:save'],

  async setup(nuxtApp) {
    const http = new HttpDriver()
    const provide = { httpDriver: http }

    const session = await authClient.getSession()
    if (!session.data) return { provide }

    const userId = session.data.user.id

    // Aparelho já acertado com esta conta não repete a pergunta do primeiro
    // login: sem esta linha, escolher "neste aparelho" sobe o local, e no boot
    // seguinte os dois lados cheios devolvem `ask` outra vez — para sempre. O
    // que roda daqui em diante é o sync contínuo, que é o PR 2.
    if (syncedWith() === userId) return { provide }

    let remote
    try {
      remote = await http.fetchRemote()
    }
    catch {
      // Rede fora não é "não há save no servidor": seguir em frente e subir o
      // local por cima seria apagar a coleção da conta por causa de um cabo. Sem
      // resposta, o jogo segue local — que é exatamente o que ele já era.
      return { provide }
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

    return { provide }
  },
})
