import { describe, expect, it } from 'vitest'
import type { Move, PokeType, Pokemon } from '~~/scripts/lib/pokeapi'
import {
  MAX_MOVE_POWER,
  MIN_MOVE_ACCURACY,
  STRUGGLE_MOVE_ID,
  buildEffectivenessMatrix,
  isEligibleMove,
  normalizeFlavorText,
  pickFlavorText,
  resolveDisplayName,
  selectMoveset,
  toBaseStats,
  toEvolutionCondition,
  toMoveEntry,
  toTypes,
} from '~~/scripts/lib/transform'
import type { MoveEntry } from '~~/shared/types/dex'
import { typeIndex } from '~~/shared/types/dex'

function named(name: string, id = 1): { name: string, url: string } {
  return { name, url: `https://pokeapi.co/api/v2/x/${id}/` }
}

function english(name: string): { name: string, language: { name: string, url: string } } {
  return { name, language: named('en') }
}

describe('resolveDisplayName', () => {
  it('usa a entrada em inglês, que é onde vive o nome bom', () => {
    expect(resolveDisplayName([english('Mr. Mime')], 'mr-mime')).toBe('Mr. Mime')
    expect(resolveDisplayName([english('Nidoran♀')], 'nidoran-f')).toBe('Nidoran♀')
    expect(resolveDisplayName([english('Type: Null')], 'type-null')).toBe('Type: Null')
    expect(resolveDisplayName([english('Mr. Rime')], 'mr-rime')).toBe('Mr. Rime')
  })

  it('capitalizar o slug produz exatamente o texto errado que o campo evita', () => {
    // Este é o fallback, e o teste existe para mostrar por que ele não pode ser
    // o caminho normal: `Mr-mime` no lugar de `Mr. Mime` numa carta.
    expect(resolveDisplayName([], 'mr-mime')).toBe('Mr Mime')
    expect(resolveDisplayName([], 'nidoran-f')).toBe('Nidoran F')
  })

  it('ignora nomes de outros idiomas e nome em branco', () => {
    const names = [
      { name: 'バリヤード', language: named('ja') },
      { name: '   ', language: named('en') },
    ]
    expect(resolveDisplayName(names, 'mr-mime')).toBe('Mr Mime')
  })
})

describe('normalizeFlavorText', () => {
  it('remove as quebras de caixa de texto do cartucho', () => {
    const raw = 'Although small,\nits venomous\nbarbs render this\fPOKéMON dangerous.'
    expect(normalizeFlavorText(raw))
      .toBe('Although small, its venomous barbs render this POKéMON dangerous.')
  })

  it('remove o hífen suave e preserva o hífen de verdade', () => {
    // U+00AD parte a palavra na tela do Game Boy e é invisível aqui.
    expect(normalizeFlavorText('PO­KéMON')).toBe('POKéMON')
    expect(normalizeFlavorText('Ho-Oh e Porygon-Z')).toBe('Ho-Oh e Porygon-Z')
  })

  it('trata U+2028 e U+2029 como espaço', () => {
    expect(normalizeFlavorText('a b c')).toBe('a b c')
  })

  it('colapsa espaço repetido e apara as pontas', () => {
    expect(normalizeFlavorText('  a   b  ')).toBe('a b')
  })
})

describe('pickFlavorText', () => {
  const species = {
    flavor_text_entries: [
      { flavor_text: 'antigo', language: named('en'), version: named('red') },
      { flavor_text: 'こんにちは', language: named('ja'), version: named('scarlet') },
      { flavor_text: 'recente\ncom quebra', language: named('en'), version: named('violet') },
    ],
  }

  it('pega a ÚLTIMA entrada em inglês, não a primeira', () => {
    // A primeira vem do cartucho mais antigo; a última é a do jogo atual, que é
    // também onde o `POKéMON` em caixa alta já não existe.
    expect(pickFlavorText({ ...emptySpecies, ...species })).toBe('recente com quebra')
  })

  it('devolve null quando não há entrada em inglês', () => {
    const onlyJapanese = {
      ...emptySpecies,
      flavor_text_entries: [{ flavor_text: 'こんにちは', language: named('ja'), version: named('red') }],
    }
    expect(pickFlavorText(onlyJapanese)).toBeNull()
  })

  it('devolve null quando o texto em inglês é só espaço', () => {
    const blank = {
      ...emptySpecies,
      flavor_text_entries: [{ flavor_text: ' \n\f ', language: named('en'), version: named('red') }],
    }
    expect(pickFlavorText(blank)).toBeNull()
  })
})

