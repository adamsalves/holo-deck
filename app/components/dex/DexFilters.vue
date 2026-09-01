<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { computed } from 'vue'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { RARITY_LABELS, RARITY_NAMES } from '~~/shared/types/game'

/**
 * A linha de filtros da prancha *Pokédex*.
 *
 * Ela desenha três grupos: posse (*Todos · 151*, *Possuídos · 98*, *Faltando ·
 * 53*), tipo e raridade. **O primeiro não está aqui**, e não por esquecimento:
 * posse é coleção, e coleção é Fase 5. Um filtro *Possuídos* que devolve zero
 * sempre não é um filtro incompleto, é um filtro mentiroso.
 *
 * Os outros dois saem do dex — tipo vem da espécie, raridade sai de BST e das
 * marcas — e por isso chegam agora.
 *
 * A prancha mostra 6 tipos e um `+12 tipos`. Aqui aparecem os 18, quebrando
 * linha: a truncagem economiza altura e cobra um clique para um filtro cujo
 * valor inteiro é ser imediato, e a chip de tipo é a coisa mais barata da tela.
 */
const types = defineModel<readonly TypeName[]>('types', { required: true })
const rarities = defineModel<readonly Rarity[]>('rarities', { required: true })

const props = defineProps<{
  total: number
  shown: number
}>()

const active = computed(() => types.value.length > 0 || rarities.value.length > 0)

function toggleType(type: TypeName) {
  types.value = types.value.includes(type)
    ? types.value.filter(current => current !== type)
    : [...types.value, type]
}

function toggleRarity(rarity: Rarity) {
  rarities.value = rarities.value.includes(rarity)
    ? rarities.value.filter(current => current !== rarity)
    : [...rarities.value, rarity]
}

function clear() {
  types.value = []
  rarities.value = []
}
</script>

<template>
  <div class="filters">
    <!-- A contagem é o retorno do filtro: sem ela, uma combinação que não casa
         com nada fica indistinguível de um grid que não carregou. -->
    <button
      type="button"
      class="filters__chip filters__chip--all"
      :class="{ 'filters__chip--on': !active }"
      :aria-pressed="!active"
      @click="clear"
    >
      Todos · <span class="numeric">{{ active ? `${props.shown} de ${props.total}` : props.total }}</span>
    </button>

    <span
      class="filters__divider"
      aria-hidden="true"
    />

    <button
      v-for="type in TYPE_NAMES"
      :key="type"
      type="button"
      class="filters__type"
      :class="{ 'filters__type--off': types.length > 0 && !types.includes(type) }"
      :aria-pressed="types.includes(type)"
      @click="toggleType(type)"
    >
      <DexTypeBadge :type="type" />
    </button>

    <span
      class="filters__divider"
      aria-hidden="true"
    />

    <button
      v-for="rarity in RARITY_NAMES"
      :key="rarity"
      type="button"
      class="filters__chip"
      :class="{ 'filters__chip--on': rarities.includes(rarity) }"
      :data-rarity="rarity"
      :aria-pressed="rarities.includes(rarity)"
      @click="toggleRarity(rarity)"
    >
      {{ RARITY_LABELS[rarity] }}
    </button>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.filters__divider {
  width: 1px;
  height: 20px;
  margin: 0 5px;
  background: var(--border);
}

.filters__chip {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
}

.filters__chip:hover {
  border-color: var(--border-strong);
  color: var(--text-body);
}

/* Ligado: a moldura assume a cor da raridade, que é o mesmo vocabulário da
   carta. `--rarity-label` e não `--rarity` no texto porque a de `common` não
   sustenta texto — a mesma razão do rótulo na carta. */
.filters__chip--on {
  border-color: var(--rarity, var(--accent));
  color: var(--rarity-label, var(--accent));
  background: color-mix(in oklab, var(--rarity, var(--accent)) 10%, var(--surface));
}

/* A chip *Todos* não tem raridade: ela é o estado limpo, e o acento a marca. */
.filters__chip--all.filters__chip--on {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 10%, var(--surface));
}

.filters__type {
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  line-height: 0;
}

/* Apagado, não escondido: some do resultado sem sumir da lista, para o jogador
   ver o que ainda pode ligar. */
.filters__type--off {
  opacity: 0.32;
}

.filters__type:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
