<script setup lang="ts">
import type { CoreData, TypeName } from '~~/shared/types/dex'
import { computed } from 'vue'
import { incomingDamageRelations, multiplierLabel } from '~~/shared/game/typechart'

/**
 * As relações de dano *recebido* — o painel que a prancha *Detalhe* anota como
 * *calculado na matriz 18×18, tipo duplo multiplicativo*.
 *
 * Ele mostra só quem foge do neutro. Onze dos dezoito tipos batem ×1 em
 * Charizard, e listá-los gastaria o painel inteiro para não informar nada.
 */
const props = defineProps<{
  effectiveness: CoreData['effectiveness']
  types: readonly TypeName[]
}>()

const relations = computed(() => incomingDamageRelations(props.effectiveness, props.types))
</script>

<template>
  <section>
    <h2 class="relations__title">
      Relações de dano
      <span class="relations__note">— calculadas na matriz 18×18, tipo duplo multiplicativo</span>
    </h2>

    <div class="relations__groups">
      <div v-if="relations.weak.length > 0">
        <p class="numeric relations__group">
          Recebe mais dano
        </p>
        <ul class="relations__list">
          <li
            v-for="relation in relations.weak"
            :key="relation.type"
          >
            <DexTypeBadge :type="relation.type" />
            <span class="numeric relations__multiplier">{{ multiplierLabel(relation.multiplier) }}</span>
          </li>
        </ul>
      </div>

      <div v-if="relations.resistant.length > 0">
        <p class="numeric relations__group">
          Recebe menos / nada
        </p>
        <ul class="relations__list">
          <li
            v-for="relation in relations.resistant"
            :key="relation.type"
          >
            <DexTypeBadge :type="relation.type" />
            <span class="numeric relations__multiplier">{{ multiplierLabel(relation.multiplier) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.relations__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.relations__note {
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
  color: var(--text-faint);
}

.relations__groups {
  display: grid;
  gap: 20px;
  margin-top: 14px;
}

@media (min-width: 640px) {
  .relations__groups {
    grid-template-columns: 1fr 1fr;
  }
}

.relations__group {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.relations__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.relations__list li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.relations__multiplier {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-body);
}
</style>