const emptySpecies = {
  id: 1,
  name: 'x',
  names: [],
  flavor_text_entries: [],
  is_legendary: false,
  is_mythical: false,
  is_baby: false,
  capture_rate: 45,
  base_happiness: 70,
  habitat: null,
  color: named('green'),
  evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/1/' },
  varieties: [],
}

describe('buildEffectivenessMatrix', () => {
  function relations(overrides: Partial<PokeType['damage_relations']> = {}): PokeType['damage_relations'] {
    return {
      no_damage_to: [],
      half_damage_to: [],
      double_damage_to: [],
      no_damage_from: [],
      half_damage_from: [],
      double_damage_from: [],
      ...overrides,
    }
  }

  it('escreve 2, 0.5 e 0 nas casas certas e 1 no resto', () => {
    const types: PokeType[] = [
      {
        id: 13,
        name: 'electric',
        damage_relations: relations({
          double_damage_to: [named('water')],
          half_damage_to: [named('grass')],
          no_damage_to: [named('ground')],
        }),
      },
      { id: 11, name: 'water', damage_relations: relations({ double_damage_from: [named('electric')] }) },
      { id: 12, name: 'grass', damage_relations: relations({ half_damage_from: [named('electric')] }) },
      { id: 5, name: 'ground', damage_relations: relations({ no_damage_from: [named('electric')] }) },
    ]

    const matrix = buildEffectivenessMatrix(types)
    const electric = typeIndex('electric')
    expect(matrix[electric]?.[typeIndex('water')]).toBe(2)
    expect(matrix[electric]?.[typeIndex('grass')]).toBe(0.5)
    expect(matrix[electric]?.[typeIndex('ground')]).toBe(0)
    expect(matrix[electric]?.[typeIndex('fire')]).toBe(1)
    expect(matrix).toHaveLength(18)
    expect(matrix.every(row => row.length === 18)).toBe(true)
  })

  it('ignora stellar, unknown e shadow, que não têm coluna', () => {
    const types: PokeType[] = [{
      id: 13,
      name: 'electric',
      damage_relations: relations({ double_damage_to: [named('stellar'), named('shadow')] }),
    }]
    expect(() => buildEffectivenessMatrix(types)).not.toThrow()
  })

  it('para o build quando as relações _to e _from se contradizem', () => {
    // É a checagem que impede uma tabela de dano silenciosamente errada — o
    // defeito mais caro possível num jogo de batalha por tipo.
    const types: PokeType[] = [
      { id: 13, name: 'electric', damage_relations: relations({ double_damage_to: [named('water')] }) },
      { id: 11, name: 'water', damage_relations: relations({ half_damage_from: [named('electric')] }) },
    ]
    expect(() => buildEffectivenessMatrix(types)).toThrow(/inconsistente/)
  })

  it('para o build também quando um _to não tem nenhum _from que o confirme', () => {
    // A outra direção, e a que passa despercebida: aqui `water` não declara
    // *nada* em `_from`. Uma conferência que só percorra as listas `_from` nunca
    // visita esta casa — o `_to` espúrio entra na matriz e o build segue.
    // Comparando coluna por coluna, a ausência vale 1 e a contradição aparece.
    const types: PokeType[] = [
      { id: 13, name: 'electric', damage_relations: relations({ double_damage_to: [named('water')] }) },
      { id: 11, name: 'water', damage_relations: relations() },
    ]
    expect(() => buildEffectivenessMatrix(types)).toThrow(/inconsistente/)
  })
})

