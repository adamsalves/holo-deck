<script setup lang="ts">
import { computed, ref } from 'vue'
import { DECK_SIZE } from '~~/shared/game/deck'
import { multiplierLabel } from '~~/shared/game/typechart'
import type { SearchEntry } from '~~/shared/types/dex'
import { TYPE_LABELS } from '~~/shared/types/game'
import { isSpeciesId } from '~~/shared/types/brand'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
import { useDeck } from '~/composables/useDeck'

/**
 * O deck builder — a prancha *Deck*.
 *
 * Duas colunas, como o canvas: os seis slots e a leitura de cobertura à esquerda,
 * a coleção à direita. **Tudo é `<ClientOnly>`** pela mesma razão do binder: a
 * rota é pré-renderizada e o deck mora em `localStorage`, então no servidor ele
 * está sempre vazio e qualquer contagem no HTML seria um número que muda na
 * hidratação.
 *
 * ## Duas divergências da prancha, e as duas são decisão
 *
 * **Não há botão SALVAR.** A prancha desenha um, cinza. O save é gravado a cada
 * mutação pelo plugin — um botão que não salva nada é pior que nenhum botão, e um
 * que salvasse de verdade exigiria um estado "não salvo" que o jogo não tem e não
 * quer ter. O cabeçalho diz `5 / 6 slots` e para por aí.
 *
 * **O `×2` que a prancha põe na linha do número de cada carta não está lá.** Ele
 * é a efetividade daquela carta contra o líder, e está na coluna de cobertura
 * logo abaixo, por tipo — que é onde ela informa mais, porque duas cartas do
 * mesmo tipo dão a mesma linha. O que ficou na carta é o alerta que muda decisão:
 * a faixa `LEVA ×2`.
 */
const collection = useCollectionStore()
const deck = useDeckStore()
const view = await useDeck()

useHead({ title: 'Deck' })

const query = ref('')
const strongOnly = ref(false)

/** Quanto cada carta do deck apanha do líder, por id. Alimenta a faixa do slot. */
const incomingById = computed(() => {
  const map = new Map<number, number>()
  for (const risk of view.coverage.value.incoming) map.set(risk.id, risk.multiplier)
  return map
})

/**
 * A coluna da direita: o que se tem, menos o que já está escalado.
 *
 * "Cartas já no deck saem da lista", diz a prancha — e é o que torna clicar uma
 * carta uma ação sem ambiguidade: tudo que está ali pode entrar.
 */
const available = computed(() => view.owned.value.filter(entry => !deck.has(entry.id)))

const visible = computed(() => {
  const term = query.value.trim().toLowerCase()

  return available.value.filter((entry) => {
    if (strongOnly.value && !view.isStrong(entry)) return false
    if (term.length === 0) return true

    return entry.displayName.toLowerCase().includes(term)
      || entry.types.some(type => TYPE_LABELS[type].toLowerCase().includes(term))
  })
})

/** O primeiro slot vazio, ou `-1` com o deck cheio. */
const firstEmpty = computed(() => view.slots.value.findIndex(slot => slot.entry === null))

/**
 * Clicar escala; arrastar escolhe o slot.
 *
 * O clique é o caminho primário e não o atalho: arrastar não existe para o
 * teclado, e o plano põe navegação por teclado no deck builder. O que o clique
 * perde é a escolha da posição, e ela importa pouco num time de seis que entra em
 * campo por ordem — quem quer a posição arrasta.
 */
function pick(entry: SearchEntry): void {
  if (firstEmpty.value < 0) return
  deck.place(firstEmpty.value, entry.id)
}

function onDrop(slot: number, id: number): void {
  if (!isSpeciesId(id) || !collection.has(id)) return
  deck.place(slot, id)
}

