<script setup lang="ts">
import { computed } from 'vue'
import { dustFor } from '~~/shared/game/dust'
import { gameNumber } from '~~/shared/game/progress'
import { rarityFrom } from '~~/shared/game/rarity'
import type { SearchEntry } from '~~/shared/types/dex'
import { RARITY_LABELS } from '~~/shared/types/game'

/**
 * Uma carta do binder — a mesma carta do sistema, com o rodapé que a coleção
 * precisa.
 *
 * O que muda em relação à `DexCard` é o rodapé e o canto: a prancha *Coleção*
 * põe `×3` no alto e troca a etiqueta de raridade por `2 dup · 10 pó` embaixo,
 * porque num binder o que se varre é **o que dá para moer**. A raridade continua
 * dita em texto quando não há duplicata, que é a regra do canvas — ela nunca é
 * comunicada só por brilho.
 *
 * O botão de moer é a própria linha `2 dup · 10 pó`, e não um ícone à parte: ela
 * já diz o que a ação faz e quanto ela rende, e um segundo alvo clicável ao lado
 * de um link de carta é a receita para moer coleção sem querer.
 *
 * ## O rodapé é um slot só, e é isso que dá altura uniforme
 *
 * Raridade e linha de moer são **estados exclusivos da mesma caixa**
 * (`.binder-card__foot`), como a prancha sempre os desenhou. Até a Fase 5 eles
 * moravam em lugares diferentes — a raridade dentro do rodapé da `PokeCard`, o
 * botão fora do link e embaixo do artigo —, e a soma disso com o `padding` extra
 * do botão deixava uma carta com duplicata ~22px mais alta que uma sem. Como a
 * fileira estica até a mais alta, a altura da fileira passava a depender de haver
 * ou não uma repetida dentro dela, e o virtualizador da Pokédex, que posiciona
 * por um `estimateSize` único, não tinha como acertar a segunda fileira.
 *
 * O que destravou o botão voltar para dentro da carta foi a `PokeCard` passar a
 * **hospedar o link** em vez de ser envolvida por ele: o rodapé fica fora do
 * `<a>`, e quem precisa de clique sobe uma camada. Ver `.poke-card__link` e a
 * issue #24 — a virtualização em si continua dependendo da medição que ela pede.
 */
const props = defineProps<{
  entry: SearchEntry
  copies: number
  shinies: number
  duplicates: number
}>()

defineEmits<{ scrap: [] }>()

const rarity = computed(() => rarityFrom(props.entry))
const dustValue = computed(() => props.duplicates * dustFor(rarity.value))
const isShiny = computed(() => props.shinies > 0)

const label = computed(() => [
  props.entry.displayName,
  `número ${props.entry.id}`,
  RARITY_LABELS[rarity.value],
  props.copies === 1 ? 'uma cópia' : `${props.copies} cópias`,
  ...(isShiny.value ? ['shiny'] : []),
].join(', '))
</script>

<template>
  <article
    class="binder-card"
    :class="{ 'binder-card--shiny': isShiny }"
  >
    <DexPokeCard
      :dex-number="entry.id"
      :name="entry.displayName"
      :types="entry.types"
      :rarity="rarity"
      :link="{ to: `/pokemon/${entry.slug}`, label }"
    >
      <template #art>
        <img
          :src="`/sprites/${entry.id}.webp`"
          alt=""
          width="128"
          height="128"
          loading="lazy"
          decoding="async"
        >
      </template>

      <!-- Os dois estados do rodapé, na mesma caixa. Trocam de conteúdo, nunca
           de lugar nem de altura. -->
      <template #footer>
        <button
          v-if="duplicates > 0"
          type="button"
          class="numeric binder-card__foot binder-card__scrap"
          :aria-label="`Transformar ${duplicates} duplicata${duplicates > 1 ? 's' : ''} de ${entry.displayName} em ${gameNumber(dustValue)} de pó`"
          @click="$emit('scrap')"
        >
          {{ duplicates }} dup · <strong>{{ gameNumber(dustValue) }} pó</strong>
        </button>

        <p
          v-else
          class="numeric binder-card__foot binder-card__rarity"
          :data-rarity="rarity"
        >
          {{ isShiny ? 'SHINY' : RARITY_LABELS[rarity].toUpperCase() }}
        </p>
      </template>
    </DexPokeCard>

    <span
      class="numeric binder-card__count"
      :data-rarity="rarity"
    >
      {{ isShiny && copies === shinies ? '✦' : `×${copies}` }}
    </span>
  </article>
</template>

<style scoped>
.binder-card {
  position: relative;
}

/* A moldura de quem tem shiny é o ciano de gelo, com o mesmo halo que a prancha
   desenha. Não é um degrau da escada: shiny é tratamento, e por isso ele pinta
   por cima do que a raridade já decidiu. */
.binder-card--shiny :deep(.poke-card) {
  border-color: var(--shiny);
  box-shadow: 0 0 26px -12px var(--shiny);
}

/* A contagem paira sobre a carta e **não intercepta ponteiro**: ela é rótulo, e
   sem isso o canto superior direito viraria uma zona morta em cima do link. */
.binder-card__count {
  position: absolute;
  top: 7px;
  right: 8px;
  pointer-events: none;
  font-size: 9px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 2px;
  background: var(--bg);
  border: 1px solid var(--rarity);
  color: var(--rarity-label);
}

/**
 * A caixa do rodapé, escrita uma vez para os dois papéis.
 *
 * Enquanto as métricas viverem aqui, e não em cada estado, os dois não têm como
 * divergir em altura — que foi exatamente o defeito da issue #24. Um estado novo
 * (o slot de deck vazio, por exemplo) herda a mesma caixa por construção.
 */
.binder-card__foot {
  display: block;
  width: 100%;
  margin: 4px 0 0;
  padding: 3px 0;
  font-size: 9px;
  line-height: 1.2;
  text-align: left;
}

.binder-card__rarity {
  color: var(--rarity-label);
}

/* O degrau que a `PokeCard` publica: a camada do link é `z-index: 1`, e o rodapé
   com ação sobe para 2 para receber o próprio clique. */
.binder-card__scrap {
  position: relative;
  z-index: 2;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.binder-card__scrap strong {
  color: var(--text);
  font-weight: 700;
}

.binder-card__scrap:hover,
.binder-card__scrap:focus-visible {
  color: var(--text-body);
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
