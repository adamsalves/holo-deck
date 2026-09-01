<script setup lang="ts">
import { toRegions } from '~/composables/useRegions'
import { useDex } from '~/composables/useDex'

/**
 * O índice da Pokédex — as 9 gerações como cartas de região.
 *
 * Esta tela não tem prancha. As 17 do canvas desenham a Pokédex já **dentro** de
 * uma região, e o cabeçalho delas é a referência que este índice segue: o
 * sobretítulo `GERAÇÃO I`, o nome da região em display grande e a contagem
 * embaixo. O que a prancha põe ao lado da contagem — `98 / 151 capturados`, em
 * verde de progresso — é coleção, e coleção é Fase 5: aqui a linha diz a faixa
 * do dex, que é o que já é verdade.
 */
const { loadCore } = useDex()

/**
 * `transform` não é otimização de gosto — é o que impede os 54 KB de `core.json`
 * de viajarem no payload de SSR.
 *
 * `useAsyncData` serializa o que devolve, e esta página lê nove metadados de um
 * arquivo que carrega 368 golpes junto. Sem o corte, o HTML sairia com o
 * catálogo inteiro embutido, que é exatamente o que `useDex()` evita ao manter o
 * cache fora do `useState`.
 */
const { data: regions } = await useAsyncData(
  'pokedex-regions',
  () => loadCore(),
  { transform: core => toRegions(core.generations) },
)

useSeoMeta({
  title: 'Pokédex — Holo Deck',
  description: 'As 1025 espécies das nove gerações, com stats, evolução e relações de dano. Dados da PokeAPI.',
})
</script>

<template>
  <main class="mx-auto w-full max-w-6xl px-6 py-12">
    <header class="mb-10">
      <p class="numeric text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
        Referência completa
      </p>
      <h1 class="mt-2 text-5xl font-bold tracking-tight text-highlighted">
        Pokédex
      </h1>
      <p class="mt-3 max-w-xl text-sm text-toned">
        As 1025 espécies, possuídas ou não. Escolha uma região.
      </p>
    </header>

    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="region in regions ?? []"
        :key="region.generation"
      >
        <NuxtLink
          :to="`/pokedex/${region.generation}`"
          class="region-card bevel-tile"
        >
          <span class="numeric region-card__generation">{{ region.generationLabel }}</span>
          <span class="region-card__name">{{ region.label }}</span>
          <span class="numeric region-card__range">
            {{ region.speciesCount }} espécies
            <span
              class="region-card__separator"
              aria-hidden="true"
            >·</span>
            {{ dexRange(region.firstId, region.lastId) }}
          </span>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.region-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: inherit;
  text-decoration: none;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}

.region-card:hover,
.region-card:focus-visible {
  background: var(--surface-raised);
  border-color: var(--border-strong);
}

.region-card__generation {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.region-card__name {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text);
}

.region-card__range {
  font-size: 12px;
  color: var(--text-muted);
}

.region-card__separator {
  padding: 0 4px;
  color: var(--text-faint);
}

@media (prefers-reduced-motion: reduce) {
  .region-card {
    transition: none;
  }
}
</style>
