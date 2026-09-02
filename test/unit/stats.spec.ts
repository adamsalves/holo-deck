import { describe, expect, it } from 'vitest'
import { BATTLE_IV, BATTLE_LEVEL, toBattleStats } from '~~/shared/game/stats'
import { readAllSpecies, readGeneration } from '../support/generated-dex'

/**
 * A conversão é o único lugar em que o motor e a prancha aprovada precisam
 * concordar em número exato — e concordam: os quatro valores que a prancha da
 * Batalha estampa saem daqui, lidos do dex real e não de uma fixture escrita
 * para dar certo.
 */

function bySlug(generation: number, slug: string) {
  const species = readGeneration(generation).species.find(entry => entry.slug === slug)
  if (species === undefined) throw new Error(`${slug} não está no dex`)
  return species
}

describe('toBattleStats', () => {
  it('reproduz o Pikachu da prancha da Batalha', () => {
    const stats = toBattleStats(bySlug(1, 'pikachu').baseStats)

    expect(stats.hp).toBe(110)
    expect(stats.specialAttack).toBe(70)
    expect(stats.speed).toBe(110)
  })

  it('reproduz o Noctowl da prancha da Batalha', () => {
    // O outro lado da mesma tela, e é ele que sustenta a leitura de ordem de
    // turno que a prancha faz: 110 contra 90, e 45 quando paralisado.
    const stats = toBattleStats(bySlug(2, 'noctowl').baseStats)

    expect(stats.hp).toBe(175)
    expect(stats.specialDefense).toBe(116)
    expect(stats.speed).toBe(90)
  })

  it('o HP soma nível + 10 e os outros somam 5', () => {
    // A assimetria é dos jogos. Aplicar a mesma soma aos seis daria 55 de HP ao
    // Pikachu, e toda batalha acabaria em dois turnos.
    const stats = toBattleStats([100, 100, 100, 100, 100, 100])
    const comum = Math.floor((2 * 100 + BATTLE_IV) * BATTLE_LEVEL / 100)

    expect(stats.hp).toBe(comum + BATTLE_LEVEL + 10)
    expect(stats.attack).toBe(comum + 5)
  })

  it('lê a tupla na ordem de STAT_NAMES, e não em outra', () => {
    // Seis valores distintos: qualquer troca de posição — defesa por ataque,
    // especial por velocidade — aparece aqui e em nenhum teste de contagem.
    const stats = toBattleStats([1, 2, 3, 4, 5, 6])

    // O HP fica fora da comparação porque ele soma 60 e os outros somam 5 — é
    // a assimetria da fórmula, não desordem.
    expect(stats.hp).toBe(Math.floor((2 * 1 + BATTLE_IV) * BATTLE_LEVEL / 100) + BATTLE_LEVEL + 10)
    expect([stats.attack, stats.defense, stats.specialAttack, stats.specialDefense, stats.speed])
      .toEqual([22, 23, 24, 25, 26])
  })

  it('as 1025 convertem para inteiros positivos', () => {
    // Um `NaN` aqui não explode: ele atravessa a fórmula de dano e sai como
    // barra de HP vazia, sem erro nenhum no console.
    for (const species of readAllSpecies()) {
      for (const value of Object.values(toBattleStats(species.baseStats))) {
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThan(0)
      }
    }
  })
})
