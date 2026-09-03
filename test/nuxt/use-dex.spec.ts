// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { GENERATION_COUNT, STRUGGLE_MOVE_ID, TYPE_NAMES } from '~~/shared/types/dex'
import { SPECIES_COUNT } from '~~/shared/types/brand'
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
  }, {
    // Struggle é obrigatório no catálogo desde a Fase 4: é o golpe de reserva
    // do motor, e o guarda recusa um core sem ele.
    id: STRUGGLE_MOVE_ID,
    slug: 'struggle',
    displayName: 'Struggle',
    type: 'normal',
    power: 50,
    accuracy: null,
    pp: 1,
    priority: 0,
    damageClass: 'physical',
  }],
  // As 9: o guarda cobra `.length(9)`, porque um `core.json` com menos é
  // justamente o deploy parcial que ele existe para recusar.
  generations: Array.from({ length: GENERATION_COUNT }, (_, index) => ({
    generation: index + 1,
    region: `region-${index + 1}`,
    displayName: `Generation ${index + 1}`,
    speciesCount: 151,
  })),
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

const chains = {
  10: {
    speciesId: 172,
    slug: 'pichu',
    evolvesTo: [{
      speciesId: 25,
      slug: 'pikachu',
      via: { trigger: 'level-up', minHappiness: 160 },
      evolvesTo: [],
    }],
  },
}

const flavor = { 25: 'Quando vários destes Pokémon se juntam, sua eletricidade pode causar tempestades.' }

/**
 * O índice tem tamanho fixo no guarda — 1025 linhas —, então a fixture não pode
 * ser um punhado de espécies escolhidas à mão. Ela é gerada, e as duas que os
 * testes procuram por slug são plantadas em posições conhecidas.
 */
const index = Array.from({ length: SPECIES_COUNT }, (_, position) => ({
  id: position + 1,
  slug: `species-${position + 1}`,
  displayName: `Species ${position + 1}`,
  generation: Math.min(GENERATION_COUNT, Math.floor(position / 151) + 1),
  types: ['electric'],
  bst: 318,
  isLegendary: false,
  isMythical: false,
}))
index[24] = {
  id: 25, slug: 'pikachu', displayName: 'Pikachu', generation: 1, types: ['electric'],
  bst: 320, isLegendary: false, isMythical: false,
}
index[5] = {
  id: 6, slug: 'charizard', displayName: 'Charizard', generation: 1, types: ['fire', 'flying'],
  bst: 534, isLegendary: false, isMythical: false,
}

let coreHits = 0
registerEndpoint('/data/core.json', () => {
  coreHits += 1
  return core
})
registerEndpoint('/data/gen-1.json', () => generation)
registerEndpoint('/data/index.json', () => index)
registerEndpoint('/data/chains.json', () => chains)
registerEndpoint('/data/flavor-1.json', () => flavor)

// Uma geração exclusiva do teste de deduplicação: as outras já ficam quentes no
// cache de módulo por causa dos testes anteriores, e um contador só é honesto
// sobre uma chave que ninguém mais tocou.
let gen3Hits = 0
registerEndpoint('/data/gen-3.json', () => {
  gen3Hits += 1
  return { ...generation, generation: 3, region: 'hoenn' }
})

// O modo real de falhar: deploy parcial ou 404 devolvendo a página de erro.
registerEndpoint('/data/gen-2.json', () => '<!doctype html><title>404</title>')

