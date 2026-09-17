<script setup lang="ts">
import { computed } from 'vue'
import { multiplierLabel } from '~~/shared/game/typechart'
import { rarityFrom } from '~~/shared/game/rarity'
import type { BattleStats } from '~~/shared/game/stats'
import type { SearchEntry, StatName } from '~~/shared/types/dex'
import { rarityKey, statKey, typeKey } from '~~/shared/types/game'

const { t } = useI18n()

/**
 * Um dos seis slots — a mesma carta do sistema, com o rodapé que o deck precisa.
 *
 * Terceiro consumidor da `PokeCard`, depois do grid da Pokédex e do binder, e o
 * primeiro a usar o degrau que a Fase 6 abriu: o rodapé hospeda uma ação (tirar
 * do deck) sem aninhar interativo dentro do link. Ver `.poke-card__link`.
 *
 * O rodapé é a caixa única, como no binder: **um slot, dois estados**. Aqui os
 * estados não são raridade e moagem, são a linha de stats e o botão de tirar —
 * e é o mesmo argumento de altura que os mantém no mesmo lugar, agora com uma
 * fileira de seis onde a divergência apareceria de imediato.
 *
 * **Os stats são de Lv50, e é decisão de 04/09.** A prancha *Deck* escrevia
 * `HP 35` (base) e a *Batalha* `110` (Lv50) para o mesmo Pikachu — duas telas
 * vizinhas escrevendo HP com significados diferentes. O deck é onde se decide
 * quem entra em campo, então ele mostra o que entra. A Detalhe segue em base
 * stat, e lá a aba se chama *Base stats*: está rotulada.
 */
const props = defineProps<{
  index: number
  entry: SearchEntry | null
  stats: BattleStats | null
  /** Quanto esta carta apanha do próximo ginásio; `1` quando não apanha mais. */
  incoming: number
}>()

const emit = defineEmits<{ remove: [], drop: [id: number] }>()

/**
 * O estado preenchido, resolvido de uma vez.
 *
 * Carta, raridade e link nascem juntos ou não nascem: um `entry` não-nulo
 * **implica** uma raridade e um destino, e três computeds separados fariam o
 * tipo perder essa implicação — o `v-if="entry"` do template estreita `entry` e
 * não estreita `rarity`, e a saída seria um `?? 'common'` que nunca roda,
 * escondendo a relação em vez de declará-la.
 */
const card = computed(() => {
  const entry = props.entry
  if (entry === null) return null

  const rarity = rarityFrom(entry)

  return {
    entry,
    rarity,
    link: {
      to: `/pokemon/${entry.slug}`,
      // O link cobre a carta e não tem texto dentro: este rótulo é o único nome
      // que ele tem.
      label: [
        entry.displayName,
        `slot ${props.index + 1}`,
        entry.types.map(type => t(typeKey(type))).join(' e '),
        t(rarityKey(rarity)),
      ].join(', '),
    },
  }
})

/**
 * The second number of the footer — the highest stat after HP.
 *
 * The board picks one per card rather than the same one for all (Pikachu shows
 * speed, Alakazam special attack, Geodude defense), and that is what makes the
 * line say something: repeating attack across six cards would be six times the
 * same axis.
 *
 * **The candidates carry the stat id and the locale writes the badge.** They
 * used to carry the abbreviation, and this was one of the three hand-written
 * copies of it: `SpA`, `SpD` and `SPD` sat in this very list, where the last two
 * are one badge to anyone reading it. Issue #20 has the finding and
 * `test/unit/stat-label-gate.spec.ts` is the gate; the annotation is what makes
 * the compiler check each id against `STAT_NAMES` instead of trusting a string.
 */
const standout = computed(() => {
  const stats = props.stats
  if (stats === null) return null

  const candidates: readonly { stat: StatName, value: number }[] = [
    { stat: 'attack', value: stats.attack },
    { stat: 'defense', value: stats.defense },
    { stat: 'special-attack', value: stats.specialAttack },
    { stat: 'special-defense', value: stats.specialDefense },
    { stat: 'speed', value: stats.speed },
  ]

  const best = candidates.reduce((top, candidate) => (
    candidate.value > top.value ? candidate : top
  ))

  return { label: t(statKey(best.stat)), value: best.value }
})

/**
 * Soltar uma carta arrastada.
 *
 * O `dataTransfer` carrega o id como texto porque é o único formato que o HTML5
 * garante entre navegadores. Um id que não vira número é descartado calado: o
 * navegador deixa qualquer coisa ser arrastada para cá, inclusive texto de outra
 * aba.
 */
function onDrop(event: DragEvent): void {
  const raw = event.dataTransfer?.getData('text/plain') ?? ''
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return

  emit('drop', id)
}
</script>

