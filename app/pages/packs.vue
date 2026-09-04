<script setup lang="ts">
import { computed, ref } from 'vue'
import { WELCOME_PACKS } from '~~/shared/game/economy'
import {
  COMMON_SLOTS,
  PACK_SIZE,
  PITY_THRESHOLD,
  RARE_PLUS_SLOTS,
  UNCOMMON_SLOTS,
  buildPool,
  openPack,
} from '~~/shared/game/packs'
import type { SearchEntry } from '~~/shared/types/dex'
import type { PackCard } from '~~/shared/types/game'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { useDex } from '~/composables/useDex'

/**
 * Abrir pack — a prancha *Abertura de pack*.
 *
 * A Fase 5 traz só a **abertura**; a loja é da Fase 6, junto com moedas e pack
 * diário. O que abre esta tela hoje são os três packs de boas-vindas, que
 * chegaram uma fase antes por necessidade: sem nenhuma fonte de carta o binder
 * nasceria vazio e a fase inteira ficaria sem como ser exercitada.
 */
const { loadIndex } = useDex()
const collection = useCollectionStore()
const progress = useProgressStore()

const { data: index } = await useAsyncData('packs-index', () => loadIndex())

/**
 * Os seis baldes, montados uma vez — não uma vez por abertura.
 *
 * `?? null` e não `!`: `useAsyncData` tipa o dado como possivelmente ausente, e
 * a asserção transformaria um índice que não carregou em `buildPool(undefined)`
 * — um erro de runtime no lugar de um botão desabilitado.
 */
const pool = computed(() => {
  const entries = index.value ?? null
  return entries === null ? null : buildPool(entries)
})

const entryById = computed(() => {
  const map = new Map<number, SearchEntry>()
  for (const entry of index.value ?? []) map.set(entry.id, entry)
  return map
})

const opened = ref<readonly PackCard[]>([])
const revealed = ref(0)
const skipped = ref(false)

/**
 * `reduced-motion` e o botão de pular chegam ao mesmo lugar: as dez de uma vez.
 * Sem animação não há `animationend`, então o contador precisa saber disso — do
 * contrário ele ficaria em `0 / 10` com as dez cartas na tela.
 */
function revealAll(): void {
  revealed.value = opened.value.length
}

