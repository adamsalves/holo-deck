import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SpeciesId } from '~~/shared/types/brand'
import type { CollectionEntry, PackCard, Rarity } from '~~/shared/types/game'
import type { CollectionMap } from '~~/shared/save/schema'
import { copiesOf, duplicatesOf, shiniesOf } from '~~/shared/save/schema'
import { dustFor, forgeCost } from '~~/shared/game/dust'

/**
 * A coleção — quantas cópias de cada espécie, quantas shiny, e o pó.
 *
 * O pó mora aqui, junto da coleção, e não numa store de economia: ele **sai** de
 * duplicata e **entra** em carta, e as duas pontas são esta store. Separá-lo
 * faria toda forja ser uma transação entre dois stores, que é como um jogo perde
 * moeda ao recarregar no meio.
 *
 * Nada aqui toca armazenamento. A store guarda estado e aplica regra; quem lê e
 * grava é o plugin de save, que é o único que conhece o `SaveDriver`. É a mesma
 * fronteira que deixa o motor da Fase 4 rodar sem Vue: a regra é testável sem
 * navegador, e o navegador é substituível sem tocar na regra.
 */
export const useCollectionStore = defineStore('collection', () => {
  const entries = ref<Record<string, CollectionEntry>>({})
  const dust = ref(0)

  /** Quantas espécies distintas, que é o numerador do `138 / 1025` do binder. */
  const ownedCount = computed(() => Object.keys(entries.value).length)

  /** Quantas cartas ao todo, duplicatas incluídas. */
  const cardCount = computed(() =>
    Object.values(entries.value).reduce((total, entry) => total + entry.c, 0))

  /** Quantos exemplares shiny, que a prancha conta à parte no cabeçalho. */
  const shinyCount = computed(() =>
    Object.values(entries.value).reduce((total, entry) => total + entry.s, 0))

  function has(id: SpeciesId): boolean {
    return copiesOf(entries.value, id) > 0
  }

  function copies(id: SpeciesId): number {
    return copiesOf(entries.value, id)
  }

  function shinies(id: SpeciesId): number {
    return shiniesOf(entries.value, id)
  }

  /** Cópias além da primeira — o que a forja pode moer sem perder a espécie. */
  function duplicates(id: SpeciesId): number {
    return duplicatesOf(entries.value, id)
  }

  /**
   * Credita uma carta.
   *
   * `c` conta o total e `s` conta quantas dessas são shiny, então um shiny soma
   * nos dois. Foi a razão de o formato ser esse: contar normais e shinies em
   * campos separados faria toda soma de "quantas tenho" ser `c + s`, e a
   * primeira que alguém esquecesse produziria uma coleção que encolhe ao ganhar
   * um shiny.
   */
  function add(card: PackCard): void {
    const key = String(card.speciesId)
    const current = entries.value[key] ?? { c: 0, s: 0 }

    entries.value[key] = {
      c: current.c + 1,
      s: current.s + (card.isShiny ? 1 : 0),
    }
  }

  /** As dez cartas de um pack, na ordem em que saíram. */
  function credit(cards: readonly PackCard[]): void {
    for (const card of cards) add(card)
  }

  /**
   * Transforma cópias em pó.
   *
   * **Consome as normais antes das shiny.** Uma shiny sai a cada ~26 packs e
   * rende o mesmo pó que a normal do mesmo tier — moer a shiny primeiro seria
   * destruir o exemplar mais raro pelo mesmo preço, e o jogador que clica em
   * *transformar em pó* está pensando nas repetidas, não na que brilha.
   *
   * Aceita moer até a última cópia, e isso é decisão do plano: a Fase 6 diz que
   * moer uma carta que está no deck ativo **esvazia o slot** em vez de ser
   * bloqueada. Um limite aqui contradiria aquela regra antes de ela chegar.
   */
  function scrap(id: SpeciesId, rarity: Rarity, count: number): number {
    const key = String(id)
    const current = entries.value[key]
    if (current === undefined || count <= 0) return 0

    const taken = Math.min(count, current.c)
    const remaining = current.c - taken
    // As shinies só entram quando as normais acabam: `s` sobrevivente é o que
    // ainda cabe dentro do que restou.
    const shinyLeft = Math.min(current.s, remaining)

    // Reconstruir sem a chave em vez de `delete`: o lint proíbe `delete` de
    // chave computada, e com razão — num objeto reativo ele é a forma mais fácil
    // de deixar para trás uma chave com valor `undefined`, que o guarda do save
    // recusaria na próxima leitura. Custa uma varredura de ≤ 1025 entradas numa
    // ação que o jogador dispara uma vez por vez.
    if (remaining === 0) {
      entries.value = Object.fromEntries(
        Object.entries(entries.value).filter(([held]) => held !== key),
      )
    }
    else entries.value[key] = { c: remaining, s: shinyLeft }

    const gained = taken * dustFor(rarity)
    dust.value += gained

    return gained
  }

  /** Moer só as repetidas — o botão que a prancha oferece na carta. */
  function scrapDuplicates(id: SpeciesId, rarity: Rarity): number {
    return scrap(id, rarity, duplicates(id))
  }

  /**
   * Forja uma carta escolhida, se o pó der.
   *
   * Credita a carta **antes** de debitar o pó, pela regra de ordem de escrita do
   * plano: uma falha no meio dá carta de graça em vez de cobrar sem entregar.
   * A carta forjada nunca é shiny — brilho é sorte de pack, e comprá-lo tiraria
   * do shiny justamente o que o faz valer alguma coisa.
   */
  function forge(id: SpeciesId, rarity: Rarity): boolean {
    const cost = forgeCost(rarity)
    if (dust.value < cost) return false

    add({ speciesId: id, rarity, isShiny: false })
    dust.value -= cost

    return true
  }

  /** O que o plugin de save grava. */
  function snapshot(): { collection: CollectionMap, dust: number } {
    return { collection: entries.value, dust: dust.value }
  }

  /** O que o plugin de save carregou. Substitui, não mescla. */
  function hydrate(collection: CollectionMap, saved: number): void {
    entries.value = { ...collection }
    dust.value = saved
  }

  return {
    entries,
    dust,
    ownedCount,
    cardCount,
    shinyCount,
    has,
    copies,
    shinies,
    duplicates,
    add,
    credit,
    scrap,
    scrapDuplicates,
    forge,
    snapshot,
    hydrate,
  }
})