<template>
  <article
    class="deck-slot"
    :class="{ 'deck-slot--empty': card === null, 'deck-slot--weak': incoming > 1 }"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <DexPokeCard
      v-if="card"
      :dex-number="card.entry.id"
      :name="card.entry.displayName"
      :types="card.entry.types"
      :rarity="card.rarity"
      :link="card.link"
    >
      <template #art>
        <img
          :src="`/sprites/${card.entry.id}.webp`"
          alt=""
          width="128"
          height="128"
          loading="lazy"
          decoding="async"
        >
      </template>

      <template #footer>
        <p
          v-if="stats && standout"
          class="numeric deck-slot__foot"
        >
          <span>{{ t(statKey('hp')) }} {{ stats.hp }}</span>
          <span>{{ standout.label }} {{ standout.value }}</span>
        </p>
        <!-- Sem os stats a linha continua existindo, vazia: é a mesma caixa, e
             a fileira de seis não pode subir e descer enquanto a geração carrega. -->
        <p
          v-else
          class="numeric deck-slot__foot deck-slot__foot--waiting"
          aria-hidden="true"
        >
          <span>—</span>
        </p>

        <!-- O alerta de matchup, que é a razão de a leitura de cobertura
             existir — **no fluxo**, logo abaixo dos stats.

             Ele era `position: absolute; bottom: 0` e cobria 9,5px da linha de
             stats: a faixa tem ~21px e o recuo de baixo da carta tem 11. Ou
             seja, escondia a metade inferior de `HP 136 / ATK 104` justamente na
             carta que mais se quer ler. No fluxo isso não tem como acontecer, e
             a arte encolhe no lugar (ela é `flex: 1`), então a fileira de seis
             continua com a mesma altura. -->
        <p
          v-if="incoming > 1"
          class="numeric deck-slot__warning"
        >
          {{ t('deck.slot.takes', { multiplier: multiplierLabel(incoming) }) }}
        </p>
      </template>
    </DexPokeCard>

    <!-- Slot vazio: a moldura tracejada da prancha, na mesma proporção 5:7 para
         a fileira não mudar de altura conforme enche. -->
    <div
      v-else
      class="deck-slot__empty bevel-tile"
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <!--
        The line break travels **inside** the key, as a `{break}` slot, because
        this is one sentence that happens to wrap: the translator sees *ARRASTE
        UMA CARTA* whole and decides where it folds, which in en is a different
        place than in pt-BR.

        `packs.vue` stacks its asides the other way — two keys with a `<br>`
        between them in the template — and that is the same rule, not a second
        one: those are two independent sentences that happen to sit on two lines,
        and one of them carries its own `<span>`. Merging them would hand the
        translator a single string for two thoughts.
      -->
      <i18n-t
        class="numeric deck-slot__hint"
        keypath="deck.slot.hint"
        scope="global"
        tag="p"
      >
        <template #break>
          <br>
        </template>
      </i18n-t>
    </div>

    <!-- Tirar do deck. Fora do link e acima dele, que é o degrau que a `PokeCard`
         publica. Some no slot vazio: não há o que tirar. -->
    <button
      v-if="card"
      type="button"
      class="deck-slot__remove"
      :aria-label="t('deck.slot.removeLabel', { name: card.entry.displayName, slot: index + 1 })"
      @click="emit('remove')"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </article>
</template>

<style scoped>
.deck-slot {
  position: relative;
}

.deck-slot__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  box-sizing: border-box;
  aspect-ratio: 5 / 7;
  background: var(--surface-sunken);
  border: 1px dashed var(--border-strong);
  color: var(--border-strong);
}

.deck-slot__hint {
  font-size: 10px;
  letter-spacing: 0.1em;
  line-height: 1.6;
  text-align: center;
  color: var(--text-faint);
}

/* A caixa única do rodapé, pelo mesmo argumento do binder: enquanto as métricas
   moram aqui e não em cada estado, os dois não têm como divergir em altura. */
.deck-slot__foot {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin: 4px 0 0;
  padding: 3px 0;
  font-size: 10px;
  line-height: 1.2;
  color: var(--text-muted);
}

.deck-slot__foot--waiting {
  color: var(--text-faint);
}

/* Acima da camada do link — o degrau 2 que `.poke-card__link` reserva para quem
   tem ação. */
.deck-slot__remove {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 2px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  cursor: pointer;
}

.deck-slot__remove:hover,
.deck-slot__remove:focus-visible {
  color: var(--text);
  border-color: var(--deficit);
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/**
 * A faixa `LEVA ×2` da prancha, sangrando até as bordas da carta.
 *
 * As margens negativas anulam os recuos que a `PokeCard` **publica** como
 * `--card-gutter` e `--card-foot`. Escrever `-9px` e `-11px` aqui funcionaria
 * igual hoje e desalinharia no dia em que a carta mudasse de recuo, sem nada
 * acusar — é a mesma razão de a escada de `z-index` estar documentada lá e não
 * adivinhada aqui.
 *
 * Ela é aviso e não ação, então não intercepta ponteiro: o resto da carta
 * continua navegando por baixo dela.
 */
.deck-slot__warning {
  margin:
    4px
    calc(var(--card-gutter) * -1)
    calc(var(--card-foot) * -1);
  padding: 4px;
  pointer-events: none;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-align: center;
  color: var(--bg);
  background: var(--deficit);
}

.deck-slot--weak :deep(.poke-card) {
  border-color: var(--deficit);
}
</style>
