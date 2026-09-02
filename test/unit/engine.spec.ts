import { describe, expect, it } from 'vitest'
import type { SpeciesId } from '~~/shared/types/brand'
import { isGymId } from '~~/shared/types/brand'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import { STRUGGLE_MOVE_ID } from '~~/shared/types/dex'
import type { BattleAction, BattleContext, BattleLog, BattleState } from '~~/shared/game/battle'
import { activeOf, ENGINE_VERSION, isBattleLog, POTION_HEAL_FRACTION } from '~~/shared/game/battle'
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

/**
 * As duas políticas de jogador que os testes usam, e a diferença entre elas
 * importa.
 *
 * `seca` insiste no primeiro golpe até o PP acabar — é ela que leva a batalha ao
 * estado em que Struggle é a única saída, que é a precondição do travamento que
 * o teste de terminação existe para pegar. `variada` troca uma vez e gasta a
 * poção, exercitando as três formas de ação para o replay.
 *
 * **Escrever as duas foi consequência de plantar a regressão:** com a política
 * variada, o defeito do Struggle sem tipo não reproduzia, e o portão teria
 * nascido passando.
 */
type Policy = 'seca' | 'variada'

function chooseTestAction(state: BattleState, policy: Policy): BattleAction {
  const bench = switchOptions(state)
  if (state.expecting === 'playerSwitch') return { kind: 'switch', index: bench[0] ?? 0 }
  if (policy === 'seca') return { kind: 'move', slot: 0 }

  const active = activeOf(state.player)
  if (state.player.potionsLeft > 0 && active.hp < active.maxHp * 0.3) return { kind: 'item' }
  if (state.turn === 3 && bench.length > 0) return { kind: 'switch', index: bench[0] ?? 0 }
  return { kind: 'move', slot: 0 }
}

function playThrough(
  seed: number,
  gymNumber: number,
  policy: Policy = 'variada',
): { state: BattleState, actions: BattleAction[] } {
  let state = startBattle({ gymId: gym(gymNumber), seed, team: DECK }, context)
  const actions: BattleAction[] = []

  for (let guard = 0; guard < 400 && state.outcome === 'ongoing'; guard++) {
    const action = chooseTestAction(state, policy)
    actions.push(action)
    state = applyAction(state, action, context).state
  }

  return { state, actions }
}

/** Os nove, para os testes que precisam varrer a Liga inteira. */
const GYMS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

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
    const uma = playThrough(4242, 1)
    const outra = playThrough(4242, 1)

    expect(JSON.stringify(outra.state)).toBe(JSON.stringify(uma.state))
    expect(outra.actions).toEqual(uma.actions)
  })

  it('seeds diferentes produzem batalhas diferentes', () => {
    const uma = playThrough(1, 1)
    const outra = playThrough(2, 1)

    expect(JSON.stringify(outra.state)).not.toBe(JSON.stringify(uma.state))
  })

  it('a batalha termina nos NOVE ginásios, e com um lado de pé', () => {
    // Este teste já existia e rodava só no ginásio 1 — faixa A, três Pokémon,
    // sem poção e sem troca por matchup, que é a única configuração em que os
    // dois travamentos que ele existia para pegar não podiam acontecer.
    //
    // O que ele deixou passar: Struggle é `normal` no catálogo e `normal → ghost`
    // é zero, então dois lados sem PP contra a Ryme trocavam golpes de dano nulo
    // para sempre; e a troca da faixa C alternava entre dois Pokémon sem nunca
    // atacar. Os dois só aparecem no fim da Liga.
    for (const gymNumber of GYMS) {
      for (const seed of [1, 7, 22, 33, 99, 1234, 65_535]) {
        for (const policy of ['seca', 'variada'] as const) {
          const { state } = playThrough(seed, gymNumber, policy)
          expect(['won', 'lost'], `ginásio ${gymNumber}, seed ${seed}, política ${policy}`)
            .toContain(state.outcome)
        }
      }
    }
  })

  it('o líder não troca em laço — a faixa C só sai para um abrigo de verdade', () => {
    // Sem o filtro de destino, o líder do nono ginásio trocava 113 vezes por
    // batalha (contra 3 nas faixas de baixo) e a dificuldade caía do sétimo ao
    // nono, porque ele gastava o turno trocando em vez de atacar.
    for (const gymNumber of [7, 8, 9]) {
      for (const seed of [1, 22, 33]) {
        let state = startBattle({ gymId: gym(gymNumber), seed, team: DECK }, context)
        let trocas = 0

        for (let guard = 0; guard < 400 && state.outcome === 'ongoing'; guard++) {
          const action: BattleAction = state.expecting === 'playerSwitch'
            ? { kind: 'switch', index: switchOptions(state)[0] ?? 0 }
            : { kind: 'move', slot: 0 }
          const turn = applyAction(state, action, context)
          trocas += turn.events.filter(event => event.kind === 'switch' && event.side === 'opponent').length
          state = turn.state
        }

        // O teto tem folga dos dois lados, e os dois números são medidos: com a
        // correção, o máximo nestes nove pares é **9** (5 trocas forçadas pelos
        // desmaios de um time de 6, mais as poucas de matchup); sem ela, o pior
        // par passa de 34 e a média do Ginásio 9 vai a 113.
        expect(trocas, `ginásio ${gymNumber}, seed ${seed}`).toBeLessThan(20)
      }
    }
  })
})

