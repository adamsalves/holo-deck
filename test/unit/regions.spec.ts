import { describe, expect, it } from 'vitest'
import { dexNumber, dexRange, toRegions } from '~~/shared/dex/regions'
import { GENERATION_COUNT } from '~~/shared/types/dex'
import { generationLabel, isRegionName, REGION_LABELS, REGION_NAMES } from '~~/shared/types/game'
import { readCore, readGeneration } from '../support/generated-dex'

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

/**
 * A faixa de dex de cada região é **derivada**: `toRegions` soma as contagens
 * anteriores em vez de abrir os `gen-N.json`. O docblock dela sempre afirmou
 * que este arquivo conferia a conta contra os nove arquivos — e não conferia:
 * até a Fase 3 nenhum teste da suíte sequer importava `toRegions`, e a
 * aritmética que produz o `#0001–0151` de toda carta de região estava
 * descoberta. É o defeito recorrente do repositório numa forma nova: aqui o
 * portão não mudou de lugar, ele nunca existiu, e o comentário dizia que sim.
 */
describe('toRegions', () => {
  const regions = toRegions(generations)

  it('devolve uma região por geração, na ordem do dex', () => {
    expect(regions).toHaveLength(GENERATION_COUNT)
    expect(regions.map(region => region.generation)).toEqual(generations.map(meta => meta.generation))
    expect(regions.map(region => region.slug)).toEqual(generations.map(meta => meta.region))
  })

  it('faz a faixa de cada região bater com os ids que a geração realmente tem', () => {
    // O cruzamento que faltava: a faixa é derivada da contagem, e a única prova
    // de que ela está certa é abrir os nove arquivos e olhar os ids.
    for (const region of regions) {
      const ids = readGeneration(region.generation).species.map(entry => entry.id)

      expect({
        generation: region.generation,
        firstId: region.firstId,
        lastId: region.lastId,
        speciesCount: region.speciesCount,
      }).toEqual({
        generation: region.generation,
        firstId: Math.min(...ids),
        lastId: Math.max(...ids),
        speciesCount: ids.length,
      })
    }
  })

  it('encadeia as faixas sem buraco nem sobreposição, começando em 1', () => {
    // A premissa que torna a derivação válida. No dia em que os ids deixarem de
    // ser contíguos, é aqui que se descobre — e não no rodapé de uma carta.
    expect(regions[0]?.firstId).toBe(1)

    for (const [index, region] of regions.entries()) {
      if (index === 0) continue
      expect(region.firstId).toBe((regions[index - 1]?.lastId ?? 0) + 1)
    }
  })

  it('rotula toda região com o vocabulário em português, nunca com o slug', () => {
    expect(regions.filter(region => region.label === region.slug)).toEqual([])
    expect(regions.map(region => region.generationLabel)).toEqual(
      generations.map(meta => generationLabel(meta.generation)),
    )
  })
})

describe('formatação de número de dex', () => {
  it('preenche até quatro casas — o padding que 1025 espécies exigem', () => {
    expect(dexNumber(1)).toBe('#0001')
    expect(dexNumber(151)).toBe('#0151')
    expect(dexNumber(1025)).toBe('#1025')
  })

  it('abre a faixa com a cerquilha e não a repete no fim', () => {
    // `#0001–#0151` lê como dois números soltos; a prancha escreve um intervalo.
    expect(dexRange(1, 151)).toBe('#0001–0151')
  })

  it('formata a faixa real de toda região sem perder dígito', () => {
    for (const region of toRegions(generations)) {
      expect(dexRange(region.firstId, region.lastId))
        .toBe(`${dexNumber(region.firstId)}–${String(region.lastId).padStart(4, '0')}`)
    }
  })
})