function onDragStart(event: DragEvent, entry: SearchEntry): void {
  event.dataTransfer?.setData('text/plain', String(entry.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
  <div class="deck">
    <div class="deck__main">
      <ClientOnly>
        <header class="mb-7 flex items-end justify-between gap-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
              Montagem de deck
            </p>
            <h1 class="mt-2 text-[40px] font-bold leading-none tracking-tight text-highlighted">
              Seu time
            </h1>
          </div>
          <p class="numeric text-[13px] text-muted">
            <span class="text-[22px] font-extrabold text-highlighted">{{ deck.filled }}</span>
            / {{ DECK_SIZE }} slots
          </p>
        </header>

        <ul class="deck__slots">
          <li
            v-for="slot in view.slots.value"
            :key="slot.index"
          >
            <DeckSlot
              :index="slot.index"
              :entry="slot.entry"
              :stats="slot.stats"
              :incoming="slot.entry ? incomingById.get(slot.entry.id) ?? 1 : 1"
              @remove="deck.clear(slot.index)"
              @drop="id => onDrop(slot.index, id)"
            />
          </li>
        </ul>

        <section class="deck__coverage">
          <header class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
              Cobertura contra
              <span class="text-highlighted">{{ view.leader.value.name }} · {{ TYPE_LABELS[view.leader.value.type] }}</span>
            </h2>
            <p
              v-if="view.coverage.value.incoming.length > 0"
              class="numeric deck__advice"
            >
              {{ view.coverage.value.incoming.length }}
              {{ view.coverage.value.incoming.length === 1 ? 'AJUSTE RECOMENDADO' : 'AJUSTES RECOMENDADOS' }}
            </p>
          </header>

          <p
            v-if="deck.filled === 0"
            class="text-[13px] leading-relaxed text-muted"
          >
            Escale uma carta para ler a cobertura do time contra
            {{ view.leader.value.name }}.
          </p>

          <div
            v-else
            class="grid gap-6 md:grid-cols-2"
          >
            <div>
              <p class="numeric mb-3 text-[11px] text-muted">
                SEU DANO CONTRA {{ TYPE_LABELS[view.leader.value.type].toUpperCase() }}
              </p>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="line in view.coverage.value.outgoing"
                  :key="line.type"
                  class="deck__line"
                >
                  <span class="numeric text-[11px] text-toned">{{ TYPE_LABELS[line.type] }}</span>
                  <span
                    class="deck__bar"
                    :data-level="line.multiplier > 1 ? 'good' : line.multiplier < 1 ? 'bad' : 'flat'"
                  >
                    <span :style="{ width: `${Math.min(100, line.multiplier * 50)}%` }" />
                  </span>
                  <span
                    class="numeric text-[11px] font-extrabold"
                    :data-level="line.multiplier > 1 ? 'good' : line.multiplier < 1 ? 'bad' : 'flat'"
                  >{{ multiplierLabel(line.multiplier) }}</span>
                </li>
              </ul>
            </div>

            <div>
              <p class="numeric mb-3 text-[11px] text-muted">
                DANO QUE VOCÊ RECEBE
              </p>
              <p
                v-if="view.coverage.value.incoming.length === 0"
                class="text-[13px] leading-relaxed text-muted"
              >
                Nenhuma carta do time apanha mais que o normal de
                {{ TYPE_LABELS[view.leader.value.type] }}.
              </p>
              <ul
                v-else
                class="flex flex-col gap-2"
              >
                <li
                  v-for="risk in view.coverage.value.incoming"
                  :key="risk.id"
                  class="deck__risk"
                >
                  <img
                    :src="`/sprites/${risk.id}.webp`"
                    alt=""
                    width="34"
                    height="34"
                    loading="lazy"
                  >
                  <span class="text-sm font-bold text-highlighted">
                    {{ view.slots.value.find(slot => slot.entry?.id === risk.id)?.entry?.displayName }}
                  </span>
                  <span class="numeric ml-auto text-[10px] font-extrabold text-[var(--deficit)]">
                    leva {{ multiplierLabel(risk.multiplier) }}
                  </span>
                </li>
              </ul>
              <p class="numeric mt-3 text-[11px] leading-relaxed text-muted">
                Leitura calculada na mesma matriz 18×18 que o motor de batalha usa —
                a tela não tem regra própria.
              </p>
            </div>
          </div>
        </section>

        <template #fallback>
          <p class="text-sm text-muted">
            Carregando seu deck…
          </p>
        </template>
      </ClientOnly>
    </div>

    <aside class="deck__collection">
      <ClientOnly>
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Sua coleção
          </p>
          <span class="numeric text-[11px] text-muted">{{ collection.ownedCount }}</span>
        </div>

        <label class="deck__search">
          <span class="sr-only">Filtrar por nome ou tipo</span>
          <input
            v-model="query"
            type="search"
            placeholder="Filtrar por nome ou tipo"
          >
        </label>

        <div class="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            class="numeric deck__chip"
            :aria-pressed="strongOnly"
            @click="strongOnly = true"
          >
            FORTE VS {{ TYPE_LABELS[view.leader.value.type].toUpperCase() }}
          </button>
          <button
            type="button"
            class="numeric deck__chip"
            :aria-pressed="!strongOnly"
            @click="strongOnly = false"
          >
            TODAS
          </button>
        </div>

        <p
          v-if="visible.length === 0"
          class="text-[13px] leading-relaxed text-muted"
        >
          {{ collection.ownedCount === 0
            ? 'Sua coleção está vazia. Abra um pack para começar.'
            : 'Nenhuma carta combina com esse filtro.' }}
        </p>

        <ul
          v-else
          class="deck__picks"
        >
          <li
            v-for="entry in visible"
            :key="entry.id"
          >
            <button
              type="button"
              class="deck__pick bevel-tile"
              draggable="true"
              :disabled="firstEmpty < 0"
              :aria-label="`Escalar ${entry.displayName}`"
              @click="pick(entry)"
              @dragstart="event => onDragStart(event, entry)"
            >
              <span class="numeric deck__pick-number">
                #{{ String(entry.id).padStart(4, '0') }}
              </span>
              <img
                :src="`/sprites/${entry.id}.webp`"
                alt=""
                width="128"
                height="128"
                loading="lazy"
                decoding="async"
              >
              <span class="deck__pick-name">{{ entry.displayName }}</span>
            </button>
          </li>
        </ul>

        <p class="numeric mt-4 text-[11px] leading-relaxed text-muted">
          Clique para escalar, ou arraste para um slot.
          Cartas já no deck saem da lista.
        </p>

        <template #fallback>
          <p class="text-sm text-muted">
            Carregando sua coleção…
          </p>
        </template>
      </ClientOnly>
    </aside>
  </div>
</template>

<style scoped>
/**
 * Duas colunas, e a da direita é fixa pelo mesmo argumento do binder: a lista de
 * cartas tem largura de conteúdo (três por fileira), e deixá-la fluida faria a
 * coluna que **não** cresce ser a que mais varia.
 */
.deck {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
  background: var(--bg);
}

@media (min-width: 1100px) {
  .deck {
    grid-template-columns: 1fr 400px;
  }
}

.deck__main {
  padding: 34px 36px 40px;
}

.deck__collection {
  padding: 34px 26px 40px;
  background: var(--surface-sunken);
  border-top: 1px solid var(--border);
}

@media (min-width: 1100px) {
  .deck__collection {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
}

/* Seis em uma fileira é o desenho da prancha; abaixo dela o time quebra em duas
   e depois em três, porque uma carta de 5:7 espremida a 60px não é uma carta. */
.deck__slots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 34px;
  padding: 0;
  list-style: none;
}

@media (min-width: 640px) {
  .deck__slots {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 900px) {
  .deck__slots {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.deck__coverage {
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

/**
 * O resumo da leitura, em `--accent`.
 *
 * A prancha pinta esta chip no amarelo de terrestre, que é um primitivo de tipo
 * — e cor de tipo é preenchimento de tipo, não vocabulário de aviso. O portão de token recusa, e com razão: o dia em que terrestre mudar de
 * tom, um aviso de deck mudaria junto sem ninguém entender por quê.
 *
 * A saída não foi inventar um `--caution` para uma chip. A tela já tem dois
 * níveis, e eles se distinguem sozinhos: o risco concreto é `--deficit` na faixa
 * `LEVA ×2` de cada carta, e este aqui é o **resumo** — informativo, do mesmo
 * grau que qualquer outro valor que se destaca, que é o papel de `--accent`.
 */
.deck__advice {
  padding: 5px 11px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 800;
  color: var(--accent);
  border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent);
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}

.deck__line {
  display: grid;
  grid-template-columns: 82px 1fr 42px;
  gap: 11px;
  align-items: center;
}

.deck__bar {
  height: 6px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--progress-track);
}

.deck__bar > span {
  display: block;
  height: 100%;
}

/* Os três degraus da leitura, e eles reaproveitam semânticos que já existem: o
   verde de progresso para o que resolve, o vermelho de déficit para o que pede
   troca, e o cinza de texto apagado para o neutro. Nenhum hex novo — a barra
   mede vantagem, que é a mesma família de leitura que o progresso mede. */
[data-level="good"] { color: var(--progress-high); }
[data-level="bad"] { color: var(--deficit); }
[data-level="flat"] { color: var(--text-muted); }

.deck__bar[data-level="good"] > span { background: var(--progress-high); }
.deck__bar[data-level="bad"] > span { background: var(--deficit); }
.deck__bar[data-level="flat"] > span { background: var(--text-muted); }

.deck__risk {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--deficit);
  border-radius: var(--radius);
  background: var(--surface-sunken);
}

.deck__search {
  display: block;
  margin-bottom: 14px;
}

.deck__search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
}

.deck__search input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.deck__chip {
  padding: 5px 10px;
  border-radius: 2px;
  border: 1px solid var(--border);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-faint);
  cursor: pointer;
}

.deck__chip[aria-pressed="true"] {
  color: var(--accent);
  border-color: color-mix(in oklab, var(--accent) 55%, transparent);
  background: color-mix(in oklab, var(--accent) 9%, transparent);
}

.deck__chip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.deck__picks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;

  /* A mesma saída do binder: a coluna pode chegar a 1025 cartas, e
     `content-visibility` pula estilo, layout e pintura do que está fora da
     janela sem exigir altura uniforme. Ver a issue #24. */
  content-visibility: auto;
  contain-intrinsic-size: auto 400px;
}

.deck__pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 7px 8px;
  border: 1px solid var(--border);
  background: var(--card-surface);
  color: inherit;
  cursor: grab;
}

.deck__pick:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.deck__pick:hover:not(:disabled) {
  border-color: var(--accent);
}

.deck__pick:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.deck__pick-number {
  align-self: flex-start;
  font-size: 8px;
  font-weight: 800;
  color: var(--text-muted);
}

.deck__pick img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.deck__pick-name {
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  line-height: 1.2;
}
</style>
