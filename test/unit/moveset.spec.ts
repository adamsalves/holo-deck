import { describe, expect, it } from 'vitest'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import { MOVES_IN_BATTLE, STRUGGLE_MOVE_ID } from '~~/shared/types/dex'
import { expectedPower, resolveMoves, selectBattleMoves } from '~~/shared/game/moveset'
import { MAX_MOVE_POWER } from '~~/scripts/lib/transform'
import { readAllSpecies, readCore, readGeneration } from '../support/generated-dex'

const core = readCore()
const catalog = new Map<number, MoveEntry>(core.moves.map(move => [move.id, move]))

function speciesBySlug(generation: number, slug: string): SpeciesEntry {
  const species = readGeneration(generation).species.find(entry => entry.slug === slug)
  if (species === undefined) throw new Error(`${slug} não está no dex`)
  return species
}

function battleMovesOf(generation: number, slug: string): readonly MoveEntry[] {
  const species = speciesBySlug(generation, slug)
  return selectBattleMoves(species.types, resolveMoves(species, catalog))
}

describe('selectBattleMoves', () => {
  it('o Pikachu sai com STAB no slot 1 e o golpe de status no 4', () => {
    // É a leitura da prancha da Batalha: o quarto botão é Thunder Wave, e o
    // primeiro é o golpe elétrico de maior dano esperado.
    const slugs = battleMovesOf(1, 'pikachu').map(move => move.slug)

    expect(slugs[0]).toBe('thunderbolt')
    expect(slugs[MOVES_IN_BATTLE - 1]).toBe('thunder-wave')
  })

  it('poder × acurácia, não poder cru', () => {
    // Thunder (110 a 70%) perde para Thunderbolt (90 a 100%): 77 contra 90 de
    // dano esperado por turno. Escolher por poder cru inverteria os dois.
    const thunder = core.moves.find(move => move.slug === 'thunder')
    const thunderbolt = core.moves.find(move => move.slug === 'thunderbolt')
    if (thunder?.damageClass === 'status' || thunderbolt?.damageClass === 'status') throw new Error('fixture')
    if (thunder === undefined || thunderbolt === undefined) throw new Error('fixture')

    expect(thunder.power).toBeGreaterThan(thunderbolt.power)
    expect(expectedPower(thunder)).toBeLessThan(expectedPower(thunderbolt))
  })

  it('acurácia nula vale 100 — é "nunca erra", não acurácia zero', () => {
    const swift = core.moves.find(move => move.slug === 'swift')
    if (swift === undefined || swift.damageClass === 'status') throw new Error('fixture')

    expect(swift.accuracy).toBeNull()
    expect(expectedPower(swift)).toBe(swift.power)
  })

  it('os três primeiros slots cobrem todo tipo que a espécie tiver para oferecer', () => {
    // É a regra que faz a cobertura existir: sem ela, um Pokémon elétrico sai
    // com quatro golpes elétricos e a matchup de tipo deixa de ser decisão.
    //
    // A afirmação não é "nunca repete tipo" — quem só conhece dois tipos vai
    // repetir, e deixar a vaga vazia seria punir a espécie duas vezes. É "não
    // repete enquanto houver tipo novo a usar".
    for (const species of readAllSpecies()) {
      const disponiveis = resolveMoves(species, catalog).filter(move => move.damageClass !== 'status')
      const moves = selectBattleMoves(species.types, resolveMoves(species, catalog))
      // O golpe de status entra no recorte quando o moveset tem menos de 4:
      // Pyukumuku sai com Struggle e Toxic, e a cobertura em questão é a dos
      // golpes de dano.
      const primeiros = moves.slice(0, 3).filter(move => move.damageClass !== 'status')
      const esperado = Math.min(new Set(disponiveis.map(move => move.type)).size, primeiros.length)

      expect(new Set(primeiros.map(move => move.type)).size, species.slug).toBe(esperado)
    }
  })

  it('o golpe de status é sempre o último, mesmo em quem conhece um tipo só', () => {
    // Montar o slot 4 antes de completar os três primeiros punha o status no
    // meio do moveset — e o índice que o log de ações grava deixaria de
    // corresponder ao botão que a prancha desenha.
    for (const species of readAllSpecies()) {
      const moves = selectBattleMoves(species.types, resolveMoves(species, catalog))
      const posicao = moves.findIndex(move => move.damageClass === 'status')
      if (posicao === -1) continue

      expect(posicao, species.slug).toBe(moves.length - 1)
    }
  })

  it('as 1025 saem com no máximo 4 golpes, sem repetição e sem golpe acima do teto', () => {
    for (const species of readAllSpecies()) {
      const moves = selectBattleMoves(species.types, resolveMoves(species, catalog))

      expect(moves.length, species.slug).toBeGreaterThan(0)
      expect(moves.length, species.slug).toBeLessThanOrEqual(MOVES_IN_BATTLE)
      expect(new Set(moves.map(move => move.id)).size, species.slug).toBe(moves.length)
      for (const move of moves) {
        if (move.damageClass === 'status') continue
        expect(move.power, `${species.slug} · ${move.slug}`).toBeLessThanOrEqual(MAX_MOVE_POWER)
      }
    }
  })

  it('é determinística — a mesma espécie sai igual toda vez', () => {
    // O replay depende disto tanto quanto do RNG: um moveset que mude de ordem
    // entre duas execuções muda o índice do slot que o log gravou.
    for (const species of readAllSpecies()) {
      const uma = selectBattleMoves(species.types, resolveMoves(species, catalog))
      const outra = selectBattleMoves(species.types, resolveMoves(species, catalog))

      expect(outra.map(move => move.id), species.slug).toEqual(uma.map(move => move.id))
    }
  })

  it('quem só tem Struggle entra com Struggle', () => {
    const moves = battleMovesOf(1, 'metapod')

    expect(moves).toHaveLength(1)
    expect(moves[0]?.id).toBe(STRUGGLE_MOVE_ID)
  })

  it('quem não sabe atacar mas sabe envenenar leva os dois', () => {
    expect(battleMovesOf(7, 'pyukumuku').map(move => move.slug).sort())
      .toEqual(['struggle', 'toxic'])
  })

  it('sem STAB disponível, o slot 1 é o mais forte no geral', () => {
    const semStab = selectBattleMoves(['dragon'], resolveMoves(speciesBySlug(1, 'pikachu'), catalog))
    const todos = resolveMoves(speciesBySlug(1, 'pikachu'), catalog)
      .filter(move => move.damageClass !== 'status')

    // `todos` já veio sem golpe de status: o TS infere o predicado do `filter`
    // acima, e é por isso que `expectedPower` aceita os dois lados aqui.
    const maisForte = [...todos].sort((a, b) => expectedPower(b) - expectedPower(a))[0]
    expect(semStab[0]?.id).toBe(maisForte?.id)
  })

  it('status ganha de prioridade no slot 4', () => {
    // O Pikachu tem os dois — Feint com prioridade +2 e Thunder Wave. O status
    // é a única coisa do moveset que muda o estado do oponente.
    const moves = battleMovesOf(1, 'pikachu')
    const quarto = moves[MOVES_IN_BATTLE - 1]

    expect(quarto?.damageClass).toBe('status')
    expect(resolveMoves(speciesBySlug(1, 'pikachu'), catalog).some(move => move.priority > 0)).toBe(true)
  })
})
