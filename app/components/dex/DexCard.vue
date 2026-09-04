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
 *
 * A posse chegou na Fase 5, em dois sinais que a prancha desenha e que a Fase 3
 * segurou por não haver coleção: o **anel vazado** de quem não se tem, e o
 * marcador de shiny. Os dois entram no `aria-label` pela mesma razão que a
 * raridade entrou — a Pokédex é referência, mostra tudo, e distinguir o que se
 * tem do que falta não pode depender de enxergar uma borda tracejada.
 */
const props = withDefaults(defineProps<{
  species: SpeciesEntry
  /** `null` enquanto o save não carregou. Ver `ownedInRegion` em `[gen].vue`. */
  owned?: boolean | null
  shiny?: boolean
}>(), { owned: null, shiny: false })

const rarity = computed(() => rarityOf(props.species))

const typeLabels = computed(() => props.species.types.map(type => TYPE_LABELS[type]))

/**
 * A frase que o leitor de tela ouve. O link cobre a carta e não tem texto dentro,
 * então o `aria-label` é o **único** nome que ele tem — precisa carregar tudo,
 * inclusive a raridade, que na tela está só na cor da moldura.
 */
const label = computed(() => [
  props.species.displayName,
  `número ${props.species.id}`,
  typeLabels.value.join(' e '),
  RARITY_LABELS[rarity.value],
  ...(props.owned === false ? ['não capturado'] : []),
  ...(props.shiny ? ['shiny'] : []),
].join(', '))
</script>

<template>
  <div
    class="dex-card"
    :class="{ 'dex-card--missing': owned === false, 'dex-card--shiny': shiny }"
  >
    <DexPokeCard
      :dex-number="species.id"
      :name="species.displayName"
      :types="species.types"
      :rarity="rarity"
      :link="{ to: `/pokemon/${species.slug}`, label }"
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
  </div>
</template>

<style scoped>
/* O link deixou de ser esta raiz e passou a ser uma camada dentro da carta, para
   o rodapé poder hospedar ação sem aninhar interativo. O anel de foco foi junto:
   ele agora mora na moldura da `PokeCard`, que é o retângulo que o chanfro não
   recorta. Ver `.poke-card__link`. */
.dex-card {
  display: block;
}

/**
 * O anel vazado de quem ainda não foi capturado.
 *
 * A carta continua **legível**, e é decisão do canvas: a Pokédex é referência
 * antes de ser coleção, e apagar a arte de 900 espécies transformaria a tela
 * numa lista de silhuetas. O que muda é a moldura — tracejada e sem preencher —
 * e uma leve dessaturação, o suficiente para o olho separar as duas classes ao
 * varrer o grid sem esconder nenhuma delas.
 */
.dex-card--missing :deep(.poke-card) {
  border-style: dashed;
  border-color: var(--border-strong);
}

.dex-card--missing :deep(.poke-card) img {
  filter: saturate(0.35) opacity(0.65);
}

/* Shiny pinta por cima da raridade, como no binder: é tratamento de exemplar,
   não degrau da escada. */
.dex-card--shiny :deep(.poke-card) {
  border-color: var(--shiny);
  box-shadow: 0 0 26px -12px var(--shiny);
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
