<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { computed, ref } from 'vue'
import { rarityOf } from '~~/shared/game/rarity'
import { GENERATION_COUNT } from '~~/shared/types/dex'
import { toRegions } from '~/composables/useRegions'
import { useDex } from '~/composables/useDex'

/**
 * O grid de uma geração — a prancha *Pokédex*.
 *
 * A tela mostra **todas** as espécies da região, possuídas ou não: a Pokédex é
 * referência, não coleção. O que a prancha desenha e não está aqui é tudo que
 * depende de coleção — a contagem `98 / 151 capturados`, o anel de não possuída,
 * o marcador de shiny e os filtros *Possuídos* e *Faltando*. Eles chegam com a
 * Fase 5, que é quem cria o dado; inventar um zero agora seria desenhar um
 * progresso que ninguém pode mover.
 */
const route = useRoute()
const { loadGeneration, loadCore } = useDex()

/**
 * A geração vem da URL, então é texto até prova em contrário.
 *
 * `Number('1abc')` é `NaN` e `Number('')` é `0` — os dois passariam por um
 * `> 0 && <= 9` mal escrito. O `Number.isInteger` recusa os dois, e a faixa vem
 * de `GENERATION_COUNT`, que é o mesmo 9 dos ginásios.
 */
const generation = computed(() => {
  const raw = Number(route.params.gen)
  return Number.isInteger(raw) && raw >= 1 && raw <= GENERATION_COUNT ? raw : null
})

if (generation.value === null) {
  throw createError({ statusCode: 404, statusMessage: 'Geração fora do dex', fatal: true })
}

const { data, error } = await useAsyncData(
  () => `pokedex-gen-${generation.value ?? 0}`,
  async () => {
    const target = generation.value
    if (target === null) throw createError({ statusCode: 404, statusMessage: 'Geração fora do dex', fatal: true })

    const [core, dexGeneration] = await Promise.all([loadCore(), loadGeneration(target)])
    const region = toRegions(core.generations).find(candidate => candidate.generation === target) ?? null

    return { region, species: dexGeneration.species }
  },
  { watch: [generation] },
)

// `useAsyncData` captura o erro em vez de deixá-lo subir; sem este relance, um
// `gen-N.json` que não carrega vira uma página 200 com o cabeçalho vazio.
if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage ?? 'Não foi possível carregar a geração',
    fatal: true,
  })
}

const region = computed(() => data.value?.region ?? null)
const species = computed(() => data.value?.species ?? [])

/**
 * O filtro é estado local, e não da URL.
 *
 * Uma URL filtrada seria compartilhável, mas ela também é uma segunda forma de
 * endereçar a mesma tela — e o que esta fase pré-renderiza é uma página por
 * região. Enquanto o filtro não tiver um consumidor que precise dele por link,
 * o estado local é o que não cria URL sem página.
 */
const selectedTypes = ref<readonly TypeName[]>([])
const selectedRarities = ref<readonly Rarity[]>([])

/**
 * Tipo é OU dentro do grupo (planta *ou* fogo), e o mesmo vale para raridade;
 * entre os dois grupos é E. É a leitura que a linha de chips sugere: ligar mais
 * chips do mesmo grupo amplia, ligar de grupos diferentes restringe.
 */
const filtered = computed(() => species.value.filter((entry) => {
  const byType = selectedTypes.value.length === 0
    || entry.types.some(type => selectedTypes.value.includes(type))

  const byRarity = selectedRarities.value.length === 0
    || selectedRarities.value.includes(rarityOf(entry))

  return byType && byRarity
}))

useSeoMeta({
  title: () => `${region.value?.label ?? 'Pokédex'} — Pokédex — Holo Deck`,
  description: () => region.value === null
    ? 'Pokédex do Holo Deck.'
    : `As ${region.value.speciesCount} espécies de ${region.value.label}, da ${region.value.generationLabel}, com tipos, stats e evolução.`,
})
</script>

<template>
  <main>
    <!-- Cabeçalho da região. O `data-type` não está aqui de propósito: a prancha
         tinge este bloco com o verde de progresso da coleção, que é papel da
         Fase 5. Sem coleção, a tinta não teria o que significar. -->
    <header class="region-header">
      <div class="mx-auto w-full max-w-6xl px-6 py-9">
        <nav
          class="mb-5 text-xs"
          aria-label="Trilha"
        >
          <NuxtLink
            to="/pokedex"
            class="region-header__back"
          >
            Pokédex
          </NuxtLink>
        </nav>

        <div class="region-header__row">
          <div>
            <p class="numeric region-header__generation">
              {{ region?.generationLabel }}
            </p>
            <h1 class="region-header__name">
              {{ region?.label }}
            </h1>
            <p class="numeric region-header__meta">
              {{ region?.speciesCount }} espécies
              <span
                class="region-header__separator"
                aria-hidden="true"
              >·</span>
              {{ region === null ? '' : dexRange(region.firstId, region.lastId) }}
            </p>
          </div>

          <DexSearch />
        </div>

        <DexFilters
          v-model:types="selectedTypes"
          v-model:rarities="selectedRarities"
          :total="species.length"
          :shown="filtered.length"
          class="mt-6"
        />
      </div>
    </header>

    <div class="mx-auto w-full max-w-6xl px-6 pb-16 pt-6">
      <!--
        O servidor renderiza o grid inteiro e o cliente monta a versão
        virtualizada por cima. O fallback do `ClientOnly` não é hidratado, então
        não há 151 cartas a reconciliar contra 18 — e o HTML pré-renderizado sai
        com um link para cada uma das páginas de detalhe, que é onde o SEO mora.
      -->
      <ClientOnly>
        <DexGrid
          :species="filtered"
          virtualize
        />
        <template #fallback>
          <!-- O servidor renderiza a lista **inteira**, não a filtrada: o
               filtro é estado do cliente, e o HTML pré-renderizado é o que
               carrega os 151 links das páginas de detalhe. -->
          <DexGrid :species="species" />
        </template>
      </ClientOnly>

      <p
        v-if="filtered.length === 0"
        class="grid-empty"
      >
        Nenhuma espécie de {{ region?.label }} combina com esses filtros.
      </p>
    </div>
  </main>
</template>

<style scoped>
.region-header {
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-sunken), var(--bg));
}

.region-header__back {
  color: var(--text-muted);
  text-decoration: none;
}

.region-header__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.region-header__back:hover,
.region-header__back:focus-visible {
  color: var(--accent);
}

.region-header__generation {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.region-header__name {
  margin-top: 8px;
  font-size: 52px;
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: -0.02em;
  color: var(--text);
}

.region-header__meta {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-muted);
}

.grid-empty {
  padding: 48px 0;
  text-align: center;
  font-size: 14px;
  color: var(--text-muted);
}

.region-header__separator {
  padding: 0 6px;
  color: var(--text-faint);
}
</style>
