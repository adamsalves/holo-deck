import { describe, expect, it } from 'vitest'
import {
  DUST_PER_DUPLICATE,
  FORGE_COST,
  FORGE_RATIO,
  duplicatesMissing,
  dustFor,
  dustMissing,
  forgeCost,
} from '~~/shared/game/dust'
import { RARITY_NAMES, rarityRank } from '~~/shared/types/game'

/**
 * A tabela de pó, conferida contra a prancha e contra si mesma.
 *
 * A prancha *Coleção* estampa as seis linhas na coluna da direita e escreve a
 * regra por extenso: *razão 4× em toda a escala*. Os dois lados dessa frase
 * podem divergir sem ninguém ver — basta alguém ajustar o custo de forja de um
 * tier e não o pó dele —, e é essa divergência que os dois primeiros testes
 * fecham.
 */

describe('a tabela de pó', () => {
  it('tem os valores que a prancha estampa', () => {
    expect(DUST_PER_DUPLICATE).toEqual({
      common: 5,
      uncommon: 15,
      rare: 50,
      ultra: 150,
      legendary: 400,
      mythic: 400,
    })
  })

  it('cobra exatamente quatro duplicatas por forja, em todo tier', () => {
    for (const rarity of RARITY_NAMES) {
      expect(forgeCost(rarity)).toBe(dustFor(rarity) * FORGE_RATIO)
    }
  })

  it('bate com os custos que a prancha escreve ao lado', () => {
    expect(FORGE_COST).toEqual({
      common: 20,
      uncommon: 60,
      rare: 200,
      ultra: 600,
      legendary: 1600,
      mythic: 1600,
    })
  })

  /**
   * A escada não pode andar para trás. Lendário e mítico empatam de propósito —
   * são recorte por marca, e nada no jogo os ordena entre si —, mas um tier de
   * BST que rendesse menos pó que o anterior faria a duplicata mais rara valer
   * menos que a mais comum.
   */
  it('não desce ao subir de tier', () => {
    const ordered = [...RARITY_NAMES].sort((a, b) => rarityRank(a) - rarityRank(b))

    for (let position = 1; position < ordered.length; position += 1) {
      const previous = ordered[position - 1]
      const current = ordered[position]
      if (previous === undefined || current === undefined) continue

      expect(dustFor(current)).toBeGreaterThanOrEqual(dustFor(previous))
    }
  })
})

describe('o que falta para forjar', () => {
  it('devolve o déficit, que é o número que o botão desabilitado escreve', () => {
    // A prancha mostra Mew a 1.600 com 340 de pó acumulado: FALTAM 1.260 PÓ.
    expect(dustMissing(340, 'mythic')).toBe(1260)
  })

  it('devolve zero quando dá — e zero também quando sobra', () => {
    expect(dustMissing(200, 'rare')).toBe(0)
    expect(dustMissing(5000, 'rare')).toBe(0)
  })

  it('conta duplicatas inteiras, arredondando para cima', () => {
    // Do zero, é a razão inteira: quatro duplicatas pagam uma forja.
    expect(duplicatesMissing(0, 'common')).toBe(FORGE_RATIO)

    // Meia duplicata não existe. Uma rara custa 200 e rende 50; com 25 de pó
    // faltam 175, que são 3,5 duplicatas — e o jogador precisa de 4.
    expect(duplicatesMissing(25, 'rare')).toBe(4)

    expect(duplicatesMissing(18, 'common')).toBe(1)
    expect(duplicatesMissing(20, 'common')).toBe(0)
  })
})
