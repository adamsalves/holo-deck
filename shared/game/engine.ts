import type { SpeciesId } from '../types/brand.ts'
import { isGymId } from '../types/brand.ts'
import type { DamagingMoveEntry, MoveEntry } from '../types/dex.ts'
import { STRUGGLE_MOVE_ID } from '../types/dex.ts'
import { assertNever } from '../types/exhaustive.ts'
import { chooseAiAction, chooseAiSwitch } from './ai.ts'
import type {
  BattleAction,
  BattleContext,
  BattleEvent,
  BattleLog,
  BattlePokemon,
  BattleSide,
  BattleState,
  SideName,
} from './battle.ts'
import {
  activeOf,
  benchIndexes,
  ENGINE_VERSION,
  hasLost,
  isFainted,
  POTION_HEAL_FRACTION,
  POTIONS_PER_SIDE,
  toBattlePokemon,
  toCombatant,
} from './battle.ts'
import { rollDamage } from './damage.ts'
import { buildGymTeam, gymLeader } from './gyms.ts'
import { resolveMoves, selectBattleMoves } from './moveset.ts'
import type { RngCursor } from './rng.ts'
import { createRng } from './rng.ts'
import { checkImpediment, createCondition, effectiveSpeed, residualDamage } from './status.ts'
import { effectivenessAgainst } from './typechart.ts'

/**
 * A máquina de estados da batalha.
 *
 * Ela é pura por fora: `applyAction(estado, ação)` devolve sempre o mesmo
 * próximo estado, porque o cursor do RNG viaja **dentro** do estado. É essa
 * propriedade que faz o save da batalha caber em seed + lista de ações e o
 * replay reconstruir a luta inteira sem guardar HP, PP nem condição de ninguém.
 *
 * **A ordem de consumo do RNG é o contrato**, e mudá-la é mudar
 * `ENGINE_VERSION`:
 *
 * 1. a decisão da IA (ruído e, se ele pegar, o sorteio do golpe);
 * 2. o desempate de Speed, e só quando os dois são iguais;
 * 3. por golpe, na ordem do turno: impedimento (só a paralisia rola) e acerto
 *    (pulado quando a acurácia é nula, que é "nunca erra");
 * 4. só em golpe de dano, crítico e aleatório — os dois **sempre**, inclusive
 *    contra imunidade, que é o que impede o `×0` de mudar o fluxo;
 * 5. a chance da condição, quando o golpe carrega uma, o alvo está limpo e não é
 *    imune ao tipo — e, se a condição aplicada for sono, os turnos dele.
 *
 * O fim de turno não rola nada. Um golpe de status pula o passo 4 inteiro, e um
 * golpe de dano contra alvo imune para antes do 5 — os dois são determinísticos
 * porque dependem só do estado, que o replay reconstrói igual.
 */

