import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  STAT_COUNT,
  TYPE_COUNT,
  TYPE_NAMES,
  isChainsData,
  isCoreData,
  isFlavorData,
  isGenerationData,
  isTypeName,
  typeIndex,
} from '~~/shared/types/dex'
import { GYM_COUNT, MOVE_COUNT, SPECIES_COUNT } from '~~/shared/types/brand'

describe('typeIndex e isTypeName', () => {
  it('mapeia os 18 tipos de batalha para 0..17', () => {
    expect(TYPE_NAMES).toHaveLength(18)
    expect(typeIndex('normal')).toBe(0)
    expect(typeIndex('fairy')).toBe(17)
  })

  it('devolve -1 para os três tipos que não entram na tabela de dano', () => {
    // Eles aparecem em `damage_relations` e precisam ser ignorados sem quebrar.
    for (const name of ['stellar', 'unknown', 'shadow']) {
      expect(typeIndex(name)).toBe(-1)
      expect(isTypeName(name)).toBe(false)
    }
  })
})

function matrix(): number[][] {
  return TYPE_NAMES.map(() => TYPE_NAMES.map(() => 1))
}

function validCore() {
  return {
    types: [...TYPE_NAMES],
    effectiveness: matrix(),
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
}

describe('isCoreData', () => {
  it('aceita a forma completa', () => {
    expect(isCoreData(validCore())).toBe(true)
  })

  it('recusa matriz incompleta — 17 linhas ou uma linha de 17', () => {
    // Uma matriz com uma linha faltando produz dano errado num tipo só, e passa
    // despercebida por qualquer checagem que olhe apenas "é um array?".
    expect(isCoreData({ ...validCore(), effectiveness: matrix().slice(0, TYPE_COUNT - 1) })).toBe(false)

    const short = matrix()
    short[3] = [1, 1, 1]
    expect(isCoreData({ ...validCore(), effectiveness: short })).toBe(false)
  })

  it('recusa multiplicador fora de {0, 0.5, 1, 2}', () => {
    const odd = matrix()
    const row = odd[0]
    if (row === undefined) throw new Error('fixture inválida')
    row[0] = 3
    expect(isCoreData({ ...validCore(), effectiveness: odd })).toBe(false)
  })

  it('recusa a lista de tipos fora da ordem canônica', () => {
    // A matriz é indexada por posição: reordenar os nomes reindexa a tabela
    // inteira sem mudar nenhum número.
    expect(isCoreData({ ...validCore(), types: [...TYPE_NAMES].reverse() })).toBe(false)
  })

  it('recusa golpe com id fora da faixa e com classe de status', () => {
    const core = validCore()
    expect(isCoreData({ ...core, moves: [{ ...core.moves[0], id: MOVE_COUNT + 1 }] })).toBe(false)
    expect(isCoreData({ ...core, moves: [{ ...core.moves[0], damageClass: 'status' }] })).toBe(false)
  })

  it('recusa o que nem objeto é', () => {
    for (const value of [null, undefined, 42, 'core', [], '<!doctype html>']) {
      expect(isCoreData(value)).toBe(false)
    }
  })
})

function validSpecies() {
  return {
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
    moveIds: [85, 98],
  }
}

function validGeneration() {
  return { generation: 1, region: 'kanto', species: [validSpecies()] }
}

describe('isGenerationData', () => {
  it('aceita a forma completa e habitat nulo', () => {
    expect(isGenerationData(validGeneration())).toBe(true)
    expect(isGenerationData({
      ...validGeneration(),
      species: [{ ...validSpecies(), habitat: null }],
    })).toBe(true)
  })

  it('recusa moveId fora do teto', () => {
    // Mesmo defeito que o review da Fase 0 encontrou em `isMoveId`: sem teto,
    // um id adulterado vira `catalog[999999] === undefined` e trava a batalha.
    expect(isGenerationData({
      ...validGeneration(),
      species: [{ ...validSpecies(), moveIds: [999999] }],
    })).toBe(false)
  })

  it('recusa id de espécie fora da faixa', () => {
    for (const id of [0, SPECIES_COUNT + 1, 1.5]) {
      expect(isGenerationData({
        ...validGeneration(),
        species: [{ ...validSpecies(), id }],
      })).toBe(false)
    }
  })

  it('recusa tupla de stats com tamanho errado', () => {
    expect(isGenerationData({
      ...validGeneration(),
      species: [{ ...validSpecies(), baseStats: [35, 55, 40] }],
    })).toBe(false)
  })

  it('recusa três tipos e nenhum tipo', () => {
    for (const types of [[], ['fire', 'flying', 'dragon'], ['stellar']]) {
      expect(isGenerationData({
        ...validGeneration(),
        species: [{ ...validSpecies(), types }],
      })).toBe(false)
    }
  })
})

describe('isChainsData e isFlavorData', () => {
  const chain = {
    speciesId: 4,
    slug: 'charmander',
    evolvesTo: [{
      speciesId: 5,
      slug: 'charmeleon',
      via: { trigger: 'level-up', minLevel: 16 },
      evolvesTo: [{
        speciesId: 6,
        slug: 'charizard',
        via: { trigger: 'level-up', minLevel: 36 },
        evolvesTo: [],
      }],
    }],
  }

  it('aceita a árvore aninhada', () => {
    expect(isChainsData({ 2: chain })).toBe(true)
  })

  it('recusa um nó descendente inválido, não só a raiz', () => {
    // A recursão é o ponto: um guarda que só olha a raiz aprova uma cadeia com
    // um filho quebrado, e o defeito aparece na aba Evolução.
    const broken = { ...chain, evolvesTo: [{ speciesId: 0, slug: 'x', evolvesTo: [] }] }
    expect(isChainsData({ 2: broken })).toBe(false)
  })

  it('recusa via sem trigger', () => {
    const broken = { ...chain, evolvesTo: [{ speciesId: 5, slug: 'x', via: {}, evolvesTo: [] }] }
    expect(isChainsData({ 2: broken })).toBe(false)
  })

  it('valida o mapa de descrições', () => {
    expect(isFlavorData({ 25: 'Fica de olho no que come.' })).toBe(true)
    expect(isFlavorData({ 25: 42 })).toBe(false)
    expect(isFlavorData(null)).toBe(false)
  })
})

/**
 * Valida o dex **commitado**, não uma fixture.
 *
 * É o teste que roda no CI a cada PR e prova que os arquivos em `public/data/`
 * continuam com a forma que `useDex()` espera — sem chamar a PokeAPI. Se ele
 * falhar por arquivo ausente, o que falta é `yarn data:build`.
 */
describe('dex commitado em public/data', () => {
  function read(name: string): unknown {
    const path = `public/data/${name}`
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    }
    catch {
      throw new Error(`${path} não existe — rodar \`yarn data:build\``)
    }
    const parsed: unknown = JSON.parse(text)
    return parsed
  }

  const core = read('core.json')

  it('core.json passa o guarda e traz os 18 tipos', () => {
    expect(isCoreData(core)).toBe(true)
    if (!isCoreData(core)) return
    expect(core.types).toHaveLength(TYPE_COUNT)
    expect(core.effectiveness.every(row => row.length === TYPE_COUNT)).toBe(true)
    expect(core.generations).toHaveLength(GYM_COUNT)
  })

  it('chains.json tem as 541 cadeias e resolve a do Charizard com 16 e 36', () => {
    const chains = read('chains.json')
    expect(isChainsData(chains)).toBe(true)
    if (!isChainsData(chains)) return

    expect(Object.keys(chains)).toHaveLength(541)

    const charmander = Object.values(chains).find(node => node.slug === 'charmander')
    const charmeleon = charmander?.evolvesTo[0]
    const charizard = charmeleon?.evolvesTo[0]
    expect(charmeleon?.slug).toBe('charmeleon')
    expect(charmeleon?.via?.minLevel).toBe(16)
    expect(charizard?.slug).toBe('charizard')
    expect(charizard?.via?.minLevel).toBe(36)
  })

  it('as 9 gerações somam 1025 espécies, com 151 em Kanto', () => {
    let total = 0
    for (let generation = 1; generation <= GYM_COUNT; generation += 1) {
      const data = read(`gen-${generation}.json`)
      expect(isGenerationData(data)).toBe(true)
      if (!isGenerationData(data)) continue
      if (generation === 1) expect(data.species).toHaveLength(151)
      total += data.species.length

      for (const species of data.species) {
        expect(species.baseStats).toHaveLength(STAT_COUNT)
        expect(species.moveIds.length).toBeGreaterThan(0)
      }
    }
    expect(total).toBe(SPECIES_COUNT)
  })

  it('os displayName difíceis não são o slug capitalizado', () => {
    const wanted = new Map([
      ['mr-mime', 'Mr. Mime'],
      ['nidoran-f', 'Nidoran♀'],
      ['nidoran-m', 'Nidoran♂'],
      ['type-null', 'Type: Null'],
      ['mr-rime', 'Mr. Rime'],
    ])
    const seen = new Map<string, string>()

    for (let generation = 1; generation <= GYM_COUNT; generation += 1) {
      const data = read(`gen-${generation}.json`)
      if (!isGenerationData(data)) continue
      for (const species of data.species) {
        if (wanted.has(species.slug)) seen.set(species.slug, species.displayName)
      }
    }
    expect(Object.fromEntries(seen)).toEqual(Object.fromEntries(wanted))
  })

  it('todo moveId do dex existe no catálogo de core.json', () => {
    // A varredura de dados do plano: nada gravado sem caminho de leitura, e
    // nada referenciado sem existir. É o que pega o catálogo sendo filtrado
    // errado sem que nenhum arquivo fique visivelmente quebrado.
    expect(isCoreData(core)).toBe(true)
    if (!isCoreData(core)) return
    const known = new Set(core.moves.map(move => move.id))

    for (let generation = 1; generation <= GYM_COUNT; generation += 1) {
      const data = read(`gen-${generation}.json`)
      if (!isGenerationData(data)) continue
      for (const species of data.species) {
        for (const moveId of species.moveIds) {
          expect(known.has(moveId)).toBe(true)
        }
      }
    }
  })

  it('toda cadeia referenciada por uma espécie existe em chains.json', () => {
    const chains = read('chains.json')
    if (!isChainsData(chains)) throw new Error('chains.json inválido')

    for (let generation = 1; generation <= GYM_COUNT; generation += 1) {
      const data = read(`gen-${generation}.json`)
      if (!isGenerationData(data)) continue
      for (const species of data.species) {
        expect(chains[String(species.evolutionChainId)]).toBeDefined()
      }
    }
  })

  it('cada geração tem um flavor-N.json legível', () => {
    for (let generation = 1; generation <= GYM_COUNT; generation += 1) {
      expect(isFlavorData(read(`flavor-${generation}.json`))).toBe(true)
    }
  })
})
