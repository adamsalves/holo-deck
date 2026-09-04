import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SpeciesId } from '~~/shared/types/brand'
import type { DeckSlots } from '~~/shared/game/deck'
import {
  clear as clearSlot,
  deckTeam,
  emptyDeck,
  filledCount,
  isBattleReady,
  place as placeCard,
  remove as removeCard,
} from '~~/shared/game/deck'
import { useCollectionStore } from './collection'

/**
 * O deck ativo — seis slots, e a única store que observa outra.
 *
 * A regra e a store são coisas separadas, como no resto do jogo: quem decide o
 * que é um deck válido é `shared/game/deck.ts`, headless e testável sem montar
 * nada. O que mora aqui é o estado e a reação a ele.
 *
 * O plano cita "decks salvos" ao lado do deck ativo. Eles **não** entram na Fase
 * 6: não há nada para alternar entre eles enquanto a Liga é uma campanha linear
 * de nove ginásios, e um seletor de decks salvos numa tela que ainda não tem
 * motivo para trocar seria mobília. O formato do save não fecha a porta — um
 * campo novo ao lado de `deck` é migração de um passo.
 */
export const useDeckStore = defineStore('deck', () => {
  const collection = useCollectionStore()
  const slots = ref<DeckSlots>(emptyDeck())

  /** O `5 / 6 slots` do cabeçalho da prancha. */
  const filled = computed(() => filledCount(slots.value))

  /** Os ids que vão para a batalha, na ordem dos slots. */
  const team = computed(() => deckTeam(slots.value))

  const ready = computed(() => isBattleReady(slots.value))

  function has(id: SpeciesId): boolean {
    return slots.value.includes(id)
  }

  /** Em que slot a carta está, ou `-1`. A tela marca a carta já escalada. */
  function slotOf(id: SpeciesId): number {
    return slots.value.indexOf(id)
  }

  /**
   * Escala uma carta, se ela existir na coleção.
   *
   * A posse é conferida **aqui** e não só na tela: arrastar é uma interface, e a
   * store é a fronteira. Sem esta linha, um deck montado antes de moer as cartas
   * sobreviveria à moagem e chegaria à batalha com espécies que o jogador não
   * tem — que é a mesma classe de defeito que o guarda do save recusa na leitura.
   */
  function place(slot: number, id: SpeciesId): boolean {
    if (!collection.has(id)) return false

    slots.value = placeCard(slots.value, slot, id)
    return true
  }

  function clear(slot: number): void {
    slots.value = clearSlot(slots.value, slot)
  }

  function remove(id: SpeciesId): void {
    slots.value = removeCard(slots.value, id)
  }

  /**
   * **Moer a última cópia esvazia o slot**, e isto é o que faz a regra valer sem
   * depender de ninguém lembrar.
   *
   * O plano escolheu esvaziar em vez de bloquear a moagem — "mais gentil que um
   * erro, e o deck builder já sinaliza slot vazio". Isso deixa a coleção livre
   * para moer sem consultar tela nenhuma, e é por isso que `scrap` na store de
   * coleção não conhece o deck: quem se ajusta é o lado que perdeu a carta.
   *
   * O observador mora na store, e não na página ou no plugin de save, porque a
   * regra é do deck e não da tela. Um `@scrap` que chamasse `remove()` à mão
   * funcionaria hoje — com um único lugar que mói — e falharia calado no dia em
   * que a segunda tela moesse, que é exatamente como esta classe de defeito
   * costuma entrar.
   */
  watch(
    () => collection.entries,
    () => {
      const perdidas = team.value.filter(id => !collection.has(id))
      for (const id of perdidas) remove(id)
    },
    { deep: true },
  )

  /** O que o plugin de save grava. */
  function snapshot(): DeckSlots {
    return slots.value
  }

  /**
   * O que o plugin de save carregou. Substitui, não mescla — e **descarta na
   * entrada a carta que a coleção não tem**.
   *
   * O filtro não é redundante com o observador acima, e descobri isso pelo
   * caminho certo: perguntando por que o e2e passava. O observador é `flush:
   * 'pre'`, então ele roda **no tick seguinte**; síncrono, logo depois de
   * hidratar, o deck ainda segurava a espécie órfã. O e2e só passava porque
   * mediu depois do tick.
   *
   * Deixar assim seria pendurar a invariante no agendamento do Vue: um dia
   * alguém troca o `flush` por `'sync'` — decisão razoável, para o save gravar
   * no mesmo tick — e o observador passa a rodar **antes** de `hydrate`, que é
   * quando ele não tem nada para ver. A órfã sobreviveria para sempre, e nada
   * acusaria.
   *
   * Com o filtro aqui a regra vale na entrada, sem depender de quando o
   * observador acorda. Ele continua existindo para o que acontece **depois**:
   * moer com o jogo aberto.
   */
  function hydrate(saved: DeckSlots): void {
    slots.value = saved.map(id => (id !== null && collection.has(id) ? id : null))
  }

  return {
    slots,
    filled,
    team,
    ready,
    has,
    slotOf,
    place,
    clear,
    remove,
    snapshot,
    hydrate,
  }
})
