import type { CoreData, DamagingMoveEntry, TypeName } from '../types/dex.ts'
import { STRUGGLE_MOVE_ID } from '../types/dex.ts'
import type { RngCursor } from './rng.ts'
import type { BattleStats } from './stats.ts'
import { BATTLE_LEVEL } from './stats.ts'
import type { Condition } from './status.ts'
import { effectiveDefense, effectiveOffense } from './status.ts'
import { effectivenessAgainst } from './typechart.ts'

/**
 * A fórmula de dano dos jogos, geração V em diante.
 *
 * ```
 * base = floor(floor((2·Lv/5 + 2) · Power · A / D) / 50) + 2
 * dano = base × crítico × aleatório × STAB × efetividade
 * ```
 *
 * **A ordem dos modificadores importa e está fixa**, com piso a cada passo:
 * crítico, aleatório, STAB, efetividade. Não é preciosismo — `floor` não
 * comuta, e trocar a ordem muda o número na tela. Com o Pikachu e o Noctowl da
 * prancha da Batalha, esta ordem produz de 62 a 74 de dano com o Thunderbolt, e
 * os **68** desenhados saem do rolo 92. Qualquer outra ordem produz outra faixa,
 * e a prancha deixa de descrever o motor.
 */

/** Golpe do próprio tipo bate mais forte. */
export const STAB_MULTIPLIER = 1.5
/** O crítico é modesto e raro, como nos jogos modernos. */
export const CRIT_MULTIPLIER = 1.5
export const CRIT_CHANCE = 1 / 24

/**
 * O fator aleatório é **inteiro de 85 a 100 sobre 100**, e não um float
 * qualquer entre 0,85 e 1: é assim nos jogos, e um inteiro sorteado consome uma
 * rolagem só, com distribuição uniforme sobre 16 valores. Um float direto daria
 * a mesma média com resultados irreprodutíveis a olho.
 */
export const RANDOM_MIN_PERCENT = 85
export const RANDOM_MAX_PERCENT = 100

/** O meio da faixa, que é o que a IA usa para comparar golpes. */
export const AVERAGE_RANDOM = (RANDOM_MIN_PERCENT + RANDOM_MAX_PERCENT) / 200

/** Um lado da troca, do ponto de vista da fórmula. */
export interface Combatant {
  readonly stats: BattleStats
  readonly types: readonly TypeName[]
  readonly condition: Condition | null
}

export interface DamageRoll {
  readonly damage: number
  /** ×0 a ×4, o número que a prancha estampa acima do botão do golpe. */
  readonly effectiveness: number
  readonly critical: boolean
}

/**
 * `(2·Lv/5 + 2)` — 22 no nível 50. Fica como função para o nível continuar
 * visível na conta: quando ele deixar de ser fixo, muda aqui e em nenhum outro
 * lugar.
 */
function levelFactor(): number {
  return Math.floor(2 * BATTLE_LEVEL / 5) + 2
}

function baseDamage(attacker: Combatant, defender: Combatant, move: DamagingMoveEntry): number {
  const offense = effectiveOffense(attacker.stats, move.damageClass, attacker.condition)
  const defense = effectiveDefense(defender.stats, move.damageClass)
  return Math.floor(Math.floor(levelFactor() * move.power * offense / defense) / 50) + 2
}

/**
 * **Struggle é sem tipo**, e o catálogo o guarda como `normal` só porque é assim
 * que a PokeAPI o entrega.
 *
 * As duas consequências disso são de sinais opostos e ambas obrigatórias. Sem a
 * primeira, um Pokémon normal sem golpe utilizável ganharia 50% de bônus na pior
 * situação possível. Sem a segunda — e foi este o defeito — `normal → ghost` é
 * **zero**: dois lados sem PP numa luta de Fantasma ficavam trocando golpes de
 * dano nulo, e a batalha não terminava nunca. Sem recuo e sem teto de turnos, o
 * único jeito de o motor sair de lá é Struggle sempre tirar HP.
 */
function isTypeless(move: DamagingMoveEntry): boolean {
  return move.id === STRUGGLE_MOVE_ID
}

/** Se o golpe casa com um dos tipos de quem o usa. */
export function hasStab(attacker: Combatant, move: DamagingMoveEntry): boolean {
  if (isTypeless(move)) return false
  return attacker.types.some(type => type === move.type)
}

/** O multiplicador de tipo do golpe — neutro para quem não tem tipo. */
export function effectivenessOf(
  move: DamagingMoveEntry,
  defender: Combatant,
  matrix: CoreData['effectiveness'],
): number {
  if (isTypeless(move)) return 1
  return effectivenessAgainst(matrix, move.type, defender.types)
}

/**
 * O dano de um golpe que acertou, com as duas rolagens do fluxo.
 *
 * **As duas rolagens acontecem sempre**, inclusive contra imunidade. Sair antes
 * economizaria dois números e faria o consumo do RNG depender do tipo do
 * defensor — o que transforma um `×0` no meio da luta em divergência de replay.
 * O motor consome; a imunidade decide o resultado, não o fluxo.
 */
export function rollDamage(
  attacker: Combatant,
  defender: Combatant,
  move: DamagingMoveEntry,
  matrix: CoreData['effectiveness'],
  rng: RngCursor,
): DamageRoll {
  const critical = rng.chance(CRIT_CHANCE)
  const randomPercent = rng.int(RANDOM_MIN_PERCENT, RANDOM_MAX_PERCENT)
  const effectiveness = effectivenessOf(move, defender, matrix)

  if (effectiveness === 0) return { damage: 0, effectiveness, critical: false }

  let damage = baseDamage(attacker, defender, move)
  if (critical) damage = Math.floor(damage * CRIT_MULTIPLIER)
  damage = Math.floor(damage * randomPercent / 100)
  if (hasStab(attacker, move)) damage = Math.floor(damage * STAB_MULTIPLIER)
  damage = Math.floor(damage * effectiveness)

  // Piso de 1: um golpe que acertou tira alguma coisa. Sem ele, um golpe fraco
  // contra defesa alta com ×¼ chega a zero e a batalha empata para sempre.
  return { damage: Math.max(1, damage), effectiveness, critical }
}

/**
 * O dano médio do golpe, **sem rolar nada** — é o que a IA compara.
 *
 * Não arredonda de propósito: o valor existe para ordenar quatro golpes, e o
 * piso jogaria fora justamente a diferença que decide o empate. Também ignora o
 * crítico: 1/24 muda a média em 2%, igual para todos os golpes, e incluí-lo só
 * embaralharia a leitura da decisão.
 */
export function averageDamage(
  attacker: Combatant,
  defender: Combatant,
  move: DamagingMoveEntry,
  matrix: CoreData['effectiveness'],
): number {
  const effectiveness = effectivenessOf(move, defender, matrix)
  if (effectiveness === 0) return 0

  const stab = hasStab(attacker, move) ? STAB_MULTIPLIER : 1
  return baseDamage(attacker, defender, move) * AVERAGE_RANDOM * stab * effectiveness
}
