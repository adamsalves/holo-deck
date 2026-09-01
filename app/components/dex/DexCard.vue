<script setup lang="ts">
import type { SpeciesEntry } from '~~/shared/types/dex'
import { computed } from 'vue'
import { rarityOf } from '~~/shared/game/rarity'
import { RARITY_LABELS, TYPE_LABELS } from '~~/shared/types/game'

/**
 * Uma espécie no grid da Pokédex — a carta do sistema, com o rodapé que esta
 * tela precisa.
 *
 * A moldura, o brilho de tipo, o chanfro e o foil vêm de `PokeCard`, que a
 * Fase 2 escreveu justamente como costura para cá. O que muda é o rodapé: a
 * prancha *Pokédex* põe os chips de tipo onde a carta padrão põe a etiqueta de
 * raridade, porque num grid o que se varre é o tipo.
 *
 * **Trocar o rodapé deixaria a raridade só na cor da moldura**, e a regra do
 * canvas é que ela nunca seja comunicada só por brilho. Quem paga essa conta é o
 * `aria-label` do link: uma frase com número, nome, tipos e raridade, que é o
 * que o leitor de tela anuncia no lugar do conteúdo visual — sem duplicar texto
 * na tela nem espremer mais uma linha numa carta de 140px.
 */
const props = defineProps<{ species: SpeciesEntry }>()

const rarity = computed(() => rarityOf(props.species))

const typeLabels = computed(() => props.species.types.map(type => TYPE_LABELS[type]))

/**
 * A frase que o leitor de tela ouve. `aria-label` no link substitui o conteúdo
 * interno, então ela precisa carregar tudo — inclusive a raridade, que na tela
 * está na cor da moldura.
 */
const label = computed(() => [
  props.species.displayName,
  `número ${props.species.id}`,
  typeLabels.value.join(' e '),
  RARITY_LABELS[rarity.value],
].join(', '))
</script>

<template>
  <NuxtLink
    :to="`/pokemon/${species.slug}`"
    :aria-label="label"
    class="dex-card"
  >
    <DexPokeCard
      :dex-number="species.id"
      :name="species.displayName"
      :types="species.types"
      :rarity="rarity"
    >
      <template #art>
        <!-- Miniatura de 128px gerada no build: é ela que faz o grid custar
             920 KB em vez de 17,8 MB, e é o que permite o offline da Fase 8 ter
             imagem. `lazy` porque só uma fileira e meia cabe na dobra.
             `alt` vazio de propósito — a carta inteira já é um link nomeado, e
             repetir o nome faria o leitor de tela anunciá-lo duas vezes. -->
        <img
          :src="`/sprites/${species.id}.webp`"
          alt=""
          width="128"
          height="128"
          loading="lazy"
          decoding="async"
        >
      </template>

      <template #footer>
        <span class="dex-card__types">
          <DexTypeBadge
            v-for="type in species.types"
            :key="type"
            :type="type"
          />
        </span>
      </template>
    </DexPokeCard>
  </NuxtLink>
</template>

<style scoped>
.dex-card {
  display: block;
  text-decoration: none;
  color: inherit;
  /* O chanfro da carta é feito por `clip-path`, que corta o próprio anel de
     foco. O anel fica no link, que é retângulo, e por isso continua visível. */
  border-radius: var(--radius);
}

.dex-card:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

.dex-card__types {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 5px;
}

/* Dois tipos numa carta de grid: o chip encolhe para os dois caberem na largura
   sem quebrar linha, que é como a prancha os desenha. */
.dex-card__types :deep(.type-badge) {
  font-size: 7px;
  padding: 2px 5px;
  letter-spacing: 0.08em;
}
</style>
