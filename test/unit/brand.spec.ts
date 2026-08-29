import { describe, expect, it } from 'vitest'
import type { GymId, MoveId, SpeciesId } from '~~/shared/types/brand'
import { GYM_COUNT, MOVE_COUNT, SPECIES_COUNT, isGymId, isMoveId, isSpeciesId } from '~~/shared/types/brand'
import { assertNever } from '~~/shared/types/exhaustive'

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

/**
 * Prova de tipo. O comentário "trocar os dois não compila" não é verificado por
 * nenhum teste de runtime: colapsar `Brand<T, B>` para `T` deixaria a suíte
 * inteira verde. Estas três linhas quebram o `yarn typecheck` com TS2344 nesse
 * caso — e rodam no portão que já existe, sem ferramenta nova.
 */
type Assert<T extends true> = T
type _MoveNaoEhGym = Assert<MoveId extends GymId ? false : true>
type _GymNaoEhMove = Assert<GymId extends MoveId ? false : true>
type _SpeciesNaoEhMove = Assert<SpeciesId extends MoveId ? false : true>

describe('ids marcados', () => {
  it('aceita a faixa real de espécies e recusa o resto', () => {
    expect(isSpeciesId(1)).toBe(true)
    expect(isSpeciesId(SPECIES_COUNT)).toBe(true)
    expect(isSpeciesId(0)).toBe(false)
    expect(isSpeciesId(SPECIES_COUNT + 1)).toBe(false)
    expect(isSpeciesId(1.5)).toBe(false)
  })

  it('aceita a faixa real de golpes e recusa o resto', () => {
    expect(isMoveId(1)).toBe(true)
    expect(isMoveId(MOVE_COUNT)).toBe(true)
    expect(isMoveId(0)).toBe(false)
    expect(isMoveId(1.5)).toBe(false)
    // O teto é o ponto: sem ele, um save adulterado com 999999 passava o guarda
    // e só quebrava lá na frente, como `dex[999999] === undefined`.
    expect(isMoveId(MOVE_COUNT + 1)).toBe(false)
    expect(isMoveId(999999)).toBe(false)
  })

  it('aceita os 9 ginásios e nada além', () => {
    expect(isGymId(1)).toBe(true)
    expect(isGymId(GYM_COUNT)).toBe(true)
    expect(isGymId(0)).toBe(false)
    expect(isGymId(1.5)).toBe(false)
    expect(isGymId(GYM_COUNT + 1)).toBe(false)
  })

  it('recusa o que não é inteiro finito positivo', () => {
    for (const guard of [isSpeciesId, isMoveId, isGymId]) {
      expect(guard(Number.NaN)).toBe(false)
      expect(guard(Number.POSITIVE_INFINITY)).toBe(false)
      expect(guard(Number.NEGATIVE_INFINITY)).toBe(false)
      expect(guard(-1)).toBe(false)
      expect(guard(-0)).toBe(false)
    }
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
    // Quem prova isso é o bloco de `Assert<...>` no topo do arquivo.
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

/**
 * Guarda deliberadamente frouxo: confere só que `kind` é string. É o validador
 * ingênuo que a Fase 1 substitui por zod na fronteira — existe aqui para deixar
 * um caso de fora do tipo chegar até o `switch` sem nenhum cast, que é como o
 * problema acontece de verdade.
 */
function looksLikeAction(value: unknown): value is Action {
  return typeof value === 'object' && value !== null
    && 'kind' in value && typeof value.kind === 'string'
}

describe('assertNever', () => {
  it('resolve os casos previstos', () => {
    expect(label({ kind: 'attack' })).toBe('ataque')
    expect(label({ kind: 'switch' })).toBe('troca')
  })

  it('explode com contexto quando um caso chega de fora do tipo', () => {
    const fromOutside: unknown = JSON.parse('{"kind":"flee"}')
    if (!looksLikeAction(fromOutside)) {
      throw new Error('esperado algo com forma de Action')
    }
    expect(() => label(fromOutside)).toThrow(/label/)
    expect(() => label(fromOutside)).toThrow(/flee/)
  })

  it('mantém o contexto mesmo quando o valor não serializa', () => {
    // Estado de batalha tem back-reference (pokémon ↔ batalha) por construção,
    // então este é o caso comum, não o exótico: sem o try/catch, o erro de
    // serialização substituiria o `context` e o rastro se perderia.
    const circular: Record<string, unknown> = { kind: 'flee' }
    circular.self = circular
    if (!looksLikeAction(circular)) {
      throw new Error('esperado algo com forma de Action')
    }
    expect(() => label(circular)).toThrow(/label/)

    const withBigInt: Record<string, unknown> = { kind: 'flee', hp: 10n }
    if (!looksLikeAction(withBigInt)) {
      throw new Error('esperado algo com forma de Action')
    }
    expect(() => label(withBigInt)).toThrow(/label/)
  })
})
