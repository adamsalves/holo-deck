import { defineNuxtPlugin } from 'nuxt/app'
import { watch } from 'vue'
import type { RecoveryReason } from '~~/shared/save/schema'
import { useBattleStore } from '~~/app/stores/battle'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
import { useProgressStore } from '~~/app/stores/progress'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
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
  const deck = useDeckStore(nuxtApp.$pinia)
  const progress = useProgressStore(nuxtApp.$pinia)
  const battle = useBattleStore(nuxtApp.$pinia)

  const { data, recovered } = await driver.load()

  // A ordem — coleção antes do deck, batalha por último — e a razão dela moram
  // em `save-document.ts`, que é o mesmo módulo que `/settings` usa para
  // importar um save. Duas cópias da ordem é como uma delas fica para trás.
  hydrateSave(data, nuxtApp.$pinia)

  /**
   * Grava as duas stores num documento só.
   *
   * Um `watch` profundo sobre o estado das duas, e não `$subscribe` por store:
   * o save é um documento, então gravar por store faria a segunda escrita do
   * mesmo tick reler o estado da primeira de qualquer jeito. Uma função que
   * compõe as duas é mais curta e não tem ordem.
   */
  watch(
    () => [
      collection.entries,
      collection.dust,
      deck.slots,
      progress.pity,
      progress.welcomeClaimed,
      progress.coins,
      progress.badges,
      progress.dailyClaimed,
      // O log cresce por uma ação a cada turno, e é isso que faz fechar a aba no
      // meio de um ginásio não perder a luta. São ~30 bytes por turno: a
      // gravação síncrona continua barata, e o debounce que o plano descreve é
      // o da rede, que chega com o `HttpDriver` na Fase 7.
      battle.log,
    ],
    () => { void driver.save(composeSave(nuxtApp.$pinia)) },
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
       *
       * Quem o lê é o `SaveRecoveryNotice`, montado em `app.vue` — acima do
       * layout, porque isto é estado do boot e não de uma tela.
       */
      saveRecovery: recovered satisfies RecoveryReason | null,

      /**
       * O driver, para a tela de ajustes exportar, importar e apagar.
       *
       * Uma instância só, e não uma por consumidor: o driver é sem estado sobre
       * o `localStorage`, mas a **poda de backups** não é — duas instâncias
       * podariam o anel em ordens diferentes, e o que se quer guardar é sempre
       * a cópia mais recente.
       */
      saveDriver: driver,
    },
  }
})
