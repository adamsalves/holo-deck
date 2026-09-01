import { describe, expect, it } from 'vitest'
import { FOIL_FROM_RARITY, hasFoil, isRarity, RARITY_COUNT, RARITY_NAMES, rarityRank } from '~~/shared/types/game'

describe('escada de raridade', () => {
  it('tem os seis níveis, do mais comum ao mais raro', () => {
    expect(RARITY_COUNT).toBe(6)
    expect([...RARITY_NAMES]).toEqual(['common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic'])
  })

  it('ordena por posição, e a ordem é a da lista', () => {
    const postos = RARITY_NAMES.map(rarityRank)

    expect(postos).toEqual([...postos].sort((a, b) => a - b))
    expect(new Set(postos).size).toBe(RARITY_COUNT)
  })

  it('reconhece só os seis nomes', () => {
    expect(RARITY_NAMES.every(isRarity)).toBe(true)
    expect(isRarity('epic')).toBe(false)
    expect(isRarity('Rare')).toBe(false)
    expect(isRarity('')).toBe(false)
  })
})

describe('foil', () => {
  /**
   * O portão da Fase 2: *foil só aparece em raro+*.
   *
   * Está aqui, headless, e não dentro do componente, porque a consequência é de
   * custo e não de estilo — o foil é a única coisa da interface que anima por
   * ponteiro, e é o que mantém o grid de 1025 espécies barato.
   */
  it('começa em raro', () => {
    expect(FOIL_FROM_RARITY).toBe('rare')
  })

  it('não aparece abaixo de raro', () => {
    expect(hasFoil('common')).toBe(false)
    expect(hasFoil('uncommon')).toBe(false)
  })

  it('aparece de raro para cima, sem buraco no meio', () => {
    const comFoil = RARITY_NAMES.filter(hasFoil)

    expect(comFoil).toEqual(['rare', 'ultra', 'legendary', 'mythic'])
  })
})
