import { describe, expect, it } from 'vitest'
import { HABITAT_NAMES, isHabitat } from '~~/shared/types/dex'
import { HABITAT_LABELS } from '~~/shared/types/game'
import { readAllSpecies } from '../support/generated-dex'

/**
 * A lista de habitats é escrita à mão e o dex é gerado — este teste mantém as
 * duas iguais, pelo mesmo motivo que `regions.spec.ts` faz com as regiões.
 *
 * O `Record<Habitat, string>` já obriga o compilador a cobrar rótulo para todo
 * nome da tupla. O que ele **não** vê é a outra ponta: um habitat no dex que a
 * tupla não conhece. Hoje o guarda de leitura recusaria a geração inteira, o que
 * é ruidoso mas honesto; o que este teste faz é transformar isso num erro de
 * `yarn test` em vez de uma tela em branco.
 *
 * O sintoma de divergirem seria `HABITAT_LABELS[habitat]` devolvendo
 * `undefined` no painel *Sobre* — e ali o habitat está em `--accent`, que é o
 * lugar mais destacado do painel.
 */

const SPECIES = readAllSpecies()

describe('habitats', () => {
  it('são os nove, e todos com rótulo em português', () => {
    expect(HABITAT_NAMES).toHaveLength(9)
    expect(Object.keys(HABITAT_LABELS).sort()).toEqual([...HABITAT_NAMES].sort())

    for (const name of HABITAT_NAMES) {
      expect(HABITAT_LABELS[name]).not.toBe('')
      // Nenhum rótulo pode ser o próprio identificador: é exatamente o
      // `ROUGH TERRAIN` que a varredura tirou da tela.
      expect(HABITAT_LABELS[name].toLowerCase()).not.toBe(name)
    }
  })

  it('cobrem todo habitat que o dex gerado traz', () => {
    const found = new Set(
      SPECIES.map(entry => entry.habitat).filter(habitat => habitat !== null),
    )

    expect(found.size).toBeGreaterThan(0)
    for (const habitat of found) {
      expect(isHabitat(habitat)).toBe(true)
    }
  })

  it('o nulo é legítimo, e é o da geração 6 em diante', () => {
    // A PokeAPI parou de preencher o campo. Inventar um valor mentiria na aba
    // *Sobre*, e é por isso que o tipo é `Habitat | null` e não `Habitat`.
    expect(SPECIES.some(entry => entry.habitat === null)).toBe(true)
    expect(SPECIES.some(entry => entry.habitat !== null)).toBe(true)
  })
})
