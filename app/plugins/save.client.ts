import { defineNuxtPlugin } from 'nuxt/app'
import { watch } from 'vue'
import { SCHEMA_VERSION } from '~~/shared/save/schema'
import type { RecoveryReason, SaveData } from '~~/shared/save/schema'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { LocalStorageDriver, browserStorage } from '~~/app/utils/save-driver'

/**
 * O plugin que liga as stores ao disco — o **único** lugar do jogo que faz IO
 * de save.
 *
 * É `.client` porque não há save no servidor: a página pré-renderizada não
 * conhece a coleção de ninguém, e tentar ler `localStorage` no SSR é o jeito
 * clássico de um jogo local-first vazar erro de hidratação. O boot lê e
 * renderiza na hora, como o plano manda — nada aqui espera rede.
 *
 * **Uma gravação por mutação, síncrona.** O save realista tem 2,6 KB e o pior
 * caso medido é 21 KB, então debounce local seria complexidade para economizar
 * microssegundos — e a janela que ele abriria é exatamente onde o navegador do
 * celular mata a aba. O debounce que o plano descreve é o da **rede**, e chega
 * com o `HttpDriver` na Fase 7.
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const driver = new LocalStorageDriver(browserStorage())
  const collection = useCollectionStore(nuxtApp.$pinia)
  const progress = useProgressStore(nuxtApp.$pinia)

  const { data, recovered } = await driver.load()

  collection.hydrate(data.collection, data.dust)
  progress.hydrate(data.progress)

  function compose(): SaveData {
    const { collection: entries, dust } = collection.snapshot()
    return {
      schemaVersion: SCHEMA_VERSION,
      collection: entries,
      dust,
      progress: progress.snapshot(),
    }
  }

  /**
   * Grava as duas stores num documento só.
   *
   * Um `watch` profundo sobre o estado das duas, e não `$subscribe` por store:
   * o save é um documento, então gravar por store faria a segunda escrita do
   * mesmo tick reler o estado da primeira de qualquer jeito. Uma função que
   * compõe as duas é mais curta e não tem ordem.
   */
  watch(
    () => [collection.entries, collection.dust, progress.pity, progress.welcomeClaimed],
    () => { void driver.save(compose()) },
    { deep: true },
  )

  return {
    provide: {
      /**
       * Por que o save anterior não pôde ser lido, ou `null`.
       *
       * Fica exposto porque **o jogador precisa saber**: a regra do plano é que
       * um save ilegível vira backup e o jogo começa limpo *avisando*. Começar
       * limpo em silêncio é indistinguível, para quem está do outro lado, de o
       * jogo ter apagado a coleção.
       */
      saveRecovery: recovered satisfies RecoveryReason | null,
    },
  }
})
