import { describe, expect, it } from 'vitest'
import { AILMENT_NAMES } from '~~/shared/types/dex'
import { createRng } from '~~/shared/game/rng'
import { toBattleStats } from '~~/shared/game/stats'
import type { Condition } from '~~/shared/game/status'
import {
  BURN_DAMAGE_FRACTION,
  CONDITION_LABELS,
  POISON_DAMAGE_FRACTION,
  checkImpediment,
  createCondition,
  effectiveDefense,
  effectiveOffense,
  effectiveSpeed,
  residualDamage,
  SLEEP_MAX_TURNS,
  SLEEP_MIN_TURNS,
} from '~~/shared/game/status'
import { readGeneration } from '../support/generated-dex'

const noctowl = toBattleStats(
  readGeneration(2).species.find(species => species.slug === 'noctowl')?.baseStats
  ?? [1, 1, 1, 1, 1, 1],
)

describe('paralisia', () => {
  it('corta o Speed pela metade — os 45 da prancha', () => {
    // A prancha da Batalha escreve `SPD 45 (90÷2)` e conclui dali que o Pikachu
    // ataca primeiro. Se este número mudar, a conclusão dela cai junto.
    expect(effectiveSpeed(noctowl, null)).toBe(90)
    expect(effectiveSpeed(noctowl, { kind: 'paralysis' })).toBe(45)
  })

  it('rouba perto de um quarto dos turnos', () => {
    const rng = createRng(77)
    let perdidos = 0
    for (let i = 0; i < 10_000; i++) {
      if (!checkImpediment({ kind: 'paralysis' }, rng).acts) perdidos += 1
    }

    expect(perdidos / 10_000).toBeGreaterThan(0.235)
    expect(perdidos / 10_000).toBeLessThan(0.265)
  })

  it('não sai sozinha — quem paralisa fica paralisado', () => {
    const depois = checkImpediment({ kind: 'paralysis' }, createRng(1)).condition
    expect(depois).toEqual({ kind: 'paralysis' })
  })
})

describe('queimadura', () => {
  it('corta o ataque físico e deixa o especial em paz', () => {
    const stats = toBattleStats([100, 100, 100, 100, 100, 100])
    const burn: Condition = { kind: 'burn' }

    expect(effectiveOffense(stats, 'physical', burn)).toBe(Math.floor(stats.attack / 2))
    expect(effectiveOffense(stats, 'special', burn)).toBe(stats.specialAttack)
  })

  it('a defesa não muda com condição nenhuma', () => {
    const stats = toBattleStats([100, 100, 100, 100, 100, 100])
    expect(effectiveDefense(stats, 'physical')).toBe(stats.defense)
    expect(effectiveDefense(stats, 'special')).toBe(stats.specialDefense)
  })

  it('tira 1/16 do HP máximo por turno, e o veneno tira o dobro', () => {
    expect(residualDamage({ kind: 'burn' }, 160)).toBe(160 * BURN_DAMAGE_FRACTION)
    expect(residualDamage({ kind: 'poison' }, 160)).toBe(160 * POISON_DAMAGE_FRACTION)
    expect(residualDamage(null, 160)).toBe(0)
    expect(residualDamage({ kind: 'paralysis' }, 160)).toBe(0)
  })

  it('o piso de 1 impede a condição de virar enfeite em HP baixo', () => {
    // 15 de HP máximo: `floor(15/16)` é zero, e a queimadura deixaria de doer
    // justamente em quem ela deveria matar.
    expect(residualDamage({ kind: 'burn' }, 15)).toBe(1)
    expect(residualDamage({ kind: 'poison' }, 7)).toBe(1)
  })
})

describe('sono', () => {
  it('sorteia de 1 a 3 turnos na aplicação', () => {
    const rng = createRng(4)
    const vistos = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const condition = createCondition('sleep', rng)
      if (condition.kind !== 'sleep') throw new Error('sono deveria nascer com contador')
      vistos.add(condition.turns)
    }

    expect([...vistos].sort()).toEqual([SLEEP_MIN_TURNS, 2, SLEEP_MAX_TURNS])
  })

  it('custa exatamente os turnos sorteados, e só então acorda', () => {
    // Um contador que acordasse no turno em que zera daria 0 a 2 turnos
    // perdidos, e o sono de 1 não custaria nada a ninguém.
    const rng = createRng(1)
    let condition: Condition | null = { kind: 'sleep', turns: 2 }
    const agiu: boolean[] = []

    for (let turno = 0; turno < 3; turno++) {
      const gate = checkImpediment(condition, rng)
      agiu.push(gate.acts)
      condition = gate.condition
    }

    expect(agiu).toEqual([false, false, true])
    expect(condition).toBeNull()
  })

  it('as outras três nascem sem contador', () => {
    const rng = createRng(1)
    expect(createCondition('paralysis', rng)).toEqual({ kind: 'paralysis' })
    expect(createCondition('burn', rng)).toEqual({ kind: 'burn' })
    expect(createCondition('poison', rng)).toEqual({ kind: 'poison' })
  })
})

describe('sem condição', () => {
  it('age sempre, e não consome rolagem', () => {
    // O consumo do fluxo precisa ser o mesmo entre a partida e o replay dela: um
    // Pokémon são não pode gastar um número que o outro caminho não gastaria.
    const rng = createRng(5)
    const antes = rng.state()
    expect(checkImpediment(null, rng).acts).toBe(true)
    expect(rng.state()).toBe(antes)
  })
})

describe('rótulos', () => {
  it('as quatro condições têm rótulo, e nenhuma a mais', () => {
    expect(Object.keys(CONDITION_LABELS).sort()).toEqual([...AILMENT_NAMES].sort())
    expect(CONDITION_LABELS.paralysis).toBe('PAR')
  })
})