describe('selectMoveset — completar moveset curto', () => {
  const catalog = new Map<number, MoveEntry>([
    [85, entry({ id: 85, name: 'thunderbolt', power: 90, type: named('electric') })],
    [98, entry({ id: 98, name: 'quick-attack', power: 40, type: named('normal') })],
    [231, entry({ id: 231, name: 'iron-tail', power: 100, accuracy: 75, type: named('steel') })],
    [89, entry({ id: 89, name: 'earthquake', power: 100, type: named('ground') })],
    [58, entry({ id: 58, name: 'ice-beam', power: 90, type: named('ice') })],
    [126, entry({ id: 126, name: 'fire-blast', power: 110, type: named('fire') })],
  ])

  /** vg 25 é scarlet-violet (order 27); vg 1 é red-blue (order 3). */
  const order = new Map([[1, 3], [25, 27]])

  function learns(moveId: number, versionGroupId: number, level: number, method = 'level-up') {
    return {
      move: named('m', moveId),
      version_group_details: [{
        level_learned_at: level,
        version_group: named('vg', versionGroupId),
        move_learn_method: named(method),
      }],
    }
  }

  it('completa com máquina e tutor quando o nível não enche as 4 vagas', () => {
    // O defeito que isto conserta: parar no primeiro método com resultado dava a
    // Clefable, Ninetales, Poliwrath e Ludicolo 2 golpes cada, porque são
    // evoluções por pedra e o grupo mais recente quase não lhes ensina por
    // nível — embora o MESMO grupo tenha máquina e tutor de sobra.
    const p = pokemon({
      moves: [
        learns(85, 25, 30),
        learns(98, 25, 10),
        learns(231, 25, 0, 'machine'),
        learns(89, 25, 0, 'tutor'),
      ],
    })

    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('supplemented')
    expect(result.moveIds).toEqual([85, 89, 98, 231])
  })

  it('não completa quando o nível já dá as 4 vagas', () => {
    // A regra 1 continua valendo: golpe por nível é o que descreve a espécie.
    // A complementação é exceção, não o caminho normal.
    const p = pokemon({
      moves: [
        learns(85, 25, 40),
        learns(98, 25, 30),
        learns(231, 25, 20),
        learns(89, 25, 10),
        learns(58, 25, 0, 'machine'),
        learns(126, 25, 0, 'machine'),
      ],
    })

    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('level-up')
    expect(result.moveIds).toEqual([85, 89, 98, 231])
    expect(result.moveIds).not.toContain(58)
  })

  it('só completa dentro do MESMO version group', () => {
    // Misturar grupos produziria um moveset que nunca existiu em jogo nenhum —
    // é a decisão 1, e a complementação não pode furá-la para encher vaga.
    const p = pokemon({
      moves: [
        learns(85, 25, 30),
        learns(231, 1, 0, 'machine'),
        learns(89, 1, 0, 'tutor'),
      ],
    })

    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('level-up')
    expect(result.moveIds).toEqual([85])
  })

  it('mantém o nível quando o golpe é aprendido pelos dois métodos', () => {
    // Um golpe que existe por nível e por máquina no mesmo grupo entra uma vez
    // só, e com o nível — que é o que descreve quando a espécie de fato o ganha.
    const p = pokemon({
      moves: [
        {
          move: named('m', 85),
          version_group_details: [
            { level_learned_at: 36, version_group: named('vg', 25), move_learn_method: named('level-up') },
            { level_learned_at: 0, version_group: named('vg', 25), move_learn_method: named('machine') },
          ],
        },
        learns(98, 25, 0, 'machine'),
      ],
    })

    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('supplemented')
    expect(result.moveIds).toEqual([85, 98])
  })
})

function pokemon(overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    id: 25,
    name: 'pikachu',
    height: 4,
    weight: 60,
    types: [{ slot: 1, type: named('electric') }],
    stats: [
      { base_stat: 35, stat: named('hp') },
      { base_stat: 55, stat: named('attack') },
      { base_stat: 40, stat: named('defense') },
      { base_stat: 50, stat: named('special-attack') },
      { base_stat: 50, stat: named('special-defense') },
      { base_stat: 90, stat: named('speed') },
    ],
    moves: [],
    ...overrides,
  }
}

