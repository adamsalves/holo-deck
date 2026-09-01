<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'

/**
 * A etiqueta de tipo — o primeiro consumidor da variável de escopo.
 *
 * Ela não conhece nenhuma das 18 cores. `data-type` publica `--type` na própria
 * etiqueta, e a regra abaixo lê a variável: dezoito tipos, uma declaração. É o
 * mesmo mecanismo que o brilho atrás da arte e o preenchimento de barra vão usar,
 * e a razão de nenhum deles precisar de 18 regras próprias.
 */
defineProps<{ type: TypeName }>()
</script>

<template>
  <span
    :data-type="type"
    class="type-badge bevel-chip"
  >{{ type }}</span>
</template>

<style scoped>
.type-badge {
  /* Texto sobre a cor do tipo, não o contrário: os 18 valores foram escolhidos
     para serem legíveis sobre o fundo escuro, e todos passam folgado com o
     fundo da página por cima deles. */
  background: var(--type);
  color: var(--bg);

  display: inline-block;
  padding: 4px 9px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  line-height: 1;
  text-transform: uppercase;
}
</style>