function prefersReducedMotion(): boolean {
  return import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
const welcomeNumber = ref<number | null>(null)
const forcedByPity = ref(false)

const openedEntries = computed(() =>
  opened.value.map(card => entryById.value.get(card.speciesId) ?? null))

const canOpen = computed(() => pool.value !== null && progress.hasWelcomePack)

/**
 * Abre um pack e credita **antes** de qualquer outra coisa.
 *
 * A ordem é a regra de escrita do plano — creditar as cartas primeiro, debitar
 * depois —, e aqui o que se "debita" é o contador de boas-vindas. Uma falha no
 * meio dá um pack a mais, que é o erro que o jogador perdoa.
 *
 * A seed é o relógio. Ela não precisa ser imprevisível: o save guarda o
 * resultado, não a seed, e um jogador que quisesse trapacear já tem o DevTools —
 * o plano decidiu isso por escrito ao recusar checksum e ofuscação.
 */
function open(): void {
  const buckets = pool.value
  if (buckets === null || !progress.hasWelcomePack) return

  const result = openPack({ seed: Date.now(), pity: progress.pity, pool: buckets })

  collection.credit(result.cards)
  const claimed = progress.claimWelcome()
  progress.setPity(result.pity)

  opened.value = result.cards
  forcedByPity.value = result.forcedByPity
  welcomeNumber.value = claimed
  skipped.value = false
  revealed.value = prefersReducedMotion() ? result.cards.length : 0
}

function skip(): void {
  skipped.value = true
  revealAll()
}

useSeoMeta({
  title: 'Abrir pack — Holo Deck',
  description: 'Dez cartas: seis comuns, três incomuns e uma rara ou acima. Shiny a 1 em 256, e um ultra garantido a cada dez packs secos.',
})
</script>

<template>
  <main class="packs">
    <header class="packs__header">
      <div>
        <div class="flex items-center gap-2.5">
          <p class="numeric text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Sequência de abertura
          </p>
          <ClientOnly>
            <span
              v-if="progress.hasWelcomePack || welcomeNumber !== null"
              class="numeric packs__badge"
            >
              Boas-vindas · {{ welcomeNumber ?? progress.welcomeClaimed + 1 }} de {{ WELCOME_PACKS }}
            </span>
          </ClientOnly>
        </div>
        <h1 class="mt-2 text-4xl font-bold tracking-tight text-highlighted">
          Abrir pack
        </h1>
      </div>

      <!-- As taxas ficam no cabeçalho porque é aqui que a decisão acontece. É a
           decisão do plano de ensinar no ponto de decisão em vez de num
           tutorial, e os números saem de `shared/game/packs.ts`. -->
      <p class="numeric packs__odds">
        {{ PACK_SIZE }} cartas · {{ COMMON_SLOTS }} comuns, {{ UNCOMMON_SLOTS }} incomuns,
        {{ RARE_PLUS_SLOTS }} raro+<br>
        <ClientOnly>
          <span class="packs__pity">
            pity: {{ PITY_THRESHOLD }} packs sem ultra garante um ultra —
            faltam {{ progress.untilPity }}
          </span>
          <template #fallback>
            <span class="packs__pity">
              pity: {{ PITY_THRESHOLD }} packs sem ultra garante um ultra
            </span>
          </template>
        </ClientOnly>
      </p>
    </header>

    <ClientOnly>
      <!-- Selado: o baralho esperando. -->
      <section
        v-if="opened.length === 0"
        class="packs__sealed"
      >
        <button
          type="button"
          class="packs__deck"
          :disabled="!canOpen"
          @click="open()"
        >
          <span
            class="packs__deck-mark"
            aria-hidden="true"
          />
          <span class="numeric packs__deck-label">HOLO/DECK</span>
        </button>

        <p
          v-if="canOpen"
          class="numeric packs__hint"
        >
          {{ progress.welcomeRemaining }} pack{{ progress.welcomeRemaining > 1 ? 's' : '' }}
          de boas-vindas esperando.<br>Clique para abrir.
        </p>
        <p
          v-else
          class="numeric packs__hint"
        >
          Os três packs de boas-vindas já foram abertos.<br>
          A loja e o pack diário chegam com a Liga.
        </p>
      </section>

      <!-- Revelado: a tira de dez. -->
      <section
        v-else
        class="packs__revealed"
      >
        <div class="packs__progress">
          <p class="numeric text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            {{ revealed }} / {{ opened.length }} reveladas
          </p>
          <div class="flex items-center gap-3.5">
            <button
              v-if="revealed < opened.length"
              type="button"
              class="numeric packs__skip"
              @click="skip()"
            >
              PULAR ANIMAÇÃO
            </button>
            <NuxtLink
              to="/collection"
              class="numeric packs__skip"
            >
              VER COLEÇÃO
            </NuxtLink>
            <button
              v-if="progress.hasWelcomePack"
              type="button"
              class="numeric packs__skip packs__skip--primary"
              @click="open()"
            >
              ABRIR O PRÓXIMO
            </button>
          </div>
        </div>

        <p
          v-if="forcedByPity"
          class="numeric packs__pity-hit"
        >
          A rede disparou: {{ PITY_THRESHOLD }} packs sem ultra garantiram este.
        </p>

        <PackOpener
          :cards="opened"
          :entries="openedEntries"
          :skipped="skipped"
          @reveal="revealed = $event"
        />
      </section>

      <template #fallback>
        <p class="packs__hint">
          Carregando…
        </p>
      </template>
    </ClientOnly>
  </main>
</template>

<style scoped>
.packs {
  max-width: 1200px;
  margin: 0 auto;
  padding: 38px 36px 44px;
}

.packs__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border);
}

.packs__badge {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 2px;
  background: var(--forge);
  color: var(--bg);
}

.packs__odds {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
  text-align: right;
}

.packs__pity {
  color: var(--text-body);
}

.packs__pity-hit {
  margin: 22px 0 0;
  font-size: 12px;
  color: var(--forge);
}

.packs__sealed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding: 72px 0;
}

/**
 * O baralho selado. O pulso é o convite — e some sob reduced-motion, onde um
 * botão grande e nomeado já convida sozinho.
 */
.packs__deck {
  position: relative;
  width: 158px;
  height: 222px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--forge);
  border-radius: var(--radius);
  cursor: pointer;
  animation: pulse 2.4s ease-in-out infinite;
}

.packs__deck:disabled {
  border-color: var(--border);
  cursor: not-allowed;
  animation: none;
  opacity: 0.55;
}

.packs__deck:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.packs__deck-mark {
  width: 60px;
  height: 60px;
  border: 3px solid var(--forge);
  border-radius: 50%;
}

.packs__deck:disabled .packs__deck-mark {
  border-color: var(--border-strong);
}

.packs__deck-label {
  position: absolute;
  bottom: 14px;
  font-size: 8px;
  letter-spacing: 0.2em;
  color: var(--text-muted);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 46px -12px color-mix(in oklab, var(--forge) 75%, transparent); }
  50% { box-shadow: 0 0 62px -8px color-mix(in oklab, var(--forge) 90%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .packs__deck {
    animation: none;
  }
}

.packs__hint {
  font-size: 12px;
  line-height: 1.65;
  text-align: center;
  color: var(--text-muted);
}

.packs__revealed {
  padding-top: 26px;
}

.packs__progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.packs__skip {
  font-size: 11px;
  padding: 5px 11px;
  color: var(--text-body);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-decoration: none;
  cursor: pointer;
}

.packs__skip--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.packs__skip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
