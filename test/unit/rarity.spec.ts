import { describe, expect, it } from 'vitest'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { FOIL_FROM_RARITY, hasFoil, isRarity, RARITY_COUNT, RARITY_LABELS, RARITY_NAMES, rarityRank, TYPE_LABELS } from '~~/shared/types/game'

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

/**
 * O texto que o jogador lê.
 *
 * `Record` completo já faz o compilador cobrar a cobertura — um nível novo não
 * compila sem rótulo. O que ele **não** cobra é o conteúdo: um rótulo vazio, ou
 * o identificador em inglês copiado para o valor, passa limpo pelo tipo. Foi
 * assim que a carta saiu escrevendo COMMON num documento `lang="pt-BR"`.
 */
describe('rótulos em português', () => {
  it('dá um rótulo não vazio a cada raridade e a cada tipo', () => {
    expect(RARITY_NAMES.filter(r => RARITY_LABELS[r].trim() === ''), 'raridades sem rótulo').toEqual([])
    expect(TYPE_NAMES.filter(t => TYPE_LABELS[t].trim() === ''), 'tipos sem rótulo').toEqual([])
  })

  it('não deixa o identificador em inglês vazar como rótulo', () => {
    // `ultra` é o único que é a mesma palavra nos dois idiomas.
    const iguais = RARITY_NAMES.filter(r => RARITY_LABELS[r].toLowerCase() === r && r !== 'ultra')
    expect(iguais, 'raridade com o identificador no lugar do rótulo').toEqual([])

    expect(TYPE_NAMES.filter(t => TYPE_LABELS[t].toLowerCase() === t && t !== 'normal'), 'tipo com o identificador no lugar do rótulo').toEqual([])
  })

  it('não repete rótulo — dois nomes iguais são um nome só na tela', () => {
    expect(new Set(RARITY_NAMES.map(r => RARITY_LABELS[r])).size).toBe(RARITY_COUNT)
    expect(new Set(TYPE_NAMES.map(t => TYPE_LABELS[t])).size).toBe(TYPE_NAMES.length)
  })
})
