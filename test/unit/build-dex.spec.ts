import { describe, expect, it } from 'vitest'
import type { ChainLink, EvolutionDetail, Species } from '~~/scripts/lib/pokeapi'
import type { Report } from '~~/scripts/build-dex'
import { buildEvolutionNode, defaultVarietyId, parseArgs } from '~~/scripts/build-dex'

/**
 * O orquestrador só ficou testável quando `await main()` deixou de rodar no
 * escopo do módulo: antes, qualquer `import` deste arquivo disparava o crawl
 * inteiro. O guarda `import.meta.main` custa uma linha e abre estas três
 * funções — e é `buildEvolutionNode` que produz a aresta sem condição.
 */

function emptyReport(): Report {
  return {
    displayNameFallback: [],
    movesetSupplemented: [],
    movesetFallback: [],
    movesetStruggle: [],
    movesetShort: [],
    movesetWithStatus: [],
    evolutionWithoutCondition: [],
    flavorMissing: [],
    legacyCasing: [],
  }
}

function speciesRef(name: string, id: number): ChainLink['species'] {
  return { name, url: `https://pokeapi.co/api/v2/pokemon-species/${id}/` }
}

function detail(overrides: Partial<EvolutionDetail> = {}): EvolutionDetail {
  return {
    trigger: { name: 'level-up', url: 'https://pokeapi.co/api/v2/evolution-trigger/1/' },
    min_level: 16,
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
    ...overrides,
  }
}

describe('parseArgs', () => {
  it('os padrões escrevem no dex commitado', () => {
    const options = parseArgs([])
    expect(options.outDir).toBe('public/data')
    expect(options.spritesDir).toBe('public/sprites')
    expect(options.concurrency).toBe(10)
    expect(options.withSprites).toBe(true)
    expect(options.partial).toBe(false)
  })

  it('recusa ensaio parcial apontado para o dex commitado', () => {
    // O ensaio escreve exatamente os mesmos nomes de arquivo do build completo:
    // sem esta recusa, `--species 4,5,6` troca 1025 espécies por 3 e sai com
    // sucesso. O caminho é comparado resolvido, então a forma relativa também cai.
    expect(() => parseArgs(['--species', '4,5,6'])).toThrow(/ensaio parcial/)
    expect(() => parseArgs(['--gen', '1'])).toThrow(/ensaio parcial/)
    expect(() => parseArgs(['--species', '4', '--out', './public/data'])).toThrow(/ensaio parcial/)
  })

  it('aceita ensaio parcial com --out fora do dex', () => {
    const options = parseArgs(['--species', '4,5,6', '--out', '/tmp/dex-ensaio'])
    expect(options.partial).toBe(true)
    expect(options.speciesFilter).toEqual([4, 5, 6])
    expect(options.outDir).toBe('/tmp/dex-ensaio')
  })

  it('recusa concorrência que não seja inteiro de 1 a 20', () => {
    // `--concurrency abc` virava `NaN` e produzia zero worker, com o erro
    // aparecendo na transformação em vez de na flag que o causou.
    expect(() => parseArgs(['--concurrency', 'abc'])).toThrow(/--concurrency/)
    expect(() => parseArgs(['--concurrency', '0'])).toThrow(/--concurrency/)
    expect(() => parseArgs(['--concurrency', '500'])).toThrow(/--concurrency/)
    expect(() => parseArgs(['--concurrency', '2.5'])).toThrow(/--concurrency/)
    expect(parseArgs(['--concurrency', '4']).concurrency).toBe(4)
  })

  it('--no-sprites pula a etapa de miniaturas', () => {
    expect(parseArgs(['--no-sprites']).withSprites).toBe(false)
  })
})

/** Espécie completa: o `consistent-type-assertions` do projeto proíbe `as`, e
 * uma fixture parcial disfarçada de `Species` é a mentira que ele existe para
 * impedir — inclusive num teste. */
