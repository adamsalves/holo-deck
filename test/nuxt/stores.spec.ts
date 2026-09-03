// @vitest-environment nuxt
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { WELCOME_PACKS } from '~~/shared/game/economy'
import { PITY_THRESHOLD } from '~~/shared/game/packs'
import { DUST_PER_DUPLICATE, FORGE_COST } from '~~/shared/game/dust'
import type { SpeciesId } from '~~/shared/types/brand'
import { isSpeciesId } from '~~/shared/types/brand'
import type { PackCard } from '~~/shared/types/game'

/**
 * As duas stores da Fase 5 — coleção com pó, e progresso com pity.
 *
 * O que estes testes cobram é a **regra**, não a persistência: as stores não
 * tocam armazenamento, e é o plugin que compõe o documento. Essa separação é o
 * que permite afirmar "moer não come a shiny primeiro" sem `localStorage` no
 * caminho, e é a mesma fronteira que a Fase 7 vai atravessar sem tocar aqui.
 */

function species(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

function card(id: number, rarity: PackCard['rarity'], isShiny = false): PackCard {
  return { speciesId: species(id), rarity, isShiny }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a coleção', () => {
  it('nasce vazia', () => {
    const collection = useCollectionStore()

    expect(collection.ownedCount).toBe(0)
    expect(collection.cardCount).toBe(0)
    expect(collection.dust).toBe(0)
  })

  it('credita as dez cartas de um pack', () => {
    const collection = useCollectionStore()

    collection.credit([card(1, 'common'), card(2, 'common'), card(6, 'rare')])

    expect(collection.ownedCount).toBe(3)
    expect(collection.cardCount).toBe(3)
    expect(collection.has(species(6))).toBe(true)
    expect(collection.has(species(150))).toBe(false)
  })

  /**
   * `c` conta o total **com** as shinies dentro. É a razão de o formato ser
   * esse: contar normais e shinies em campos separados faria toda soma de
   * "quantas tenho" ser `c + s`, e a primeira esquecida produziria uma coleção
   * que encolhe ao ganhar um shiny.
   */
  it('conta a shiny dentro do total, e não ao lado', () => {
    const collection = useCollectionStore()

    collection.credit([card(25, 'common'), card(25, 'common', true)])

    expect(collection.copies(species(25))).toBe(2)
    expect(collection.shinies(species(25))).toBe(1)
    expect(collection.cardCount).toBe(2)
    expect(collection.shinyCount).toBe(1)
  })

  it('não conta a primeira cópia como duplicata', () => {
    const collection = useCollectionStore()

    collection.credit([card(25, 'common')])
    expect(collection.duplicates(species(25))).toBe(0)

    collection.credit([card(25, 'common'), card(25, 'common')])
    expect(collection.duplicates(species(25))).toBe(2)
  })
})

describe('moer', () => {
  it('paga o pó do tier, por cópia', () => {
    const collection = useCollectionStore()
    collection.credit([card(25, 'common'), card(25, 'common'), card(25, 'common')])

    const gained = collection.scrapDuplicates(species(25), 'common')

    expect(gained).toBe(2 * DUST_PER_DUPLICATE.common)
    expect(collection.dust).toBe(2 * DUST_PER_DUPLICATE.common)
    expect(collection.copies(species(25))).toBe(1)
  })

  /**
   * A shiny sai a cada ~26 packs e rende o mesmo pó que a normal do mesmo tier.
   * Moê-la primeiro seria destruir o exemplar mais raro pelo mesmo preço.
   */
  it('come as normais antes das shiny', () => {
    const collection = useCollectionStore()
    collection.credit([card(25, 'common'), card(25, 'common', true), card(25, 'common')])

    collection.scrapDuplicates(species(25), 'common')

    expect(collection.copies(species(25))).toBe(1)
    expect(collection.shinies(species(25))).toBe(1)
  })

  /**
   * Moer até a última cópia é permitido, e é decisão do plano: a Fase 6 diz que
   * moer uma carta que está no deck ativo esvazia o slot em vez de ser
   * bloqueada. Um limite aqui contradiria aquela regra antes de ela chegar.
   */
  it('deixa moer até o fim, e aí a espécie some da coleção', () => {
    const collection = useCollectionStore()
    collection.credit([card(25, 'common'), card(25, 'common')])

    collection.scrap(species(25), 'common', 2)

    expect(collection.has(species(25))).toBe(false)
    expect(collection.ownedCount).toBe(0)
  })

  it('não paga por carta que não se tem, nem por contagem não positiva', () => {
    const collection = useCollectionStore()
    collection.credit([card(25, 'common')])

    expect(collection.scrap(species(150), 'ultra', 1)).toBe(0)
    expect(collection.scrap(species(25), 'common', 0)).toBe(0)
    expect(collection.scrap(species(25), 'common', -3)).toBe(0)
    expect(collection.dust).toBe(0)
  })

  it('não moe mais do que existe', () => {
    const collection = useCollectionStore()
    collection.credit([card(25, 'common')])

    expect(collection.scrap(species(25), 'common', 99)).toBe(DUST_PER_DUPLICATE.common)
  })
})

