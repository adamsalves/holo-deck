import { describe, expect, it } from 'vitest'
import { GENERATION_COUNT } from '~~/shared/types/dex'
import { generationLabel, isRegionName, REGION_LABELS, REGION_NAMES } from '~~/shared/types/game'
import { readCore } from '../support/generated-dex'

/**
 * A lista de regiões é escrita à mão e o dex é gerado — este teste é o que
 * mantém as duas iguais.
 *
 * O sintoma de elas divergirem não é uma exceção: é o cabeçalho da região
 * abrindo em branco numa geração, porque `REGION_LABELS[region]` devolveu
 * `undefined` para um nome que o dex conhece e a tupla não.
 */

const { generations } = readCore()

describe('regiões', () => {
  it('são as nove, na ordem das gerações do dex', () => {
    expect(REGION_NAMES).toHaveLength(GENERATION_COUNT)
    expect(generations.map(meta => meta.region)).toEqual([...REGION_NAMES])
  })

  it('dá um rótulo não vazio a cada uma', () => {
    expect(REGION_NAMES.filter(region => REGION_LABELS[region].trim() === '')).toEqual([])
  })

  it('reconhece só os nove nomes', () => {
    expect(REGION_NAMES.every(isRegionName)).toBe(true)
    expect(isRegionName('orre')).toBe(false)
    expect(isRegionName('Kanto')).toBe(false)
  })
})

describe('rótulo da geração', () => {
  it('escreve em português com algarismo romano, como a prancha', () => {
    expect(generationLabel(1)).toBe('Geração I')
    expect(generationLabel(4)).toBe('Geração IV')
    expect(generationLabel(GENERATION_COUNT)).toBe('Geração IX')
  })

  it('cobre todas as gerações que o dex tem', () => {
    const semRomano = generations.filter(meta => /\d/.test(generationLabel(meta.generation)))

    expect(semRomano.map(meta => meta.generation)).toEqual([])
  })
})
