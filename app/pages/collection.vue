<script setup lang="ts">
import { computed, ref } from 'vue'
import { dustFor, dustMissing, forgeCost } from '~~/shared/game/dust'
import { gameNumber, progressLabel } from '~~/shared/game/progress'
import { rarityFrom } from '~~/shared/game/rarity'
import type { SearchEntry } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { RARITY_LABELS, RARITY_NAMES } from '~~/shared/types/game'
import { useCollectionStore } from '~~/app/stores/collection'
import { useCollection } from '~/composables/useCollection'

/**
 * O binder — a prancha *Coleção e forja*.
 *
 * Duas colunas, como o canvas: a coleção à esquerda, o pó e a forja à direita. A
 * da direita é `380px` fixos porque a tabela de forja tem largura de conteúdo, e
 * deixá-la fluida faria a coluna que **não** cresce ser a que mais varia.
 *
 * **Tudo que depende da coleção é `<ClientOnly>`.** A rota é pré-renderizada e o
 * save mora em `localStorage`: no servidor a coleção está sempre vazia, então
 * qualquer contagem no HTML seria um número que muda na hidratação. O dex, esse
 * sim, é carregado no servidor — é arquivo estático e não depende de jogador.
 */
const store = useCollectionStore()
const collection = await useCollection()

type Filter = 'owned' | 'duplicates' | 'shiny'

const filter = ref<Filter>('owned')
const rarityFilter = ref<Rarity | null>(null)

/** As linhas do índice que o jogador possui, na ordem do dex nacional. */
const ownedEntries = computed(() =>
  collection.entries.value.filter(entry => store.has(entry.id)))

const duplicateCount = computed(() =>
  ownedEntries.value.reduce((total, entry) => total + store.duplicates(entry.id), 0))

const visible = computed(() => ownedEntries.value.filter((entry) => {
  if (rarityFilter.value !== null && rarityFrom(entry) !== rarityFilter.value) return false
  if (filter.value === 'duplicates') return store.duplicates(entry.id) > 0
  if (filter.value === 'shiny') return store.shinies(entry.id) > 0
  return true
}))

/**
 * O alvo da forja.
 *
 * Ele é escolhido por busca, e não clicando no grid, por uma razão que a prancha
 * torna óbvia depois de vista: o exemplo dela é **Mew**, e o grid do binder só
 * mostra o que já se tem. Forjar existe justamente para a carta que falta.
 */
const query = ref('')

const suggestions = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (term.length < 2) return []

  return collection.entries.value
    .filter(entry => entry.displayName.toLowerCase().includes(term))
    .slice(0, 6)
})

const target = ref<SearchEntry | null>(null)
const targetRarity = computed(() => (target.value === null ? null : rarityFrom(target.value)))

const targetCost = computed(() =>
  (targetRarity.value === null ? 0 : forgeCost(targetRarity.value)))

/**
 * O déficit vem de `dustMissing`, e não de uma subtração escrita aqui.
 *
 * É a razão de aquela função devolver o número em vez de um booleano: o botão
 * desabilitado escreve `FALTAM 1.260 PÓ`, e uma tela que refaz a conta é uma
 * segunda conta esperando para divergir da primeira.
 */
const missing = computed(() =>
  (targetRarity.value === null ? 0 : dustMissing(store.dust, targetRarity.value)))

function choose(entry: SearchEntry): void {
  target.value = entry
  query.value = ''
}

function forgeTarget(): void {
  const entry = target.value
  const rarity = targetRarity.value
  if (entry === null || rarity === null) return
  store.forge(entry.id, rarity)
}

useSeoMeta({
  title: 'Coleção — Holo Deck',
  description: 'Seu binder: cartas capturadas por região e por raridade, duplicatas em pó e a forja que fecha a cauda longa das 1025.',
})
</script>

