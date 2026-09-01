<script setup lang="ts">
import type { BaseStats, TypeName } from '~~/shared/types/dex'
import { computed } from 'vue'
import { baseStatTotal, MAX_BASE_STAT, MAX_BASE_STAT_TOTAL } from '~~/shared/game/rarity'

/**
 * Os seis base stats, como a prancha *Detalhe* os desenha.
 *
 * **O mais alto recebe a cor-luz do tipo** — a anotação da prancha *Componente
 * central* diz por quê: é a leitura instantânea do papel da carta. Charizard tem
 * SpA acesa e se lê como atacante especial sem ninguém escrever isso.
 *
 * A escala é o teto do dex (255 num stat, 720 no BST), não os ~165 do mockup.
 * A prancha escala pelo que cabe bonito nela; 255 é o HP da Blissey, e uma barra
 * que passa de 100% da trilha não é uma barra.
 */
const props = defineProps<{
  baseStats: BaseStats
  type: TypeName
}>()

const STAT_LABELS = ['HP', 'ATK', 'DEF', 'SpA', 'SpD', 'SPD'] as const

const total = computed(() => baseStatTotal(props.baseStats))

const highest = computed(() => Math.max(...props.baseStats))

const rows = computed(() => props.baseStats.map((value, index) => ({
  label: STAT_LABELS[index] ?? '',
  value,
  percent: (value / MAX_BASE_STAT) * 100,
  // Empate acende os dois: escolher um pelo índice mentiria sobre qual é o
  // maior, e há espécies com dois stats iguais no topo.
  isHighest: value === highest.value,
})))
</script>

<template>
  <section :data-type="type">
    <header class="stat-header">
      <h3 class="stat-header__title">
        Base stats
      </h3>
      <p class="numeric stat-header__total">
        BST <strong class="stat-header__value">{{ total }}</strong>
        <span class="stat-header__max"> / {{ MAX_BASE_STAT_TOTAL }} máx</span>
      </p>
    </header>

    <dl class="stat-rows">
      <div
        v-for="row in rows"
        :key="row.label"
        class="stat-row"
      >
        <dt class="numeric stat-row__label">
          {{ row.label }}
        </dt>
        <dd class="numeric stat-row__value">
          {{ row.value }}
        </dd>
        <div class="stat-row__track">
          <div
            class="stat-row__fill"
            :class="{ 'stat-row__fill--highest': row.isHighest }"
            :style="{ width: `${row.percent}%` }"
          />
        </div>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.stat-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.stat-header__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.stat-header__total {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-header__value {
  font-weight: 700;
  color: var(--text);
}

.stat-header__max {
  color: var(--text-faint);
}

.stat-rows {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.stat-row {
  display: grid;
  grid-template-columns: 34px 34px 1fr;
  align-items: center;
  gap: 10px;
}

.stat-row__label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.stat-row__value {
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  color: var(--text-body);
}

.stat-row__track {
  height: 7px;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.stat-row__fill {
  height: 100%;
  border-radius: var(--radius);
  background: var(--border-strong);
}

/* O maior stat da espécie, na cor-luz do tipo primário. O halo é o que faz a
   leitura ser instantânea — sem ele a diferença é só de matiz. */
.stat-row__fill--highest {
  background: var(--type);
  box-shadow: 0 0 16px color-mix(in oklab, var(--type) 70%, transparent);
}
</style>
