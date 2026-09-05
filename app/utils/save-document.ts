import type { Pinia } from 'pinia'
import type { SaveData } from '~~/shared/save/schema'
import { SCHEMA_VERSION } from '~~/shared/save/schema'
import { useBattleStore } from '~~/app/stores/battle'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
import { useProgressStore } from '~~/app/stores/progress'

/**
 * O documento do save montado a partir das stores, e desmontado de volta.
 *
 * Ele existe porque passaram a ser **dois** os lugares que fazem isso: o plugin
 * de boot, que lê no início e grava a cada mutação, e a tela de ajustes, que
 * exporta, importa e apaga. A ordem de hidratação carrega uma dependência real —
 * a coleção antes do deck — e duas cópias dela é como uma das duas fica para
 * trás no dia em que uma store nova entrar.
 *
 * `Pinia` entra por parâmetro porque o plugin roda fora de componente, onde as
 * stores não encontram a instância ativa sozinhas.
 */

export function composeSave(pinia?: Pinia): SaveData {
  const { collection, dust } = useCollectionStore(pinia).snapshot()

  return {
    schemaVersion: SCHEMA_VERSION,
    collection,
    dust,
    deck: useDeckStore(pinia).snapshot(),
    progress: useProgressStore(pinia).snapshot(),
    battle: useBattleStore(pinia).snapshot(),
  }
}

/**
 * Devolve um save às stores, **na única ordem que funciona**.
 *
 * A coleção antes do deck, porque `deck.hydrate` **lê** a coleção: ele descarta
 * na entrada a espécie que o save escalou e a coleção não tem mais. O observador
 * da store do deck não cobre este caso — ele é `flush: 'pre'` e acorda um tick
 * depois, o que basta para moer com o jogo aberto e não para o boot.
 *
 * A batalha por último, e **esta** é a única das quatro que não é exigência:
 * `battle.hydrate` guarda o log cru e não liquida nada — quem paga moedas e
 * insígnia é `resume`, na primeira tela que trouxer o dex. Ela fica por último
 * porque depende do resto, não porque inverter quebraria algo.
 */
export function hydrateSave(data: SaveData, pinia?: Pinia): void {
  useCollectionStore(pinia).hydrate(data.collection, data.dust)
  useDeckStore(pinia).hydrate(data.deck)
  useProgressStore(pinia).hydrate(data.progress)
  useBattleStore(pinia).hydrate(data.battle)
}
