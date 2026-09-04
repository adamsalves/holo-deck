import { describe, expect, it } from 'vitest'
import {
  FLAWLESS_RATE,
  REMATCH_RATE,
  WELCOME_PACKS,
  gymReward,
  rewardFor,
} from '~~/shared/game/economy'
import type { GymId } from '~~/shared/types/brand'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'

/**
 * A economia da Liga — e os números que a prancha estampa.
 *
 * O que estes testes seguram não é a aritmética, que é trivial: é a
 * **calibração**. Trocar `200 + 100 × ginásio` por outra curva muda quanto a
 * campanha paga, e é isso que decide se o jogo tem economia depois do nono
 * ginásio.
 */

/** A marca vem do guarda, como no resto da suíte: `as` é proibido e `!` também. */
function gym(number: number): GymId {
  if (!isGymId(number)) throw new Error(`${number} não é ginásio`)
  return number
}

const GYMS: readonly GymId[] = Array.from({ length: GYM_COUNT }, (_, index) => gym(index + 1))

function somaDaLiga(terms: { rematch: boolean, flawless: boolean }): number {
  return GYMS.reduce((total, id) => total + rewardFor({ gym: id, ...terms }).total, 0)
}

describe('recompensa de ginásio', () => {
  it('é `200 + 100 × ginásio`, e a prancha *Liga* confere', () => {
    // O botão `DESAFIAR · +400` do ginásio 2 e o `Prêmio +400` do painel
    // *Próximo* são os dois lugares em que o canvas escreve este número.
    expect(gymReward(gym(1))).toBe(300)
    expect(gymReward(gym(2))).toBe(400)
    expect(gymReward(gym(9))).toBe(1100)
  })

  it('cresce a cada ginásio, porque o time do líder cresce junto', () => {
    const valores = GYMS.map(gymReward)

    expect(valores).toEqual([...valores].sort((a, b) => a - b))
    expect(new Set(valores).size).toBe(GYM_COUNT)
  })

  it('a campanha inteira paga 6.300', () => {
    expect(somaDaLiga({ rematch: false, flawless: false })).toBe(6300)
  })
})

describe('revanche', () => {
  it('paga 25%, e é o `REVANCHE +75` da carta vencida', () => {
    expect(REMATCH_RATE).toBe(0.25)
    expect(rewardFor({ gym: gym(1), rematch: true, flawless: false }).total).toBe(75)
  })

  /**
   * Sem ela a economia bate num muro: depois do nono ginásio a renda cairia
   * para 1 pack por dia, para sempre, e completar as 1025 é projeto de centenas
   * de packs.
   */
  it('mantém a Liga rendendo depois de completada, sem alcançar a estreia', () => {
    const ciclo = somaDaLiga({ rematch: true, flawless: false })

    expect(ciclo).toBe(1575)
    expect(ciclo).toBeLessThan(somaDaLiga({ rematch: false, flawless: false }))
  })
})

describe('vitória imaculada', () => {
  it('acrescenta 25% sobre o que está sendo pago', () => {
    expect(FLAWLESS_RATE).toBe(0.25)

    expect(rewardFor({ gym: gym(1), rematch: false, flawless: true }))
      .toEqual({ base: 300, earned: 300, flawless: 75, total: 375 })
  })

  /**
   * **Sobre o que está sendo pago, e não sobre o valor cheio.** Numa revanche
   * imaculada o bônus acompanha a revanche; calculá-lo sobre a base inflaria a
   * repetição de volta ao preço da estreia, que é justamente o que a taxa de
   * revanche existe para impedir.
   */
  it('acompanha a revanche em vez de inflá-la de volta à estreia', () => {
    const revanche = rewardFor({ gym: gym(1), rematch: true, flawless: true })

    expect(revanche).toEqual({ base: 300, earned: 75, flawless: 18, total: 93 })
    expect(revanche.total).toBeLessThan(gymReward(gym(1)))
  })

  it('não paga nada quando alguém caiu', () => {
    expect(rewardFor({ gym: gym(5), rematch: false, flawless: false }).flawless).toBe(0)
  })

  it('a campanha imaculada paga 7.875, contra os 6.300 normais', () => {
    expect(somaDaLiga({ rematch: false, flawless: true })).toBe(7875)
  })

  /**
   * Moeda fracionária é a coisa que uma economia de jogo não pode ter: ela vaza
   * para o saldo, para o preço do pack e para o texto da tela ao mesmo tempo.
   * 25% de 75 dá 18,75, e o `floor` é o que a mantém inteira.
   */
  it('nunca produz moeda fracionária, e o total é sempre a soma das parcelas', () => {
    for (const id of GYMS) {
      for (const rematch of [false, true]) {
        for (const flawless of [false, true]) {
          const reward = rewardFor({ gym: id, rematch, flawless })

          expect(Number.isInteger(reward.total), `ginásio ${id}`).toBe(true)
          expect(reward.total).toBe(reward.earned + reward.flawless)
        }
      }
    }
  })
})

/**
 * A tabela do contrato da Fase 6 punha `economy.ts` "completo" neste PR, e a
 * decisão de 04/09 corrigiu: pack diário e preço da loja só ganham consumidor
 * com a loja, no PR seguinte. Constante de economia sem quem a leia é o que o
 * repositório recusa desde a Fase 0, e o que o docblock do módulo escreve desde
 * a Fase 5.
 */
describe('o que continua fora deste módulo', () => {
  it('a concessão inicial da Fase 5 segue sendo a única fonte de carta grátis', () => {
    expect(WELCOME_PACKS).toBe(3)
  })
})
