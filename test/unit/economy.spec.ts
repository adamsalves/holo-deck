import { describe, expect, it } from 'vitest'
import {
  FLAWLESS_RATE,
  PACK_PRICE,
  REMATCH_RATE,
  WELCOME_PACKS,
  coinsMissing,
  dayKey,
  gymReward,
  isDailyReady,
  isDayKey,
  msUntilNextDay,
  packsAffordable,
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
 * O preço da loja, e a razão que ele fecha.
 *
 * O que importa não é o 150 isolado — é a divisão. Os 6.300 da campanha compram
 * 42 packs, e é essa razão que decide se vencer os nove ginásios significa
 * alguma coisa. Um preço dobrado deixaria a Liga inteira valendo 21 packs.
 */
describe('o preço do pack', () => {
  it('é 150, e a campanha compra 42', () => {
    expect(PACK_PRICE).toBe(150)
    expect(Math.floor(somaDaLiga({ rematch: false, flawless: false }) / PACK_PRICE)).toBe(42)
  })

  it('divide o saldo em packs inteiros — a prancha escreve `dá para 8`', () => {
    // 1.240 é o saldo que as prancha *Hub* e *Loja* estampam na barra superior.
    expect(packsAffordable(1240)).toBe(8)
    expect(packsAffordable(PACK_PRICE)).toBe(1)
    expect(packsAffordable(PACK_PRICE - 1)).toBe(0)
    expect(packsAffordable(0)).toBe(0)
  })

  it('devolve o déficit, que é o que o botão desabilitado escreve', () => {
    expect(coinsMissing(0)).toBe(PACK_PRICE)
    expect(coinsMissing(90)).toBe(60)
    expect(coinsMissing(PACK_PRICE)).toBe(0)
    expect(coinsMissing(9000)).toBe(0)
  })
})

/**
 * O pack diário, e a decisão de 05/09: **dia de calendário local**, não espera
 * de 24 horas.
 *
 * A diferença aparece no segundo dia, e é ela que estes testes seguram. Uma
 * espera contada a partir da abertura empurra o horário para frente toda vez;
 * dia de calendário devolve o pack à meia-noite, que é o que "um por dia"
 * significa para quem lê a frase.
 */
describe('o pack diário', () => {
  it('lê o dia do relógio local, e não o de Greenwich', () => {
    // Às 22h de um fuso a oeste, `toISOString` já marcaria o dia seguinte — e o
    // pack aberto na terça sumiria a quarta inteira.
    expect(dayKey(new Date(2026, 8, 5, 22, 30))).toBe('2026-09-05')
    expect(dayKey(new Date(2026, 8, 5, 0, 0))).toBe('2026-09-05')
    expect(dayKey(new Date(2026, 0, 9, 12, 0))).toBe('2026-01-09')
  })

  it('está de pé quando o dia guardado não é o de hoje', () => {
    expect(isDailyReady(null, '2026-09-05')).toBe(true)
    expect(isDailyReady('2026-09-04', '2026-09-05')).toBe(true)
    expect(isDailyReady('2026-09-05', '2026-09-05')).toBe(false)
  })

  /**
   * Relógio atrasado **devolve** o pack em vez de travar a loja.
   *
   * É a diferença que a decisão comprou: uma subtração de instantes deixaria
   * quem viaja de fuso ou corrige a data esperando por um pack que já venceu.
   */
  it('não trava quando o relógio anda para trás', () => {
    expect(isDailyReady('2026-09-05', '2026-09-04')).toBe(true)
  })

  it('conta até a meia-noite local', () => {
    expect(msUntilNextDay(new Date(2026, 8, 5, 0, 0, 0, 0))).toBe(86_400_000)
    expect(msUntilNextDay(new Date(2026, 8, 5, 23, 59, 59, 0))).toBe(1_000)
    expect(msUntilNextDay(new Date(2026, 8, 5, 9, 37, 53, 0))).toBe(51_727_000)
  })

  /**
   * O guarda do save chama esta função, então ela precisa recusar o que um save
   * editado à mão produz — não só o que o jogo produz.
   */
  it('reconhece a forma que o save aceita, e recusa o resto', () => {
    expect(isDayKey(dayKey(new Date(2026, 8, 5)))).toBe(true)
    expect(isDayKey('2026-09-05')).toBe(true)

    expect(isDayKey('2026-9-5')).toBe(false)
    expect(isDayKey('05/09/2026')).toBe(false)
    expect(isDayKey('')).toBe(false)
    expect(isDayKey(null)).toBe(false)
    expect(isDayKey(20260905)).toBe(false)
  })
})

/**
 * `economy.ts` fecha aqui. As duas linhas que faltavam — preço e pack diário —
 * chegaram com a loja, que é quem as lê, e não no PR da Liga: constante de
 * economia sem consumidor é o que este repositório recusa desde a Fase 0.
 */
describe('as fontes de carta e moeda', () => {
  it('a concessão inicial segue sendo a única fonte de carta grátis fora do diário', () => {
    expect(WELCOME_PACKS).toBe(3)
  })
})
