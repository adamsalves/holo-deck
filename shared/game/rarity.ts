import type { BaseStats, SpeciesEntry } from '../types/dex.ts'
import type { Rarity } from '../types/game.ts'

/**
 * A raridade de uma espécie — derivada do dex, não guardada nele.
 *
 * O plano a lista na Fase 5, junto com pack e pó. Ela chega antes porque a
 * Pokédex a exibe: a prancha *Detalhe* estampa `Raridade RARO` no herói e a
 * prancha *Pokédex* colore a moldura de cada carta do grid por ela. Nada aqui
 * depende de coleção — BST e as duas marcas vêm do próprio `SpeciesEntry` —,
 * então antecipar custa este arquivo e um teste, enquanto adiar custaria uma
 * Pokédex que diverge do canvas aprovado.
 *
 * Headless de propósito, como todo `shared/game/`: quem sorteia carta na Fase 5
 * e quem monta o binder lêem daqui, e nenhum dos dois precisa de Vue para isso.
 */

/**
 * Os limiares, escolhidos por percentil sobre o dex real.
 *
 * Os limiares "óbvios" (400 / 480 / 580) produziam pirâmide invertida, com
 * *raro* virando o maior tier do jogo — a maioria das espécies é evolução final,
 * e a mediana de BST das 1025 é 450. Estes saem dos percentis, e é sobre eles
 * que o pack da Fase 5 reserva um slot em dez para raro+.
 *
 * Faixas fechadas em cima, na ordem da escada. A última é o teto aberto: quem
 * passa do terceiro limiar é ultra.
 */
export const RARITY_THRESHOLDS = [475, 529, 581] as const

/** BST — a soma dos seis base stats, e o eixo em que a raridade é medida. */
export function baseStatTotal(stats: BaseStats): number {
  return stats.reduce((total, stat) => total + stat, 0)
}

/**
 * Os dois tetos das barras da prancha *Detalhe*: um stat e o BST.
 *
 * São os **máximos observados no dex gerado** — Blissey tem 255 de HP, Arceus
 * soma 720 —, e não um número redondo escolhido a olho. O canvas escala as seis
 * barras por ~165 (Charizard SpA 109 sai a 66%), o que é bonito na prancha e
 * corta na tela: os 255 de Blissey passariam de 150% da trilha. A escala do
 * mockup não sobrevive ao dex inteiro, então vale o dex.
 *
 * `test/unit/rarity.spec.ts` anda pelos nove `gen-N.json` e reprova se alguma
 * espécie passar de qualquer um dos dois — uma geração nova que traga um stat
 * maior derruba o portão em vez de silenciosamente estourar a barra.
 */
export const MAX_BASE_STAT = 255
export const MAX_BASE_STAT_TOTAL = 720

/**
 * As duas marcas vêm antes do BST, e não depois.
 *
 * Não é desempate: é a regra. Cosmog é lendário com BST 200 e cairia em *comum*
 * por faixa; Mew é mítico com BST 600 e cairia em *ultra*. As pranchas mostram
 * os dois casos — Mew aparece como MÍTICO com BST 600 na fileira de estados —, e
 * medir lenda por soma de stat é justamente o que a marca existe para evitar.
 *
 * Mítico ganha de lendário porque é o recorte mais estreito dos dois. A PokeAPI
 * não marca nenhuma espécie com as duas, mas a ordem precisa estar escrita: um
 * `if` que dependa de os dados nunca discordarem é um `if` que já quebrou.
 */
export function rarityOf(
  species: Pick<SpeciesEntry, 'baseStats' | 'isLegendary' | 'isMythical'>,
): Rarity {
  if (species.isMythical) return 'mythic'
  if (species.isLegendary) return 'legendary'

  const bst = baseStatTotal(species.baseStats)
  const [uncommon, rare, ultra] = RARITY_THRESHOLDS

  if (bst < uncommon) return 'common'
  if (bst < rare) return 'uncommon'
  if (bst < ultra) return 'rare'
  return 'ultra'
}
