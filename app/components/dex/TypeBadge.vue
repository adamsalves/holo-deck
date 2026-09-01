<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import { TYPE_LABELS } from '~~/shared/types/game'

/**
 * A etiqueta de tipo — o primeiro consumidor da variável de escopo.
 *
 * Ela não conhece nenhuma das 18 cores. `data-type` publica `--type` na própria
 * etiqueta, e a regra abaixo lê a variável: dezoito tipos, uma declaração. É o
 * mesmo mecanismo que o brilho atrás da arte e o preenchimento de barra vão usar,
 * e a razão de nenhum deles precisar de 18 regras próprias.
 *
 * O texto sai de `TYPE_LABELS` e não do próprio `type` pelo mesmo motivo que o da
 * raridade: o identificador é em inglês, o documento é `lang="pt-BR"`, e é a
 * etiqueta que o jogador lê.
 */
defineProps<{ type: TypeName }>()
</script>

<template>
  <span
    :data-type="type"
    class="type-badge"
  >{{ TYPE_LABELS[type] }}</span>
</template>

<style scoped>
/**
 * **Sem chanfro, e isso é correção de uma divergência da Fase 2.**
 *
 * As 17 pranchas desenham `.tchip` com `border-radius:2px` e nenhum `clip-path`
 * — em nenhuma tela o chip de tipo é chanfrado; quem carrega a assinatura é a
 * carta, o painel e o botão. O `bevel-chip` que estava aqui só ficava de pé no
 * tamanho grande: no grid da Pokédex o chip tem 11px de altura, e um chanfro de
 * 9px come o canto inteiro, cortando a última letra de VENENOSO na diagonal. É
 * literalmente o caso que o comentário da escada de chanfro descreve ao
 * justificar por que ela é escada.
 */
.type-badge {
  /* Texto sobre a cor do tipo, não o contrário: os 18 valores foram escolhidos
     para serem legíveis sobre o fundo escuro, e todos passam folgado com o
     fundo da página por cima deles. */
  background: var(--type);
  color: var(--bg);
  border-radius: var(--radius);

  display: inline-block;
  padding: 4px 9px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1;
  text-transform: uppercase;
}
</style>
