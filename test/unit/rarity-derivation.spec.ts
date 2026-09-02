import type { Rarity } from '~~/shared/types/game'
import { describe, expect, it } from 'vitest'
import {
  baseStatTotal,
  MAX_BASE_STAT,
  MAX_BASE_STAT_TOTAL,
  RARITY_THRESHOLDS,
  rarityOf,
} from '~~/shared/game/rarity'
import { STAT_COUNT } from '~~/shared/types/dex'
import { RARITY_NAMES } from '~~/shared/types/game'
import { readAllSpecies } from '../support/generated-dex'

/**
 * A regra que atribui raridade — testada contra o dex inteiro, não contra
 * fixture.
 *
 * O erro que este teste existe para pegar não é de aritmética: é de
 * *distribuição*. Os limiares originais do plano (400 / 480 / 580) eram
 * plausíveis linha a linha e produziam uma pirâmide invertida sobre as 1025
 * espécies, com *raro* virando o maior tier do jogo. Só a passagem pelo dex
 * inteiro mostra isso.
 */

const species = readAllSpecies()

function statsOf(total: number) {
  // Seis stats que somam `total`, para exercitar a faixa sem depender de espécie.
  const base = Math.floor(total / STAT_COUNT)
  const rest = total - base * (STAT_COUNT - 1)
  return { baseStats: [base, base, base, base, base, rest] as const, isLegendary: false, isMythical: false }
}

describe('BST', () => {
  it('soma os seis stats', () => {
    expect(baseStatTotal([78, 84, 78, 109, 85, 100])).toBe(534)
  })

  it('reproduz o BST que a prancha Detalhe estampa para Charizard', () => {
    const charizard = species.find(entry => entry.slug === 'charizard')

    expect(charizard, 'charizard não está no dex gerado').toBeDefined()
    expect(baseStatTotal(charizard?.baseStats ?? [0, 0, 0, 0, 0, 0])).toBe(534)
  })
})

describe('limiares', () => {
  it('sobem, e nenhum é repetido', () => {
    expect([...RARITY_THRESHOLDS]).toEqual([...RARITY_THRESHOLDS].sort((a, b) => a - b))
    expect(new Set(RARITY_THRESHOLDS).size).toBe(RARITY_THRESHOLDS.length)
  })

  it('classifica a borda de cada faixa pelo lado certo', () => {
    const [uncommon, rare, ultra] = RARITY_THRESHOLDS

    expect(rarityOf(statsOf(uncommon - 1))).toBe('common')
    expect(rarityOf(statsOf(uncommon))).toBe('uncommon')
    expect(rarityOf(statsOf(rare - 1))).toBe('uncommon')
    expect(rarityOf(statsOf(rare))).toBe('rare')
    expect(rarityOf(statsOf(ultra - 1))).toBe('rare')
    expect(rarityOf(statsOf(ultra))).toBe('ultra')
  })
})

describe('as marcas ganham do BST', () => {
  /**
   * Os dois casos são reais e estão nas pranchas: Cosmog é lendário com BST 200,
   * Mew é mítico com BST 600. Se a faixa decidisse primeiro, um viraria comum e
   * o outro ultra.
   */
  it('lendário de BST baixo continua lendário', () => {
    const cosmog = species.find(entry => entry.slug === 'cosmog')

    expect(cosmog?.isLegendary).toBe(true)
    expect(baseStatTotal(cosmog?.baseStats ?? [0, 0, 0, 0, 0, 0])).toBeLessThan(RARITY_THRESHOLDS[0])
    expect(cosmog && rarityOf(cosmog)).toBe('legendary')
  })

  it('mítico de BST alto continua mítico', () => {
    const mew = species.find(entry => entry.slug === 'mew')

    expect(mew?.isMythical).toBe(true)
    expect(baseStatTotal(mew?.baseStats ?? [0, 0, 0, 0, 0, 0])).toBe(600)
    expect(mew && rarityOf(mew)).toBe('mythic')
  })

  it('mítico ganha de lendário quando os dois estão marcados', () => {
    expect(rarityOf({ baseStats: [1, 1, 1, 1, 1, 1], isLegendary: true, isMythical: true })).toBe('mythic')
  })
})

describe('sobre o dex inteiro', () => {
  it('dá uma raridade a cada uma das 1025', () => {
    expect(species).toHaveLength(1025)
    expect(species.filter(entry => !RARITY_NAMES.includes(rarityOf(entry)))).toEqual([])
  })

  /**
   * A pirâmide, que é a razão de os limiares serem estes.
   *
   * A checagem é de **forma**, não de percentual exato: cada tier por faixa é
   * menor que o anterior. Fixar as fatias em número tornaria este teste um
   * espelho da implementação, e ele reprovaria numa geração nova sem que nada
   * estivesse errado.
   */
  it('produz pirâmide: cada faixa é menor que a anterior', () => {
    const porFaixa = (['common', 'uncommon', 'rare', 'ultra'] satisfies Rarity[])
      .map(rarity => species.filter(entry => rarityOf(entry) === rarity).length)

    const decrescente = porFaixa.every((count, index) => {
      const anterior = porFaixa[index - 1]
      return anterior === undefined || count < anterior
    })

    expect(decrescente, `contagens: ${porFaixa.join(' / ')}`).toBe(true)
  })

  it('não deixa nenhum tier vazio', () => {
    const vazios = RARITY_NAMES.filter(rarity => !species.some(entry => rarityOf(entry) === rarity))

    expect(vazios, 'tier sem nenhuma espécie é tier que o jogador nunca vê').toEqual([])
  })
})

/**
 * Os tetos das barras da prancha *Detalhe*.
 *
 * O canvas escala as seis barras por ~165 — bonito no mockup e errado no dex: os
 * 255 de HP da Blissey passariam de 150% da trilha. Estes dois números são os
 * máximos observados, e este teste é o que os mantém observados: uma geração
 * nova que traga um stat maior reprova aqui em vez de estourar a barra na tela.
 */
describe('tetos das barras', () => {
  it('nenhum stat passa do teto', () => {
    const acima = species.filter(entry => entry.baseStats.some(stat => stat > MAX_BASE_STAT))

    expect(acima.map(entry => entry.slug), `MAX_BASE_STAT (${MAX_BASE_STAT}) ficou abaixo do dex`).toEqual([])
  })

  it('nenhum BST passa do teto', () => {
    const acima = species.filter(entry => baseStatTotal(entry.baseStats) > MAX_BASE_STAT_TOTAL)

    expect(acima.map(entry => entry.slug), `MAX_BASE_STAT_TOTAL (${MAX_BASE_STAT_TOTAL}) ficou abaixo do dex`).toEqual([])
  })

  it('os tetos são apertados — alguma espécie encosta em cada um', () => {
    // Teto folgado é barra que nunca enche: se ninguém alcança, o número foi
    // escolhido a olho e não medido.
    expect(species.some(entry => entry.baseStats.some(stat => stat === MAX_BASE_STAT))).toBe(true)
    expect(species.some(entry => baseStatTotal(entry.baseStats) === MAX_BASE_STAT_TOTAL)).toBe(true)
  })
})
