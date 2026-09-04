import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBattleStore } from '~~/app/stores/battle'
import { useProgressStore } from '~~/app/stores/progress'
import type { BattleAction, BattleContext } from '~~/shared/game/battle'
import { activeOf } from '~~/shared/game/battle'
import { switchOptions } from '~~/shared/game/engine'
import { rewardFor } from '~~/shared/game/economy'
import type { GymId, SpeciesId } from '~~/shared/types/brand'
import { isGymId, isSpeciesId } from '~~/shared/types/brand'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import { readAllSpecies, readCore, readGeneration } from '../support/generated-dex'

/**
 * A store da batalha — o log que o save grava e o estado que ele reconstrói.
 *
 * O teste que sustenta a fase inteira é o de **retomar**: gravar o log no meio
 * da luta, hidratar uma store nova com ele e provar que o estado reconstruído é
 * idêntico. Se isso não valer, fechar a aba no meio de um ginásio perde a
 * batalha — que é exatamente o que o save por seed + ações existe para impedir.
 *
 * Roda sobre o dex real, e não sobre fixture: o time do líder sai de
 * `buildGymTeam` lendo `gen-N.json`, então uma fixture provaria a fixture.
 *
 * **Mora em `test/unit/` e não em `test/nuxt/`, ao contrário das outras stores**,
 * e a razão é essa mesma leitura: sob o ambiente `nuxt` o `import.meta.url` deixa
 * de ser uma URL de arquivo e `test/support/generated-dex` não consegue achar a
 * raiz do repositório. Esta store não toca composable nenhum do Nuxt — só `pinia`
 * e `vue` —, então o ambiente `node` a serve inteira.
 */

const core = readCore()
const species = new Map<number, SpeciesEntry>(readAllSpecies().map(entry => [entry.id, entry]))

const context: BattleContext = {
  dexVersion: core.dexVersion,
  matrix: core.effectiveness,
  moves: new Map<number, MoveEntry>(core.moves.map(move => [move.id, move])),
  speciesById: id => species.get(id),
  speciesOfGeneration: generation => readGeneration(generation).species,
}

function speciesId(slug: string): SpeciesId {
  const found = [...species.values()].find(entry => entry.slug === slug)
  if (found === undefined || !isSpeciesId(found.id)) throw new Error(`${slug} não está no dex`)
  return found.id
}

function gym(number: number): GymId {
  if (!isGymId(number)) throw new Error(`${number} não é ginásio`)
  return number
}

const DECK = ['charizard', 'blastoise', 'venusaur', 'snorlax', 'gengar', 'alakazam'].map(speciesId)
/** Um Magikarp sozinho contra o nono ginásio. Existe para a derrota ser fato,
 * e não sorte de seed. */
const DECK_PERDEDOR = [speciesId('magikarp')]

/** A ação óbvia: trocar quando o motor exige, e o primeiro golpe com PP quando
 * não. Ela não joga bem — joga **determinístico**, que é o que o teste precisa. */
function nextAction(store: ReturnType<typeof useBattleStore>): BattleAction {
  const state = store.state
  if (state === null) throw new Error('sem batalha em campo')

  if (state.expecting === 'playerSwitch') {
    const [target] = switchOptions(state)
    if (target === undefined) throw new Error('troca exigida sem banco')
    return { kind: 'switch', index: target }
  }

  const slot = activeOf(state.player).slots.findIndex(current => current.pp > 0)
  return { kind: 'move', slot: slot < 0 ? 0 : slot }
}

function playToEnd(store: ReturnType<typeof useBattleStore>, limit = 400): void {
  for (let turn = 0; turn < limit; turn += 1) {
    if (store.state === null || store.state.outcome !== 'ongoing') return
    store.act(nextAction(store), context)
  }
  throw new Error('a batalha não terminou dentro do limite')
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a batalha começa', () => {
  it('carimba motor e dex no log, e nasce sem ações', () => {
    const battle = useBattleStore()
    battle.start(gym(1), DECK, 2024, context)

    expect(battle.hasSaved).toBe(true)
    expect(battle.ongoing).toBe(true)
    expect(battle.log?.actions).toEqual([])
    expect(battle.log?.team).toEqual(DECK)
    expect(battle.log?.dexVersion).toBe(core.dexVersion)
    expect(battle.gymId).toBe(1)
  })

  it('o log cresce por uma ação a cada turno, e o estado anda junto', () => {
    const battle = useBattleStore()
    battle.start(gym(1), DECK, 2024, context)

    battle.act({ kind: 'move', slot: 0 }, context)
    battle.act({ kind: 'move', slot: 0 }, context)

    expect(battle.log?.actions).toHaveLength(2)
    expect(battle.state?.turn).toBe(3)
    expect(battle.events.length).toBeGreaterThan(0)
  })
})

