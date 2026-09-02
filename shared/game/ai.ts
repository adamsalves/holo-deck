import { GYM_COUNT } from '../types/brand.ts'
import type { CoreData, DamagingMoveEntry } from '../types/dex.ts'
import type { BattleAction, BattlePokemon, BattleSide, BattleSlot } from './battle.ts'
import { activeOf, benchIndexes, isFainted, toCombatant } from './battle.ts'
import { averageDamage } from './damage.ts'
import type { RngCursor } from './rng.ts'
import { effectivenessAgainst } from './typechart.ts'

/**
 * A cabeça do líder: gulosa, com ruído que cai a cada ginásio.
 *
 * A ideia é ter curva de dificuldade sem escrever minimax. O líder calcula o
 * dano esperado de cada golpe e escolhe o maior — e, com probabilidade `p`,
 * escolhe um dos quatro ao acaso. `p` vai de 40% no primeiro ginásio a 0% no
 * nono, então o jogador sente o oponente ficando mais afiado sem que nenhuma
 * regra nova entre em campo.
 *
 * **As faixas são cumulativas.** A B ganha a poção e mantém o ruído menor da A;
 * a C ganha a troca e mantém a poção. Um líder do nono ginásio que não usasse
 * poção seria mais fraco que um do quarto, e a curva quebraria no meio.
 *
 * **Toda rolagem sai do RNG com seed.** É o que mantém a batalha reproduzível:
 * um `Math.random` aqui faz o mesmo log de ações produzir outra luta amanhã, e o
 * save por seed + ações deixa de funcionar.
 */

/** Ruído: 40% no ginásio 1, 0% no 9, linear entre os dois. */
export function noiseChance(gym: number): number {
  return 0.40 * (GYM_COUNT - gym) / (GYM_COUNT - 1)
}

export type AiBand = 'A' | 'B' | 'C'

export function bandOf(gym: number): AiBand {
  if (gym <= 3) return 'A'
  if (gym <= 6) return 'B'
  return 'C'
}

/** A poção entra na faixa B e fica. */
export function usesPotion(gym: number): boolean {
  return bandOf(gym) !== 'A'
}

/** A troca por matchup entra só na C. */
export function switchesOnBadMatchup(gym: number): boolean {
  return bandOf(gym) === 'C'
}

/** Abaixo disto o líder da faixa B gasta a poção. */
export const POTION_HP_THRESHOLD = 0.25

/** A partir daqui a faixa C considera a matchup ruim o bastante para trocar. */
export const BAD_MATCHUP_EFFECTIVENESS = 2

function isUsable(slot: BattleSlot): boolean {
  return slot.pp > 0
}

function damagingSlots(pokemon: BattlePokemon): { slot: BattleSlot, index: number, move: DamagingMoveEntry }[] {
  return pokemon.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => isUsable(slot) && slot.move.damageClass !== 'status')
    .map(({ slot, index }) => {
      if (slot.move.damageClass === 'status') throw new Error('filtro de golpe de dano deixou passar status')
      return { slot, index, move: slot.move }
    })
}

/**
 * Dano esperado por turno: a média da fórmula vezes a acurácia.
 *
 * É a comparação que o plano descreve — *dano médio × acurácia × efetividade ×
 * STAB* —, e as três últimas já estão dentro de `averageDamage`. Acurácia nula é
 * "nunca erra" e vale 100.
 */
export function expectedTurnDamage(
  self: BattlePokemon,
  foe: BattlePokemon,
  move: DamagingMoveEntry,
  matrix: CoreData['effectiveness'],
): number {
  const accuracy = (move.accuracy ?? 100) / 100
  return averageDamage(toCombatant(self), toCombatant(foe), move, matrix) * accuracy
}

/** A pior efetividade que o ativo do jogador pode aplicar — a leitura de "estou
 * numa matchup ruim". */
