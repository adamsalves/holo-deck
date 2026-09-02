import { describe, expect, it } from 'vitest'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'
import { aceOf, buildGymTeam, GYM_LEADERS, gymLeader } from '~~/shared/game/gyms'
import { baseStatTotal } from '~~/shared/game/rarity'
import { readGeneration } from '../support/generated-dex'

/**
 * A Liga amarrada ao dex real.
 *
 * O time sai da regra, não de uma lista curada — então o que precisa ser
 * verificado não é "o time está certo", é que a regra **fecha** nos nove casos:
 * há candidatos suficientes, todos do tipo e da geração do líder, todos sob o
 * teto, e o ace é o mais forte. Se uma geração futura mudar isso, o teste
 * reprova antes de a tela ficar vazia.
 */

function gym(number: number) {
  if (!isGymId(number)) throw new Error(`${number} não é ginásio`)
  return number
}

describe('os nove líderes', () => {
  it('são nove, um por geração, na ordem das regiões', () => {
    expect(GYM_LEADERS).toHaveLength(GYM_COUNT)
    expect(GYM_LEADERS.map(leader => leader.name)).toEqual([
      'Brock', 'Falkner', 'Wattson', 'Gardenia', 'Lenora', 'Valerie', 'Kiawe', 'Nessa', 'Ryme',
    ])
    expect(GYM_LEADERS.map(leader => leader.generation)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(GYM_LEADERS.map(leader => leader.region)).toEqual([
      'kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea',
    ])
  })

  it('a faixa decide tamanho de time e teto de BST', () => {
    expect(GYM_LEADERS.map(leader => leader.teamSize)).toEqual([3, 3, 3, 4, 4, 4, 6, 6, 6])
    expect(GYM_LEADERS.map(leader => leader.bstCap)).toEqual([480, 480, 480, 540, 540, 540, 600, 600, 600])
  })

  it('cada tipo aparece uma vez só — nove ginásios, nove leituras diferentes', () => {
    expect(new Set(GYM_LEADERS.map(leader => leader.type)).size).toBe(GYM_COUNT)
  })

  it('`gymLeader` devolve o líder pelo número do ginásio', () => {
    expect(gymLeader(gym(3)).name).toBe('Wattson')
    expect(gymLeader(gym(9)).type).toBe('ghost')
  })
})

describe('buildGymTeam', () => {
  const times = GYM_LEADERS.map(leader => ({
    leader,
    team: buildGymTeam(leader.gym, readGeneration(leader.generation).species),
  }))

  it('os nove times fecham: tamanho, tipo, geração e teto', () => {
    for (const { leader, team } of times) {
      expect(team, leader.name).toHaveLength(leader.teamSize)

      const daGeracao = new Set(readGeneration(leader.generation).species.map(species => species.id))
      for (const species of team) {
        expect(species.types, `${leader.name} · ${species.slug}`).toContain(leader.type)
        expect(daGeracao.has(species.id), `${leader.name} · ${species.slug}`).toBe(true)
        expect(baseStatTotal(species.baseStats), `${leader.name} · ${species.slug}`)
          .toBeLessThanOrEqual(leader.bstCap)
      }
    }
  })

  it('nenhum lendário e nenhum mítico, nos nove', () => {
    // O plano abria exceção para o Ginásio 9, e no dex real ela teria um único
    // efeito concreto: pôr Pecharunt como ace da Ryme. Não vale uma regra para
    // uma espécie.
    for (const { leader, team } of times) {
      for (const species of team) {
        expect(species.isLegendary, `${leader.name} · ${species.slug}`).toBe(false)
        expect(species.isMythical, `${leader.name} · ${species.slug}`).toBe(false)
      }
    }
  })

  it('o time entra em ordem crescente de BST, e o ace é o último', () => {
    for (const { leader, team } of times) {
      const bst = team.map(species => baseStatTotal(species.baseStats))
      expect([...bst].sort((a, b) => a - b), leader.name).toEqual(bst)
      expect(aceOf(team).slug, leader.name).toBe(team[team.length - 1]?.slug)
      expect(baseStatTotal(aceOf(team).baseStats), leader.name).toBe(Math.max(...bst))
    }
  })

  it('os dois pools apertados continuam apertados', () => {
    // O plano dizia Wattson 4 para 3 e Kiawe 7 para 6. O primeiro confere; o
    // segundo são **8**, porque Blacephalon é Ultra Beast e a PokeAPI não a
    // marca como lendária. Este teste é o que avisa se uma geração futura
    // apertar mais.
    const candidatos = (generation: number, type: string, cap: number) =>
      readGeneration(generation).species
        .filter(species => species.types.some(known => known === type))
        .filter(species => baseStatTotal(species.baseStats) <= cap)
        .filter(species => !species.isLegendary && !species.isMythical)
        .length

    expect(candidatos(3, 'electric', 480)).toBe(4)
    expect(candidatos(7, 'fire', 600)).toBe(8)
  })

  it('reprova alto quando o pool não enche o time', () => {
    // Falhar em silêncio aqui seria entregar um ginásio com dois Pokémon.
    expect(() => buildGymTeam(gym(1), [])).toThrow(/candidatos/)
  })
})
