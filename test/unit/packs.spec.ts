import { describe, expect, it } from 'vitest'
import {
  COMMON_SLOTS,
  PACK_SIZE,
  PITY_THRESHOLD,
  RARE_PLUS_SLOTS,
  RARE_PLUS_WEIGHTS,
  SHINY_ODDS,
  UNCOMMON_SLOTS,
  buildPool,
  dryPackOdds,
  isPityTier,
  openPack,
  packsUntilPity,
} from '~~/shared/game/packs'
import { RARITY_NAMES } from '~~/shared/types/game'
import type { Rarity } from '~~/shared/types/game'
import { readIndex } from '../support/generated-dex'

/**
 * O pack, medido sobre o dex real e sobre 100 mil aberturas.
 *
 * Duas coisas justificam o volume. A primeira é que a composição de um pack é
 * uma afirmação **estatística**: "0,5% de mítico" não é verificável em dez
 * aberturas, e um erro de peso que dobrasse a taxa de lendário passaria por
 * qualquer amostra pequena sem levantar suspeita. A segunda é que o pity é a
 * única regra do jogo cujo valor foi escolhido por uma conta — `0,8^10` — e uma
 * conta escrita num docblock que ninguém confere é um comentário, não um
 * contrato.
 *
 * O pool sai do índice commitado, não de fixture: os limiares de raridade
 * produzem uma pirâmide **sobre estas 1025 espécies**, e testar o sorteio contra
 * seis baldes inventados testaria os baldes.
 */

const pool = buildPool(readIndex())

/** Uma corrida longa, com o pity carregando de um pack para o próximo. */
function openMany(count: number): { cards: ReturnType<typeof openPack>['cards'][], forced: number } {
  const cards: ReturnType<typeof openPack>['cards'][] = []
  let pity = 0
  let forced = 0

  for (let n = 0; n < count; n += 1) {
    const result = openPack({ seed: n + 1, pity, pool })
    if (result.forcedByPity) forced += 1
    cards.push(result.cards)
    pity = result.pity
  }

  return { cards, forced }
}

function tierCounts(packs: readonly (readonly { rarity: Rarity }[])[]): Record<Rarity, number> {
  const counts: Record<Rarity, number> = {
    common: 0, uncommon: 0, rare: 0, ultra: 0, legendary: 0, mythic: 0,
  }
  for (const pack of packs) for (const card of pack) counts[card.rarity] += 1
  return counts
}

describe('o pool', () => {
  it('reparte as 1025 sem perder nem duplicar espécie', () => {
    const total = RARITY_NAMES.reduce((sum, tier) => sum + pool[tier].length, 0)
    const ids = new Set(RARITY_NAMES.flatMap(tier => [...pool[tier]]))

    expect(total).toBe(1025)
    expect(ids.size).toBe(1025)
  })

  /**
   * A pirâmide. É a razão de os limiares terem sido movidos dos 400/480/580 do
   * plano original — com aqueles, *raro* virava o maior tier do jogo e cada
   * carta rara aparecia ~8× menos que cada comum, porque o pack reserva um slot
   * em dez para raro+.
   */
  it('sai em pirâmide: cada tier de BST é menor que o anterior', () => {
    expect(pool.common.length).toBeGreaterThan(pool.uncommon.length)
    expect(pool.uncommon.length).toBeGreaterThan(pool.rare.length)
    expect(pool.rare.length).toBeGreaterThan(pool.ultra.length)
  })

  it('tem balde para lendário e para mítico, que são recorte por marca', () => {
    expect(pool.legendary.length).toBeGreaterThan(0)
    expect(pool.mythic.length).toBeGreaterThan(0)
  })
})

