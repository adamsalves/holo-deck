<script setup lang="ts">
import { computed } from 'vue'
import type { BattlePokemon } from '~~/shared/game/battle'
import { CONDITION_LABELS, effectiveSpeed, PARALYSIS_SPEED_FACTOR } from '~~/shared/game/status'
import { POTION_HP_THRESHOLD } from '~~/shared/game/ai'

/**
 * O painel de quem está em campo — a prancha *Batalha*, nos dois lados.
 *
 * Nome, Lv50, condição, tipos, barra de HP e uma linha de dois stats. O mesmo
 * componente serve o líder e o jogador: o que muda entre os dois é a moldura,
 * não o conteúdo, e duplicá-lo seria a chance de as duas barras divergirem em
 * como leem o mesmo HP.
 */
const props = defineProps<{
  pokemon: BattlePokemon
  /** O do jogador ganha a moldura do próprio tipo, como no canvas. */
  own?: boolean
}>()

const ratio = computed(() => props.pokemon.maxHp === 0
  ? 0
  : Math.max(0, props.pokemon.hp) / props.pokemon.maxHp)

/**
 * A barra fica vermelha abaixo de `POTION_HP_THRESHOLD`.
 *
 * O corte não é estético: é a mesma fração em que o líder da faixa B decide
 * gastar a poção. A barra passa a mostrar a regra que o motor executa, em vez de
 * inventar um limiar próprio ao lado dela.
 */
const critical = computed(() => ratio.value <= POTION_HP_THRESHOLD)

const paralysed = computed(() => props.pokemon.condition?.kind === 'paralysis')

const speed = computed(() => effectiveSpeed(props.pokemon.stats, props.pokemon.condition))

/**
 * O segundo número da linha, e a Speed é sempre o primeiro.
 *
 * A Speed fica porque é ela que decide a ordem do turno e é a única que a
 * paralisia muda — a prancha estampa `SPD 45 (90÷2)` justamente por isso. O
 * acompanhante é o mais alto dos outros quatro, pela mesma razão que a carta do
 * deck escolhe um: repetir ATK nos dois lados seria dizer duas vezes a mesma
 * coisa sobre Pokémon diferentes.
 */
const standout = computed(() => {
  const stats = props.pokemon.stats
  const candidates = [
    { label: 'ATK', value: stats.attack },
    { label: 'DEF', value: stats.defense },
    { label: 'SpA', value: stats.specialAttack },
    { label: 'SpD', value: stats.specialDefense },
  ]
  return candidates.reduce((best, candidate) => (candidate.value > best.value ? candidate : best))
})
</script>

<template>
  <article
    class="combatant bevel-tile"
    :class="{ 'combatant--own': own }"
    :data-type="pokemon.types[0]"
  >
    <header class="combatant__head">
      <h2 class="combatant__name">
        {{ pokemon.displayName }}
        <span class="numeric combatant__level">Lv50</span>
      </h2>

      <div class="combatant__marks">
        <span
          v-if="pokemon.condition"
          class="numeric combatant__condition"
        >{{ CONDITION_LABELS[pokemon.condition.kind] }}</span>
        <DexTypeBadge
          v-for="type in pokemon.types"
          :key="type"
          :type="type"
        />
      </div>
    </header>

    <div class="combatant__track">
      <div
        class="combatant__fill"
        :class="{ 'combatant__fill--critical': critical }"
        :style="{ width: `${ratio * 100}%` }"
      />
    </div>

    <footer class="numeric combatant__foot">
      <p class="combatant__stats">
        <span>{{ standout.label }} <b>{{ standout.value }}</b></span>
        <span>
          SPD <b :class="{ combatant__slowed: paralysed }">{{ speed }}</b>
          <template v-if="paralysed">
            ({{ pokemon.stats.speed }}÷{{ 1 / PARALYSIS_SPEED_FACTOR }})
          </template>
        </span>
      </p>
      <p class="combatant__hp">
        {{ Math.max(0, pokemon.hp) }}<span>/{{ pokemon.maxHp }}</span>
      </p>
    </footer>
  </article>
</template>

<style scoped>
.combatant {
  box-sizing: border-box;
  width: 100%;
  max-width: 352px;
  padding: 15px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.combatant--own {
  border-color: var(--type);
}

.combatant__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  margin-bottom: 9px;
}

.combatant__name {
  display: flex;
  align-items: baseline;
  gap: 9px;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
}

.combatant__level {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.combatant__marks {
  display: flex;
  align-items: center;
  gap: 4px;
}

.combatant__condition {
  padding: 4px 7px;
  border-radius: var(--radius);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--bg);
  background: var(--deficit);
}

.combatant__track {
  overflow: hidden;
  height: 9px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
}

.combatant__fill {
  height: 100%;
  background: var(--hp);
  box-shadow: 0 0 12px color-mix(in oklab, var(--hp) 70%, transparent);
  transition: width 240ms var(--ease-out);
}

.combatant__fill--critical {
  background: var(--deficit);
  box-shadow: 0 0 12px color-mix(in oklab, var(--deficit) 70%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .combatant__fill {
    transition: none;
  }
}

.combatant__foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 9px;
  margin-top: 7px;
  font-size: 11px;
  color: var(--text-muted);
}

.combatant__stats {
  display: flex;
  gap: 10px;
}

.combatant__stats b {
  font-weight: 700;
  color: var(--text-body);
}

.combatant__slowed {
  color: var(--deficit);
}

.combatant__hp {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.combatant__hp span {
  font-weight: 400;
  color: var(--text-muted);
}
</style>
