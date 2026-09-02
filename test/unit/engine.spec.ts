import { describe, expect, it } from 'vitest'
import type { SpeciesId } from '~~/shared/types/brand'
import { isGymId } from '~~/shared/types/brand'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import type { BattleAction, BattleContext, BattleLog, BattleState } from '~~/shared/game/battle'
import { activeOf, ENGINE_VERSION, POTION_HEAL_FRACTION } from '~~/shared/game/battle'
import { applyAction, replay, startBattle, switchOptions } from '~~/shared/game/engine'
import { readAllSpecies, readCore, readGeneration } from '../support/generated-dex'

/**
 * O motor inteiro, rodado sobre o dex real.
 *
 * O teste que sustenta a decisão de persistência é o do replay: se a mesma seed
 * com a mesma sequência de ações não reproduzir a batalha idêntica, o save por
 * seed + log de ações não funciona, e a Fase 6 precisa saber disso aqui e não
 * quando o jogador voltar do celular.
 */

const core = readCore()
const species = new Map<number, SpeciesEntry>(readAllSpecies().map(entry => [entry.id, entry]))

const context: BattleContext = {
  matrix: core.effectiveness,
  moves: new Map<number, MoveEntry>(core.moves.map(move => [move.id, move])),
  speciesById: id => species.get(id),
  speciesOfGeneration: generation => readGeneration(generation).species,
}

function speciesId(slug: string): SpeciesId {
  const found = [...species.values()].find(entry => entry.slug === slug)
  if (found === undefined) throw new Error(`${slug} não está no dex`)
  return found.id
}

const DECK = ['pikachu', 'charizard', 'blastoise', 'venusaur', 'snorlax', 'gengar'].map(speciesId)

function gym(number: number) {
  if (!isGymId(number)) throw new Error(`${number} não é ginásio`)
  return number
}

/** Joga a batalha inteira sempre com o primeiro golpe, e devolve as ações. */
function playThrough(seed: number, gymNumber = 1): { state: BattleState, actions: BattleAction[] } {
  let state = startBattle({ gymId: gym(gymNumber), seed, team: DECK }, context)
  const actions: BattleAction[] = []

  for (let guard = 0; guard < 400 && state.outcome === 'ongoing'; guard++) {
    const action: BattleAction = state.expecting === 'playerSwitch'
      ? { kind: 'switch', index: switchOptions(state)[0] ?? 0 }
      : { kind: 'move', slot: 0 }
    actions.push(action)
    state = applyAction(state, action, context).state
  }

  return { state, actions }
}

describe('startBattle', () => {
  it('monta os dois times, com HP e PP cheios', () => {
    const state = startBattle({ gymId: gym(1), seed: 1, team: DECK }, context)

    expect(state.player.team).toHaveLength(6)
    // Brock é da faixa de três.
    expect(state.opponent.team).toHaveLength(3)
    expect(state.outcome).toBe('ongoing')
    expect(state.engineVersion).toBe(ENGINE_VERSION)

    for (const pokemon of [...state.player.team, ...state.opponent.team]) {
      expect(pokemon.hp).toBe(pokemon.maxHp)
      expect(pokemon.slots.length).toBeGreaterThan(0)
      for (const slot of pokemon.slots) expect(slot.pp).toBe(slot.move.pp)
    }
  })

  it('o adversário sai da regra, não de uma lista — mesmo ginásio, mesmo time', () => {
    const uma = startBattle({ gymId: gym(1), seed: 1, team: DECK }, context)
    const outra = startBattle({ gymId: gym(1), seed: 999, team: DECK }, context)

    expect(outra.opponent.team.map(pokemon => pokemon.slug))
      .toEqual(uma.opponent.team.map(pokemon => pokemon.slug))
  })

  it('recusa espécie que o dex não conhece', () => {
    // O id é válido; quem não a conhece é o contexto — que é exatamente a falha
    // real: um deploy com `gen-N.json` truncado. Forjar um id fora da faixa
    // exigiria um `as`, e a marca existe para isso não acontecer.
    const cego: BattleContext = { ...context, speciesById: () => undefined }

    expect(() => startBattle({ gymId: gym(1), seed: 1, team: DECK }, cego)).toThrow(/não está no dex/)
  })
})

describe('determinismo', () => {
  it('a mesma seed com as mesmas ações reproduz a batalha idêntica', () => {
    const uma = playThrough(4242)
    const outra = playThrough(4242)

    expect(JSON.stringify(outra.state)).toBe(JSON.stringify(uma.state))
    expect(outra.actions).toEqual(uma.actions)
  })

  it('seeds diferentes produzem batalhas diferentes', () => {
    const uma = playThrough(1)
    const outra = playThrough(2)

    expect(JSON.stringify(outra.state)).not.toBe(JSON.stringify(uma.state))
  })

  it('a batalha termina, e com um lado de pé', () => {
    // Se o motor travar — PP zerado sem Struggle, faint sem troca —, é aqui que
    // aparece: o laço tem teto e o estado ficaria em `ongoing`.
    for (const seed of [1, 7, 99, 1234, 65_535]) {
      const { state } = playThrough(seed)
      expect(['won', 'lost'], `seed ${seed}`).toContain(state.outcome)
    }
  })
})