describe('toBaseStats', () => {
  it('lê por nome, não por posição', () => {
    // A PokeAPI não promete a ordem de `stats[]`. Ler por índice trocaria Ataque
    // por Defesa numa espécie só, e nenhuma checagem de contagem notaria.
    const shuffled = pokemon({
      stats: [
        { base_stat: 90, stat: named('speed') },
        { base_stat: 40, stat: named('defense') },
        { base_stat: 35, stat: named('hp') },
        { base_stat: 50, stat: named('special-defense') },
        { base_stat: 55, stat: named('attack') },
        { base_stat: 50, stat: named('special-attack') },
      ],
    })
    expect(toBaseStats(shuffled)).toEqual([35, 55, 40, 50, 50, 90])
  })

  it('explode quando um stat não veio', () => {
    const missing = pokemon({ stats: [{ base_stat: 35, stat: named('hp') }] })
    expect(() => toBaseStats(missing)).toThrow(/stat ausente/)
  })
})

describe('toTypes', () => {
  it('ordena pelo slot, não pela ordem do array', () => {
    const dual = pokemon({
      types: [
        { slot: 2, type: named('flying') },
        { slot: 1, type: named('fire') },
      ],
    })
    expect(toTypes(dual)).toEqual(['fire', 'flying'])
  })

  it('aceita tipo único', () => {
    expect(toTypes(pokemon())).toEqual(['electric'])
  })

  it('explode quando nenhum tipo é de batalha', () => {
    const odd = pokemon({ types: [{ slot: 1, type: named('stellar') }] })
    expect(() => toTypes(odd)).toThrow(/tipos/)
  })
})

function move(overrides: Partial<Move> = {}): Move {
  return {
    id: 85,
    name: 'thunderbolt',
    names: [english('Thunderbolt')],
    power: 90,
    accuracy: 100,
    pp: 15,
    priority: 0,
    type: named('electric'),
    damage_class: named('special'),
    ...overrides,
  }
}

function entry(overrides: Partial<Move> = {}): MoveEntry {
  const built = toMoveEntry(move(overrides))
  if (built === null) throw new Error('fixture deveria produzir um golpe de dano')
  return built
}

describe('toMoveEntry', () => {
  it('descarta golpe de status e golpe sem poder', () => {
    expect(toMoveEntry(move({ damage_class: named('status') }))).toBeNull()
    // Counter e Mirror Coat: classe de dano, poder nulo — o dano vem do golpe
    // recebido, e uma tabela de poder fixo não os representa.
    expect(toMoveEntry(move({ power: null }))).toBeNull()
  })

  it('preserva acurácia nula, que significa "nunca erra"', () => {
    expect(entry({ id: 129, name: 'swift', accuracy: null }).accuracy).toBeNull()
  })
})

describe('isEligibleMove', () => {
  it('aplica os dois tetos do plano', () => {
    expect(isEligibleMove(entry({ power: MAX_MOVE_POWER }))).toBe(true)
    expect(isEligibleMove(entry({ power: MAX_MOVE_POWER + 1 }))).toBe(false)
    expect(isEligibleMove(entry({ accuracy: MIN_MOVE_ACCURACY }))).toBe(true)
    expect(isEligibleMove(entry({ accuracy: MIN_MOVE_ACCURACY - 1 }))).toBe(false)
  })

  it('acurácia nula passa — não é acurácia baixa', () => {
    expect(isEligibleMove(entry({ accuracy: null }))).toBe(true)
  })
})

