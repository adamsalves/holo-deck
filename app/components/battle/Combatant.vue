<script setup lang="ts">
import { computed } from 'vue'
import type { BattlePokemon } from '~~/shared/game/battle'
import { effectiveSpeed, PARALYSIS_SPEED_FACTOR } from '~~/shared/game/status'
import type { StatName } from '~~/shared/types/dex'
import { conditionKey, statKey } from '~~/shared/types/game'
import { POTION_HP_THRESHOLD } from '~~/shared/game/ai'

const { t } = useI18n()

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
 * The second number of the line, and speed is always the first.
 *
 * Speed stays because it is what decides the turn order and the only one
 * paralysis changes — the board stamps the line with the divided value
 * (`45 (90÷2)`) for exactly that reason. Its companion is the highest of the
 * other four, for the same reason the deck card picks one: repeating attack on
 * both sides would say the same thing twice about different Pokémon.
 *
 * **The badge comes from the locale**, and the abbreviation this HUD wrote by
 * hand is where issue #20 was most visible: `SpD` in this list and `SPD` in the
 * template below were one badge on one screen. The *Detail* board answers with
 * `DEE`/`VEL` in Portuguese and `SpD`/`SPE` in English, and
 * `test/unit/stat-label-gate.spec.ts` holds both sides of it.
 */
const standout = computed(() => {
  const stats = props.pokemon.stats
  const candidates: readonly { stat: StatName, value: number }[] = [
    { stat: 'attack', value: stats.attack },
    { stat: 'defense', value: stats.defense },
    { stat: 'special-attack', value: stats.specialAttack },
    { stat: 'special-defense', value: stats.specialDefense },
  ]

  const best = candidates.reduce((top, candidate) => (
    candidate.value > top.value ? candidate : top
  ))

  return { label: t(statKey(best.stat)), value: best.value }
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
        >{{ t(conditionKey(pokemon.condition.kind)) }}</span>
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
          {{ t(statKey('speed')) }}
          <b :class="{ combatant__slowed: paralysed }">{{ speed }}</b>
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

:root[data-reduce-motion] .combatant__fill {
  transition: none;
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
