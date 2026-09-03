<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Region } from '~~/shared/dex/regions'
import { dexRange, toRegions } from '~~/shared/dex/regions'
import { progressLabel } from '~~/shared/game/progress'
import { isSpeciesId } from '~~/shared/types/brand'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDex } from '~/composables/useDex'

/**
 * O índice da Pokédex — as 9 gerações como cartas de região.
 *
 * Esta tela foi implementada na Fase 3 **sem prancha**: as 17 do canvas de então
 * desenhavam a Pokédex já **dentro** de uma região, e o cabeçalho delas foi a
 * referência que este índice seguiu — o sobretítulo `GERAÇÃO I`, o nome da
 * região em display grande e a contagem embaixo. A varredura de 02/09 fechou a
 * lacuna: o canvas ganhou a 18ª prancha, *Pokédex — as 9 regiões*, desenhada a
 * partir deste componente e com as faixas de dex tiradas do `core.json`.
 *
 * `98 / 151 capturados` e a barra de progresso chegaram na Fase 5, que é a que
 * criou a coleção. Antes disso a linha dizia só a faixa do dex, porque era o que
 * já era verdade.
 */
const { loadCore } = useDex()
const collection = useCollectionStore()

/**
 * A coleção mora em `localStorage`, logo não existe no servidor. Antes de montar
 * a contagem é `null` e a linha volta a dizer só a faixa — escrever `0 / 151`
 * afirmaria uma coleção vazia que ninguém verificou, e mudaria de número na
 * hidratação.
 */
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

function ownedIn(region: Region): number | null {
  if (!mounted.value) return null

  let owned = 0
  for (let id = region.firstId; id <= region.lastId; id += 1) {
    if (isSpeciesId(id) && collection.has(id)) owned += 1
  }
  return owned
}

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
    <header class="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div>
        <p class="numeric text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
          Referência completa
        </p>
        <h1 class="mt-2 text-5xl font-bold tracking-tight text-highlighted">
          Pokédex
        </h1>
        <p class="mt-3 max-w-xl text-sm text-toned">
          As 1025 espécies, possuídas ou não. Escolha uma região ou busque direto.
        </p>
      </div>

      <DexSearch />
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
            <template v-if="ownedIn(region) !== null">
              <span class="region-card__owned">{{ ownedIn(region) }}</span>
              / {{ region.speciesCount }} capturados
            </template>
            <template v-else>
              {{ region.speciesCount }} espécies
            </template>
            <span
              class="region-card__separator"
              aria-hidden="true"
            >·</span>
            {{ dexRange(region.firstId, region.lastId) }}
          </span>

          <CollectionProgressBar
            v-if="ownedIn(region) !== null"
            :owned="ownedIn(region) ?? 0"
            :total="region.speciesCount"
            :label="`Progresso em ${region.label}: ${progressLabel(ownedIn(region) ?? 0, region.speciesCount)}`"
            class="mt-1"
          />
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

/* O numerador em verde, como no cabeçalho da região: o número que se move é o
   que se destaca. */
.region-card__owned {
  color: var(--progress-high);
  font-weight: 800;
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