/** O que o motor devolve: o estado seguinte e o que aconteceu para a tela narrar. */
export interface BattleTurn {
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface BattleSetup {
  readonly gymId: number
  readonly seed: number
  readonly team: readonly SpeciesId[]
}

const OTHER: Record<SideName, SideName> = { player: 'opponent', opponent: 'player' }

function sideOf(state: BattleState, side: SideName): BattleSide {
  return side === 'player' ? state.player : state.opponent
}

function withSide(state: BattleState, side: SideName, value: BattleSide): BattleState {
  return side === 'player' ? { ...state, player: value } : { ...state, opponent: value }
}

function withPokemon(side: BattleSide, index: number, pokemon: BattlePokemon): BattleSide {
  return { ...side, team: side.team.map((current, i) => (i === index ? pokemon : current)) }
}

function withActive(side: BattleSide, pokemon: BattlePokemon): BattleSide {
  return withPokemon(side, side.active, pokemon)
}

function hurt(pokemon: BattlePokemon, amount: number): BattlePokemon {
  return { ...pokemon, hp: Math.max(0, pokemon.hp - amount) }
}

/**
 * Monta um lado a partir das espécies, resolvendo golpe e PP.
 *
 * Espécie que o contexto não conhece derruba a montagem: um time com buraco
 * seria uma batalha com menos cartas do que o jogador escolheu, e falhar aqui é
 * o único jeito de isso não virar uma vitória fácil que ninguém pediu.
 */
function buildSide(ids: readonly SpeciesId[], context: BattleContext): BattleSide {
  const team = ids.map((id) => {
    const species = context.speciesById(id)
    if (species === undefined) throw new Error(`espécie ${id} não está no dex`)
    const moves = selectBattleMoves(species.types, resolveMoves(species, context.moves))
    return toBattlePokemon(species, moves)
  })
  if (team.length === 0) throw new Error('time vazio não entra em batalha')
  return { team, active: 0, potionsLeft: POTIONS_PER_SIDE }
}

/**
 * O estado inicial, derivado inteiramente do `BattleSetup`.
 *
 * O time do líder é montado aqui, e não recebido pronto, porque é isso que faz o
 * log da batalha se bastar: `buildGymTeam` é determinística sobre o dex, então
 * a mesma seed e o mesmo ginásio produzem o mesmo adversário em qualquer
 * máquina e em qualquer retomada.
 */
export function startBattle(setup: BattleSetup, context: BattleContext): BattleState {
  if (!isGymId(setup.gymId)) throw new Error(`ginásio ${setup.gymId} fora da faixa`)
  const leader = gymLeader(setup.gymId)
  const opponentTeam = buildGymTeam(setup.gymId, context.speciesOfGeneration(leader.generation))

  return {
    gymId: setup.gymId,
    seed: setup.seed,
    rng: setup.seed,
    engineVersion: ENGINE_VERSION,
    // Do contexto, e não do `setup`: quem sabe qual dex está em campo é quem
    // carrega o dex. Um `dexVersion` vindo do chamador seria um número que ele
    // poderia digitar diferente do arquivo que acabou de ler.
    dexVersion: context.dexVersion,
    turn: 1,
    player: buildSide(setup.team, context),
    opponent: buildSide(opponentTeam.map(species => species.id), context),
    outcome: 'ongoing',
    expecting: 'action',
  }
}

/**
 * O golpe que sai do slot.
 *
 * Slot inexistente ou sem PP vira **Struggle**, dos dois lados. A tela do
 * jogador não oferece golpe zerado, mas um save adulterado oferece — e Struggle
 * é a resposta honesta, a mesma que os jogos dão. Ele não gasta PP: a PokeAPI o
 * entrega com `pp: 1` por resíduo de primeira geração, e respeitar isso faria as
 * dez espécies que só o têm atacarem uma vez por batalha.
 */
function moveFromSlot(
  pokemon: BattlePokemon,
  slot: number,
  context: BattleContext,
): { readonly move: MoveEntry, readonly spends: boolean } {
  const chosen = pokemon.slots[slot]
  if (chosen !== undefined && chosen.pp > 0) {
    // Struggle **no slot** também não gasta: as nove espécies que só o têm o
    // carregam como golpe de verdade, com o `pp: 1` que a PokeAPI entrega, e sem
    // esta linha o primeiro uso o zerava — a tela desenharia `Struggle 0/1` e o
    // comentário acima seria mentira na metade dos casos que ele descreve.
    return { move: chosen.move, spends: chosen.move.id !== STRUGGLE_MOVE_ID }
  }

  const struggle = context.moves.get(STRUGGLE_MOVE_ID)
  if (struggle === undefined) throw new Error('Struggle fora do catálogo — sem golpe de reserva')
  return { move: struggle, spends: false }
}

function spendPp(pokemon: BattlePokemon, slot: number): BattlePokemon {
  return {
    ...pokemon,
    slots: pokemon.slots.map((current, index) =>
      (index === slot ? { ...current, pp: Math.max(0, current.pp - 1) } : current)),
  }
}

/** Passo 1 da resolução: quem age primeiro. */
function firstMover(
  state: BattleState,
  playerMove: MoveEntry,
  opponentMove: MoveEntry,
  rng: RngCursor,
): SideName {
  if (playerMove.priority !== opponentMove.priority) {
    return playerMove.priority > opponentMove.priority ? 'player' : 'opponent'
  }

  const player = activeOf(state.player)
  const opponent = activeOf(state.opponent)
  const playerSpeed = effectiveSpeed(player.stats, player.condition)
  const opponentSpeed = effectiveSpeed(opponent.stats, opponent.condition)
  if (playerSpeed !== opponentSpeed) return playerSpeed > opponentSpeed ? 'player' : 'opponent'

  // Empate de Speed sorteia — é a regra real, e ela sai do RNG com seed para o
  // replay reproduzir o mesmo lado agindo primeiro.
  return rng.chance(0.5) ? 'player' : 'opponent'
}

/** Passos 2 a 5, para um lado. Devolve o estado com o golpe já aplicado. */
function resolveMove(
  state: BattleState,
  attacker: SideName,
  slot: number,
  context: BattleContext,
  rng: RngCursor,
  events: BattleEvent[],
): BattleState {
  const defender = OTHER[attacker]
  const attackerSide = sideOf(state, attacker)
  const active = activeOf(attackerSide)

  const impediment = checkImpediment(active.condition, rng)
  let current: BattlePokemon = { ...active, condition: impediment.condition }
  if (!impediment.acts) {
    if (active.condition !== null) events.push({ kind: 'blocked', side: attacker, condition: active.condition })
    return withSide(state, attacker, withActive(attackerSide, current))
  }

  const { move, spends } = moveFromSlot(current, slot, context)
  if (spends) current = spendPp(current, slot)
  let next = withSide(state, attacker, withActive(attackerSide, current))

  // Acurácia nula é "nunca erra" e nem chega a rolar.
  if (move.accuracy !== null && !rng.chance(move.accuracy / 100)) {
    events.push({ kind: 'miss', side: attacker, moveId: move.id })
    return next
  }

  const defenderSide = sideOf(next, defender)
  const target = activeOf(defenderSide)

  if (move.damageClass !== 'status') {
    const damaging: DamagingMoveEntry = move
    const roll = rollDamage(toCombatant(current), toCombatant(target), damaging, context.matrix, rng)
    if (roll.effectiveness === 0) {
      events.push({ kind: 'no-effect', side: attacker, moveId: move.id })
      return next
    }
    events.push({
      kind: 'hit',
      side: attacker,
      moveId: move.id,
      damage: roll.damage,
      effectiveness: roll.effectiveness,
      critical: roll.critical,
    })
    next = withSide(next, defender, withActive(defenderSide, hurt(target, roll.damage)))
  }

  return applyAilment(next, attacker, move, context, rng, events)
}

/**
 * A condição do golpe, se houver, e se o alvo estiver limpo.
 *
 * A rolagem acontece sempre que o golpe carrega condição e o alvo não tem
 * nenhuma — inclusive no golpe de status, cuja chance é 100. Rolar um dado que
 * sempre passa parece desperdício e é o contrário: é o que mantém o consumo do
 * fluxo igual entre golpes que só diferem na chance.
 *
 * **Uma condição por vez, e ela não empilha** — é o `JÁ PARALISADO` da prancha.
 * Alvo desmaiado também não recebe: adoecer um Pokémon que já caiu só sujaria o
 * log.
 */
function applyAilment(
  state: BattleState,
  attacker: SideName,
  move: MoveEntry,
  context: BattleContext,
  rng: RngCursor,
  events: BattleEvent[],
): BattleState {
  const ailment = move.ailment
  if (ailment === undefined) return state

  const defender = OTHER[attacker]
  const defenderSide = sideOf(state, defender)
  const target = activeOf(defenderSide)
  if (target.condition !== null || isFainted(target)) return state

  // **Imunidade de tipo vale para condição também**: Thunder Wave não paralisa
  // Terrestre, Toxic não envenena Aço. O golpe de dano já parava antes daqui, no
  // `×0` da fórmula; o de status não passa por ela e precisa da checagem
  // própria. Sem ela, a regra "status primeiro" da IA fazia o líder abrir a luta
  // com o golpe contra justamente quem era imune.
  if (effectivenessAgainst(context.matrix, move.type, target.types) === 0) {
    events.push({ kind: 'no-effect', side: attacker, moveId: move.id })
    return state
  }

  if (!rng.chance(ailment.chance / 100)) return state

  const condition = createCondition(ailment.kind, rng)
  events.push({ kind: 'ailment', side: defender, condition })
  return withSide(state, defender, withActive(defenderSide, { ...target, condition }))
}

/** Passo 6: queimadura e veneno, e então a checagem de faint. */
function endOfTurn(state: BattleState, order: readonly SideName[], events: BattleEvent[]): BattleState {
  let next = state
  for (const side of order) {
    const current = sideOf(next, side)
    const active = activeOf(current)
    if (isFainted(active)) continue

    const damage = residualDamage(active.condition, active.maxHp)
    if (damage === 0) continue

    events.push({ kind: 'residual', side, damage })
    next = withSide(next, side, withActive(current, hurt(active, damage)))
  }
  return next
}

/**
 * Depois de tudo: quem caiu, quem entra, e se a luta acabou.
 *
 * A troca do líder é resolvida aqui mesmo, pela IA. A do jogador não — ele
 * escolhe, e o estado passa a `playerSwitch` até que escolha.
 */
function settle(state: BattleState, context: BattleContext, events: BattleEvent[]): BattleState {
  let next = state

  for (const side of ['player', 'opponent'] as const) {
    if (isFainted(activeOf(sideOf(next, side)))) events.push({ kind: 'faint', side })
  }

  if (hasLost(next.player)) {
    events.push({ kind: 'outcome', outcome: 'lost' })
    return { ...next, outcome: 'lost', expecting: 'action' }
  }
  if (hasLost(next.opponent)) {
    events.push({ kind: 'outcome', outcome: 'won' })
    return { ...next, outcome: 'won', expecting: 'action' }
  }

  const opponent = sideOf(next, 'opponent')
  if (isFainted(activeOf(opponent))) {
    const target = chooseAiSwitch(opponent, activeOf(next.player), context.matrix)
    if (target === null) throw new Error('líder sem ativo e sem banco, mas a batalha não acabou')
    events.push({ kind: 'switch', side: 'opponent', to: target })
    next = withSide(next, 'opponent', { ...opponent, active: target })
  }

  if (isFainted(activeOf(next.player))) return { ...next, expecting: 'playerSwitch' }
  return { ...next, expecting: 'action' }
}

function switchTo(state: BattleState, side: SideName, index: number, events: BattleEvent[]): BattleState {
  const current = sideOf(state, side)
  const target = current.team[index]
  if (target === undefined) throw new Error(`troca para o índice ${index}, que não existe no time`)
  if (isFainted(target)) throw new Error(`troca para ${target.slug}, que está desmaiado`)
  if (index === current.active) throw new Error(`troca para quem já está em campo`)

  events.push({ kind: 'switch', side, to: index })
  return withSide(state, side, { ...current, active: index })
}

function usePotion(state: BattleState, side: SideName, events: BattleEvent[]): BattleState {
  const current = sideOf(state, side)
  if (current.potionsLeft <= 0) throw new Error('poção já usada nesta batalha')

  const active = activeOf(current)
  const healed = Math.min(Math.floor(active.maxHp * POTION_HEAL_FRACTION), active.maxHp - active.hp)
  events.push({ kind: 'potion', side, healed })

  return withSide(state, side, {
    ...withActive(current, { ...active, hp: active.hp + healed }),
    potionsLeft: current.potionsLeft - 1,
  })
}

/**
 * Um turno inteiro, ou a troca forçada que o desmaio pediu.
 *
 * Ação inválida **derruba**, e é de propósito: a tela nunca oferece uma, então
 * quem chega aqui com ela é um log adulterado ou um replay que divergiu — e nos
 * dois casos parar é melhor que inventar um estado plausível.
 */
export function applyAction(
  state: BattleState,
  action: BattleAction,
  context: BattleContext,
): BattleTurn {
  if (state.outcome !== 'ongoing') throw new Error('a batalha já acabou')

  const rng = createRng(state.rng)
  const events: BattleEvent[] = []

  if (state.expecting === 'playerSwitch') {
    if (action.kind !== 'switch') throw new Error('o ativo desmaiou: só uma troca é aceita agora')
    const next = switchTo(state, 'player', action.index, events)
    return { state: { ...next, expecting: 'action', rng: rng.state() }, events }
  }

  const opponentAction = chooseAiAction(
    state.gymId,
    state.opponent,
    activeOf(state.player),
    context.matrix,
    rng,
  )

  // Troca e item resolvem antes de qualquer golpe, como nos jogos. Entre os dois
  // lados a ordem é a do jogador primeiro: nenhum dos dois interage com o outro,
  // então ela é convenção, não regra.
  let next = applyPreMove(state, 'player', action, events)
  next = applyPreMove(next, 'opponent', opponentAction, events)

  const playerMove = action.kind === 'move'
    ? moveFromSlot(activeOf(next.player), action.slot, context).move
    : null
  const opponentMove = opponentAction.kind === 'move'
    ? moveFromSlot(activeOf(next.opponent), opponentAction.slot, context).move
    : null

  const order: SideName[] = playerMove !== null && opponentMove !== null
    ? orderedSides(firstMover(next, playerMove, opponentMove, rng))
    : ['player', 'opponent']

  for (const side of order) {
    const chosen = side === 'player' ? action : opponentAction
    if (chosen.kind !== 'move') continue
    // Quem desmaiou no golpe anterior não revida.
    if (isFainted(activeOf(sideOf(next, side)))) continue
    next = resolveMove(next, side, chosen.slot, context, rng, events)
  }

  next = endOfTurn(next, order, events)
  next = settle(next, context, events)

  return { state: { ...next, turn: next.turn + 1, rng: rng.state() }, events }
}

/**
 * Troca e item, antes dos golpes.
 *
 * É um `switch` fechado com `assertNever` e não três `if`s: com os `if`s, um
 * `kind` novo — ou um vindo de save adulterado — caía fora dos três e virava um
 * **turno em branco**, em silêncio, contradizendo o "ação inválida derruba" que
 * este módulo promete.
 */
function applyPreMove(
  state: BattleState,
  side: SideName,
  action: BattleAction,
  events: BattleEvent[],
): BattleState {
  switch (action.kind) {
    case 'switch':
      return switchTo(state, side, action.index, events)
    case 'item':
      return usePotion(state, side, events)
    case 'move':
      return state
    default:
      return assertNever(action, 'ação de batalha')
  }
}

function orderedSides(first: SideName): SideName[] {
  return first === 'player' ? ['player', 'opponent'] : ['opponent', 'player']
}

/**
 * Reconstrói a batalha a partir do log.
 *
 * É o outro lado do save: o estado nunca é gravado, e sim reproduzido. Um log de
 * versão anterior é **recusado** em vez de reproduzido torto — a batalha em
 * andamento se perde, a coleção e o progresso não, que é a troca que o plano
 * fixou.
 */
export function replay(log: BattleLog, context: BattleContext): BattleState {
  if (log.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `log da versão ${log.engineVersion} não reproduz no motor ${ENGINE_VERSION}`,
    )
  }
  if (log.dexVersion !== context.dexVersion) {
    throw new Error(
      `log do dex ${log.dexVersion} não reproduz sobre o dex ${context.dexVersion}`,
    )
  }

  let state = startBattle({ gymId: log.gymId, seed: log.seed, team: log.team }, context)
  for (const action of log.actions) {
    state = applyAction(state, action, context).state
  }
  return state
}

/**
 * Se este log ainda reproduz — as duas travas, perguntadas sem exceção.
 *
 * `replay` derruba, e está certo: chegar lá com um log incompatível é defeito de
 * quem chamou. Só que **descartar a batalha de uma build anterior é o caminho
 * normal**, não o excepcional, e a store precisa perguntar antes em vez de usar
 * `try/catch` como fluxo. As duas versões vivem num lugar só, e é este.
 */
export function replayable(log: BattleLog, context: BattleContext): boolean {
  return log.engineVersion === ENGINE_VERSION && log.dexVersion === context.dexVersion
}

/** Os índices do banco que o jogador pode mandar entrar. */
export function switchOptions(state: BattleState): readonly number[] {
  return benchIndexes(state.player)
}