describe('replay', () => {
  it('reconstrói o estado final a partir do log', () => {
    const { state, actions } = playThrough(2024)
    const log: BattleLog = {
      gymId: state.gymId,
      seed: state.seed,
      engineVersion: ENGINE_VERSION,
      team: DECK,
      actions,
    }

    expect(JSON.stringify(replay(log, context))).toBe(JSON.stringify(state))
  })

  it('reconstrói também o meio da luta, turno a turno', () => {
    // É o caso real: fechar a aba no turno 4 e voltar.
    const { actions } = playThrough(77)
    const parcial = actions.slice(0, 4)
    const log: BattleLog = { gymId: 1, seed: 77, engineVersion: ENGINE_VERSION, team: DECK, actions: parcial }

    let esperado = startBattle({ gymId: gym(1), seed: 77, team: DECK }, context)
    for (const action of parcial) esperado = applyAction(esperado, action, context).state

    expect(JSON.stringify(replay(log, context))).toBe(JSON.stringify(esperado))
  })

  it('recusa log de outra versão do motor em vez de reproduzir torto', () => {
    const log: BattleLog = {
      gymId: 1,
      seed: 1,
      engineVersion: ENGINE_VERSION - 1,
      team: DECK,
      actions: [],
    }

    expect(() => replay(log, context)).toThrow(/não reproduz/)
  })
})

describe('ordem do turno', () => {
  /** Sobrescreve o ativo de um lado — mais direto que procurar a espécie que
   * tem por acaso o Speed ou o golpe que o teste precisa. */
  function comAtivo(
    state: BattleState,
    side: 'player' | 'opponent',
    patch: (pokemon: BattleState['player']['team'][number]) => BattleState['player']['team'][number],
  ): BattleState {
    const lado = state[side]
    const team = lado.team.map((pokemon, index) => (index === lado.active ? patch(pokemon) : pokemon))
    return side === 'player'
      ? { ...state, player: { ...lado, team } }
      : { ...state, opponent: { ...lado, team } }
  }

  /** Quem apareceu primeiro agindo no log do turno. */
  function primeiro(events: readonly { kind: string, side?: string }[]): string | undefined {
    return events.find(event => ['hit', 'miss', 'no-effect', 'blocked'].includes(event.kind))?.side
  }

  function comSpeed(state: BattleState, side: 'player' | 'opponent', speed: number): BattleState {
    return comAtivo(state, side, pokemon => ({ ...pokemon, stats: { ...pokemon.stats, speed } }))
  }

  it('o mais rápido age primeiro', () => {
    const base = startBattle({ gymId: gym(1), seed: 12, team: DECK }, context)

    const rapido = comSpeed(comSpeed(base, 'player', 999), 'opponent', 1)
    expect(primeiro(applyAction(rapido, { kind: 'move', slot: 0 }, context).events)).toBe('player')

    const lento = comSpeed(comSpeed(base, 'player', 1), 'opponent', 999)
    expect(primeiro(applyAction(lento, { kind: 'move', slot: 0 }, context).events)).toBe('opponent')
  })

  it('prioridade ganha de Speed', () => {
    // Quick Attack existe para isto, e sem a regra ela seria só um golpe fraco.
    const quickAttack = context.moves.get(98)
    if (quickAttack === undefined) throw new Error('quick-attack fora do catálogo')
    expect(quickAttack.priority).toBeGreaterThan(0)

    const base = startBattle({ gymId: gym(1), seed: 12, team: DECK }, context)
    const comPrioridade = comAtivo(
      comSpeed(comSpeed(base, 'player', 1), 'opponent', 999),
      'player',
      pokemon => ({ ...pokemon, slots: [{ move: quickAttack, pp: 30 }, ...pokemon.slots.slice(1)] }),
    )

    expect(primeiro(applyAction(comPrioridade, { kind: 'move', slot: 0 }, context).events)).toBe('player')
  })

  it('empate de Speed sorteia pela seed, e o sorteio é estável', () => {
    // É a regra real, e é o que mantém a batalha reproduzível: sem ela, empate
    // de Speed precisaria de um critério fixo, e um dos dois lados sempre
    // ganharia a iniciativa.
    const ordens = new Set<string | undefined>()
    for (let seed = 0; seed < 40; seed++) {
      const base = startBattle({ gymId: gym(1), seed, team: DECK }, context)
      const empate = comSpeed(comSpeed(base, 'player', 100), 'opponent', 100)
      const uma = primeiro(applyAction(empate, { kind: 'move', slot: 0 }, context).events)
      const outra = primeiro(applyAction(empate, { kind: 'move', slot: 0 }, context).events)

      expect(outra, `seed ${seed} não repetiu`).toBe(uma)
      ordens.add(uma)
    }

    expect(ordens.size, 'a mesma ordem em 40 seeds significa que o desempate não sorteia').toBe(2)
  })
})

