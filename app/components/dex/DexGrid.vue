<script setup lang="ts">
import type { SpeciesEntry } from '~~/shared/types/dex'
import { useWindowVirtualizer } from '@tanstack/vue-virtual'
import { computed, useTemplateRef, watch } from 'vue'
import { useElementBounding, useElementSize } from '@vueuse/core'

/**
 * O grid de espécies — o mesmo desenho nas duas formas em que ele existe.
 *
 * `virtualize` decide qual das duas roda, e as duas precisam existir por razões
 * diferentes:
 *
 * - **Virtualizada** é o que a prancha anota: *"o DOM nunca segura as 1025"*. É
 *   o que roda no navegador depois da hidratação.
 * - **Completa** é o que o servidor renderiza. Este grid é a única superfície
 *   que linka as 1025 páginas de detalhe, e são elas que carregam o SEO que o
 *   plano promete: um HTML pré-renderizado com 18 cartas deixa 133 páginas de
 *   Kanto sem nenhuma referência apontando para elas.
 *
 * A troca é feita pelo `<ClientOnly>` da página, e não por um `onMounted` daqui,
 * porque é o `ClientOnly` que garante que o HTML servido e o primeiro render do
 * cliente sejam o mesmo — a forma completa nos dois.
 *
 * **Isso não evita a hidratação da forma completa, evita a divergência.** O
 * `ClientOnly` mostra o fallback enquanto `mounted` é `false`, e ele só vira
 * `true` no `onMounted`: no primeiro render do cliente, que é a hidratação, quem
 * está montado é a forma completa. As 151 cartas são hidratadas e descartadas um
 * tick depois. É o preço dos 151 links no HTML, e ele é real.
 */
const props = withDefaults(defineProps<{
  species: readonly SpeciesEntry[]
  virtualize?: boolean
}>(), { virtualize: false })

/** Largura mínima de uma carta. Abaixo disso o nome quebra em duas linhas. */
const MIN_CARD_WIDTH = 132
const GAP = 12
/** A proporção de `PokeCard`, que é a de uma carta de verdade. */
const CARD_RATIO = 7 / 5

const container = useTemplateRef<HTMLElement>('container')
const { width } = useElementSize(container)

/**
 * Quantas colunas cabem — a mesma conta que o `auto-fill` do CSS faria, escrita
 * aqui porque o virtualizador precisa do número para saber quantas fileiras
 * existem. As duas versões usam esta função, e é isso que as mantém idênticas.
 */
const columns = computed(() => {
  if (width.value === 0) return 1
  return Math.max(1, Math.floor((width.value + GAP) / (MIN_CARD_WIDTH + GAP)))
})

const rowHeight = computed(() => {
  const cardWidth = (width.value - GAP * (columns.value - 1)) / columns.value
  return cardWidth * CARD_RATIO + GAP
})

const rowCount = computed(() => Math.ceil(props.species.length / columns.value))

/**
 * Virtualização pela **janela**, não por um contêiner com rolagem própria.
 *
 * A prancha desenha a página inteira rolando, com o cabeçalho da região saindo
 * junto. Um contêiner com `overflow` teria duas barras de rolagem e prenderia o
 * cabeçalho no topo — que é outra tela, não esta.
 */
/**
 * Quanto de página existe **acima** do grid — o cabeçalho da região.
 *
 * O virtualizador de janela mede o deslocamento a partir do topo do documento, e
 * sem esta margem ele acha que a primeira fileira começa no pixel zero: o grid
 * abre já rolado, com as primeiras espécies fora da vista. `useElementBounding`
 * dá o `top` relativo ao viewport e recalcula em rolagem e redimensionamento, e
 * a soma com a posição da janela é a distância estável até o topo do documento.
 */
const { top } = useElementBounding(container)
const scrollMargin = computed(() => Math.max(0, Math.round(top.value + (import.meta.client ? window.scrollY : 0))))

const virtualizer = useWindowVirtualizer({
  get count() {
    return rowCount.value
  },
  // Na forma completa o virtualizador não decide nada, e `enabled: false`
  // curto-circuita `getMeasurements` antes de ele medir 26 fileiras que ninguém
  // vai ler. A instância continua existindo — o `useWindowVirtualizer` não é
  // condicional —, mas para de trabalhar.
  get enabled() {
    return props.virtualize
  },
  estimateSize: () => rowHeight.value,
  overscan: 3,
  get scrollMargin() {
    return scrollMargin.value
  },
})

/**
 * `estimateSize` não invalida a medição sozinho.
 *
 * O memo de `getMeasurements` tem por chave
 * `[{count, paddingStart, scrollMargin, getItemKey, enabled, lanes, laneAssignmentMode, gap}, itemSizeCacheVersion]`
 * — e `estimateSize` não está nela. Como não há `measureElement`, o
 * `itemSizeCache` fica vazio e **todo** tamanho sai do `estimateSize`
 * memoizado.
 *
 * Passa despercebido enquanto a largura muda junto com o número de colunas,
 * porque aí `count` muda e a chave vira outra. O caso que quebra é o
 * redimensionamento que mantém as colunas e o topo do grid: de 900px para
 * 1000px continuam 6 colunas, o `scrollMargin` não se mexe, e `rowHeight` sobe
 * ~7% — as fileiras ficam posicionadas pela altura antiga, sobrepondo ou
 * abrindo buraco. `measure()` limpa o cache e incrementa a versão, que é o
 * outro lado da chave.
 */
watch(rowHeight, () => {
  virtualizer.value.measure()
})

const rows = computed(() => virtualizer.value.getVirtualItems())

function rowSpecies(index: number): readonly SpeciesEntry[] {
  const start = index * columns.value
  return props.species.slice(start, start + columns.value)
}

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
  gap: `${GAP}px`,
}))
</script>

<template>
  <div ref="container">
    <div
      v-if="!virtualize"
      :style="gridStyle"
    >
      <DexCard
        v-for="entry in species"
        :key="entry.id"
        :species="entry"
      />
    </div>

    <div
      v-else
      :style="{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }"
    >
      <div
        v-for="row in rows"
        :key="row.index"
        :style="{
          ...gridStyle,
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
        }"
      >
        <DexCard
          v-for="entry in rowSpecies(row.index)"
          :key="entry.id"
          :species="entry"
        />
      </div>
    </div>
  </div>
</template>