<template>
  <main class="collection">
    <div class="collection__main">
      <ClientOnly>
        <header class="mb-7 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p class="numeric text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
              Sua coleção
            </p>
            <div class="mt-2 flex items-baseline gap-3">
              <h1 class="text-4xl font-bold tracking-tight text-highlighted">
                Binder
              </h1>
              <span class="numeric text-[15px] text-muted">
                {{ progressLabel(store.ownedCount, collection.total.value) }}
              </span>
            </div>
          </div>

          <!-- As cinco somas do cabeçalho da prancha. `shiny` é a única que
               conta exemplar e não espécie: um shiny é um tratamento de carta,
               e duas espécies distintas com shiny são dois shinies. -->
          <dl class="flex gap-5">
            <div
              v-for="tier in (['common', 'uncommon', 'rare', 'ultra'] as const)"
              :key="tier"
              class="text-right"
              :data-rarity="tier"
            >
              <dd
                class="numeric text-[19px] font-extrabold"
                style="color: var(--rarity-label)"
              >
                {{ collection.ownedByRarity.value[tier] }}
              </dd>
              <dt class="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
                {{ RARITY_LABELS[tier] }}
              </dt>
            </div>
            <div class="text-right">
              <dd class="numeric text-[19px] font-extrabold collection__shiny">
                {{ store.shinyCount }}
              </dd>
              <dt class="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
                Shiny
              </dt>
            </div>
          </dl>
        </header>

        <!-- Progresso por região: as nove barras da prancha. -->
        <ul class="collection__regions">
          <li
            v-for="region in collection.byRegion.value"
            :key="region.generation"
          >
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <span
                class="text-xs font-semibold"
                :class="region.owned === 0 ? 'text-muted' : 'text-highlighted'"
              >{{ region.label }}</span>
              <span class="numeric text-[9px] text-muted">
                {{ progressLabel(region.owned, region.speciesCount) }}
              </span>
            </div>
            <CollectionProgressBar
              :owned="region.owned"
              :total="region.speciesCount"
              :label="`Progresso em ${region.label}`"
            />
          </li>
        </ul>

        <div class="collection__filters">
          <button
            v-for="option in ([
              { key: 'owned', label: 'Possuídas', count: store.ownedCount },
              { key: 'duplicates', label: 'Duplicadas', count: duplicateCount },
              { key: 'shiny', label: 'Shiny', count: store.shinyCount },
            ] as const)"
            :key="option.key"
            type="button"
            class="numeric collection__chip"
            :aria-pressed="filter === option.key"
            @click="filter = option.key"
          >
            {{ option.label }} · {{ option.count }}
          </button>

          <span class="collection__divider" />

          <!-- Os seis saem de `RARITY_NAMES`, que é onde a escada mora: uma
               lista escrita aqui é a que fica para trás no dia em que um degrau
               entrar. -->
          <button
            v-for="tier in RARITY_NAMES"
            :key="tier"
            type="button"
            class="numeric collection__chip"
            :data-rarity="tier"
            :aria-pressed="rarityFilter === tier"
            @click="rarityFilter = rarityFilter === tier ? null : tier"
          >
            {{ RARITY_LABELS[tier] }}
          </button>
        </div>

        <p
          v-if="store.ownedCount === 0"
          class="collection__empty"
        >
          Nenhuma carta ainda. Os três packs de boas-vindas estão esperando em
          <NuxtLink
            to="/packs"
            class="collection__link"
          >
            abrir pack
          </NuxtLink>.
        </p>

        <p
          v-else-if="visible.length === 0"
          class="collection__empty"
        >
          Nenhuma carta da sua coleção combina com esses filtros.
        </p>

        <ul
          v-else
          class="collection__grid"
        >
          <li
            v-for="entry in visible"
            :key="entry.id"
          >
            <CollectionCard
              :entry="entry"
              :copies="store.copies(entry.id)"
              :shinies="store.shinies(entry.id)"
              :duplicates="store.duplicates(entry.id)"
              @scrap="store.scrapDuplicates(entry.id, rarityFrom(entry))"
            />
          </li>
        </ul>

        <template #fallback>
          <p class="collection__empty">
            Carregando sua coleção…
          </p>
        </template>
      </ClientOnly>
    </div>

    <aside class="collection__forge">
      <ClientOnly>
        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
          Pó
        </p>
        <p class="mt-3 flex items-baseline gap-2">
          <span class="numeric text-[38px] font-extrabold leading-none text-highlighted">
            {{ gameNumber(store.dust) }}
          </span>
          <span class="numeric text-xs text-muted">acumulado</span>
        </p>
        <p class="numeric mt-2 text-[11px] leading-relaxed text-toned">
          Duplicata vira pó. Pó compra a carta que você escolher — é o que fecha a
          cauda longa das 1025.
        </p>

        <section class="collection__panel">
          <p class="collection__panel-title">
            Forjar
          </p>

          <label
            class="sr-only"
            for="forge-search"
          >Buscar espécie para forjar</label>
          <input
            id="forge-search"
            v-model="query"
            type="search"
            class="collection__search"
            placeholder="Buscar espécie…"
            autocomplete="off"
          >

          <ul
            v-if="suggestions.length > 0"
            class="collection__suggestions"
          >
            <li
              v-for="entry in suggestions"
              :key="entry.id"
            >
              <button
                type="button"
                class="collection__suggestion"
                @click="choose(entry)"
              >
                <span>{{ entry.displayName }}</span>
                <span
                  class="numeric text-[9px] font-extrabold"
                  :data-rarity="rarityFrom(entry)"
                  style="color: var(--rarity-label)"
                >{{ RARITY_LABELS[rarityFrom(entry)].toUpperCase() }}</span>
              </button>
            </li>
          </ul>

          <div
            v-if="target !== null && targetRarity !== null"
            class="collection__target"
          >
            <img
              :src="`/sprites/${target.id}.webp`"
              alt=""
              width="44"
              height="44"
              loading="lazy"
              decoding="async"
            >
            <div>
              <p class="text-[15px] font-bold leading-none text-highlighted">
                {{ target.displayName }}
              </p>
              <p
                class="numeric mt-1.5 text-[10px] font-extrabold"
                :data-rarity="targetRarity"
                style="color: var(--rarity-label)"
              >
                {{ RARITY_LABELS[targetRarity].toUpperCase() }}
              </p>
              <p class="numeric mt-1.5 text-[11px] text-muted">
                custa <strong class="collection__cost">{{ gameNumber(targetCost) }}</strong> pó
              </p>
            </div>
          </div>

          <button
            v-if="target !== null"
            type="button"
            class="collection__forge-button"
            :disabled="missing > 0"
            @click="forgeTarget()"
          >
            {{ missing > 0 ? `FALTAM ${gameNumber(missing)} PÓ` : 'FORJAR' }}
          </button>
        </section>

        <template #fallback>
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Pó
          </p>
        </template>
      </ClientOnly>

      <!-- A tabela não depende de coleção: é constante do jogo, lida de
           `shared/game/dust.ts`. Fica fora do `ClientOnly` porque é exatamente o
           tipo de conteúdo que vale estar no HTML servido. -->
      <p class="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
        Tabela
      </p>
      <table class="collection__table">
        <thead>
          <tr>
            <th
              class="numeric"
              scope="col"
            >
              Tier
            </th>
            <th
              class="numeric"
              scope="col"
            >
              Pó
            </th>
            <th
              class="numeric"
              scope="col"
            >
              Forja
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tier in (['common', 'uncommon', 'rare', 'ultra', 'legendary'] as const)"
            :key="tier"
            :data-rarity="tier"
          >
            <th
              scope="row"
              style="color: var(--rarity-label)"
            >
              {{ tier === 'legendary' ? 'Lend. / mít.' : RARITY_LABELS[tier] }}
            </th>
            <td class="numeric">
              {{ gameNumber(dustFor(tier)) }}
            </td>
            <td class="numeric">
              {{ gameNumber(forgeCost(tier)) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="numeric mt-3 text-[11px] leading-relaxed text-toned">
        Razão 4× em toda a escala: quatro duplicatas de um tier pagam uma carta
        escolhida daquele tier.
      </p>
    </aside>
  </main>
</template>

<style scoped>
.collection {
  display: grid;
  gap: 0;
  grid-template-columns: 1fr;
}

@media (min-width: 1024px) {
  .collection {
    grid-template-columns: 1fr 380px;
  }
}

.collection__main {
  padding: 38px 36px 44px;
  min-width: 0;
}

.collection__forge {
  padding: 38px 26px 44px;
  background: var(--surface-sunken);
  border-top: 1px solid var(--border);
}

@media (min-width: 1024px) {
  .collection__forge {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
}

.collection__regions {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 26px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}

@media (min-width: 900px) {
  .collection__regions {
    grid-template-columns: repeat(9, minmax(0, 1fr));
  }
}

.collection__shiny {
  /* Shiny não é um degrau da escada de raridade — é tratamento —, e a prancha o
     escreve no ciano de gelo. Reusar o token de tipo em vez de um hex novo é a
     mesma decisão que fez `--rarity-common` apontar para um degrau de `ink`. */
  color: var(--shiny);
}

.collection__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.collection__chip {
  font-size: 11px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-body);
  background: transparent;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}

.collection__chip[data-rarity][aria-pressed="true"] {
  border-color: var(--rarity);
  color: var(--rarity-label);
}

.collection__chip[aria-pressed="true"]:not([data-rarity]) {
  border-color: var(--accent);
  color: var(--accent);
}

.collection__chip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.collection__divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 5px;
}

.collection__grid {
  display: grid;
  gap: 11px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}

/**
 * O binder não virtualiza, e isto é o que faz as 1025 caberem mesmo assim.
 *
 * `content-visibility: auto` manda o navegador pular estilo, layout e pintura de
 * cada carta fora da janela. Não é virtualização — os nós continuam no DOM, e é
 * de propósito: virtualizar aqui exigiria fileira de **altura uniforme**, e a
 * carta do binder não tem uma. A linha `2 dup · 10 pó` só aparece quando há
 * duplicata, então uma fileira com repetida é ~22px mais alta que uma sem, e um
 * `estimateSize` único posicionaria as fileiras erradas depois da primeira
 * divergência. Uniformizar a altura é decisão de canvas, não de implementação.
 *
 * `contain-intrinsic-size` é a altura que o navegador assume enquanto a carta
 * está pulada — sem ela a barra de rolagem salta a cada pedaço que entra na
 * janela. O valor é a carta na largura mínima (140 × 7/5) mais a linha de
 * duplicata: errar para mais é preferível, porque a correção encolhe a página em
 * vez de esticá-la sob o cursor.
 */
.collection__grid > li {
  content-visibility: auto;
  contain-intrinsic-size: auto 218px;
}

.collection__empty {
  padding: 48px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.collection__link {
  color: var(--accent);
}

.collection__panel {
  margin-top: 22px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.collection__panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--forge);
  margin-bottom: 14px;
}

.collection__search {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.collection__search:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.collection__suggestions {
  margin-top: 8px;
  display: grid;
  gap: 1px;
}

.collection__suggestion {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  font-size: 12px;
  color: var(--text-body);
  background: var(--bg);
  border: 0;
  cursor: pointer;
}

.collection__suggestion:hover,
.collection__suggestion:focus-visible {
  color: var(--text);
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.collection__target {
  display: flex;
  align-items: center;
  gap: 13px;
  margin: 16px 0;
}

.collection__cost {
  color: var(--deficit);
  font-weight: 800;
}

.collection__forge-button {
  width: 100%;
  padding: 11px;
  font-size: 13px;
  font-weight: 700;
  color: var(--bg);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  cursor: pointer;
}

.collection__forge-button:disabled {
  color: var(--text-muted);
  background: var(--surface-raised);
  border-color: var(--border);
  cursor: not-allowed;
}

.collection__forge-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.collection__table {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.collection__table th,
.collection__table td {
  padding: 10px 14px;
  font-size: 12px;
  text-align: right;
  background: var(--surface-raised);
}

.collection__table thead th {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--surface);
}

.collection__table th:first-child,
.collection__table tbody th {
  text-align: left;
  font-weight: 600;
}
</style>
