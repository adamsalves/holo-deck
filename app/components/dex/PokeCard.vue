<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { computed, useTemplateRef } from 'vue'
import { hasFoil } from '~~/shared/types/game'
import { useFoil } from '~/composables/useFoil'

/**
 * A carta — a superfície que carrega a assinatura do sistema.
 *
 * Ela não sabe carregar imagem: a arte entra pelo slot. É a costura entre esta
 * fase e a Fase 3, que decide entre miniatura de 128px no grid e arte oficial
 * remota no detalhe; a moldura é a mesma nos dois.
 *
 * `interactive` é o que separa o herói das 1025 do grid. Falso — o padrão —
 * significa nenhum listener: o foil fica no repouso, que é exatamente o gradiente
 * estático que o canvas desenha nas cartas do grid.
 */
const props = withDefaults(defineProps<{
  dexNumber: number
  name: string
  types: readonly [TypeName] | readonly [TypeName, TypeName]
  rarity: Rarity
  interactive?: boolean
}>(), { interactive: false })

const card = useTemplateRef<HTMLElement>('card')
const { variables } = useFoil(card, { enabled: () => props.interactive })

const showsFoil = computed(() => hasFoil(props.rarity))

/**
 * `padStart(4, '0')` — o dex vai a 1025, então quatro casas.
 *
 * O app antigo tinha um filtro que produzia `10` e `001` na mesma listagem, e o
 * plano nomeia essa correção. Ela cabe aqui porque é aqui que o número aparece.
 */
const dexLabel = computed(() => `#${String(props.dexNumber).padStart(4, '0')}`)
</script>

<template>
  <article
    ref="card"
    class="poke-card bevel-tile"
    :data-rarity="rarity"
    :data-type="types[0]"
    :style="variables"
  >
    <div
      class="poke-card__glow"
      aria-hidden="true"
    />

    <span class="poke-card__number numeric">{{ dexLabel }}</span>

    <div class="poke-card__art">
      <slot name="art" />
    </div>

    <div class="poke-card__id">
      <h3 class="poke-card__name">
        {{ name }}
      </h3>
      <!-- A raridade nunca é comunicada só por brilho: a etiqueta textual está
           sempre presente, inclusive com reduced-motion ligado. É regra do canvas. -->
      <span class="poke-card__rarity numeric">{{ rarity }}</span>
    </div>

    <div
      v-if="showsFoil"
      class="poke-card__foil"
      aria-hidden="true"
    />
  </article>
</template>

<style scoped>
.poke-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  aspect-ratio: 5 / 7;
  padding: 9px 0 11px;

  background: linear-gradient(168deg, var(--surface-raised), var(--surface-cell));
  border: 1px solid var(--rarity);
  color: var(--text);

  /* A inclinação vem do foil e é zero em repouso, então a carta parada não paga
     composição por causa dela. `transition` some sob reduced-motion, abaixo. */
  transform: perspective(700px)
    rotateX(var(--foil-tilt-x, 0deg))
    rotateY(var(--foil-tilt-y, 0deg));
  transition: transform 120ms var(--ease-out, ease-out);
}

/* O brilho do tipo, atrás da arte. Deriva de `--type` com `color-mix`, que é o
   que evita 18 regras — uma por tipo. */
.poke-card__glow {
  position: absolute;
  left: 50%;
  top: 38%;
  width: 76%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: radial-gradient(
    circle,
    color-mix(in oklab, var(--type) 24%, transparent),
    transparent 66%
  );
}

.poke-card__number {
  position: relative;
  align-self: flex-start;
  padding: 0 9px;
  font-size: 9px;
  color: var(--text-faint);
}

.poke-card__art {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 0 9px;
}

.poke-card__art :deep(img) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.poke-card__id {
  position: relative;
  padding: 0 9px;
}

.poke-card__name {
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.poke-card__rarity {
  display: block;
  margin-top: 4px;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rarity-label);
}

/* Mítico é o único que não cabe numa cor: o rótulo recebe a varredura linear,
   recortada no texto. O `conic` de `--rarity-fill` embaralharia num texto curto. */
.poke-card[data-rarity="mythic"] .poke-card__rarity {
  background-image: var(--rarity-text);
  background-clip: text;
  color: transparent;
}

.poke-card__foil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: color-dodge;
  opacity: var(--foil-strength);
  background: var(--foil);
}

/**
 * O reforço no CSS, e não substituto do desligamento no composable.
 *
 * `useFoil` já não liga listener nenhum sob `prefers-reduced-motion`, então as
 * variáveis ficam paradas no repouso. Isto aqui cobre o resto: a transição da
 * inclinação, que existiria mesmo sem rastreio se alguma outra coisa mexesse nas
 * variáveis. O foil continua visível como gradiente estático — a raridade não
 * pode sumir por preferência de movimento.
 */
@media (prefers-reduced-motion: reduce) {
  .poke-card {
    transition: none;
  }
}
</style>
