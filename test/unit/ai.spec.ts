import { describe, expect, it } from 'vitest'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import type { BattlePokemon, BattleSide } from '~~/shared/game/battle'
import { activeOf, POTIONS_PER_SIDE, toBattlePokemon } from '~~/shared/game/battle'
import {
  chooseAiAction,
  chooseAiSwitch,
  expectedTurnDamage,
  noiseChance,
  switchesOnBadMatchup,
  usesPotion,
} from '~~/shared/game/ai'
import { bandOf } from '~~/shared/game/gyms'
import { resolveMoves, selectBattleMoves } from '~~/shared/game/moveset'
import { createRng } from '~~/shared/game/rng'
import { readAllSpecies, readCore } from '../support/generated-dex'

const core = readCore()
const catalog = new Map<number, MoveEntry>(core.moves.map(move => [move.id, move]))
const dex = new Map<string, SpeciesEntry>(readAllSpecies().map(entry => [entry.slug, entry]))

function pokemon(slug: string): BattlePokemon {
  const species = dex.get(slug)
  if (species === undefined) throw new Error(`${slug} não está no dex`)
  return toBattlePokemon(species, selectBattleMoves(species.types, resolveMoves(species, catalog)))
}

function side(slugs: readonly string[]): BattleSide {
  return { team: slugs.map(pokemon), active: 0, potionsLeft: POTIONS_PER_SIDE }
}

describe('ruído por ginásio', () => {
  it('cai de 40% no primeiro a 0% no nono', () => {
    expect(noiseChance(1)).toBeCloseTo(0.40, 10)
    expect(noiseChance(3)).toBeCloseTo(0.30, 10)
    expect(noiseChance(4)).toBeCloseTo(0.25, 10)
    expect(noiseChance(6)).toBeCloseTo(0.15, 10)
    expect(noiseChance(7)).toBeCloseTo(0.10, 10)
    expect(noiseChance(9)).toBe(0)
  })

  it('as faixas são cumulativas', () => {
    // Um líder do nono ginásio que não usasse poção seria mais fraco que um do
    // quarto, e a curva de dificuldade quebraria no meio.
    expect([1, 2, 3].map(bandOf)).toEqual(['A', 'A', 'A'])
    expect([4, 5, 6].map(bandOf)).toEqual(['B', 'B', 'B'])
    expect([7, 8, 9].map(bandOf)).toEqual(['C', 'C', 'C'])

    expect([1, 2, 3].map(usesPotion)).toEqual([false, false, false])
    expect([4, 7, 9].map(usesPotion)).toEqual([true, true, true])
    expect([1, 4, 6].map(switchesOnBadMatchup)).toEqual([false, false, false])
    expect([7, 8, 9].map(switchesOnBadMatchup)).toEqual([true, true, true])
  })
})

