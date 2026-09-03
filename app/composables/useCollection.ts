import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { Region } from '~~/shared/dex/regions'
import { toRegions } from '~~/shared/dex/regions'
import { rarityFrom } from '~~/shared/game/rarity'
import { progressRatio } from '~~/shared/game/progress'
import type { SearchEntry } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { RARITY_NAMES } from '~~/shared/types/game'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDex } from './useDex'

/**
 * A coleção cruzada com o dex — o que a store sozinha não sabe responder.
 *
 * A store guarda `{ id: { c, s } }` e nada além: ela não sabe que Charizard é
 * raro nem que Kanto tem 151 espécies. Quem sabe é o índice, e é aqui que os
 * dois se encontram — uma vez, num lugar, em vez de em cada componente que
 * precisar contar.
 *
 * **Contra o índice e não contra as nove gerações**, que é a razão de `bst` e as
 * duas marcas terem entrado em `SearchEntry`: o binder conta tier de espécie de
 * qualquer geração, e carregar 319 KB para colorir um cabeçalho seria pagar o
 * dex inteiro por uma soma.
 *
 * **O composable carrega o próprio dado, e lê o que o `useAsyncData` devolve** —
 * não o cache de módulo de `useDex()`. A diferença não é estilo: numa rota
 * pré-renderizada o handler roda **só no servidor**, e o cliente hidrata do
 * payload sem reexecutá-lo. Ler `dex.index.value` no cliente devolvia `null`, e
 * o binder abria com `30 / 0`, sem contagem por tier e sem as nove barras, com o
 * grid dizendo que nenhuma carta combinava com os filtros. É um defeito que
 * nenhum teste de unidade alcança e que só aparece navegando.
 */

export interface RegionProgress extends Region {
  readonly owned: number
  readonly ratio: number
}

export interface CollectionView {
  readonly ready: ComputedRef<boolean>
  readonly entries: ComputedRef<readonly SearchEntry[]>
  readonly rarityOfId: ComputedRef<(id: number) => Rarity | null>
  readonly ownedByRarity: ComputedRef<Readonly<Record<Rarity, number>>>
  readonly byRegion: ComputedRef<readonly RegionProgress[]>
  readonly total: ComputedRef<number>
  readonly ratio: ComputedRef<number>
}

export async function useCollection(): Promise<CollectionView> {
  const { loadCore, loadIndex } = useDex()
  const store = useCollectionStore()

  const { data } = await useAsyncData('collection-dex', async () => {
    const [index, core] = await Promise.all([loadIndex(), loadCore()])
    return { index, generations: core.generations }
  })

  const entries = computed(() => data.value?.index ?? [])
  const ready = computed(() => data.value !== null && data.value !== undefined)

  /**
   * Id → linha do índice, montado uma vez.
   *
   * `Map` e não um `find` por consulta: o binder pergunta pela raridade e pela
   * geração de **cada** espécie possuída ao desenhar o cabeçalho, e um `find`
   * linear sobre 1025 entradas por pergunta transformaria duas somas em
   * varredura quadrática — no caso realista de 138 cartas são 140 mil
   * comparações por render, e no pior caso 1 milhão.
   */
  const entryById = computed(() => {
    const map = new Map<number, SearchEntry>()
    for (const entry of entries.value) map.set(entry.id, entry)
    return map
  })

  const rarityOfId = computed(() => (id: number): Rarity | null => {
    const entry = entryById.value.get(id)
    return entry === undefined ? null : rarityFrom(entry)
  })

  /**
   * Quantas espécies **distintas** possuídas em cada tier.
   *
   * Distintas, e não cartas: o cabeçalho da prancha *Coleção* soma
   * `124 + 11 + 2 + 1 = 138`, que é o mesmo 138 do `138 / 1025` ao lado. Contar
   * duplicatas aqui faria os dois números da mesma linha discordarem.
   */
  const ownedByRarity = computed(() => {
    const counts: Record<Rarity, number> = {
      common: 0, uncommon: 0, rare: 0, ultra: 0, legendary: 0, mythic: 0,
    }

    for (const key of Object.keys(store.entries)) {
      const entry = entryById.value.get(Number(key))
      if (entry !== undefined) counts[rarityFrom(entry)] += 1
    }

    return counts
  })

  /**
   * Progresso por região, na ordem das gerações — a fileira de nove barras.
   *
   * A contagem sai de `entry.generation`, e **não** da faixa de ids que
   * `toRegions` calcula. As duas dariam o mesmo número hoje, porque os ids são
   * contíguos e ordenados por geração; contar por faixa é justamente a suposição
   * que o campo `generation` do índice existe para dispensar.
   */
  const byRegion = computed<readonly RegionProgress[]>(() => {
    const generations = data.value?.generations ?? null
    if (generations === null) return []

    const ownedPerGeneration = new Map<number, number>()
    for (const key of Object.keys(store.entries)) {
      const entry = entryById.value.get(Number(key))
      if (entry === undefined) continue
      ownedPerGeneration.set(entry.generation, (ownedPerGeneration.get(entry.generation) ?? 0) + 1)
    }

    return toRegions(generations).map((region) => {
      const owned = ownedPerGeneration.get(region.generation) ?? 0
      return { ...region, owned, ratio: progressRatio(owned, region.speciesCount) }
    })
  })

  const total = computed(() => entries.value.length)
  const ratio = computed(() => progressRatio(store.ownedCount, total.value))

  return { ready, entries, rarityOfId, ownedByRarity, byRegion, total, ratio }
}

/** As seis, na ordem da escada — para a tela não reimportar o vocabulário. */
export const COLLECTION_TIERS = RARITY_NAMES
