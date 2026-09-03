<script setup lang="ts">
import { computed } from 'vue'
import { progressLabel, progressRatio, progressStep } from '~~/shared/game/progress'

/**
 * A barra de progresso de coleção — a fileira de nove que abre o binder e o Hub.
 *
 * A cor sai do **degrau**, e o degrau sai da fração: verde quando passa da
 * metade, acento no meio, neutro no começo, e trilha vazia quando não se tem
 * nenhuma. A regra é `progressStep`, em `shared/game/`, e não um `if` aqui —
 * `/rules` vai ler a mesma função na Fase 6.
 *
 * `<meter>` foi considerado e recusado: ele traz uma aparência de plataforma que
 * só se remove zerando `appearance` em três prefixos, e a semântica que ele daria
 * de graça é a mesma que `role="progressbar"` dá com os três atributos abaixo —
 * sem herdar estilo de ninguém.
 */
const props = defineProps<{
  owned: number
  total: number
  /** O nome do conjunto, para o leitor de tela dizer de que barra se trata. */
  label: string
}>()

const ratio = computed(() => progressRatio(props.owned, props.total))
const step = computed(() => progressStep(ratio.value))
const percent = computed(() => `${Math.round(ratio.value * 100)}%`)
</script>

<template>
  <div
    class="progress"
    :data-step="step"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="owned"
    :aria-valuemin="0"
    :aria-valuemax="total"
    :aria-valuetext="`${progressLabel(owned, total)} capturados`"
  >
    <div class="progress__track">
      <!-- Largura zero não renderiza nada, e é assim que a prancha desenha as
           regiões em que ninguém capturou: trilha vazia, sem um fio de cor. -->
      <div
        v-if="ratio > 0"
        class="progress__fill"
        :style="{ width: percent }"
      />
    </div>
  </div>
</template>

<style scoped>
.progress {
  /**
   * O degrau publica a cor, e o preenchimento a consome. Mesmo desenho que
   * `[data-type]` e `[data-rarity]` no tema: um atributo de escopo em vez de uma
   * regra por combinação de estado e papel.
   */
  --fill: var(--progress-low);
}

.progress[data-step="mid"] {
  --fill: var(--progress-mid);
}

.progress[data-step="high"] {
  --fill: var(--progress-high);
}

.progress__track {
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--progress-track);
}

.progress__fill {
  height: 100%;
  background: var(--fill);
  /* O brilho é o que a prancha desenha nas barras que já andaram, e ele sai da
     própria cor do degrau — nenhum valor novo, e ele acompanha a troca de cor
     sem uma segunda regra. */
  box-shadow: 0 0 12px var(--fill);
  transition: width 240ms var(--ease-out);
}

/* Uma barra que cresce sozinha ao carregar a página é movimento sem informação
   para quem pediu para não ver movimento. O valor final é o mesmo. */
@media (prefers-reduced-motion: reduce) {
  .progress__fill {
    transition: none;
  }
}
</style>