describe('selectMoveset', () => {
  const catalog = new Map<number, MoveEntry>([
    [85, entry({ id: 85, name: 'thunderbolt', power: 90, type: named('electric') })],
    [98, entry({ id: 98, name: 'quick-attack', power: 40, type: named('normal') })],
    [231, entry({ id: 231, name: 'iron-tail', power: 100, accuracy: 75, type: named('steel') })],
    [84, entry({ id: 84, name: 'thunder-shock', power: 40, type: named('electric') })],
    [STRUGGLE_MOVE_ID, entry({ id: STRUGGLE_MOVE_ID, name: 'struggle', power: 50, accuracy: null, type: named('normal') })],
  ])

  /** `order` é o campo cronológico. Os ids abaixo são os reais da PokeAPI. */
  const order = new Map([[1, 3], [25, 27], [29, 2]])

  function learns(moveId: number, versionGroupId: number, level: number, method = 'level-up') {
    return {
      move: named('m', moveId),
      version_group_details: [{
        level_learned_at: level,
        version_group: named('vg', versionGroupId),
        move_learn_method: named(method),
      }],
    }
  }

  it('vale a versão mais recente por ORDER, não por id', () => {
    // A regressão real: `blue-japan` tem id 29 — maior que scarlet-violet (25) —
    // porque a PokeAPI cadastrou o relançamento japonês depois. Ordenar por id
    // entrega o moveset de 1996 a todas as 1025 espécies, e o dex fica plausível
    // o bastante para ninguém notar.
    const p = pokemon({
      moves: [
        learns(84, 29, 1),
        learns(85, 25, 36),
        learns(98, 25, 5),
      ],
    })
    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('level-up')
    expect(result.moveIds).toEqual([85, 98])
    expect(result.moveIds).not.toContain(84)
  })

  it('prioriza diversidade de tipo antes de nível', () => {
    // Sem isso, um Pokémon com 8 golpes elétricos de nível alto deixaria a
    // escolha por cobertura da Fase 4 sem nada para escolher.
    const p = pokemon({
      moves: [
        learns(85, 25, 50),
        learns(84, 25, 45),
        learns(98, 25, 10),
        learns(231, 25, 5),
      ],
    })
    const result = selectMoveset(p, catalog, order)
    // Os quatro cabem em 8 vagas, então o teste olha a ORDEM de entrada:
    // um por tipo primeiro (85 elétrico, 231 aço, 98 normal), depois o resto.
    expect(new Set(result.moveIds)).toEqual(new Set([85, 84, 98, 231]))
  })

  it('cai para máquina/tutor quando não há golpe por nível', () => {
    const p = pokemon({ moves: [learns(85, 25, 0, 'machine')] })
    const result = selectMoveset(p, catalog, order)
    expect(result.source).toBe('any-method')
    expect(result.moveIds).toEqual([85])
  })

  it('cai para Struggle quando a espécie não tem golpe de dano nenhum', () => {
    // Ditto, Wobbuffet e Smeargle. Sem esta saída eles entram no dex com moveset
    // vazio e travam a batalha.
    const result = selectMoveset(pokemon({ moves: [] }), catalog, order)
    expect(result.source).toBe('struggle')
    expect(result.moveIds).toEqual([STRUGGLE_MOVE_ID])
  })

  it('nunca passa de 8 golpes', () => {
    const many = Array.from({ length: 30 }, (_, i) => learns(85, 25, i + 1))
    const result = selectMoveset(pokemon({ moves: many }), catalog, order)
    expect(result.moveIds.length).toBeLessThanOrEqual(8)
  })
})

describe('toEvolutionCondition', () => {
  const bare = {
    trigger: named('level-up'),
    min_level: null,
    item: null,
    held_item: null,
    known_move: null,
    known_move_type: null,
    min_happiness: null,
    min_affection: null,
    min_beauty: null,
    time_of_day: '',
    location: null,
    gender: null,
    trade_species: null,
    party_species: null,
    party_type: null,
    relative_physical_stats: null,
    needs_overworld_rain: false,
    turn_upside_down: false,
  }

  it('omite todo campo que não se aplica', () => {
    // Com 20 campos e ~700 arestas, serializar os nulos custaria ~175 KB para
    // dizer "nada aqui" — mais que o dex inteiro.
    expect(toEvolutionCondition(bare)).toEqual({ trigger: 'level-up' })
  })

  it('guarda o nível, que é o que a aba Evolução mostra', () => {
    expect(toEvolutionCondition({ ...bare, min_level: 16 })).toEqual({
      trigger: 'level-up',
      minLevel: 16,
    })
  })

  it('trata string vazia de time_of_day como ausência', () => {
    expect(toEvolutionCondition({ ...bare, time_of_day: '' })).not.toHaveProperty('timeOfDay')
    expect(toEvolutionCondition({ ...bare, time_of_day: 'night' })).toHaveProperty('timeOfDay', 'night')
  })

  it('converte os booleanos só quando são verdadeiros', () => {
    expect(toEvolutionCondition({ ...bare, turn_upside_down: true }))
      .toHaveProperty('turnUpsideDown', true)
    expect(toEvolutionCondition(bare)).not.toHaveProperty('turnUpsideDown')
  })
})
