import type { SearchEntry } from '~~/shared/types/dex'
import type { SpeciesId } from '~~/shared/types/brand'
import type { Rarity } from '~~/shared/types/game'
import { rarityRank } from '~~/shared/types/game'
import { rarityFrom } from '~~/shared/game/rarity'
import type { SaveData } from '~~/shared/save/schema'
import { ownedIds } from '~~/shared/save/schema'

/** Uma carta da fileira *Melhores cartas* da prancha *Duas coleções*. */
export interface SummaryCard {
  readonly id: SpeciesId
  readonly name: string
  readonly rarity: Rarity
  readonly shiny: boolean
}

export interface SaveSummary {
  readonly cards: number
  readonly badges: number
  readonly shiny: number
  readonly dust: number
  readonly best: readonly SummaryCard[]
}

/** Quantas miniaturas a prancha desenha em cada lado. */
export const BEST_CARDS = 5

/**
 * O retrato de um save, do jeito que a tela de escolha o mostra.
 *
 * **Melhores por raridade e, no empate, por BST** — a mesma escada que o binder
 * usa, lida pelo `rarityRank` que já existe em vez de um `indexOf` solto. O
 * empate importa mais do que parece: quase toda coleção inicial é uma parede de
 * comuns, e sem o segundo critério as cinco miniaturas sairiam em ordem de id,
 * que não diz nada sobre qual coleção vale mais.
 *
 * Recebe o índice do dex em vez de o buscar: a tela mostra **dois** saves lado a
 * lado, e um composable que carregasse dados por chamada faria a mesma leitura
 * duas vezes.
 */
export function summarize(save: SaveData, index: readonly SearchEntry[]): SaveSummary {
  const owned = ownedIds(save.collection)
  const byId = new Map<SpeciesId, SearchEntry>(index.map(entry => [entry.id, entry]))

  let shiny = 0
  const cards: SummaryCard[] = []

  for (const id of owned) {
    const entry = byId.get(id)
    if (entry === undefined) continue

    const copies = save.collection[String(id)]
    const isShiny = (copies?.s ?? 0) > 0
    if (isShiny) shiny += copies?.s ?? 0

    cards.push({
      id,
      name: entry.displayName,
      rarity: rarityFrom(entry),
      shiny: isShiny,
    })
  }

  const bstOf = (card: SummaryCard): number => byId.get(card.id)?.bst ?? 0
  const best = [...cards]
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || bstOf(b) - bstOf(a))
    .slice(0, BEST_CARDS)

  return { cards: owned.length, badges: save.progress.badges, shiny, dust: save.dust, best }
}
