<script setup lang="ts">
import { computed } from 'vue'
import { isPityTier } from '~~/shared/game/packs'
import type { SearchEntry } from '~~/shared/types/dex'
import type { PackCard } from '~~/shared/types/game'
import { RARITY_LABELS } from '~~/shared/types/game'

/**
 * A tira de dez, virando carta a carta — a prancha *Abertura de pack*.
 *
 * **Feito em CSS, e não com `motion-v`.** O plano nomeia a biblioteca, e o que
 * ela faria aqui é uma `@keyframes` de `rotateY` com atraso escalonado por
 * índice. Três coisas decidiram a favor do CSS: a cascata é uma propriedade só;
 * o "o foil só acende depois dos 90°" que a prancha anota é literalmente um
 * passo de keyframe a 50%, enquanto em JS seria um segundo temporizador por
 * carta; e `prefers-reduced-motion` desliga a animação por media query, sem o
 * componente precisar saber que a preferência existe. Uma dependência de
 * animação para girar um retângulo é peso que este projeto já recusou em
 * `@nuxt/image` e em Dexie pelo mesmo argumento.
 *
 * O atraso não é uniforme: uma carta ultra+ **segura a fila**, e as seguintes
 * herdam a pausa. É o que a prancha descreve — raios, escala, e 600 ms antes da
 * próxima.
 */
const props = defineProps<{
  cards: readonly PackCard[]
  /** Linha do índice de cada carta, na mesma ordem. Vem da tela, que tem o dex. */
  entries: readonly (SearchEntry | null)[]
  skipped: boolean
}>()

/**
 * Quantas já viraram — o `4 / 10 reveladas` que a prancha estampa no cabeçalho
 * da tira.
 *
 * Contado por `animationend`, e não por temporizador em JS: o temporizador seria
 * uma segunda fonte de verdade sobre a mesma cascata, e as duas divergiriam na
 * primeira aba em segundo plano, onde o navegador estrangula timers mas pausa a
 * animação junto.
 *
 * Sob `reduced-motion` e no modo pulado não há animação, logo não há evento — e
 * é por isso que os dois casos entregam o total de uma vez, em vez de deixar o
 * contador travado em zero enquanto as dez cartas estão à vista.
 */
const emit = defineEmits<{ reveal: [count: number] }>()

let revealed = 0

function onRevealed(): void {
  revealed += 1
  emit('reveal', revealed)
}

const FLIP_MS = 320
const STAGGER_MS = 90
const PITY_PAUSE_MS = 600

/**
 * O atraso de cada carta, acumulado.
 *
 * Calculado uma vez e passado como custom property, em vez de `nth-child`: o
 * incremento depende do que **saiu** — uma ultra no meio empurra as três
 * seguintes —, e isso não cabe num seletor posicional.
 */
const delays = computed(() => {
  let cursor = 0

  return props.cards.map((card) => {
    const at = cursor
    cursor += STAGGER_MS + (isPityTier(card.rarity) ? PITY_PAUSE_MS : 0)
    return at
  })
})

function labelOf(card: PackCard, entry: SearchEntry | null): string {
  const name = entry?.displayName ?? `#${card.speciesId}`
  return card.isShiny
    ? `${name}, ${RARITY_LABELS[card.rarity]}, shiny`
    : `${name}, ${RARITY_LABELS[card.rarity]}`
}
</script>