describe('retomar', () => {
  /**
   * **É a checagem nº 1 da persistência da fase.** Duas stores, um log entre
   * elas, e o estado precisa sair idêntico do outro lado — HP, PP, condição,
   * cursor do RNG e turno. Nada disso é gravado: tudo é reproduzido.
   */
  it('reconstrói o meio da luta a partir do log gravado', () => {
    const original = useBattleStore()
    original.start(gym(3), DECK, 77, context)
    for (let turn = 0; turn < 4; turn += 1) original.act(nextAction(original), context)

    const gravado = original.snapshot()
    const antes = JSON.stringify(original.state)

    // Uma store nova, como no boot: hidrata cru, sem dex, e só depois retoma.
    setActivePinia(createPinia())
    const depois = useBattleStore()
    depois.hydrate(gravado)

    expect(depois.hasSaved).toBe(true)
    expect(depois.state).toBeNull()

    const retomado = depois.resume(context)

    expect(retomado).not.toBeNull()
    expect(JSON.stringify(depois.state)).toBe(antes)
  })

  it('sem batalha salva não há o que retomar', () => {
    const battle = useBattleStore()
    battle.hydrate(null)

    expect(battle.resume(context)).toBeNull()
    expect(battle.hasSaved).toBe(false)
  })

  /**
   * A trava da issue #18 vista de cima: um deploy mexeu no dex, o log não
   * reproduz mais, e a regra do plano é perder a **luta** — nunca a coleção nem
   * o progresso, que vivem em outras stores e não são tocados aqui.
   */
  it('descarta a batalha de outro dex em vez de reproduzi-la torta', () => {
    const battle = useBattleStore()
    battle.start(gym(1), DECK, 2024, context)
    battle.act({ kind: 'move', slot: 0 }, context)

    const gravado = battle.snapshot()
    if (gravado === null) throw new Error('a batalha não foi gravada')

    setActivePinia(createPinia())
    const depois = useBattleStore()
    depois.hydrate({ ...gravado, dexVersion: 'deadbeef' })

    expect(depois.resume(context)).toBeNull()
    expect(depois.hasSaved).toBe(false)
    expect(depois.state).toBeNull()
  })

  it('descarta a batalha de outra versão do motor pela mesma regra', () => {
    const battle = useBattleStore()
    battle.start(gym(1), DECK, 2024, context)

    const gravado = battle.snapshot()
    if (gravado === null) throw new Error('a batalha não foi gravada')

    setActivePinia(createPinia())
    const depois = useBattleStore()
    depois.hydrate({ ...gravado, engineVersion: gravado.engineVersion - 1 })

    expect(depois.resume(context)).toBeNull()
    expect(depois.hasSaved).toBe(false)
  })
})

describe('o fim da luta', () => {
  it('vitória credita pela regra, dá a insígnia e apaga o log', () => {
    const progress = useProgressStore()
    const battle = useBattleStore()

    battle.start(gym(1), DECK, 2024, context)
    playToEnd(battle)

    expect(battle.state?.outcome).toBe('won')

    const esperado = rewardFor({ gym: gym(1), rematch: false, flawless: battle.flawless })
    expect(battle.reward).toEqual(esperado)
    expect(progress.coins).toBe(esperado.total)
    expect(progress.badges).toBe(1)

    // O log some e o estado fica: é o estado que a tela de resultado desenha.
    expect(battle.hasSaved).toBe(false)
    expect(battle.state).not.toBeNull()
  })

  /**
   * A revanche é lida **antes** de a insígnia avançar. Depois, toda estreia
   * pareceria repetição e pagaria 25% — o defeito que só aparece na conta do
   * jogador, e nunca numa tela.
   */
  it('a segunda vitória no mesmo ginásio paga revanche, e não outra insígnia', () => {
    const progress = useProgressStore()
    const battle = useBattleStore()

    battle.start(gym(1), DECK, 2024, context)
    playToEnd(battle)
    const estreia = progress.coins

    battle.start(gym(1), DECK, 909, context)
    playToEnd(battle)

    expect(battle.state?.outcome).toBe('won')
    expect(battle.reward?.earned).toBe(Math.floor(300 * 0.25))
    expect(progress.badges).toBe(1)
    expect(progress.coins).toBe(estreia + (battle.reward?.total ?? 0))
  })

  /**
   * "Derrota não tem punição: revanche imediata, nada é perdido." É um jogo de
   * um jogador só, e punir derrota ensinaria a evitar o conteúdo.
   */
  it('derrota não cobra nada, e também apaga o log', () => {
    const progress = useProgressStore()
    const battle = useBattleStore()

    battle.start(gym(9), DECK_PERDEDOR, 5, context)
    playToEnd(battle)

    expect(battle.state?.outcome).toBe('lost')
    expect(battle.reward).toBeNull()
    expect(progress.coins).toBe(0)
    expect(progress.badges).toBe(0)
    expect(battle.hasSaved).toBe(false)
  })

  it('não paga duas vezes quando o turno seguinte é tentado', () => {
    const progress = useProgressStore()
    const battle = useBattleStore()

    battle.start(gym(1), DECK, 2024, context)
    playToEnd(battle)
    const pago = progress.coins

    battle.act({ kind: 'move', slot: 0 }, context)

    expect(progress.coins).toBe(pago)
    expect(progress.badges).toBe(1)
  })
})

describe('desistir', () => {
  it('apaga a batalha e não cobra nada — não há punição por sair', () => {
    const progress = useProgressStore()
    const battle = useBattleStore()

    battle.start(gym(1), DECK, 2024, context)
    battle.act({ kind: 'move', slot: 0 }, context)
    battle.discard()

    expect(battle.hasSaved).toBe(false)
    expect(battle.state).toBeNull()
    expect(battle.gymId).toBeNull()
    expect(progress.coins).toBe(0)
  })
})