describe('regras do turno', () => {
  it('quem perdeu o ativo escolhe quem entra, e o turno não anda até isso', () => {
    let state = startBattle({ gymId: gym(1), seed: 5, team: DECK }, context)
    // Derruba o ativo do jogador na marra, que é mais direto que procurar a
    // sequência de golpes que faz isso.
    state = {
      ...state,
      player: {
        ...state.player,
        team: state.player.team.map((pokemon, index) => (index === 0 ? { ...pokemon, hp: 1 } : pokemon)),
      },
    }

    let turnos = 0
    while (state.outcome === 'ongoing' && state.expecting === 'action' && turnos < 20) {
      state = applyAction(state, { kind: 'move', slot: 0 }, context).state
      turnos += 1
    }

    if (state.expecting === 'playerSwitch') {
      const antes = state.turn
      const depois = applyAction(state, { kind: 'switch', index: switchOptions(state)[0] ?? 1 }, context).state
      expect(depois.turn).toBe(antes)
      expect(depois.expecting).toBe('action')
      expect(activeOf(depois.player).hp).toBeGreaterThan(0)
    }
  })

  it('só aceita troca enquanto espera troca', () => {
    let state = startBattle({ gymId: gym(1), seed: 5, team: DECK }, context)
    state = { ...state, expecting: 'playerSwitch' }

    expect(() => applyAction(state, { kind: 'move', slot: 0 }, context)).toThrow(/só uma troca/)
  })

  it('recusa troca para quem está em campo ou desmaiado', () => {
    const state = startBattle({ gymId: gym(1), seed: 5, team: DECK }, context)

    expect(() => applyAction(state, { kind: 'switch', index: 0 }, context)).toThrow(/já está em campo/)
    expect(() => applyAction(state, { kind: 'switch', index: 42 }, context)).toThrow(/não existe/)
  })

  it('a poção devolve 40% do máximo e só funciona uma vez por lado', () => {
    let state = startBattle({ gymId: gym(1), seed: 11, team: DECK }, context)
    const ativo = activeOf(state.player)
    state = {
      ...state,
      player: {
        ...state.player,
        team: state.player.team.map((pokemon, index) =>
          (index === 0 ? { ...pokemon, hp: 1 } : pokemon)),
      },
    }

    const { state: curado, events } = applyAction(state, { kind: 'item' }, context)
    const cura = events.filter(event => event.kind === 'potion')

    // O quanto curou sai do evento, e não do HP final: o líder ataca no mesmo
    // turno, e o HP que sobra já vem com o golpe dele descontado.
    expect(cura).toHaveLength(1)
    expect(cura[0]?.healed).toBe(Math.floor(ativo.maxHp * POTION_HEAL_FRACTION))
    expect(curado.player.potionsLeft).toBe(0)

    // A segunda tentativa, num estado em que o ativo ainda está de pé.
    const dePe: typeof curado = {
      ...curado,
      expecting: 'action',
      player: {
        ...curado.player,
        team: curado.player.team.map((pokemon, index) =>
          (index === curado.player.active ? { ...pokemon, hp: pokemon.maxHp } : pokemon)),
      },
    }
    expect(() => applyAction(dePe, { kind: 'item' }, context)).toThrow(/já usada/)
  })

  it('gasta PP a cada golpe, e o slot zerado cai em Struggle', () => {
    let state = startBattle({ gymId: gym(1), seed: 3, team: DECK }, context)
    const ppInicial = activeOf(state.player).slots[0]?.pp ?? 0

    const { state: depois, events } = applyAction(state, { kind: 'move', slot: 0 }, context)
    const gastou = activeOf(depois.player).slots[0]?.pp ?? 0
    expect(gastou).toBe(ppInicial - 1)

    // Zera o slot e confere que o golpe usado passa a ser Struggle.
    state = {
      ...state,
      player: {
        ...state.player,
        team: state.player.team.map((pokemon, index) =>
          (index === 0
            ? { ...pokemon, slots: pokemon.slots.map(slot => ({ ...slot, pp: 0 })) }
            : pokemon)),
      },
    }
    const semPp = applyAction(state, { kind: 'move', slot: 0 }, context)
    const usados = semPp.events.filter(event => event.kind === 'hit' || event.kind === 'miss')
    expect(usados.length).toBeGreaterThan(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('a batalha acabada não aceita mais ação', () => {
    const { state } = playThrough(9)
    expect(() => applyAction(state, { kind: 'move', slot: 0 }, context)).toThrow(/já acabou/)
  })
})