describe('replay', () => {
  it('reconstrói o estado final a partir do log', () => {
    const { state, actions } = playThrough(2024, 6)
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
    // É o caso real: fechar a aba no turno 4 e voltar. No ginásio 9, que é onde
    // a IA troca e a batalha é mais longa.
    const { actions } = playThrough(77, 9)
    const parcial = actions.slice(0, 4)
    const log: BattleLog = { gymId: 9, seed: 77, engineVersion: ENGINE_VERSION, team: DECK, actions: parcial }

    let esperado = startBattle({ gymId: gym(9), seed: 77, team: DECK }, context)
    for (const action of parcial) esperado = applyAction(esperado, action, context).state

    expect(JSON.stringify(replay(log, context))).toBe(JSON.stringify(esperado))
  })

  it('reproduz as três formas de ação, e não só o golpe', () => {
    // Sem isto o replay estaria provado sobre um log que nunca carregou `item`
    // nem troca voluntária — que são justamente as ações com retorno antecipado
    // antes da rolagem de ruído da IA.
    const { state, actions } = playThrough(2024, 6)
    const formas = new Set(actions.map(action => action.kind))

    expect(formas).toEqual(new Set(['move', 'switch', 'item']))
    expect(JSON.stringify(replay({
      gymId: state.gymId,
      seed: state.seed,
      engineVersion: ENGINE_VERSION,
      team: DECK,
      actions,
    }, context))).toBe(JSON.stringify(state))
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

  it('um golpe de 75% de acurácia erra perto de um quarto das vezes', () => {
    // Sem esta rolagem os 75% do Iron Tail seriam decoração, e a IA estaria
    // otimizando dano esperado contra uma regra que não existe.
    const ironTail = context.moves.get(231)
    if (ironTail === undefined) throw new Error('iron-tail fora do catálogo')
    expect(ironTail.accuracy).toBe(75)

    const base = comAtivo(
      startBattle({ gymId: gym(1), seed: 0, team: DECK }, context),
      'player',
      pokemon => ({ ...pokemon, slots: [{ move: ironTail, pp: 999 }, ...pokemon.slots.slice(1)] }),
    )

    const rodadas = 2000
    let erros = 0
    for (let seed = 0; seed < rodadas; seed++) {
      const { events } = applyAction({ ...base, seed, rng: seed }, { kind: 'move', slot: 0 }, context)
      if (events.some(event => event.kind === 'miss' && event.side === 'player')) erros += 1
    }

    expect(erros / rodadas).toBeGreaterThan(0.22)
    expect(erros / rodadas).toBeLessThan(0.28)
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

describe('isBattleLog — a fronteira do save', () => {
  // `Record<string, unknown>` e não `unknown`: os casos abaixo espalham o log
  // válido e trocam um campo, e `unknown` não é espalhável — a fixture precisa
  // ser um objeto de verdade, mesmo que o guarda receba `unknown`.
  function logValido(): Record<string, unknown> {
    return { gymId: 1, seed: 7, engineVersion: ENGINE_VERSION, team: [...DECK], actions: [{ kind: 'move', slot: 0 }] }
  }

  it('aceita o log que o motor produz', () => {
    expect(isBattleLog(logValido())).toBe(true)
  })

  it('recusa o que volta de um JSON.parse qualquer', () => {
    // É a fronteira que o `eslint.config.mjs` nomeia: round-trip de
    // localStorage. Sem guarda, o objeto chega ao motor e o erro aparece dez
    // turnos adiante, dentro de `applyAction`.
    expect(isBattleLog(null)).toBe(false)
    expect(isBattleLog('{}')).toBe(false)
    expect(isBattleLog([])).toBe(false)
    expect(isBattleLog({})).toBe(false)
  })

  it('recusa ginásio fora da Liga e time vazio', () => {
    expect(isBattleLog({ ...logValido(), gymId: 0 })).toBe(false)
    expect(isBattleLog({ ...logValido(), gymId: 10 })).toBe(false)
    expect(isBattleLog({ ...logValido(), team: [] })).toBe(false)
    expect(isBattleLog({ ...logValido(), team: [0] })).toBe(false)
  })

  it('recusa ação de kind desconhecido', () => {
    // Sem isto, ela atravessava até o `assertNever` do motor — que agora existe,
    // mas o certo é a forma ser recusada na porta.
    expect(isBattleLog({ ...logValido(), actions: [{ kind: 'fly', slot: 0 }] })).toBe(false)
    expect(isBattleLog({ ...logValido(), actions: [{ kind: 'move' }] })).toBe(false)
    expect(isBattleLog({ ...logValido(), actions: [{ kind: 'switch', index: -1 }] })).toBe(false)
    expect(isBattleLog({ ...logValido(), actions: [{ kind: 'item' }] })).toBe(true)
  })

  it('não julga a versão do motor — quem decide isso é o replay', () => {
    // Log de versão anterior é bem-formado; o que fazer com a batalha perdida é
    // decisão de quem sabe o contexto.
    expect(isBattleLog({ ...logValido(), engineVersion: ENGINE_VERSION - 1 })).toBe(true)
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

    // A asserção precisa vir **antes** do uso: envolvida num `if`, ela deixaria o
    // teste passar sem verificar nada no dia em que o laço acima parasse por
    // outro motivo.
    expect(state.expecting).toBe('playerSwitch')

    const antes = state.turn
    const depois = applyAction(state, { kind: 'switch', index: switchOptions(state)[0] ?? 1 }, context).state
    expect(depois.turn).toBe(antes)
    expect(depois.expecting).toBe('action')
    expect(activeOf(depois.player).hp).toBeGreaterThan(0)
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

    const { state: depois } = applyAction(state, { kind: 'move', slot: 0 }, context)
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

    // O teste dizia "cai em Struggle" e conferia só que **algum** evento saiu —
    // o que passaria igual se o motor tivesse usado outro golpe. O id está no
    // evento; é ele que prova a queda. `flatMap` em vez de `filter` porque é
    // dentro dele que o `kind` estreita a união e `moveId` passa a existir.
    const golpesDoJogador = semPp.events.flatMap(event =>
      (event.kind === 'hit' || event.kind === 'miss' || event.kind === 'no-effect')
      && event.side === 'player'
        ? [event.moveId]
        : [])

    expect(golpesDoJogador).toEqual([STRUGGLE_MOVE_ID])
  })

  it('condição respeita imunidade de tipo — Thunder Wave não paralisa Terrestre', () => {
    // O golpe de dano já parava no ×0 da fórmula; o de status não passa por ela.
    // Com a regra "status primeiro" da IA, sem esta checagem o líder abria a luta
    // aplicando a condição justamente em quem era imune.
    const thunderWave = context.moves.get(86)
    if (thunderWave === undefined) throw new Error('thunder-wave fora do catálogo')
    expect(thunderWave.damageClass).toBe('status')

    let state = startBattle({ gymId: gym(1), seed: 4, team: DECK }, context)
    const terrestre = readGeneration(1).species.find(entry => entry.slug === 'onix')
    if (terrestre === undefined) throw new Error('onix sumiu do dex')

    state = {
      ...state,
      player: {
        ...state.player,
        team: state.player.team.map((pokemon, index) =>
          (index === 0 ? { ...pokemon, slots: [{ move: thunderWave, pp: 20 }] } : pokemon)),
      },
      opponent: {
        ...state.opponent,
        team: state.opponent.team.map((pokemon, index) =>
          (index === state.opponent.active ? { ...pokemon, types: terrestre.types } : pokemon)),
      },
    }
    expect(activeOf(state.opponent).types).toContain('ground')

    const { state: depois, events } = applyAction(state, { kind: 'move', slot: 0 }, context)

    expect(events.some(event => event.kind === 'ailment')).toBe(false)
    expect(events.some(event => event.kind === 'no-effect' && event.side === 'player')).toBe(true)
    expect(activeOf(depois.opponent).condition).toBeNull()
  })

  it('o Struggle do slot não gasta PP', () => {
    // As nove espécies que só o têm o carregam com o `pp: 1` da PokeAPI. Sem a
    // exceção, o primeiro uso o zerava e a tela desenharia `Struggle 0/1`.
    let state = startBattle({ gymId: gym(1), seed: 8, team: DECK }, context)
    const struggle = context.moves.get(STRUGGLE_MOVE_ID)
    if (struggle === undefined) throw new Error('Struggle fora do catálogo')

    state = {
      ...state,
      player: {
        ...state.player,
        team: state.player.team.map((pokemon, index) =>
          (index === 0 ? { ...pokemon, slots: [{ move: struggle, pp: 1 }] } : pokemon)),
      },
    }

    const { state: depois } = applyAction(state, { kind: 'move', slot: 0 }, context)
    expect(activeOf(depois.player).slots[0]?.pp).toBe(1)
  })

  it('a batalha acabada não aceita mais ação', () => {
    const { state } = playThrough(9, 1)
    expect(() => applyAction(state, { kind: 'move', slot: 0 }, context)).toThrow(/já acabou/)
  })
})
