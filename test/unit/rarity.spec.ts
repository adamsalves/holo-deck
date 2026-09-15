import { describe, expect, it } from 'vitest'
import { FOIL_FROM_RARITY, hasFoil, isRarity, RARITY_COUNT, RARITY_NAMES, rarityRank } from '~~/shared/types/game'

describe('escada de raridade', () => {
  it('tem os seis níveis, do mais comum ao mais raro', () => {
    expect(RARITY_COUNT).toBe(6)
    expect([...RARITY_NAMES]).toEqual(['common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic'])
  })

  it('ordena por posição, e a ordem é a da lista', () => {
    const ranks = RARITY_NAMES.map(rarityRank)

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(RARITY_COUNT)
  })

  it('reconhece só os seis nomes', () => {
    expect(RARITY_NAMES.every(isRarity)).toBe(true)
    expect(isRarity('epic')).toBe(false)
    expect(isRarity('Rare')).toBe(false)
    expect(isRarity('')).toBe(false)
  })
})

describe('foil', () => {
  /**
   * O portão da Fase 2: *foil só aparece em raro+*.
   *
   * Está aqui, headless, e não dentro do componente, porque a consequência é de
   * custo e não de estilo — o foil é a única coisa da interface que anima por
   * ponteiro, e é o que mantém o grid de 1025 espécies barato.
   */
  it('começa em raro', () => {
    expect(FOIL_FROM_RARITY).toBe('rare')
  })

  it('não aparece abaixo de raro', () => {
    expect(hasFoil('common')).toBe(false)
    expect(hasFoil('uncommon')).toBe(false)
  })

  it('aparece de raro para cima, sem buraco no meio', () => {
    const withFoil = RARITY_NAMES.filter(hasFoil)

    expect(withFoil).toEqual(['rare', 'ultra', 'legendary', 'mythic'])
  })
})

/**
 * The labels themselves moved to `test/unit/i18n-gate.spec.ts` in Phase 8.
 *
 * They were asserted here while `RARITY_LABELS` and `TYPE_LABELS` were complete
 * `Record`s in `shared/`: the compiler charged for coverage and this file
 * charged for content — no empty label, no English id copied into the value,
 * which is how the card once shipped COMMON inside a `lang="pt-BR"` document.
 *
 * The vocabulary is JSON now, one file per locale, and `shared/` keeps only the
 * ids. Asserting it from here would mean reading a locale to check an export
 * that no longer exists; the gate that already reads every locale is the one
 * place where the same questions can be asked of **both** languages at once.
 */