function species(varieties: Species['varieties']): Species {
  return {
    id: 122,
    name: 'mr-mime',
    names: [],
    flavor_text_entries: [],
    is_legendary: false,
    is_mythical: false,
    is_baby: false,
    capture_rate: 45,
    base_happiness: 50,
    habitat: null,
    color: { name: 'pink', url: 'https://pokeapi.co/api/v2/pokemon-color/6/' },
    evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/58/' },
    varieties,
  }
}

describe('defaultVarietyId', () => {
  it('segue is_default, não a ordem da lista', () => {
    // `/pokemon` tem 1351 entradas contra as 1025 de `/pokemon-species`: as 326
    // de diferença são formas regionais. Sem `is_default`, Mr. Mime poderia
    // entrar no dex como a forma de Galar.
    expect(defaultVarietyId(species([
      { is_default: false, pokemon: speciesRef('mr-mime-galar', 10109) },
      { is_default: true, pokemon: speciesRef('mr-mime', 122) },
    ]))).toBe(122)
  })

  it('falha alto quando nenhuma variedade é padrão', () => {
    expect(() => defaultVarietyId(species([
      { is_default: false, pokemon: speciesRef('mr-mime-galar', 10109) },
    ]))).toThrow(/nenhuma variedade/)
  })
})

describe('buildEvolutionNode', () => {
  it('a raiz não tem condição e a aresta descendente tem', () => {
    const report = emptyReport()
    const chain: ChainLink = {
      species: speciesRef('charmander', 4),
      evolution_details: [],
      evolves_to: [{
        species: speciesRef('charmeleon', 5),
        evolution_details: [detail({ min_level: 16 })],
        evolves_to: [],
      }],
    }

    const node = buildEvolutionNode(chain, report)
    expect(node.via).toBeUndefined()
    expect(node.evolvesTo[0]?.via?.minLevel).toBe(16)
    expect(report.evolutionWithoutCondition).toEqual([])
  })

  it('relata a aresta descendente que a PokeAPI manda sem condição', () => {
    // `phione → manaphy` chega com `evolution_details` vazio. A aresta existe e a
    // condição não; inventar uma seria pior, e o silêncio anterior deixava a aba
    // Evolução da Fase 3 com uma seta sem explicação e ninguém sabendo por quê.
    const report = emptyReport()
    const chain: ChainLink = {
      species: speciesRef('phione', 489),
      evolution_details: [],
      evolves_to: [{
        species: speciesRef('manaphy', 490),
        evolution_details: [],
        evolves_to: [],
      }],
    }

    const node = buildEvolutionNode(chain, report)
    expect(node.evolvesTo[0]?.via).toBeUndefined()
    expect(report.evolutionWithoutCondition).toEqual(['phione → manaphy'])
  })

  it('fica com a primeira condição quando a API lista várias', () => {
    const report = emptyReport()
    const chain: ChainLink = {
      species: speciesRef('eevee', 133),
      evolution_details: [],
      evolves_to: [{
        species: speciesRef('vaporeon', 134),
        evolution_details: [
          detail({ min_level: null, trigger: { name: 'use-item', url: 'https://pokeapi.co/api/v2/evolution-trigger/3/' } }),
          detail({ min_level: 99 }),
        ],
        evolves_to: [],
      }],
    }

    const node = buildEvolutionNode(chain, report)
    expect(node.evolvesTo[0]?.via?.trigger).toBe('use-item')
    expect(node.evolvesTo[0]?.via?.minLevel).toBeUndefined()
  })

  it('recusa cadeia que aponta para espécie fora da faixa 1..1025', () => {
    const report = emptyReport()
    const chain: ChainLink = {
      species: speciesRef('forma-regional', 10109),
      evolution_details: [],
      evolves_to: [],
    }
    expect(() => buildEvolutionNode(chain, report)).toThrow(/fora da faixa/)
  })
})
