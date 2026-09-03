import { describe, expect, it } from 'vitest'
import { GENERATION_COUNT, isIndexData } from '~~/shared/types/dex'
import { baseStatTotal, rarityFrom, rarityOf } from '~~/shared/game/rarity'
import { readAllSpecies, readGeneration, readIndex } from '../support/generated-dex'

/**
 * O índice é uma **projeção** de `gen-N.json`, e este teste é o que impede as
 * duas de discordarem.
 *
 * Elas são gravadas pelo mesmo build a partir do mesmo objeto, então hoje não
 * têm como divergir. O que muda isso é qualquer edição futura no script — um
 * campo renomeado num lado, um filtro aplicado no outro —, e o sintoma seria
 * silencioso: a busca acha `Mr. Mime`, a rota resolve o slug, e a página de
 * detalhe abre vazia porque a geração apontada não contém aquele id.
 */

const index = readIndex()
const species = readAllSpecies()

/** Onde cada id realmente está em disco — a fonte que a rota vai consultar. */
const generationOfId = new Map<number, number>(
  Array.from({ length: GENERATION_COUNT }, (_, position) => position + 1)
    .flatMap(generation => readGeneration(generation).species.map(entry => [entry.id, generation])),
)

describe('índice do dex', () => {
  it('passa pelo próprio guarda', () => {
    expect(isIndexData(index)).toBe(true)
  })

  it('tem uma linha para cada espécie, e nenhuma a mais', () => {
    expect(index).toHaveLength(species.length)
    expect(new Set(index.map(entry => entry.id)).size).toBe(index.length)
    expect(new Set(index.map(entry => entry.slug)).size).toBe(index.length)
  })

  it('concorda com gen-N.json em id, slug, nome e tipos', () => {
    const porId = new Map(species.map(entry => [entry.id, entry]))

    const divergentes = index.filter((entry) => {
      const source = porId.get(entry.id)
      return source === undefined
        || source.slug !== entry.slug
        || source.displayName !== entry.displayName
        || source.types.join() !== entry.types.join()
    })

    expect(divergentes.map(entry => entry.slug)).toEqual([])
  })

  /**
   * Os três campos da Fase 5, conferidos contra a mesma fonte.
   *
   * `bst` é o único campo do índice que é **cálculo** e não cópia, e por isso é
   * o único que pode divergir sem ninguém renomear nada: basta alguém somar
   * diferente de um lado. Conferir a soma aqui é o que impede o índice de
   * afirmar uma raridade que `gen-N.json` não sustenta.
   */
  it('concorda com gen-N.json em BST e nas duas marcas', () => {
    const porId = new Map(species.map(entry => [entry.id, entry]))

    const divergentes = index.filter((entry) => {
      const source = porId.get(entry.id)
      return source === undefined
        || entry.bst !== baseStatTotal(source.baseStats)
        || source.isLegendary !== entry.isLegendary
        || source.isMythical !== entry.isMythical
    })

    expect(divergentes.map(entry => entry.slug)).toEqual([])
  })

  /**
   * A propriedade da qual a Fase 5 inteira depende, afirmada diretamente.
   *
   * As duas conferências acima olham campo a campo; esta olha o **veredito**. O
   * pack sorteia lendo o índice e o binder conta tier lendo o índice, enquanto a
   * Pokédex colore moldura lendo `gen-N.json` — se os dois caminhos discordarem,
   * uma carta muda de raridade ao trocar de tela, e nenhum dos dois lados está
   * obviamente errado no diff.
   */
  it('produz a mesma raridade pelos dois caminhos, para as 1025', () => {
    const porId = new Map(species.map(entry => [entry.id, entry]))

    const divergentes = index.flatMap((entry) => {
      const source = porId.get(entry.id)
      if (source === undefined) return [`${entry.slug} não está em gen-N.json`]

      const doIndice = rarityFrom(entry)
      const daEspecie = rarityOf(source)

      return doIndice === daEspecie ? [] : [`${entry.slug}: índice ${doIndice} ≠ gen ${daEspecie}`]
    })

    expect(divergentes).toEqual([])
  })

  /**
   * O campo que existe só por causa desta checagem. A geração é derivável da
   * faixa de id hoje — os ids são contíguos e ordenados —, e gravá-la é o que
   * faz `/pokemon/[name]` não depender disso continuar verdadeiro.
   */
  it('aponta cada espécie para a geração em cujo arquivo ela realmente está', () => {
    const errados = index.filter(entry => generationOfId.get(entry.id) !== entry.generation)

    expect(errados.map(entry => `${entry.slug} diz gen ${entry.generation}`)).toEqual([])
  })

  it('está na ordem do dex nacional', () => {
    const ids = index.map(entry => entry.id)

    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })
})
