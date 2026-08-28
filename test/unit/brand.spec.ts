import { describe, expect, it } from 'vitest'
import type { GymId, MoveId, SpeciesId } from '../../shared/types/brand'
import { GYM_COUNT, SPECIES_COUNT, isGymId, isMoveId, isSpeciesId } from '../../shared/types/brand'
import { assertNever } from '../../shared/types/exhaustive'

/** Só existem para provar que a marca pega: passar o id errado não compila. */
function artworkUrl(id: SpeciesId): string {
  return `https://img.pokemondb.net/artwork/${id}.png`
}

function movePower(id: MoveId): number {
  return id
}

function gymReward(id: GymId): number {
  return id * 300
}

describe('ids marcados', () => {
  it('aceita a faixa real de espécies e recusa o resto', () => {
    expect(isSpeciesId(1)).toBe(true)
    expect(isSpeciesId(SPECIES_COUNT)).toBe(true)
    expect(isSpeciesId(0)).toBe(false)
    expect(isSpeciesId(SPECIES_COUNT + 1)).toBe(false)
    expect(isSpeciesId(1.5)).toBe(false)
  })

  it('aceita os 9 ginásios e nada além', () => {
    expect(isGymId(1)).toBe(true)
    expect(isGymId(GYM_COUNT)).toBe(true)
    expect(isGymId(GYM_COUNT + 1)).toBe(false)
  })

  it('estreita sem cast — o valor sai do guarda já marcado', () => {
    const raw: number = 25
    if (!isSpeciesId(raw)) {
      throw new Error('esperado id de espécie válido')
    }
    // `raw` entrou como number e sai daqui como SpeciesId, sem um único `as`.
    expect(artworkUrl(raw)).toContain('/25.png')
  })

  it('a marca separa ids que são todos number', () => {
    const move: number = 85
    const gym: number = 3
    if (!isMoveId(move) || !isGymId(gym)) {
      throw new Error('esperado ids válidos')
    }
    expect(movePower(move)).toBe(85)
    expect(gymReward(gym)).toBe(900)
    // Trocar os dois — `movePower(gym)` — não compila, que é o ponto da marca.
  })
})

type Action = { kind: 'attack' } | { kind: 'switch' }

function label(action: Action): string {
  switch (action.kind) {
    case 'attack':
      return 'ataque'
    case 'switch':
      return 'troca'
    default:
      return assertNever(action, 'label')
  }
}

describe('assertNever', () => {
  it('resolve os casos previstos', () => {
    expect(label({ kind: 'attack' })).toBe('ataque')
    expect(label({ kind: 'switch' })).toBe('troca')
  })

  it('explode com contexto quando um caso chega de fora do tipo', () => {
    // É assim que um caso não previsto entra de verdade: por JSON.parse, que
    // devolve `any`. É exatamente o buraco que a Fase 1 fecha com zod na
    // fronteira — aqui ele existe para provar que o `never` avisa em vez de calar.
    const fromOutside: Action = JSON.parse('{"kind":"flee"}')
    expect(() => label(fromOutside)).toThrow(/label/)
  })
})
