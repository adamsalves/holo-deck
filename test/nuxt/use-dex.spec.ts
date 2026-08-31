// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { useDex } from '~/composables/useDex'

const core = {
  types: [...TYPE_NAMES],
  effectiveness: TYPE_NAMES.map(() => TYPE_NAMES.map(() => 1)),
  moves: [{
    id: 85,
    slug: 'thunderbolt',
    displayName: 'Thunderbolt',
    type: 'electric',
    power: 90,
    accuracy: 100,
    pp: 15,
    priority: 0,
    damageClass: 'special',
  }],
  generations: [{ generation: 1, region: 'kanto', displayName: 'Generation I', speciesCount: 151 }],
}

const generation = {
  generation: 1,
  region: 'kanto',
  species: [{
    id: 25,
    slug: 'pikachu',
    displayName: 'Pikachu',
    types: ['electric'],
    baseStats: [35, 55, 40, 50, 50, 90],
    height: 4,
    weight: 60,
    isLegendary: false,
    isMythical: false,
    isBaby: false,
    captureRate: 190,
    habitat: 'forest',
    baseHappiness: 70,
    color: 'yellow',
    evolutionChainId: 10,
    moveIds: [85],
  }],
}

let coreHits = 0
registerEndpoint('/data/core.json', () => {
  coreHits += 1
  return core
})
registerEndpoint('/data/gen-1.json', () => generation)

// O modo real de falhar: deploy parcial ou 404 devolvendo a página de erro.
registerEndpoint('/data/gen-2.json', () => '<!doctype html><title>404</title>')

describe('useDex', () => {
  it('carrega core.json e devolve os 18 tipos', async () => {
    const dex = useDex()
    const loaded = await dex.loadCore()
    expect(loaded.types).toHaveLength(18)
    expect(loaded.moves[0]?.displayName).toBe('Thunderbolt')
  })

  it('memoiza — a segunda chamada não vai à rede', async () => {
    const dex = useDex()
    coreHits = 0
    await dex.loadCore()
    await dex.loadCore()
    await dex.loadCore()
    expect(coreHits).toBeLessThanOrEqual(1)
    expect(dex.core.value).not.toBeNull()
  })

  it('carrega uma geração e a guarda pela chave da geração', async () => {
    const dex = useDex()
    const gen1 = await dex.loadGeneration(1)
    expect(gen1.species[0]?.displayName).toBe('Pikachu')
    expect(dex.generations.value[1]).toBeDefined()
    expect(dex.generations.value[2]).toBeUndefined()
  })

  it('recusa resposta com forma errada em vez de deixar any entrar', async () => {
    // Sem o guarda, `$fetch` entrega `any` e o HTML da página de erro viaja como
    // se fosse dex até estourar em `species.map` numa tela qualquer.
    const dex = useDex()
    await expect(dex.loadGeneration(2)).rejects.toThrow(/forma esperada/)
    expect(dex.generations.value[2]).toBeUndefined()
  })
})