<template>
  <ul
    class="opener"
    :class="{ 'opener--skipped': skipped }"
  >
    <li
      v-for="(card, index) in cards"
      :key="`${card.speciesId}-${index}`"
      class="opener__slot"
      :style="{ '--delay': `${delays[index] ?? 0}ms`, '--flip': `${FLIP_MS}ms` }"
      :data-rarity="card.rarity"
      :data-shiny="card.isShiny ? 'true' : undefined"
      :data-pity="isPityTier(card.rarity) ? 'true' : undefined"
      @animationend="onRevealed()"
    >
      <!-- Os raios de ultra+, atrás da carta. `aria-hidden` porque a raridade já
           está no texto da carta e no rótulo do slot. -->
      <span
        v-if="isPityTier(card.rarity)"
        class="opener__rays"
        aria-hidden="true"
      />

      <article
        class="opener__card"
        :aria-label="labelOf(card, entries[index] ?? null)"
      >
        <!-- `v-for` sobre um par de listas alinhadas por posição pede a linha
             uma vez só: `entry` local em vez de três `entries[index]`, e sem o
             `!` que a leitura indexada exigiria. -->
        <template
          v-for="entry in [entries[index]]"
          :key="entry?.id ?? index"
        >
          <DexPokeCard
            v-if="entry"
            :dex-number="card.speciesId"
            :name="entry.displayName"
            :types="entry.types"
            :rarity="card.rarity"
          >
            <template #art>
              <img
                :src="`/sprites/${card.speciesId}.webp`"
                alt=""
                width="128"
                height="128"
                decoding="async"
              >
            </template>

            <template #footer>
              <p class="numeric opener__rarity">
                {{ card.isShiny ? 'SHINY' : RARITY_LABELS[card.rarity].toUpperCase() }}
              </p>
            </template>
          </DexPokeCard>
        </template>
      </article>
    </li>
  </ul>
</template>

<style scoped>
.opener {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  /* A perspectiva mora no contêiner e não na carta: uma perspectiva por carta
     dá a cada uma o próprio ponto de fuga, e a fileira deixa de parecer um
     baralho sendo virado para parecer dez animações independentes. */
  perspective: 1000px;
}

.opener__slot {
  position: relative;
  transform-style: preserve-3d;
  animation: flip-in var(--flip) var(--ease-out) var(--delay) backwards;
}

.opener__card {
  position: relative;
}

/**
 * A virada, e o foil que só acende depois dos 90°.
 *
 * O passo a 50% é o momento em que a carta está de perfil — invisível — e é
 * exatamente ali que a face troca. Fazer isso com duas faces reais (`backface-
 * visibility`) exigiria renderizar o verso de dez cartas para vê-lo por 160 ms.
 */
@keyframes flip-in {
  from {
    transform: rotateY(-90deg) scale(0.94);
    opacity: 0;
  }

  50% {
    opacity: 1;
  }

  to {
    transform: rotateY(0) scale(1);
    opacity: 1;
  }
}

/* Ultra+ chega maior e volta — a "escala" que a prancha anota junto dos raios. */
.opener__slot[data-pity="true"] {
  animation-name: flip-in-pity;
}

@keyframes flip-in-pity {
  from {
    transform: rotateY(-90deg) scale(0.94);
    opacity: 0;
  }

  50% {
    opacity: 1;
  }

  70% {
    transform: rotateY(0) scale(1.08);
  }

  to {
    transform: rotateY(0) scale(1);
    opacity: 1;
  }
}

.opener__rays {
  position: absolute;
  inset: -18%;
  z-index: -1;
  opacity: 0.4;
  background: repeating-conic-gradient(
    from 0deg,
    color-mix(in oklab, var(--rarity) 50%, transparent) 0deg 2deg,
    transparent 2deg 16deg
  );
}

.opener__slot[data-shiny="true"] :deep(.poke-card) {
  border-color: var(--shiny);
  box-shadow: 0 0 30px -12px var(--shiny);
}

.opener__rarity {
  font-size: 9px;
  margin-top: 4px;
  color: var(--rarity-label);
}

.opener__slot[data-shiny="true"] .opener__rarity {
  color: var(--shiny);
}

/**
 * Pular a animação e `prefers-reduced-motion` chegam ao mesmo lugar por
 * caminhos diferentes, e é de propósito que o resultado seja idêntico: as dez
 * de uma vez, sem virada. A prancha anota exatamente isso.
 */
.opener--skipped .opener__slot {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .opener__slot {
    animation: none;
  }
}
</style>
