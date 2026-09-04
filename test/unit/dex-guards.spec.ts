import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GENERATION_COUNT,
  STRUGGLE_MOVE_ID,
  MOVES_PER_SPECIES,
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

/** As 9 entradas que `core.json` sempre traz. O guarda cobra `.length(9)` — um
 * core com uma geração é o deploy parcial que ele existe para recusar. */
function allGenerations() {
  return Array.from({ length: GENERATION_COUNT }, (_, index) => ({
    generation: index + 1,
    region: `region-${index + 1}`,
    displayName: `Generation ${index + 1}`,
    speciesCount: 151,
  }))
}

function validCore() {
  return {
    dexVersion: '19c9dc2a',
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
    generations: allGenerations(),
  }
}

/** Thunder Wave: o par que a união exige — classe `status`, poder nulo e
 * condição obrigatória. */
function statusMove() {
  return {
    id: 86,
    slug: 'thunder-wave',
    displayName: 'Thunder Wave',
    type: 'electric',
    power: null,
    accuracy: 90,
    pp: 20,
    priority: 0,
    damageClass: 'status',
    ailment: { kind: 'paralysis', chance: 100 },
  }
}

describe('isCoreData — a união de golpes', () => {
  it('aceita golpe de status com poder nulo e condição', () => {
    expect(isCoreData({ ...validCore(), moves: [...validCore().moves, statusMove()] })).toBe(true)
  })

  it('recusa catálogo sem Struggle', () => {
    // Sem ele, a primeira carta que fica sem PP derruba a batalha — e o arquivo
    // tem forma perfeita. É a mesma classe do `moveIds: []`.
    const semStruggle = validCore().moves.filter(move => move.id !== STRUGGLE_MOVE_ID)

    expect(isCoreData({ ...validCore(), moves: semStruggle })).toBe(false)
  })

  it('aceita efeito secundário num golpe de dano, e a ausência dele', () => {
    const [thunderbolt, struggle] = validCore().moves
    expect(isCoreData({
      ...validCore(),
      moves: [{ ...thunderbolt, ailment: { kind: 'paralysis', chance: 10 } }, struggle],
    })).toBe(true)
    expect(isCoreData(validCore())).toBe(true)
  })

  it('recusa golpe de status sem condição', () => {
    // É o registro que o motor não sabe executar: um golpe que não tira HP e
    // não aplica nada gasta o turno do jogador e não faz coisa alguma.
    const { ailment: _ailment, ...semCondicao } = statusMove()
    expect(isCoreData({ ...validCore(), moves: [...validCore().moves, semCondicao] })).toBe(false)
  })

  it('recusa golpe de status com poder', () => {
    // O `power: null` é o que impede o golpe de entrar na fórmula de dano; um
    // número aqui desfaz a proteção que a união inteira existe para dar.
    expect(isCoreData({ ...validCore(), moves: [...validCore().moves, { ...statusMove(), power: 50 }] })).toBe(false)
  })

  it('recusa golpe de dano com poder nulo', () => {
    const [thunderbolt, struggle] = validCore().moves
    expect(isCoreData({ ...validCore(), moves: [{ ...thunderbolt, power: null }, struggle] })).toBe(false)
  })

  it('recusa a chance zero, que é a convenção crua da PokeAPI', () => {
    // Se ela reaparecer no arquivo, alguém gravou o valor sem normalizar — e o
    // leitor seguinte entende "nunca aplica" num Thunder Wave.
    expect(isCoreData({
      ...validCore(),
      moves: [...validCore().moves, { ...statusMove(), ailment: { kind: 'paralysis', chance: 0 } }],
    })).toBe(false)
  })

  it('recusa condição fora das quatro modeladas', () => {
    expect(isCoreData({
      ...validCore(),
      moves: [...validCore().moves, { ...statusMove(), ailment: { kind: 'freeze', chance: 10 } }],
    })).toBe(false)
  })
})

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
describe('guardas cobram as mesmas restrições do schema de escrita', () => {
  /**
   * O modo de falhar que estes guardas nomeiam como alvo é o deploy parcial —
   * `core.json` novo com `gen-1.json` velho. Ele produz arquivo **bem-formado e
   * errado**, que uma checagem de forma aprova. Cada caso abaixo tem a forma
   * certa e viola uma restrição que `scripts/lib/schema.ts` cobra na escrita:
   * o portão de saída proíbe, e o de leitura precisa proibir também.
   *
   * O outro motivo é de princípio: um type predicate que valida menos do que
   * afirma é a mesma mentira que um `as`, sem a palavra-chave que a tornaria
   * visível no review. Num projeto com `assertionStyle: 'never'`, isso conta.
   */

  /** Uma geração válida com um campo trocado — o formato certo, o valor errado. */
  function withGeneration(patch: Record<string, unknown>): unknown {
    return { ...validGeneration(), ...patch }
  }

  /** O mesmo, na espécie. O `[first]` desestruturado em vez de `[0]!` porque o
   * projeto proíbe a asserção não-nula, inclusive em teste. */
  function withSpecies(patch: Record<string, unknown>): unknown {
    const draft = validGeneration()
    const [first] = draft.species
    if (first === undefined) throw new Error('fixture inválida: geração sem espécie')
    return { ...draft, species: [{ ...first, ...patch }] }
  }

  function withMove(patch: Record<string, unknown>): unknown {
    const core = validCore()
    const [first] = core.moves
    if (first === undefined) throw new Error('fixture inválida: core sem golpe')
    // O resto do catálogo continua ali: trocar a lista inteira por um golpe só
    // levaria Struggle junto, e o guarda reprovaria pelo motivo errado.
    return { ...core, moves: [{ ...first, ...patch }, ...core.moves.slice(1)] }
  }

  /** `baseStats` é tupla de 6: trocar `[0]` é o que corrompe o HP de verdade. */
  function stats(hp: number): number[] {
    return [hp, 55, 40, 50, 50, 90]
  }

  function moveIds(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index + 1)
  }

  it('recusa espécie sem golpe e espécie com mais de 8', () => {
    // `moveIds: []` é o defeito que o schema nomeia por escrito: espécie sem
    // golpe trava a batalha da Fase 4. Tem a forma de um array de números e
    // passa por qualquer checagem que só pergunte se é um array de números.
    expect(isGenerationData(withSpecies({ moveIds: [] }))).toBe(false)
    expect(isGenerationData(withSpecies({ moveIds: moveIds(MOVES_PER_SPECIES + 1) }))).toBe(false)
    expect(isGenerationData(withSpecies({ moveIds: moveIds(MOVES_PER_SPECIES) }))).toBe(true)
  })

  it('recusa geração vazia e número de geração fora de 1..9', () => {
    expect(isGenerationData(withGeneration({ species: [] }))).toBe(false)
    expect(isGenerationData(withGeneration({ generation: 0 }))).toBe(false)
    expect(isGenerationData(withGeneration({ generation: GENERATION_COUNT + 1 }))).toBe(false)
    expect(isGenerationData(withGeneration({ generation: GENERATION_COUNT }))).toBe(true)
  })

  it('recusa stat, altura, captura e cadeia com valor impossível', () => {
    expect(isGenerationData(withSpecies({ baseStats: stats(-5) }))).toBe(false)
    expect(isGenerationData(withSpecies({ baseStats: stats(0) }))).toBe(false)
    expect(isGenerationData(withSpecies({ baseStats: stats(12.5) }))).toBe(false)
    expect(isGenerationData(withSpecies({ height: -1 }))).toBe(false)
    expect(isGenerationData(withSpecies({ captureRate: -1 }))).toBe(false)
    expect(isGenerationData(withSpecies({ evolutionChainId: 0 }))).toBe(false)
  })

  it('recusa string vazia onde o schema pede .min(1)', () => {
    expect(isGenerationData(withSpecies({ slug: '' }))).toBe(false)
    expect(isGenerationData(withSpecies({ displayName: '' }))).toBe(false)
    expect(isGenerationData(withSpecies({ color: '' }))).toBe(false)
    expect(isGenerationData(withGeneration({ region: '' }))).toBe(false)
    // `habitat` é `null` legítimo da geração 6 em diante — mas nunca `''`.
    expect(isGenerationData(withSpecies({ habitat: '' }))).toBe(false)
    expect(isGenerationData(withSpecies({ habitat: null }))).toBe(true)
  })

  it('recusa habitat fora dos 9 da PokeAPI', () => {
    // O painel *Sobre* traduz o habitat por `HABITAT_LABELS`, e o põe em
    // `--accent` — um valor fora da lista não teria rótulo em português e
    // apareceria como o identificador cru no lugar mais destacado do painel.
    // O guarda o para aqui, que é onde o dado entra.
    expect(isGenerationData(withSpecies({ habitat: 'grassland' }))).toBe(true)
    expect(isGenerationData(withSpecies({ habitat: 'space' }))).toBe(false)
    expect(isGenerationData(withSpecies({ habitat: 'Forest' }))).toBe(false)
  })

  it('recusa NaN e Infinity, que atravessam um typeof number', () => {
    expect(isGenerationData(withSpecies({ baseStats: stats(Number.NaN) }))).toBe(false)
    expect(isGenerationData(withSpecies({ weight: Number.POSITIVE_INFINITY }))).toBe(false)
  })

  it('recusa catálogo vazio e número de gerações diferente de 9', () => {
    expect(isCoreData({ ...validCore(), moves: [] })).toBe(false)
    expect(isCoreData({ ...validCore(), generations: [] })).toBe(false)
    expect(isCoreData({ ...validCore(), generations: allGenerations().slice(0, 8) })).toBe(false)
  })

  it('recusa golpe com poder, pp ou acurácia sem sentido', () => {
    expect(isCoreData(withMove({ power: -50 }))).toBe(false)
    expect(isCoreData(withMove({ power: 0 }))).toBe(false)
    expect(isCoreData(withMove({ pp: 0 }))).toBe(false)
    expect(isCoreData(withMove({ accuracy: 0 }))).toBe(false)
    expect(isCoreData(withMove({ slug: '' }))).toBe(false)
    // `accuracy: null` é "nunca erra" — Swift, Aerial Ace —, não dado ruim.
    expect(isCoreData(withMove({ accuracy: null }))).toBe(true)
  })

  it('recusa condição de evolução com campo do tipo errado', () => {
    // O caso de princípio: checar só `trigger` fazia o compilador acreditar em
    // `minLevel: number` depois de um guarda que nunca olhou o campo.
    const chain = (minLevel: unknown): unknown => ({
      1: {
        speciesId: 4,
        slug: 'charmander',
        evolvesTo: [{
          speciesId: 5,
          slug: 'charmeleon',
          via: { trigger: 'level-up', minLevel },
          evolvesTo: [],
        }],
      },
    })

    expect(isChainsData(chain('muitos'))).toBe(false)
    expect(isChainsData(chain(-3))).toBe(false)
    expect(isChainsData(chain(16))).toBe(true)
    // Ausente é legítimo: `phione → manaphy` chega da API sem condição nenhuma.
    expect(isChainsData(chain(undefined))).toBe(true)
  })

  it('recusa descrição vazia em flavor-N.json', () => {
    expect(isFlavorData({ 1: 'Um Pokémon.' })).toBe(true)
    expect(isFlavorData({ 1: '' })).toBe(false)
  })
})

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
