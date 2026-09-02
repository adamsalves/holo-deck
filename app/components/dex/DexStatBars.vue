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

/**
 * As seis abreviações, e o nome por extenso que o leitor de tela recebe.
 *
 * `SpD` (defesa especial) e `SPD` (velocidade) diferiam só por caixa, em linhas
 * vizinhas — e para um leitor de tela elas são a mesma sequência de letras.
 * `VEL` desfaz a colisão à vista, e o nome por extenso resolve as seis de uma
 * vez: num projeto que trocou `{{ rarity }}` cru por `RARITY_LABELS` para não
 * ler enum em inglês no meio de uma frase em português, seis siglas mudas
 * destoam.
 */
const STAT_LABELS = [
  { short: 'HP', long: 'Pontos de saúde' },
  { short: 'ATK', long: 'Ataque' },
  { short: 'DEF', long: 'Defesa' },
  { short: 'SpA', long: 'Ataque especial' },
  { short: 'SpD', long: 'Defesa especial' },
  { short: 'VEL', long: 'Velocidade' },
] as const

const total = computed(() => baseStatTotal(props.baseStats))

const highest = computed(() => Math.max(...props.baseStats))

const rows = computed(() => props.baseStats.map((value, index) => ({
  label: STAT_LABELS[index]?.short ?? '',
  longLabel: STAT_LABELS[index]?.long ?? '',
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
      <h2 class="stat-header__title">
        Base stats
      </h2>
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
        <!-- Sigla à vista, nome por extenso para quem ouve. **Não** por
             `aria-label`: um `dt` mapeia para o papel `term`, que está na lista
             de *name from: prohibited* da ARIA 1.2 — o atributo é inválido ali e
             o leitor de tela o ignora, deixando a sigla muda do mesmo jeito. -->
        <dt class="numeric stat-row__label">
          <span aria-hidden="true">{{ row.label }}</span>
          <span class="sr-only">{{ row.longLabel }}</span>
        </dt>
        <!-- A trilha vive **dentro** do `dd`, e não como terceiro irmão: num
             `dl`, o `div` de agrupamento só admite `dt` e `dd`, e um terceiro
             filho torna o documento inválido. O grid não muda — o `dd` é quem
             passa a ocupar as duas colunas. -->
        <dd class="stat-row__cell">
          <span class="numeric stat-row__value">{{ row.value }}</span>
          <span class="stat-row__track">
            <span
              class="stat-row__fill"
              :class="{ 'stat-row__fill--highest': row.isHighest }"
              :style="{ width: `${row.percent}%` }"
            />
          </span>
        </dd>
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
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 10px;
}

/* O `dd` carrega valor e trilha, então ele repete a grade que o `stat-row`
   tinha nas duas últimas colunas. */
.stat-row__cell {
  display: grid;
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 10px;
  margin: 0;
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
  display: block;
  height: 7px;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.stat-row__fill {
  display: block;
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
