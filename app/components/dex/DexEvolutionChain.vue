<script setup lang="ts">
import type { EvolutionNode, SpeciesEntry, TypeName } from '~~/shared/types/dex'
import { computed } from 'vue'
import { describeEvolution, toStages } from '~~/shared/game/evolution'
import { baseStatTotal } from '~~/shared/game/rarity'
import { dexNumber } from '~~/shared/dex/regions'

/**
 * A linha evolutiva, resolvida do JSON local — zero requisições, que é a
 * promessa que o plano faz para esta aba.
 *
 * A prancha desenha uma sequência horizontal com setas e o rótulo da condição
 * sob cada uma. A maioria das 541 cadeias é isso mesmo; **Eevee tem oito filhos
 * no mesmo degrau**, e por isso o layout é uma grade de estágios em vez de uma
 * fila: cada estágio é uma coluna, e o que ramifica empilha dentro dela.
 *
 * O BST de cada estágio vem da prancha (`#0004 · BST 309`) e é o que torna a
 * linha legível como progressão, não só como sequência.
 */
const props = defineProps<{
  root: EvolutionNode
  currentId: number
  /** O que o dex sabe sobre as espécies da cadeia — nem sempre é tudo: uma
   *  cadeia pode cruzar gerações, e só a do detalhe está carregada. */
  known: ReadonlyMap<number, SpeciesEntry>
  type: TypeName
}>()

const stages = computed(() => toStages(props.root))

function bstOf(speciesId: number): number | null {
  const entry = props.known.get(speciesId)
  return entry === undefined ? null : baseStatTotal(entry.baseStats)
}

function nameOf(node: EvolutionNode): string {
  return props.known.get(node.speciesId)?.displayName ?? node.slug
}
</script>

<template>
  <section :data-type="type">
    <h2 class="chain__title">
      Linha evolutiva
      <span class="chain__note">— resolvida do JSON local, zero requisições</span>
    </h2>

    <ol class="chain">
      <li
        v-for="stage in stages"
        :key="stage.depth"
        class="chain__stage"
      >
        <!-- A seta liga o estágio anterior a este, então ela não existe no
             primeiro. Decorativa: quem já leu "linha evolutiva" no título não
             precisa ouvir "seta para a direita" seis vezes. -->
        <span
          v-if="stage.depth > 0"
          class="chain__arrow"
          aria-hidden="true"
        >→</span>

        <ul class="chain__nodes">
          <li
            v-for="node in stage.nodes"
            :key="node.speciesId"
          >
            <NuxtLink
              :to="`/pokemon/${node.slug}`"
              class="chain__card bevel-chip"
              :class="{ 'chain__card--current': node.speciesId === currentId }"
              :aria-current="node.speciesId === currentId ? 'page' : undefined"
            >
              <img
                :src="`/sprites/${node.speciesId}.webp`"
                alt=""
                width="128"
                height="128"
                loading="lazy"
                decoding="async"
                class="chain__art"
              >
              <span class="chain__name">{{ nameOf(node) }}</span>
              <span class="numeric chain__meta">
                {{ dexNumber(node.speciesId) }}<template v-if="bstOf(node.speciesId) !== null"> · BST {{ bstOf(node.speciesId) }}</template>
              </span>
              <span
                v-if="node.via"
                class="numeric chain__condition"
              >{{ describeEvolution(node.via) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.chain__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.chain__note {
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
  color: var(--text-faint);
}

.chain {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
}

.chain__stage {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

/**
 * A seta acompanha o topo do estágio, não o centro dele.
 *
 * Centrada, ela desce para o meio vertical do grupo — e num estágio que ramifica
 * (Eevee tem oito filhos, que quebram em duas fileiras) ela aparece ao lado da
 * segunda fileira, apontando para o lugar errado. Os 40px são a altura da arte
 * mais o respiro de cima: a seta fica na linha do desenho da primeira carta, que
 * é onde o olho a procura.
 */
.chain__arrow {
  margin-top: 40px;
  font-size: 18px;
  line-height: 1;
  color: var(--type);
}

.chain__nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chain__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 116px;
  padding: 10px 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: inherit;
  text-align: center;
  text-decoration: none;
}

.chain__card:hover,
.chain__card:focus-visible {
  border-color: var(--border-strong);
}

/* A espécie que está aberta: o fio na cor do tipo é o que evita o jogador se
   perder numa cadeia de oito irmãos, todos com a mesma cara. */
.chain__card--current {
  border-color: var(--type);
  background: color-mix(in oklab, var(--type) 8%, var(--surface-raised));
}

.chain__art {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.chain__name {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}

.chain__meta {
  font-size: 9px;
  color: var(--text-muted);
}

.chain__condition {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.3;
  color: var(--text-faint);
}
</style>