function worstIncoming(self: BattlePokemon, foe: BattlePokemon, matrix: CoreData['effectiveness']): number {
  return foe.slots
    .filter(isUsable)
    .map(slot => effectivenessAgainst(matrix, slot.move.type, self.types))
    .reduce((worst, value) => Math.max(worst, value), 0)
}

/**
 * Quem entra quando o ativo do líder desmaia, ou quando ele foge de uma matchup.
 *
 * Escolhe por dano esperado contra o ativo do jogador, empate por índice — sem
 * rolagem. A troca forçada acontece **depois** de um desmaio, e um sorteio ali
 * gastaria uma rolagem que o replay teria de reproduzir sem que ela decidisse
 * nada interessante.
 */
export function chooseAiSwitch(
  self: BattleSide,
  foe: BattlePokemon,
  matrix: CoreData['effectiveness'],
): number | null {
  const options = benchIndexes(self)
  if (options.length === 0) return null

  let best = options[0] ?? null
  let bestScore = -1
  for (const index of options) {
    const candidate = self.team[index]
    if (candidate === undefined || isFainted(candidate)) continue
    const score = damagingSlots(candidate)
      .map(({ move }) => expectedTurnDamage(candidate, foe, move, matrix))
      .reduce((max, value) => Math.max(max, value), 0)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  }
  return best
}

/**
 * A ação do líder no turno.
 *
 * A ordem das decisões é: fugir da matchup, curar, aplicar condição, atacar. A
 * troca vem antes da poção de propósito — curar para continuar apanhando ×2 é
 * gastar o único item da batalha para adiar o mesmo desfecho.
 *
 * **A regra do golpe de status existe porque a escolha gulosa nunca o pegaria:**
 * dano esperado zero perde de qualquer ataque. Sem ela, a vaga que o pipeline
 * reserva no moveset seria peso morto na mão dos nove líderes. Ele é usado uma
 * vez, quando o alvo está limpo, e depois o líder volta a ser guloso.
 */
export function chooseAiAction(
  gym: number,
  self: BattleSide,
  foe: BattlePokemon,
  matrix: CoreData['effectiveness'],
  rng: RngCursor,
): BattleAction {
  const active = activeOf(self)

  if (switchesOnBadMatchup(gym) && worstIncoming(active, foe, matrix) >= BAD_MATCHUP_EFFECTIVENESS) {
    const target = chooseAiSwitch(self, foe, matrix)
    if (target !== null) return { kind: 'switch', index: target }
  }

  if (usesPotion(gym) && self.potionsLeft > 0 && active.hp < active.maxHp * POTION_HP_THRESHOLD) {
    return { kind: 'item' }
  }

  if (foe.condition === null) {
    const status = active.slots.findIndex(slot => isUsable(slot) && slot.move.damageClass === 'status')
    if (status !== -1) return { kind: 'move', slot: status }
  }

  const attacks = damagingSlots(active)
  if (attacks.length === 0) {
    // Sem golpe de dano com PP: o motor resolve em Struggle, e o slot que vai
    // aqui não muda nada. Zero mantém a ação legível no log.
    return { kind: 'move', slot: 0 }
  }

  // A rolagem de ruído acontece **sempre** que há ataque a escolher, mesmo com
  // `p = 0` no nono ginásio: fazer o consumo do fluxo depender do ginásio
  // significaria que a mesma seed produz lutas diferentes conforme o adversário.
  const aleatorio = rng.chance(noiseChance(gym))
  if (aleatorio) {
    const [first, ...rest] = attacks
    if (first === undefined) return { kind: 'move', slot: 0 }
    return { kind: 'move', slot: rng.pick([first, ...rest]).index }
  }

  const best = attacks.reduce((melhor, candidato) =>
    expectedTurnDamage(active, foe, candidato.move, matrix)
    > expectedTurnDamage(active, foe, melhor.move, matrix)
      ? candidato
      : melhor)

  return { kind: 'move', slot: best.index }
}