describe('escolha do golpe', () => {
  const leader = side(['machamp'])
  const target = pokemon('snorlax')

  function greedySlot(self: BattlePokemon, foe: BattlePokemon): number {
    let best = -1
    let bestScore = -1
    self.slots.forEach((slot, index) => {
      if (slot.move.damageClass === 'status') return
      const score = expectedTurnDamage(self, foe, slot.move, core.effectiveness)
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    return best
  }

  it('a faixa C sem ruído escolhe sempre o de maior dano esperado', () => {
    const expected = greedySlot(activeOf(leader), target)

    for (let seed = 0; seed < 200; seed++) {
      const action = chooseAiAction(9, leader, target, core.effectiveness, createRng(seed))
      expect(action, `seed ${seed}`).toEqual({ kind: 'move', slot: expected })
    }
  })

  it('a taxa de ruído da faixa A converge para 40%', () => {
    // A medida direta é indireta de propósito: quando o ruído pega, ele sorteia
    // entre os quatro e às vezes cai no mesmo golpe do guloso. Com n golpes, a
    // fração de decisões *diferentes* é `p × (n−1)/n` — e é dela que a taxa sai.
    const self = activeOf(leader)
    const expected = greedySlot(self, target)
    const options = self.slots.filter(slot => slot.move.damageClass !== 'status').length
    expect(options).toBeGreaterThan(1)

    const rng = createRng(31_337)
    let different = 0
    const rounds = 10_000
    for (let i = 0; i < rounds; i++) {
      const action = chooseAiAction(1, leader, target, core.effectiveness, rng)
      if (action.kind === 'move' && action.slot !== expected) different += 1
    }

    const rate = (different / rounds) / ((options - 1) / options)
    expect(rate).toBeGreaterThan(0.37)
    expect(rate).toBeLessThan(0.43)
  })
})

describe('golpe de status', () => {
  it('entra quando o alvo está limpo e sai depois disso', () => {
    // A escolha gulosa nunca o pegaria: dano esperado zero perde de qualquer
    // ataque. Sem esta regra, a vaga que o pipeline reserva no moveset seria
    // peso morto na mão dos nove líderes.
    const leader = side(['pikachu'])
    const statusSlot = activeOf(leader).slots.findIndex(slot => slot.move.damageClass === 'status')
    expect(statusSlot).toBeGreaterThanOrEqual(0)

    const healthy = pokemon('snorlax')
    expect(chooseAiAction(9, leader, healthy, core.effectiveness, createRng(1)))
      .toEqual({ kind: 'move', slot: statusSlot })

    const paralyzed: BattlePokemon = { ...healthy, condition: { kind: 'paralysis' } }
    const after = chooseAiAction(9, leader, paralyzed, core.effectiveness, createRng(1))
    expect(after.kind).toBe('move')
    expect(after).not.toEqual({ kind: 'move', slot: statusSlot })
  })

  it('não insiste com o golpe sem PP', () => {
    const leader = side(['pikachu'])
    const statusSlot = activeOf(leader).slots.findIndex(slot => slot.move.damageClass === 'status')
    const withoutPp: BattleSide = {
      ...leader,
      team: leader.team.map(current => ({
        ...current,
        slots: current.slots.map((slot, index) => (index === statusSlot ? { ...slot, pp: 0 } : slot)),
      })),
    }

    expect(chooseAiAction(9, withoutPp, pokemon('snorlax'), core.effectiveness, createRng(1)))
      .not.toEqual({ kind: 'move', slot: statusSlot })
  })
})

describe('poção', () => {
  const hurt = (base: BattleSide): BattleSide => ({
    ...base,
    team: base.team.map((current, index) =>
      (index === base.active ? { ...current, hp: Math.floor(current.maxHp * 0.1) } : current)),
  })

  it('a faixa B gasta a poção com o ativo abaixo de 25%', () => {
    const leader = hurt(side(['machamp']))
    expect(chooseAiAction(4, leader, pokemon('snorlax'), core.effectiveness, createRng(1)))
      .toEqual({ kind: 'item' })
  })

  it('a faixa A não tem poção para gastar', () => {
    const leader = hurt(side(['machamp']))
    expect(chooseAiAction(1, leader, pokemon('snorlax'), core.effectiveness, createRng(1)).kind)
      .toBe('move')
  })

  it('sem poção restante, volta a atacar', () => {
    const leader = { ...hurt(side(['machamp'])), potionsLeft: 0 }
    expect(chooseAiAction(4, leader, pokemon('snorlax'), core.effectiveness, createRng(1)).kind)
      .toBe('move')
  })
})

describe('troca', () => {
  it('a faixa C foge de uma matchup de ×2 contra', () => {
    // Onix é pedra/terra: um golpe de água bate ×4 nele.
    const leader = side(['onix', 'machamp'])
    const foe = pokemon('blastoise')

    const action = chooseAiAction(9, leader, foe, core.effectiveness, createRng(1))
    expect(action).toEqual({ kind: 'switch', index: 1 })
  })

  it('não troca quando o banco inteiro está na mesma enrascada', () => {
    // É o laço que o review achou: `chooseAiSwitch` escolhe por dano de saída e
    // não olhava a matchup de destino, então com o time todo ameaçado o líder
    // alternava entre dois Pokémon para sempre, sem nunca atacar — 113 trocas
    // por batalha no Ginásio 9 contra 3 nas faixas de baixo.
    const leader = side(['onix', 'geodude'])
    const foe = pokemon('blastoise')

    expect(chooseAiAction(9, leader, foe, core.effectiveness, createRng(1)).kind).toBe('move')
  })

  it('a faixa A aguenta o desaforo', () => {
    const leader = side(['onix', 'machamp'])
    expect(chooseAiAction(1, leader, pokemon('blastoise'), core.effectiveness, createRng(1)).kind)
      .toBe('move')
  })

  it('sem banco, não há para onde fugir', () => {
    const leader = side(['onix'])
    expect(chooseAiAction(9, leader, pokemon('blastoise'), core.effectiveness, createRng(1)).kind)
      .toBe('move')
  })

  it('a troca forçada escolhe quem bate mais forte, sem rolar dado', () => {
    const leader: BattleSide = {
      ...side(['onix', 'magikarp', 'machamp']),
      active: 0,
      team: side(['onix', 'magikarp', 'machamp']).team.map((current, index) =>
        (index === 0 ? { ...current, hp: 0 } : current)),
    }

    expect(chooseAiSwitch(leader, pokemon('snorlax'), core.effectiveness)).toBe(2)
  })
})
