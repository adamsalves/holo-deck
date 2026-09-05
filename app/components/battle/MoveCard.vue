<script setup lang="ts">
import { computed } from 'vue'
import type { MoveEntry } from '~~/shared/types/dex'
import { multiplierLabel } from '~~/shared/game/typechart'
import { AILMENT_LABELS } from '~~/shared/types/game'

/**
 * Um dos quatro golpes — a prancha *Batalha*, com os três estados que ela desenha.
 *
 * O golpe normal mostra `×2.0` na cor da efetividade; o que não afeta mostra
 * `×0 NÃO AFETA` em `--deficit`; e o de status contra alvo já afetado mostra
 * `JÁ PARALISADO`. **Os três estados são a mesma linha e o mesmo lugar**, pelo
 * mesmo argumento do rodapé da carta do binder: dois estados em posições
 * diferentes fazem a fileira mudar de altura conforme a matchup.
 *
 * O botão continua clicável quando o golpe não afeta — o motor executa, gasta o
 * turno e narra `não afetou`. Isso é decisão do plano, e não descuido: a
 * interface **ensina no ponto de decisão**, e um botão desabilitado esconderia o
 * `×0` em vez de mostrá-lo.
 *
 * **Sem PP ele também continua clicável, e pelo mesmo argumento.** `moveFromSlot`
 * cai em Struggle por *slot*, não só quando os quatro acabam: clicar um golpe
 * zerado é uma jogada válida, e o motor a resolve. A carta dizia o contrário de
 * três formas — `cursor: not-allowed`, um comentário afirmando que o golpe "some
 * da escolha" e um `choose()` que voltava em silêncio —, sem nunca desabilitar o
 * botão. Fechá-lo de verdade era a saída errada: com os quatro zerados, sem banco
 * vivo e sem poção, não sobraria nenhuma ação e a batalha travaria — e o Struggle
 * que o motor mantém para exatamente esse caso deixaria de existir para o
 * jogador. Aqui o slot vazio vira o aviso `SEM PP · STRUGGLE`, que é o que a
 * jogada produz.
 */
const props = defineProps<{
  move: MoveEntry
  pp: number
  /** Efetividade contra o ativo inimigo. Ignorada em golpe de status. */
  multiplier: number
  /** O aviso que substitui o multiplicador, quando há um. */
  note: string | null
  focused: boolean
}>()

defineEmits<{ choose: [], focus: [] }>()

const CLASS_LABELS: Record<MoveEntry['damageClass'], string> = {
  physical: 'FÍS',
  special: 'ESP',
  status: 'STATUS',
}

const empty = computed(() => props.pp <= 0)

/** Verde quando bate mais, vermelho quando bate menos, neutro no ×1. */
const tone = computed(() => {
  if (props.multiplier > 1) return 'move__mult--strong'
  if (props.multiplier < 1) return 'move__mult--weak'
  return ''
})

/**
 * **Golpe de status não tem multiplicador**, e mostrar um é mentira.
 *
 * A efetividade multiplica dano, e um golpe de status não causa nenhum: Thunder
 * Wave contra um Pokémon de Água estampava `×2` — número verdadeiro sobre uma
 * conta que não acontece, no lugar onde a tela ensina a escolher. O que sobra
 * dele é a imunidade de tipo, que o motor cobra também para condição, e essa
 * continua aparecendo como `×0 NÃO AFETA` porque vira um `note`.
 */
const showsMultiplier = computed(() => props.note !== null || props.move.damageClass !== 'status')

/**
 * A terceira coluna da linha de baixo: `PWR 90 · ACC 100` para golpe de dano,
 * `paralisia · ACC 90` para o de status. É a mesma linha da prancha, e o que
 * muda é o que existe — golpe de status não tem poder.
 */
const detail = computed(() => {
  // Numa constante local, e não `props.move` direto: a união é discriminada e o
  // estreitamento por `damageClass` precisa de uma referência estável para o
  // compilador aceitar `ailment` de um lado e `power` do outro.
  const move = props.move
  const accuracy = move.accuracy === null ? '—' : move.accuracy

  if (move.damageClass === 'status') {
    return `${AILMENT_LABELS[move.ailment.kind]} · ACC ${accuracy}`
  }
  return `PWR ${move.power} · ACC ${accuracy}`
})
</script>

<template>
  <button
    type="button"
    class="move"
    :class="[{ 'move--empty': empty, 'move--focused': focused }, tone && 'move--toned']"
    :data-type="move.type"
    @click="$emit('choose')"
    @mouseenter="$emit('focus')"
    @focus="$emit('focus')"
  >
    <span class="move__top">
      <span class="move__name">{{ move.displayName }}</span>
      <span
        v-if="showsMultiplier"
        class="numeric move__mult"
        :class="note ? 'move__mult--note' : tone"
      >{{ note ?? multiplierLabel(multiplier) }}</span>
    </span>

    <span class="move__foot">
      <DexTypeBadge :type="move.type" />
      <span class="numeric move__detail">{{ CLASS_LABELS[move.damageClass] }} · {{ detail }}</span>
      <span class="numeric move__pp">PP {{ pp }}/{{ move.pp }}</span>
    </span>
  </button>
</template>

<style scoped>
.move {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  padding: 14px 16px;
  text-align: left;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}

.move:hover,
.move--focused {
  border-color: var(--border-strong);
  background: var(--surface-raised);
}

.move:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* O slot gasto continua uma jogada — o motor o resolve em Struggle. O que a cor
   diz é que o golpe escrito ali não é o que vai sair; quem diz o que sai é o
   aviso `SEM PP · STRUGGLE`, na linha do multiplicador. Sem `not-allowed`: o
   cursor prometia um botão desabilitado que nunca existiu. */
.move--empty {
  opacity: 0.45;
}

.move__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}

.move__name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.move__mult {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.move__mult--strong {
  color: var(--hp);
}

.move__mult--weak {
  color: var(--deficit);
}

/* O aviso (`×0 NÃO AFETA`, `JÁ PARALISADO`) é sempre alerta, e ocupa o mesmo
   lugar do multiplicador. */
.move__mult--note {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--deficit);
}

.move__foot {
  display: flex;
  align-items: center;
  gap: 7px;
}

.move__detail {
  font-size: 10px;
  color: var(--text-muted);
}

.move__pp {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .move {
    transition: none;
  }
}
</style>
