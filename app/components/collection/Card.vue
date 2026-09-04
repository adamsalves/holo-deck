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
    <NuxtLink
      :to="`/pokemon/${entry.slug}`"
      :aria-label="label"
      class="binder-card__link"
    >
      <DexPokeCard
        :dex-number="entry.id"
        :name="entry.displayName"
        :types="entry.types"
        :rarity="rarity"
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

        <template #footer>
          <p
            v-if="duplicates === 0"
            class="numeric binder-card__rarity"
            :data-rarity="rarity"
          >
            {{ isShiny ? 'SHINY' : RARITY_LABELS[rarity].toUpperCase() }}
          </p>
        </template>
      </DexPokeCard>
    </NuxtLink>

    <!-- A contagem fica fora do link: ela não navega, e um `<span>` clicável
         dentro de um link é o jeito de o teclado nunca alcançar a ação. -->
    <span
      class="numeric binder-card__count"
      :data-rarity="rarity"
    >
      {{ isShiny && copies === shinies ? '✦' : `×${copies}` }}
    </span>

    <button
      v-if="duplicates > 0"
      type="button"
      class="numeric binder-card__scrap"
      :aria-label="`Transformar ${duplicates} duplicata${duplicates > 1 ? 's' : ''} de ${entry.displayName} em ${gameNumber(dustValue)} de pó`"
      @click="$emit('scrap')"
    >
      {{ duplicates }} dup · <strong>{{ gameNumber(dustValue) }} pó</strong>
    </button>
  </article>
</template>

<style scoped>
.binder-card {
  position: relative;
}

.binder-card__link {
  display: block;
  text-decoration: none;
  color: inherit;
  border-radius: var(--radius);
}

.binder-card__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

/* A moldura de quem tem shiny é o ciano de gelo, com o mesmo halo que a prancha
   desenha. Não é um degrau da escada: shiny é tratamento, e por isso ele pinta
   por cima do que a raridade já decidiu. */
.binder-card--shiny :deep(.poke-card) {
  border-color: var(--shiny);
  box-shadow: 0 0 26px -12px var(--shiny);
}

.binder-card__count {
  position: absolute;
  top: 7px;
  right: 8px;
  font-size: 9px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 2px;
  background: var(--bg);
  border: 1px solid var(--rarity);
  color: var(--rarity-label);
}

.binder-card__rarity {
  font-size: 9px;
  margin-top: 4px;
  color: var(--rarity-label);
}

.binder-card__scrap {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 3px 0;
  font-size: 9px;
  text-align: left;
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
