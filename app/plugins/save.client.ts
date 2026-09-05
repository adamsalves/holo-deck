import { defineNuxtPlugin } from 'nuxt/app'
import { watch } from 'vue'
import { SCHEMA_VERSION } from '~~/shared/save/schema'
import type { RecoveryReason, SaveData } from '~~/shared/save/schema'
import { useBattleStore } from '~~/app/stores/battle'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
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
  const deck = useDeckStore(nuxtApp.$pinia)
  const progress = useProgressStore(nuxtApp.$pinia)
  const battle = useBattleStore(nuxtApp.$pinia)

  const { data, recovered } = await driver.load()

  // A coleção antes do deck, porque `deck.hydrate` **lê** a coleção: ele
  // descarta na entrada a espécie que o save escalou e a coleção não tem mais.
  // O observador da store do deck não cobre este caso — ele é `flush: 'pre'` e
  // acorda um tick depois, o que basta para moer com o jogo aberto e não para
  // o boot. Ver o comentário de `hydrate`.
  collection.hydrate(data.collection, data.dust)
  deck.hydrate(data.deck)
  progress.hydrate(data.progress)
  // A batalha por último, e **esta** ordem é a única das quatro que não é
  // exigência: `battle.hydrate` guarda o log cru e não liquida nada — quem paga
  // moedas e insígnia é `resume`, na primeira tela que trouxer o dex, muito
  // depois de as quatro hidratações terem terminado. Ela fica por último porque
  // é a que depende do resto, não porque inverter quebraria algo.
  battle.hydrate(data.battle)

  function compose(): SaveData {
    const { collection: entries, dust } = collection.snapshot()
    return {
      schemaVersion: SCHEMA_VERSION,
      collection: entries,
      dust,
      deck: deck.snapshot(),
      progress: progress.snapshot(),
      battle: battle.snapshot(),
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
    () => [
      collection.entries,
      collection.dust,
      deck.slots,
      progress.pity,
      progress.welcomeClaimed,
      progress.coins,
      progress.badges,
      // O log cresce por uma ação a cada turno, e é isso que faz fechar a aba no
      // meio de um ginásio não perder a luta. São ~30 bytes por turno: a
      // gravação síncrona continua barata, e o debounce que o plano descreve é
      // o da rede, que chega com o `HttpDriver` na Fase 7.
      battle.log,
    ],
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
       *
       * Quem o lê é o `SaveRecoveryNotice`, montado em `app.vue` — acima do
       * layout, porque isto é estado do boot e não de uma tela.
       */
      saveRecovery: recovered satisfies RecoveryReason | null,
    },
  }
})
