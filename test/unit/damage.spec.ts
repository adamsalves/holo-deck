import { describe, expect, it } from 'vitest'
import type { CoreData, DamagingMoveEntry } from '~~/shared/types/dex'
import { STRUGGLE_MOVE_ID } from '~~/shared/types/dex'
import type { Combatant } from '~~/shared/game/damage'
import { averageDamage, hasStab, rollDamage } from '~~/shared/game/damage'
import { createRng } from '~~/shared/game/rng'
import { toBattleStats } from '~~/shared/game/stats'
import { readCore, readGeneration } from '../support/generated-dex'

/**
 * A fórmula, medida contra o dex real e contra a prancha aprovada.
 *
 * O caso que amarra tudo é o primeiro: Pikachu usando Thunderbolt no Noctowl
 * paralisado, que é exatamente a tela que o canvas desenha. Se a faixa de dano
 * mudar, ou a prancha ou o motor está errado — e o teste diz qual.
 */

const core = readCore()

function moveBySlug(slug: string): DamagingMoveEntry {
  const move = core.moves.find(entry => entry.slug === slug)
  if (move === undefined) throw new Error(`${slug} não está no catálogo`)
  if (move.damageClass === 'status') throw new Error(`${slug} é golpe de status`)
  return move
}

function combatant(generation: number, slug: string, condition: Combatant['condition'] = null): Combatant {
  const species = readGeneration(generation).species.find(entry => entry.slug === slug)
  if (species === undefined) throw new Error(`${slug} não está no dex`)
  return { stats: toBattleStats(species.baseStats), types: species.types, condition }
}

const matrix: CoreData['effectiveness'] = core.effectiveness

describe('rollDamage — o caso da prancha da Batalha', () => {
  it('Thunderbolt do Pikachu no Noctowl fica entre 62 e 74, e 68 é alcançável', () => {
    const pikachu = combatant(1, 'pikachu')
    const noctowl = combatant(2, 'noctowl')
    const thunderbolt = moveBySlug('thunderbolt')

    const semCritico: number[] = []
    for (let seed = 0; seed < 400; seed++) {
      const roll = rollDamage(pikachu, noctowl, thunderbolt, matrix, createRng(seed))
      expect(roll.effectiveness).toBe(2)
      if (!roll.critical) semCritico.push(roll.damage)
    }

    expect(Math.min(...semCritico)).toBe(62)
    expect(Math.max(...semCritico)).toBe(74)
    expect(semCritico).toContain(68)
  })
})

describe('rollDamage', () => {
  const charizard = combatant(1, 'charizard')
  const onix = combatant(1, 'onix')

  it('imunidade zera, e o fluxo do RNG não muda por causa dela', () => {
    // As duas rolagens acontecem de qualquer jeito: fazer o consumo depender do
    // tipo do defensor transformaria um ×0 no meio da luta em divergência de
    // replay.
    const earthquake = moveBySlug('earthquake')
    const rngA = createRng(9)
    const rngB = createRng(9)

    const imune = rollDamage(onix, charizard, earthquake, matrix, rngA)
    rollDamage(charizard, onix, earthquake, matrix, rngB)

    expect(imune.damage).toBe(0)
    expect(imune.effectiveness).toBe(0)
    expect(rngA.state()).toBe(rngB.state())
  })

  it('fraqueza dupla multiplica', () => {
    // Charizard é fogo/voador e pedra bate ×2 nos dois.
    const rockSlide = moveBySlug('rock-slide')
    expect(rollDamage(onix, charizard, rockSlide, matrix, createRng(1)).effectiveness).toBe(4)
  })

  it('STAB soma 50%, e Struggle não recebe', () => {
    // Struggle é sem tipo nos jogos; o catálogo o guarda como normal porque a
    // PokeAPI assim o entrega. Dar STAB a ele premiaria justamente quem está sem
    // golpe nenhum.
    const struggle = core.moves.find(move => move.id === STRUGGLE_MOVE_ID)
    if (struggle === undefined || struggle.damageClass === 'status') throw new Error('Struggle sumiu do catálogo')

    const rattata = combatant(1, 'rattata')
    expect(rattata.types).toContain('normal')
    expect(hasStab(rattata, struggle)).toBe(false)
    expect(hasStab(rattata, moveBySlug('quick-attack'))).toBe(true)
  })

  it('o crítico multiplica o dano do mesmo golpe', () => {
    const thunderbolt = moveBySlug('thunderbolt')
    const pikachu = combatant(1, 'pikachu')
    const noctowl = combatant(2, 'noctowl')

    const rolls = Array.from({ length: 400 }, (_, seed) =>
      rollDamage(pikachu, noctowl, thunderbolt, matrix, createRng(seed)))
    const criticos = rolls.filter(roll => roll.critical)
    const normais = rolls.filter(roll => !roll.critical)

    expect(criticos.length).toBeGreaterThan(0)
    expect(Math.min(...criticos.map(roll => roll.damage)))
      .toBeGreaterThan(Math.max(...normais.map(roll => roll.damage)))
  })

  it('a queimadura corta o golpe físico e deixa o especial em paz', () => {
    const machamp = combatant(1, 'machamp')
    const queimado: Combatant = { ...machamp, condition: { kind: 'burn' } }
    const fisico = moveBySlug('cross-chop')
    const especial = moveBySlug('flamethrower')

    const puro = rollDamage(machamp, onix, fisico, matrix, createRng(3)).damage
    const comQueimadura = rollDamage(queimado, onix, fisico, matrix, createRng(3)).damage
    expect(comQueimadura).toBeLessThan(puro)

    expect(rollDamage(queimado, onix, especial, matrix, createRng(3)).damage)
      .toBe(rollDamage(machamp, onix, especial, matrix, createRng(3)).damage)
  })

  it('golpe que acerta tira pelo menos 1', () => {
    // Sem o piso, golpe fraco contra defesa alta com ×¼ chega a zero e a
    // batalha empata para sempre.
    const fraco = moveBySlug('ruination')
    const shuckle = combatant(2, 'shuckle')
    for (let seed = 0; seed < 50; seed++) {
      expect(rollDamage(shuckle, shuckle, fraco, matrix, createRng(seed)).damage)
        .toBeGreaterThanOrEqual(1)
    }
  })
})

describe('averageDamage', () => {
  it('cai no meio da faixa que as rolagens produzem', () => {
    const pikachu = combatant(1, 'pikachu')
    const noctowl = combatant(2, 'noctowl')
    const thunderbolt = moveBySlug('thunderbolt')

    const media = averageDamage(pikachu, noctowl, thunderbolt, matrix)
    expect(media).toBeGreaterThan(62)
    expect(media).toBeLessThan(74)
  })

  it('não arredonda — o valor existe para desempatar quatro golpes', () => {
    const pikachu = combatant(1, 'pikachu')
    const noctowl = combatant(2, 'noctowl')
    const media = averageDamage(pikachu, noctowl, moveBySlug('thunderbolt'), matrix)

    expect(Number.isInteger(media)).toBe(false)
  })

  it('imunidade vale zero, e é assim que a IA aprende a não usá-lo', () => {
    expect(averageDamage(combatant(1, 'onix'), combatant(1, 'charizard'), moveBySlug('earthquake'), matrix))
      .toBe(0)
  })
})
