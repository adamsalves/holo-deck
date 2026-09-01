/**
 * Tipos do jogo — o que a Pokédex não conhece.
 *
 * `dex.ts` descreve a espécie como a PokeAPI a entrega; aqui ficam as noções que
 * o Holo Deck inventa em cima dela. A Fase 2 traz só a raridade, porque ela é
 * quem decide tratamento visual: moldura, etiqueta, brilho e foil. Os limiares
 * de BST que atribuem raridade a cada espécie são da Fase 5 e moram em
 * `shared/game/rarity.ts` — aqui está o vocabulário, não a regra.
 */

/**
 * Os seis níveis, do mais comum ao mais raro. **A ordem é significativa**: é ela
 * que responde "isto é raro o bastante para X?", e é por isso que a lista é uma
 * tupla e não um `Set`.
 */
export const RARITY_NAMES = [
  'common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic',
] as const

export type Rarity = typeof RARITY_NAMES[number]

export const RARITY_COUNT = RARITY_NAMES.length

/** Posição na escada. Existe para as comparações não dependerem de `indexOf` solto. */
export function rarityRank(rarity: Rarity): number {
  return RARITY_NAMES.indexOf(rarity)
}

/**
 * Foil começa em raro — decidido no canvas e repetido na anotação da prancha de
 * raridade ("Foil começa em raro").
 *
 * Não é detalhe de estilo: o foil é a única coisa da interface que anima por
 * ponteiro, e prendê-lo a raro+ é o que mantém o grid de 1025 espécies barato.
 * Por isso a regra mora aqui, headless e testável, e não dentro do componente.
 */
export const FOIL_FROM_RARITY: Rarity = 'rare'

export function hasFoil(rarity: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(FOIL_FROM_RARITY)
}

/** `some` com comparação explícita pelo mesmo motivo que `isTypeName`: o
 * `includes` de uma tupla `as const` só aceita os próprios literais. */
export function isRarity(value: string): value is Rarity {
  return RARITY_NAMES.some(known => known === value)
}
