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
  /** `#0001–0151`, para o rodapé. A faixa é da região e o grid não a conhece —
   *  quem a calcula é a página, que sabe qual região está aberta.
   *
   *  `null` para ausência, e não `''`: é como o resto do repositório escreve
   *  "não tem" (`data.value?.region ?? null`, `description ?? null`,
   *  `species.habitat === null`), e uma string vazia obriga quem lê a saber que
   *  ela é sentinela e não conteúdo. */
  range?: string | null
  /**
   * Quem o jogador possui, e quem ele possui em shiny.
   *
   * `Set` de id, e não uma função de consulta: o grid pergunta uma vez por
   * carta visível e um `Set` responde em tempo constante sem o componente
   * precisar segurar um closure que muda de identidade a cada render.
   *
   * `null` — o padrão — significa **sem coleção carregada**, e é o que mantém
   * este componente utilizável fora do jogo: o fallback de SSR renderiza as 151
   * cartas sem anel nenhum, que é exatamente o HTML que o servidor pode
   * produzir sobre um save que ele não tem.
   */
  ownedIds?: ReadonlySet<number> | null
  shinyIds?: ReadonlySet<number> | null
}>(), { virtualize: false, range: null, ownedIds: null, shinyIds: null })

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

/**
 * Quantas cartas estão de fato no DOM — o número que a prancha estampa no
 * rodapé (`18 de 151 renderizados`).
 *
 * Sai da soma das fileiras visíveis, e não de `rows.length * columns`: a última
 * fileira quase nunca está cheia, e multiplicar contaria cartas que não existem.
 * Na forma completa são todas, que é justamente o que o rodapé precisa dizer —
 * ali não há virtualização nenhuma para anunciar.
 */
const rendered = computed(() => {
  if (!props.virtualize) return props.species.length
  return rows.value.reduce((total, row) => total + rowSpecies(row.index).length, 0)
})

/** A fração desenhada, que é o que a barra do rodapé mostra. */
const renderedPercent = computed(() => {
  if (props.species.length === 0) return 0
  return (rendered.value / props.species.length) * 100
})

/**
 * A frase do rodapé, montada aqui e não no template.
 *
 * A ressalva sobre virtualização é parte da mesma sentença, e um `<template
 * v-if>` no meio de um parágrafo obriga a quebrar linha no HTML — o que insere
 * espaço em branco antes do `·`. Uma string resolve os dois.
 *
 * **A ressalva só aparece quando a virtualização está de fato retendo alguma
 * coisa.** `virtualize` diz que ela está ligada, não que ela está segurando: com
 * um filtro estreito — Kanto por *Lendário* são 4 espécies — todas as fileiras
 * cabem na janela, e a frase anunciava "scroll virtualizado" ao lado de
 * `4 de 4` e de uma barra em 100%. Anunciar um mecanismo que não está operando é
 * o mesmo defeito que o comentário do `addInitScript` no e2e tinha, agora em
 * texto que o usuário lê.
 *
 * E sem número: a versão anterior citava `SPECIES_COUNT` (1025), que não tem
 * referente em tela nenhuma — o grid é sempre de **uma** região, e a maior tem
 * 156. Quem quer o número tem os dois reais na primeira metade da frase.
 */
const renderedLabel = computed(() => {
  const counted = `${rendered.value} de ${props.species.length} renderizados`
  if (!props.virtualize || rendered.value >= props.species.length) return counted
  return `${counted} · scroll virtualizado`
})
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
        :owned="ownedIds === null ? null : ownedIds.has(entry.id)"
        :shiny="shinyIds?.has(entry.id) ?? false"
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
          :owned="ownedIds === null ? null : ownedIds.has(entry.id)"
          :shiny="shinyIds?.has(entry.id) ?? false"
        />
      </div>
    </div>

    <!--
      O rodapé da prancha *Pokédex*, que a Fase 3 não tinha reproduzido.

      Ele existe porque a virtualização é invisível por definição: sem esta
      linha, um grid que segura 18 cartas e um que segura 151 são a mesma tela, e
      a promessa central da fase — *o DOM nunca segura as 1025* — fica sem
      nenhuma evidência para quem está olhando.

      A segunda frase da prancha continua com a Fase 5: ela fala do anel vazado
      que marca a espécie não possuída, e o anel não existe enquanto não existir
      coleção. Fica aqui a metade que já é verdade.
    -->
    <footer
      v-if="species.length > 0"
      class="grid-footer"
    >
      <!-- O `numeric` vai no que é número, e não no parágrafo inteiro: o
           utilitário é tabular-nums para alinhar dígito, e a nota abaixo é
           prosa. -->
      <p class="grid-footer__count">
        <span class="numeric">{{ renderedLabel }}</span>
        <span class="grid-footer__note">A Pokédex é referência: mostra tudo, possuídas ou não.</span>
      </p>

      <div class="grid-footer__extent">
        <!-- A barra é indicador de extensão, não de progresso: ela mede o que
             está desenhado, não o que foi capturado. A prancha a pinta com o
             verde de progresso de coleção, que não tem token no sistema — usá-lo
             aqui gastaria o significado da Fase 5 num medidor que não fala de
             coleção. `--accent` é o semântico que sobra, e o valor da prancha
             está na seção de divergências do README.

             `aria-hidden` porque o número ao lado já diz a mesma coisa em texto,
             e um `progressbar` anunciando "12%" sem rótulo é ruído. -->
        <span
          class="grid-footer__bar"
          aria-hidden="true"
        >
          <span
            class="grid-footer__fill"
            :style="{ width: `${renderedPercent}%` }"
          />
        </span>
        <span
          v-if="range !== null"
          class="numeric grid-footer__range"
        >{{ range }}</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.grid-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

/* Os dois papéis têm piso AA normal, que é o que 11px exige. `--text-faint` é o
   único com piso de texto grande — `theme.spec.ts` escreve que usá-lo em texto
   pequeno é erro do lado do componente, e a nota aqui tem 11px. A hierarquia
   entre as duas linhas sai do par corpo/mudo, sem gastar o papel de rodapé. */
.grid-footer__count {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-body);
}

.grid-footer__note {
  display: block;
  color: var(--text-muted);
}

.grid-footer__extent {
  display: flex;
  align-items: center;
  gap: 9px;
}

.grid-footer__bar {
  display: block;
  width: 150px;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.grid-footer__fill {
  display: block;
  height: 100%;
  background: var(--accent);
}

.grid-footer__range {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
