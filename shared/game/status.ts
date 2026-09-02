import type { AilmentName, DamagingClass } from '../types/dex.ts'
import type { RngCursor } from './rng.ts'
import type { BattleStats } from './stats.ts'

/**
 * As quatro condições alteradas, e nada além.
 *
 * **Congelamento fica de fora de propósito** — é frustrante de receber e pouco
 * interessante de aplicar: o alvo perde turnos sem nada que ele possa decidir a
 * respeito. Confusão, armadilha e silêncio ficam pelo motivo oposto: nenhuma
 * delas tem efeito que este motor saiba executar.
 *
 * **Uma por vez, e não empilha.** Um golpe de status contra alvo já afetado não
 * faz nada — é o `JÁ PARALISADO` que a prancha da Batalha desenha no botão.
 */

/** Speed pela metade. */
export const PARALYSIS_SPEED_FACTOR = 0.5
/** E um quarto dos turnos perdido. */
export const PARALYSIS_SKIP_CHANCE = 0.25
/** Ataque **físico** pela metade — o especial passa incólume. */
export const BURN_ATTACK_FACTOR = 0.5
/** Por turno, sobre o HP máximo. */
export const BURN_DAMAGE_FRACTION = 1 / 16
/** O dobro da queimadura, e sem contrapartida ofensiva. */
export const POISON_DAMAGE_FRACTION = 1 / 8
/** Turnos perdidos por quem dorme, sorteados na aplicação. */
export const SLEEP_MIN_TURNS = 1
export const SLEEP_MAX_TURNS = 3

/**
 * A condição de um Pokémon em campo.
 *
 * União, e não `{ kind, turns? }`: só o sono tem contador, e um campo opcional
 * deixaria representável tanto um sono sem contagem quanto uma paralisia com
 * ela. O primeiro trava o Pokémon para sempre; o segundo é lixo silencioso.
 */
export type Condition
  = | { readonly kind: 'paralysis' }
    | { readonly kind: 'burn' }
    | { readonly kind: 'poison' }
    | { readonly kind: 'sleep', readonly turns: number }

/**
 * Cria a condição a partir do nome que o golpe carrega. O sono nasce com os
 * turnos já sorteados — é a única das quatro que consome RNG ao ser aplicada, e
 * fazer isso aqui mantém o consumo do fluxo num lugar só.
 */
export function createCondition(kind: AilmentName, rng: RngCursor): Condition {
  if (kind === 'sleep') return { kind, turns: rng.int(SLEEP_MIN_TURNS, SLEEP_MAX_TURNS) }
  return { kind }
}

/** Speed depois da paralisia — o número que decide a ordem do turno. */
export function effectiveSpeed(stats: BattleStats, condition: Condition | null): number {
  if (condition?.kind !== 'paralysis') return stats.speed
  return Math.floor(stats.speed * PARALYSIS_SPEED_FACTOR)
}

/**
 * O `A` da fórmula de dano, já com a queimadura descontada.
 *
 * A queimadura corta o ataque **físico**: um Charizard queimado ainda lança
 * Flamethrower com força total. Era o detalhe mais fácil de perder aplicando o
 * fator ao stat errado, e é por isso que a classe do golpe entra aqui.
 */
export function effectiveOffense(
  stats: BattleStats,
  damageClass: DamagingClass,
  condition: Condition | null,
): number {
  if (damageClass === 'special') return stats.specialAttack
  if (condition?.kind !== 'burn') return stats.attack
  return Math.floor(stats.attack * BURN_ATTACK_FACTOR)
}

/** O `D` da fórmula, que nenhuma das quatro condições altera. */
export function effectiveDefense(stats: BattleStats, damageClass: DamagingClass): number {
  return damageClass === 'special' ? stats.specialDefense : stats.defense
}

/**
 * O resultado da checagem de impedimento, no começo do turno.
 *
 * Devolve a condição **depois** da checagem porque o sono anda: guardar o
 * contador em outro lugar seria ter duas fontes para o mesmo estado.
 */
export interface Impediment {
  /** Se o Pokémon age neste turno. */
  readonly acts: boolean
  readonly condition: Condition | null
}

/**
 * Passo 2 da resolução de turno: dormindo não age, paralisado perde o turno em
 * 25% das rolagens.
 *
 * **O sono conta turnos perdidos, não turnos de duração.** Sorteado 1, o alvo
 * perde exatamente um turno e acorda para o seguinte — que é o que "não age por
 * 1 a 3 turnos" quer dizer. Um contador que acordasse no turno em que zera daria
 * 0 a 2 turnos perdidos, e o sono de 1 não custaria nada a ninguém.
 *
 * A rolagem da paralisia sai do RNG com seed **sempre**, inclusive quando não
 * muda nada, porque é o consumo do fluxo que precisa ser igual entre a partida e
 * o replay dela.
 */
export function checkImpediment(condition: Condition | null, rng: RngCursor): Impediment {
  if (condition === null) return { acts: true, condition }

  if (condition.kind === 'sleep') {
    const restantes = condition.turns - 1
    return { acts: false, condition: restantes > 0 ? { kind: 'sleep', turns: restantes } : null }
  }

  if (condition.kind === 'paralysis') {
    return { acts: !rng.chance(PARALYSIS_SKIP_CHANCE), condition }
  }

  return { acts: true, condition }
}

/**
 * Passo 6: o dano de fim de turno, sobre o HP máximo.
 *
 * O piso de 1 existe porque as frações são de HP máximo e o motor trabalha em
 * inteiros: um Pokémon de 15 de HP máximo queimado perderia `floor(0,9) = 0` por
 * turno, e a queimadura viraria enfeite justamente em quem ela deveria doer mais.
 */
export function residualDamage(condition: Condition | null, maxHp: number): number {
  if (condition === null) return 0
  if (condition.kind === 'burn') return Math.max(1, Math.floor(maxHp * BURN_DAMAGE_FRACTION))
  if (condition.kind === 'poison') return Math.max(1, Math.floor(maxHp * POISON_DAMAGE_FRACTION))
  return 0
}

/** O rótulo curto que a interface mostra na carta — `PAR` na prancha. */
export const CONDITION_LABELS: Record<AilmentName, string> = {
  paralysis: 'PAR',
  burn: 'QUE',
  poison: 'ENV',
  sleep: 'SON',
}