describe('composição do pack', () => {
  it('traz dez cartas, e os slots somam dez', () => {
    expect(COMMON_SLOTS + UNCOMMON_SLOTS + RARE_PLUS_SLOTS).toBe(PACK_SIZE)
    expect(openPack({ seed: 1, pity: 0, pool }).cards).toHaveLength(PACK_SIZE)
  })

  it('traz seis comuns, três incomuns e uma raro+', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { cards } = openPack({ seed, pity: 0, pool })

      expect(cards.filter(card => card.rarity === 'common')).toHaveLength(COMMON_SLOTS)
      expect(cards.filter(card => card.rarity === 'uncommon')).toHaveLength(UNCOMMON_SLOTS)
      expect(cards.filter(card => isPityTier(card.rarity) || card.rarity === 'rare'))
        .toHaveLength(RARE_PLUS_SLOTS)
    }
  })

  /**
   * A carta que sai do balde é do tier que o slot pediu. Parece tautologia e não
   * é: `rarity` viaja na carta, e nada além deste teste impede o sorteador de
   * anotar um tier e tirar a espécie de outro balde.
   */
  it('tira cada carta do balde do próprio tier', () => {
    const { cards } = openPack({ seed: 7, pity: 0, pool })

    for (const card of cards) {
      expect(pool[card.rarity]).toContain(card.speciesId)
    }
  })

  it('não repete espécie dentro do mesmo pack', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const { cards } = openPack({ seed, pity: 0, pool })
      const ids = new Set(cards.map(card => card.speciesId))

      expect(ids.size).toBe(cards.length)
    }
  })

  /**
   * A ordem de revelação é embaralhada, e este teste é o que impede o
   * embaralhamento de virar no-op sem ninguém ver — todos os outros contam por
   * tier, que é invariante à ordem.
   *
   * A prancha *Abertura de pack* põe o Gyarados RARO na quarta posição de dez.
   * Sem embaralhar, os slots sairiam em blocos e o raro+ seria **sempre** o
   * décimo: um tell perfeito, que apaga o suspense das nove primeiras.
   */
  it('embaralha a ordem, e não entrega o raro+ sempre por último', () => {
    const positions = new Set(
      Array.from({ length: 200 }, (_, seed) =>
        openPack({ seed: seed + 1, pity: 0, pool }).cards
          .findIndex(card => card.rarity !== 'common' && card.rarity !== 'uncommon')),
    )

    // Com 200 aberturas, dez posições possíveis e ordem uniforme, ver menos que
    // metade delas é praticamente impossível — e ver uma só é o sintoma exato de
    // o embaralhamento ter sumido.
    expect(positions.size).toBeGreaterThan(5)
    expect(positions.has(PACK_SIZE - 1)).toBe(true)
  })

  it('a mesma seed abre o mesmo pack', () => {
    const first = openPack({ seed: 4242, pity: 3, pool })
    const second = openPack({ seed: 4242, pity: 3, pool })

    expect(second).toEqual(first)
  })

  it('seeds diferentes abrem packs diferentes', () => {
    const first = openPack({ seed: 1, pity: 0, pool })
    const second = openPack({ seed: 2, pity: 0, pool })

    expect(second.cards).not.toEqual(first.cards)
  })
})

describe('pesos do slot raro+', () => {
  it('somam 1 — um peso mexido sem os outros cederem espaço não fecha', () => {
    const total = Object.values(RARE_PLUS_WEIGHTS).reduce((sum, weight) => sum + weight, 0)

    expect(total).toBeCloseTo(1, 10)
  })

  /**
   * A conta que escolheu `PITY_THRESHOLD`, refeita a partir dos pesos.
   *
   * Se alguém mexer num peso de ultra+ sem revisitar o limiar, o docblock que
   * afirma "1 jogador em 9" passa a mentir. Este teste é o que faz a mentira
   * derrubar o build em vez de envelhecer em silêncio.
   */
  it('produzem a taxa de pack seco de que o limiar do pity foi derivado', () => {
    expect(dryPackOdds()).toBeCloseTo(0.8, 10)
    expect(dryPackOdds() ** PITY_THRESHOLD).toBeCloseTo(0.107, 3)
  })
})

/**
 * As taxas, sobre 100 mil aberturas — **sem** o pity no caminho.
 *
 * Este bloco abre sempre com o contador zerado, e é de propósito: ele mede os
 * pesos, e nada mais. Encadear o pity aqui misturaria duas afirmações num
 * número só, que foi exatamente o erro que a primeira versão deste teste
 * cometeu — ela cobrava 15% de ultra numa corrida onde a rede empurra a taxa
 * para 16,3%, e não havia como dizer, olhando a falha, se o peso estava errado
 * ou se a rede estava funcionando.
 */
describe('cem mil aberturas, pesos puros', () => {
  const RUNS = 100_000
  const cards = Array.from(
    { length: RUNS },
    (_, seed) => openPack({ seed: seed + 1, pity: 0, pool }).cards,
  )
  const counts = tierCounts(cards)

  it('dá exatamente um raro+ por pack', () => {
    expect(counts.rare + counts.ultra + counts.legendary + counts.mythic).toBe(RUNS)
  })

  it('reparte o slot raro+ nos pesos declarados', () => {
    expect(counts.rare / RUNS).toBeCloseTo(RARE_PLUS_WEIGHTS.rare, 2)
    expect(counts.ultra / RUNS).toBeCloseTo(RARE_PLUS_WEIGHTS.ultra, 2)
    expect(counts.legendary / RUNS).toBeCloseTo(RARE_PLUS_WEIGHTS.legendary, 2)
    expect(counts.mythic / RUNS).toBeCloseTo(RARE_PLUS_WEIGHTS.mythic, 3)
  })

  it('rola shiny 1 em 256, sobre qualquer tier', () => {
    const shiny = cards.flat().filter(card => card.isShiny)

    expect(shiny.length / (RUNS * PACK_SIZE)).toBeCloseTo(SHINY_ODDS, 3)
    // Shiny é tratamento, não tier: precisa aparecer em comum também, senão
    // alguém prendeu o brilho à escada de raridade sem o docblock notar.
    expect(shiny.some(card => card.rarity === 'common')).toBe(true)
  })
})