describe('forjar', () => {
  it('recusa quando o pó não dá, sem cobrar nada', () => {
    const collection = useCollectionStore()

    expect(collection.forge(species(151), 'mythic')).toBe(false)
    expect(collection.has(species(151))).toBe(false)
    expect(collection.dust).toBe(0)
  })

  it('entrega a carta e debita o custo do tier', () => {
    const collection = useCollectionStore()
    collection.credit(Array.from({ length: 5 }, () => card(25, 'common')))
    collection.scrapDuplicates(species(25), 'common')
    collection.dust = FORGE_COST.rare

    expect(collection.forge(species(6), 'rare')).toBe(true)
    expect(collection.copies(species(6))).toBe(1)
    expect(collection.dust).toBe(0)
  })

  /**
   * Brilho é sorte de pack. Comprá-lo tiraria do shiny exatamente o que o faz
   * valer alguma coisa.
   */
  it('nunca entrega shiny', () => {
    const collection = useCollectionStore()
    collection.dust = FORGE_COST.ultra

    collection.forge(species(149), 'ultra')

    expect(collection.shinies(species(149))).toBe(0)
  })
})

describe('o progresso', () => {
  it('guarda o contador que openPack devolveu, sem recalcular a regra', () => {
    const progress = useProgressStore()

    progress.setPity(7)

    expect(progress.pity).toBe(7)
    expect(progress.untilPity).toBe(PITY_THRESHOLD - 7)
  })

  it('não deixa o contador ficar negativo', () => {
    const progress = useProgressStore()

    progress.setPity(-4)

    expect(progress.pity).toBe(0)
  })

  it('entrega os três packs de boas-vindas, e nem um a mais', () => {
    const progress = useProgressStore()

    const claimed = Array.from({ length: WELCOME_PACKS + 2 }, () => progress.claimWelcome())

    expect(claimed).toEqual([1, 2, 3, null, null])
    expect(progress.hasWelcomePack).toBe(false)
    expect(progress.welcomeRemaining).toBe(0)
  })

  /**
   * Sem esta marca no save, a concessão inicial vira pack infinito a cada
   * recarga da página — que é a forma mais barata de um jogo de coleção deixar
   * de ter economia.
   */
  it('lembra quantos já foram, ao voltar do save', () => {
    const progress = useProgressStore()

    progress.hydrate({ pity: 2, welcomeClaimed: WELCOME_PACKS })

    expect(progress.hasWelcomePack).toBe(false)
    expect(progress.claimWelcome()).toBeNull()
  })
})

describe('ida e volta pelo save', () => {
  it('devolve o mesmo estado que gravou', () => {
    const collection = useCollectionStore()
    const progress = useProgressStore()

    collection.credit([card(25, 'common', true), card(6, 'rare'), card(6, 'rare')])
    collection.dust = 340
    progress.setPity(4)
    progress.claimWelcome()

    const saved = { ...collection.snapshot(), progress: progress.snapshot() }

    setActivePinia(createPinia())
    const restored = useCollectionStore()
    const restoredProgress = useProgressStore()
    restored.hydrate(saved.collection, saved.dust)
    restoredProgress.hydrate(saved.progress)

    expect(restored.copies(species(6))).toBe(2)
    expect(restored.shinies(species(25))).toBe(1)
    expect(restored.dust).toBe(340)
    expect(restoredProgress.pity).toBe(4)
    expect(restoredProgress.welcomeClaimed).toBe(1)
  })

  /**
   * `hydrate` substitui, não mescla. Mesclar faria um save carregado por cima de
   * uma sessão já iniciada somar cartas que o jogador não ganhou — e é o tipo de
   * defeito que só aparece na Fase 7, quando duas fontes de save existirem.
   */
  it('substitui o estado em vez de somar ao que já havia', () => {
    const collection = useCollectionStore()
    collection.credit([card(1, 'common'), card(2, 'common')])

    collection.hydrate({ 25: { c: 1, s: 0 } }, 10)

    expect(collection.ownedCount).toBe(1)
    expect(collection.has(species(1))).toBe(false)
    expect(collection.dust).toBe(10)
  })
})
