import type { BaseStats } from '../types/dex.ts'

/**
 * Do base stat da espécie para o stat que entra na batalha.
 *
 * O plano listava a fórmula de dano e não esta, e a prancha da Batalha já tinha
 * assumido uma convenção: Pikachu com **110** de HP e Noctowl com **175** só
 * saem de um conjunto específico de premissas. Sem elas escritas, o motor e a
 * tela discordam na cara do jogador.
 *
 * **Nível 50 fixo, IV 31, EV 0, natureza neutra — para os dois lados.**
 *
 * O nível fixo é o que mantém a matemática balanceável: a carta se diferencia
 * pela raridade e pelo BST, não pelo grind. E o EV zerado não é economia de
 * código — com EV, duas cartas de mesmo BST deixariam de ser equivalentes, e o
 * jogo ganharia de volta o eixo de progressão que decidiu não ter.
 */

/** O nível de toda carta em campo, dos dois lados. */
export const BATTLE_LEVEL = 50

/**
 * IV máximo para todo mundo. Igual para os dois lados, então não é vantagem de
 * ninguém: é só a constante que faz os números da prancha fecharem.
 */
export const BATTLE_IV = 31

/**
 * Os seis stats já convertidos.
 *
 * Campos nomeados, e não a tupla de seis que o dex usa: aqui o consumidor é o
 * motor, que lê `specialDefense` num cálculo de dano, e `stats[4]` num cálculo
 * de dano é a forma silenciosa de trocar defesa especial por velocidade.
 */
export interface BattleStats {
  readonly hp: number
  readonly attack: number
  readonly defense: number
  readonly specialAttack: number
  readonly specialDefense: number
  readonly speed: number
}

/**
 * A fórmula real dos jogos, com o nível e o IV à vista em vez de já resolvidos.
 *
 * `(2·base + IV) · nível / 100` daria `(2·base + 31) / 2` no nosso caso, e a
 * simplificação esconderia de onde vêm o 50 e o 31 — que é justamente o que
 * precisa estar legível quando alguém for conferir a tela contra o motor.
 *
 * O HP soma `nível + 10` e os outros somam 5, e essa assimetria é dos jogos, não
 * escolha nossa.
 */
function convert(base: number, isHp: boolean): number {
  const common = Math.floor((2 * base + BATTLE_IV) * BATTLE_LEVEL / 100)
  return isHp ? common + BATTLE_LEVEL + 10 : common + 5
}

/**
 * Converte a tupla do dex.
 *
 * A leitura por índice é segura porque `BaseStats` é tupla de seis na ordem de
 * `STAT_NAMES` — é o mesmo motivo pelo qual aquela ordem é constante declarada e
 * não a ordem em que a PokeAPI devolveu o array.
 */
export function toBattleStats(base: BaseStats): BattleStats {
  return {
    hp: convert(base[0], true),
    attack: convert(base[1], false),
    defense: convert(base[2], false),
    specialAttack: convert(base[3], false),
    specialDefense: convert(base[4], false),
    speed: convert(base[5], false),
  }
}