/**
 * A mesma corrida, agora **com o contador atravessando de um pack ao próximo** —
 * que é como um jogador de verdade abre.
 *
 * A frequência que o plano promete, "1 em 9", é por **ciclo** e não por pack: a
 * cada ultra+ o contador zera, e a pergunta que `0,8¹⁰ = 10,7%` responde é "que
 * fração das secas chega ao décimo pack". Medida por pack ela dá ~2,3%, porque
 * um ciclo dura 4,6 packs em média — os dois números descrevem a mesma rede, e
 * confundi-los é o jeito de o portão reprovar um código correto.
 */
describe('cem mil aberturas, com a rede em série', () => {
  const RUNS = 100_000
  const { cards, forced } = openMany(RUNS)
  const cycles = cards.filter(pack => pack.some(card => isPityTier(card.rarity))).length

  it('nunca deixa a seca passar do limiar', () => {
    let streak = 0
    let longest = 0

    for (const pack of cards) {
      streak = pack.some(card => isPityTier(card.rarity)) ? 0 : streak + 1
      longest = Math.max(longest, streak)
    }

    expect(longest).toBeLessThanOrEqual(PITY_THRESHOLD)
  })

  it('pega uma seca em cada nove, que é o que o limiar prometia', () => {
    expect(forced / cycles).toBeCloseTo(dryPackOdds() ** PITY_THRESHOLD, 2)
  })

  /**
   * O efeito colateral da rede, afirmado em vez de tolerado: ela **sobe** a taxa
   * de ultra+ acima dos pesos. Quem calibrar economia na Fase 6 lê daqui, não do
   * bloco de pesos puros.
   */
  it('faz ultra+ sair acima do peso, e é assim que tem de ser', () => {
    const counts = tierCounts(cards)
    const ultraPlus = (counts.ultra + counts.legendary + counts.mythic) / RUNS
    const weights = RARE_PLUS_WEIGHTS.ultra + RARE_PLUS_WEIGHTS.legendary + RARE_PLUS_WEIGHTS.mythic

    expect(ultraPlus).toBeGreaterThan(weights)
    expect(ultraPlus).toBeCloseTo(weights + forced / RUNS * (1 - weights), 2)
  })
})

describe('a rede', () => {
  it('força ultra+ quando o contador chega ao limiar', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { cards, forcedByPity } = openPack({ seed, pity: PITY_THRESHOLD, pool })

      expect(forcedByPity).toBe(true)
      expect(cards.some(card => isPityTier(card.rarity))).toBe(true)
    }
  })

  /**
   * Forçar não é rebaixar para ultra. Um pity que sempre entregasse o degrau
   * mais baixo do ultra+ tornaria lendário e mítico impossíveis exatamente para
   * o jogador mais azarado.
   */
  it('mantém lendário e mítico alcançáveis quando força', () => {
    const tiers = new Set(
      Array.from({ length: 3000 }, (_, seed) =>
        openPack({ seed: seed + 1, pity: PITY_THRESHOLD, pool }).cards
          .find(card => isPityTier(card.rarity))?.rarity),
    )

    expect(tiers).toContain('ultra')
    expect(tiers).toContain('legendary')
    expect(tiers).toContain('mythic')
  })

  it('zera o contador quando o pack traz ultra+, e soma quando não traz', () => {
    const dry = openPack({ seed: 1, pity: 4, pool })
    const expected = dry.cards.some(card => isPityTier(card.rarity)) ? 0 : 5

    expect(dry.pity).toBe(expected)
    expect(openPack({ seed: 1, pity: PITY_THRESHOLD, pool }).pity).toBe(0)
  })

  it('conta quantos packs faltam, e não desce de zero', () => {
    expect(packsUntilPity(0)).toBe(PITY_THRESHOLD)
    expect(packsUntilPity(7)).toBe(3)
    expect(packsUntilPity(PITY_THRESHOLD)).toBe(0)
    expect(packsUntilPity(PITY_THRESHOLD + 5)).toBe(0)
  })
})
