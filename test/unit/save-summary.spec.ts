import { describe, expect, it } from 'vitest'
import type { SpeciesId } from '~~/shared/types/brand'
import { isSpeciesId } from '~~/shared/types/brand'
import type { SearchEntry } from '~~/shared/types/dex'
import type { SaveData } from '~~/shared/save/schema'
import { emptySave } from '~~/shared/save/schema'
import { BEST_CARDS, summarize } from '~~/app/utils/save-summary'

/**
 * O retrato que a tela *Duas coleções* mostra.
 *
 * **Ele não tinha teste, e é o número que decide qual coleção o jogador perde.**
 * O e2e conta miniaturas na tela e não afirma ordem nenhuma; a escada "raridade e,
 * no empate, BST" é a decisão que o docblock de `summarize` faz questão de
 * justificar, e era justamente a que ninguém verificava.
 */

function speciesId(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

/** Uma linha do índice, com o BST e as flags que decidem a raridade. */
function entry(id: number, bst: number, over: Partial<SearchEntry> = {}): SearchEntry {
  return {
    id: speciesId(id),
    slug: `especie-${id}`,
    displayName: `Espécie ${id}`,
    generation: 1,
    types: ['normal'],
    bst,
    isLegendary: false,
    isMythical: false,
    ...over,
  }
}

function saveWith(collection: Record<string, { c: number, s: number }>, over: Partial<SaveData> = {}): SaveData {
  return { ...emptySave(), collection, ...over }
}

describe('o retrato de um save', () => {
  it('conta espécies, insígnias, pó — e shiny na mesma unidade de cartas', () => {
    // Três espécies, sete cópias, duas delas shiny na mesma espécie. `shiny` conta
    // **espécie**: somar cópias produziria "3 cartas / 2 shiny" com uma shiny só, e
    // os dois números ficam lado a lado na tela.
    const save = saveWith(
      { 1: { c: 5, s: 2 }, 4: { c: 1, s: 0 }, 7: { c: 1, s: 1 } },
      { dust: 340, progress: { ...emptySave().progress, badges: 4 } },
    )

    const sum = summarize(save, [entry(1, 318), entry(4, 309), entry(7, 314)])

    expect(sum.cards).toBe(3)
    expect(sum.shiny).toBe(2)
    expect(sum.badges).toBe(4)
    expect(sum.dust).toBe(340)
  })

  it('ordena as melhores por raridade e, no empate, por BST', () => {
    const save = saveWith({ 1: { c: 1, s: 0 }, 2: { c: 1, s: 0 }, 150: { c: 1, s: 0 } })

    const sum = summarize(save, [
      entry(1, 318),
      entry(2, 405),
      entry(150, 680, { isLegendary: true }),
    ])

    // O lendário na frente por raridade; entre os dois comuns, o de BST maior.
    expect(sum.best.map(card => card.id)).toEqual([150, 2, 1])
  })

  it('mostra no máximo as cinco da prancha', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7]
    const save = saveWith(Object.fromEntries(ids.map(id => [String(id), { c: 1, s: 0 }])))

    const sum = summarize(save, ids.map(id => entry(id, 300 + id)))

    expect(sum.best).toHaveLength(BEST_CARDS)
    expect(sum.cards).toBe(ids.length)
  })

  it('marca a miniatura como shiny quando há ao menos uma cópia shiny', () => {
    const save = saveWith({ 1: { c: 2, s: 1 }, 4: { c: 1, s: 0 } })

    const sum = summarize(save, [entry(1, 318), entry(4, 309)])

    expect(sum.best.find(card => card.id === 1)?.shiny).toBe(true)
    expect(sum.best.find(card => card.id === 4)?.shiny).toBe(false)
  })

  /**
   * **O índice vazio é o caso que a tela precisava saber distinguir**, e por isso
   * ele tem asserção: com ele, `cards` continua certo (não depende do índice) e as
   * miniaturas somem. Era assim que a tela pedia decisão irreversível mostrando
   * *nenhuma carta* nos dois lados — quem fecha isso agora é o estado de carregando
   * do `SaveChoice`, e este teste é o que descreve por que ele existe.
   */
  it('sem índice, o que depende dele fica vazio — e `cards` não', () => {
    const save = saveWith({ 1: { c: 1, s: 1 } })

    const sum = summarize(save, [])

    expect(sum.cards).toBe(1)
    expect(sum.shiny).toBe(0)
    expect(sum.best).toEqual([])
  })

  it('de um save intocado, um retrato de zeros', () => {
    const sum = summarize(emptySave(), [entry(1, 318)])

    expect(sum).toEqual({ cards: 0, badges: 0, shiny: 0, dust: 0, best: [] })
  })
})