describe('useDex', () => {
  it('carrega core.json e devolve os 18 tipos', async () => {
    const dex = useDex()
    const loaded = await dex.loadCore()
    expect(loaded.types).toHaveLength(18)
    expect(loaded.moves[0]?.displayName).toBe('Thunderbolt')
  })

  it('memoiza — com o cache quente, nenhuma chamada vai à rede', async () => {
    // A asserção é exata de propósito. `toBeLessThanOrEqual(1)` passaria tanto
    // com 0 quanto com 1 e esconderia qual dos dois acontece — o teste aquece o
    // cache ele mesmo, zera o contador, e então zero é a única resposta certa.
    const dex = useDex()
    await dex.loadCore()

    coreHits = 0
    await dex.loadCore()
    await dex.loadCore()
    await dex.loadCore()

    expect(coreHits).toBe(0)
    expect(dex.core.value).not.toBeNull()
  })

  it('deduplica requisições em voo — três chamadas simultâneas, uma requisição', async () => {
    // Memoizar só o valor resolvido deixa a janela entre a chamada e a resposta
    // aberta: dois componentes pedindo a mesma geração no mesmo tick baixavam o
    // arquivo duas vezes. Guardar a promessa fecha a janela.
    const dex = useDex()
    gen3Hits = 0

    const [first, second, third] = await Promise.all([
      dex.loadGeneration(3),
      dex.loadGeneration(3),
      dex.loadGeneration(3),
    ])

    expect(gen3Hits).toBe(1)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('carrega chains.json com a árvore de evolução resolvida', async () => {
    const dex = useDex()
    const loaded = await dex.loadChains()
    expect(loaded[10]?.slug).toBe('pichu')
    expect(loaded[10]?.evolvesTo[0]?.via?.minHappiness).toBe(160)
    expect(dex.chains.value).not.toBeNull()
  })

  it('carrega flavor-N.json separado do grid', async () => {
    // A descrição pesa 144 KB no dex inteiro e só a página de detalhe a usa —
    // por isso ela é arquivo à parte, e por isso tem carregamento próprio.
    const dex = useDex()
    const loaded = await dex.loadFlavor(1)
    expect(loaded[25]).toMatch(/tempestades/)
    expect(dex.flavors.value[1]).toBeDefined()
    expect(dex.flavors.value[2]).toBeUndefined()
  })

  it('carrega uma geração e a guarda pela chave da geração', async () => {
    const dex = useDex()
    const gen1 = await dex.loadGeneration(1)
    expect(gen1.species[0]?.displayName).toBe('Pikachu')
    expect(dex.generations.value[1]).toBeDefined()
    expect(dex.generations.value[2]).toBeUndefined()
  })

  it('carrega o índice inteiro — as 1025 numa requisição só', async () => {
    const dex = useDex()
    const loaded = await dex.loadIndex()

    expect(loaded).toHaveLength(SPECIES_COUNT)
    expect(dex.index.value).not.toBeNull()
  })

  it('acha a espécie pelo slug, que é o que a rota /pokemon/[name] recebe', async () => {
    const dex = useDex()

    expect(await dex.findBySlug('charizard')).toEqual({
      id: 6,
      slug: 'charizard',
      displayName: 'Charizard',
      generation: 1,
      types: ['fire', 'flying'],
      bst: 534,
      isLegendary: false,
      isMythical: false,
    })
  })

  it('devolve null para slug que não existe — é o 404 da rota, não uma exceção', async () => {
    // A tela precisa distinguir "não existe" de "não carregou": o primeiro vira
    // 404, o segundo vira erro. Um `throw` aqui apagaria a diferença.
    const dex = useDex()

    expect(await dex.findBySlug('missingno')).toBeNull()
  })

  it('recusa resposta com forma errada em vez de deixar any entrar', async () => {
    // Sem o guarda, `$fetch` entrega `any` e o HTML da página de erro viaja como
    // se fosse dex até estourar em `species.map` numa tela qualquer.
    const dex = useDex()
    await expect(dex.loadGeneration(2)).rejects.toThrow(/forma esperada/)
    expect(dex.generations.value[2]).toBeUndefined()
  })

  it('uma falha não fica presa no cache de promessas — a próxima tentativa vai à rede', async () => {
    // Se a promessa em voo não fosse limpa ao final, o primeiro erro ficaria
    // memoizado e nenhuma tentativa posterior chegaria a sair.
    const dex = useDex()
    await expect(dex.loadGeneration(2)).rejects.toThrow(/forma esperada/)
    await expect(dex.loadGeneration(2)).rejects.toThrow(/forma esperada/)
  })
})
