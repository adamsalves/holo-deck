<script setup lang="ts">
import { computed } from 'vue'
import { noiseChance, switchesOnBadMatchup, usesPotion } from '~~/shared/game/ai'
import { POTIONS_PER_SIDE, POTION_HEAL_FRACTION } from '~~/shared/game/battle'
import {
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  RANDOM_MAX_PERCENT,
  RANDOM_MIN_PERCENT,
  STAB_MULTIPLIER,
} from '~~/shared/game/damage'
import { DUST_PER_DUPLICATE, FORGE_COST, FORGE_RATIO } from '~~/shared/game/dust'
import {
  FLAWLESS_RATE,
  GYM_REWARD_BASE,
  GYM_REWARD_STEP,
  PACK_PRICE,
  REMATCH_RATE,
  WELCOME_PACKS,
  gymReward,
} from '~~/shared/game/economy'
import { GYM_BANDS } from '~~/shared/game/gyms'
import { BATTLE_MOVE_SLOTS } from '~~/shared/game/moveset'
import {
  COMMON_SLOTS,
  PACK_SIZE,
  PITY_THRESHOLD,
  RARE_PLUS_SLOTS,
  RARE_PLUS_TIERS,
  RARE_PLUS_WEIGHTS,
  SHINY_ODDS,
  UNCOMMON_SLOTS,
} from '~~/shared/game/packs'
import { gameNumber, gamePercent } from '~~/shared/game/progress'
import { RARITY_THRESHOLDS } from '~~/shared/game/rarity'
import { BATTLE_IV, BATTLE_LEVEL } from '~~/shared/game/stats'
import {
  BURN_ATTACK_FACTOR,
  BURN_DAMAGE_FRACTION,
  PARALYSIS_SKIP_CHANCE,
  PARALYSIS_SPEED_FACTOR,
  POISON_DAMAGE_FRACTION,
  SLEEP_MAX_TURNS,
  SLEEP_MIN_TURNS,
} from '~~/shared/game/status'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'
import type { AilmentName, TypeName } from '~~/shared/types/dex'
import { AILMENT_NAMES, TYPE_COUNT } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { ailmentKey, rarityKey, RARITY_NAMES, statKey, statNameKey } from '~~/shared/types/game'
import { TURN_STEPS, turnStepKey } from '~~/app/utils/turn-order'

const { t } = useI18n()

/**
 * `/rules` — a referência, e a única tela do jogo cujo contrato é **não conter
 * número nenhum**.
 *
 * O plano fecha a Fase 6 com ela e escreve a razão: as regras estão espalhadas
 * por três fases — dano e status na 4, raridade e pity na 5, economia na 6 — e
 * "spec espalhada" foi o padrão de quase todo defeito que a revisão do plano
 * encontrou. Uma fonte só, consumida pelo motor **e** pela página, é rede contra
 * deriva antes de ser cortesia com o jogador.
 *
 * **Nada aqui é redigido.** Trocar o pity de 10 para 8 em `shared/game/packs.ts`
 * muda esta tela no mesmo commit, e `test/unit/rules-gate.spec.ts` anda por este
 * arquivo procurando os números calibrados escritos à mão. É documentação que
 * não pode mentir porque não é escrita — é derivada.
 *
 * O que a página **pode** escrever é prosa: o porquê de cada regra, que não mora
 * em constante nenhuma. A linha divisória é essa — número, não; frase, sim.
 */

/** `1,5` e `0,5` no lugar de `1.5` — o documento é `lang="pt-BR"`. */
function decimal(value: number, places = 1): string {
  return value.toFixed(places).replace('.', ',')
}

/** `1/24`, `1/16`, `1/8` — a fração como o jogador a lê, e não como float. */
function ratio(fraction: number): string {
  return `1/${Math.round(1 / fraction)}`
}

/**
 * As faixas de BST, derivadas dos limiares.
 *
 * O topo de cada faixa é o limiar seguinte menos um, e é assim que a tabela
 * fecha sem buraco nem sobreposição: um limiar movido reescreve as duas linhas
 * vizinhas de uma vez. A prancha escreve `475 – 528` e `529 – 580`, que é
 * exatamente esta conta.
 */
const rarityBands = computed(() => {
  const derived: Rarity[] = ['common', 'uncommon', 'rare', 'ultra']

  return derived.map((tier, index) => {
    const floor = RARITY_THRESHOLDS[index - 1]
    const ceiling = RARITY_THRESHOLDS[index]

    const range = floor === undefined
      ? `BST < ${ceiling}`
      : ceiling === undefined ? `> ${floor - 1}` : `${floor} – ${ceiling - 1}`

    return { tier, label: t(rarityKey(tier)), range }
  })
})

/** Os dois recortes por marca, que não são faixa de BST e por isso ficam à parte. */
const rarityMarks = computed(() =>
  (['legendary', 'mythic'] as const).map(tier => ({
    tier,
    label: t(rarityKey(tier)),
    source: tier === 'legendary' ? 'is_legendary' : 'is_mythical',
  })))

/**
 * A tabela de forja, com lendário e mítico numa linha só.
 *
 * A fusão não é diagramação: os dois pagam o mesmo pó de propósito — são
 * recortes por marca, e nenhum critério do jogo os ordena entre si —, e a
 * condição abaixo lê o próprio valor em vez de assumir isso. No dia em que eles
 * divergirem, a tabela se separa sozinha.
 */
const forgeRows = computed(() => {
  const rows: { key: string, label: string, tier: Rarity, dust: number, cost: number }[] = []

  for (const tier of RARITY_NAMES) {
    const previous = rows.at(-1)
    if (previous !== undefined && DUST_PER_DUPLICATE[previous.tier] === DUST_PER_DUPLICATE[tier]) {
      previous.label = `${previous.label} / ${t(rarityKey(tier))}`
      previous.key = `${previous.key}+${tier}`
      continue
    }

    rows.push({
      key: tier,
      label: t(rarityKey(tier)),
      tier,
      dust: DUST_PER_DUPLICATE[tier],
      cost: FORGE_COST[tier],
    })
  }

  return rows
})

const rarePlusOdds = computed(() =>
  RARE_PLUS_TIERS.map(tier => gamePercent(RARE_PLUS_WEIGHTS[tier])).join(' / '))

/**
 * The formula, with the level in plain sight.
 *
 * `BATTLE_LEVEL` is interpolated because it **is** a decision of the game —
 * fixed level on both sides — and not part of the shape of the arithmetic. The
 * other numbers in the expression (the 5, the two 2s and the 50) are the
 * series' formula, and changing them would be writing a different formula, not
 * recalibrating this one.
 *
 * It is the one message `rules-gate` cuts before sweeping, and it cuts it **by
 * key**: the sentence that used to be spelled here in Portuguese is now spelled
 * in each locale, and a pattern matching `dano = …` would have stopped matching
 * the English one the moment it said `damage = …`.
 */
const damageFormula = computed(() => t('rules.battle.formula', { level: BATTLE_LEVEL }))

/**
 * As quatro condições, cada uma pintada pelo **tipo que a causa** — elétrico
 * paralisa, fogo queima, venenoso envenena, psíquico dorme.
 *
 * O tipo viaja como dado e não como classe porque é assim que o sistema pinta
 * qualquer coisa por tipo: `data-type` no elemento, `var(--type)` no CSS. Ler
 * `--color-type-fire` direto seria pular a camada semântica, e o portão de token
 * recusa — com razão, porque a cor não é *da condição*, é da fonte dela.
 */
const CONDITION_TYPES: Record<AilmentName, TypeName> = {
  paralysis: 'electric',
  burn: 'fire',
  poison: 'poison',
  sleep: 'psychic',
}

const conditions = computed(() => AILMENT_NAMES.map(name => ({
  name,
  type: CONDITION_TYPES[name],
  label: t(ailmentKey(name)).toUpperCase(),
  effect: {
    paralysis: t('rules.conditions.paralysis', {
      stat: t(statKey('speed')),
      factor: decimal(PARALYSIS_SPEED_FACTOR),
      chance: gamePercent(PARALYSIS_SKIP_CHANCE),
    }),
    burn: t('rules.conditions.burn', {
      factor: decimal(BURN_ATTACK_FACTOR),
      fraction: ratio(BURN_DAMAGE_FRACTION),
    }),
    poison: t('rules.conditions.poison', { fraction: ratio(POISON_DAMAGE_FRACTION) }),
    sleep: t('rules.conditions.sleep', { min: SLEEP_MIN_TURNS, max: SLEEP_MAX_TURNS }),
  }[name],
})))

/** O ruído do primeiro ginásio e o do último — a curva de dificuldade, medida. */
const noiseRange = computed(() => ({
  first: gamePercent(noiseChance(1)),
  last: gamePercent(noiseChance(GYM_COUNT)),
}))

/** Em que faixa cada comportamento do líder entra. */
const aiSteps = computed(() => {
  const first = (able: (gym: number) => boolean): number =>
    GYM_BANDS.find(band => able(band.first))?.first ?? GYM_COUNT

  return { potion: first(usesPotion), swap: first(switchesOnBadMatchup) }
})

/**
 * O que a campanha inteira paga, e quantos packs isso compra.
 *
 * Somado sobre os nove em vez de escrito: é a razão que dá sentido à Liga, e ela
 * muda junto com a curva de recompensa **e** com o preço do pack. Escrever
 * `6.300` aqui seria a terceira cópia de um número que já tem duas fontes.
 */
const rewards = computed(() =>
  Array.from({ length: GYM_COUNT }, (_, index) => index + 1)
    .filter(isGymId)
    .map(gymReward))

const campaign = computed(() => {
  const total = rewards.value.reduce((sum, reward) => sum + reward, 0)

  return { total, packs: Math.floor(total / PACK_PRICE) }
})

/**
 * A curva da recompensa como a prancha a escreve: `200 + 100×n`.
 *
 * A fórmula e não a faixa, porque é a fórmula que explica **por que** o nono
 * ginásio paga mais — e as duas parcelas vêm nomeadas de `economy.ts` para a
 * página poder escrevê-la sem digitar nenhuma delas.
 */
const rewardCurve = computed(() =>
  `${gameNumber(GYM_REWARD_BASE)} + ${gameNumber(GYM_REWARD_STEP)}×n`)

useSeoMeta({
  title: () => t('rules.seo.title'),
  description: () => t('rules.seo.description'),
})
</script>

<template>
  <main class="rules">
    <header class="rules__header">
      <div>
        <p class="rules__eyebrow">
          {{ t('rules.overline') }}
        </p>
        <h1 class="rules__title">
          {{ t('nav.rules') }}
        </h1>
      </div>

      <p class="numeric rules__aside">
        <i18n-t
          keypath="rules.source"
          scope="global"
          tag="span"
        >
          <template #module>
            <b>shared/game/</b>
          </template>
        </i18n-t><br>
        <b>{{ t('rules.derived') }}</b>
      </p>
    </header>

    <div class="rules__row rules__row--thirds">
      <!-- RARIDADE -->
      <!-- `data-panel` is the e2e's hook: the forge table below carries the same
           `data-rarity` and `.rules__key--rarity`, so without it a locator for a
           tier matches two lines with different text. -->
      <section
        class="rules__panel"
        data-panel="rarity"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.rarity.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.rarity.note') }}
        </p>

        <dl class="rules__list">
          <div
            v-for="band in rarityBands"
            :key="band.tier"
            class="rules__line"
            :data-rarity="band.tier"
          >
            <dt class="rules__key rules__key--rarity">
              {{ band.label.toUpperCase() }}
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ band.range }}
            </dd>
          </div>
          <div
            v-for="mark in rarityMarks"
            :key="mark.tier"
            class="rules__line"
            :data-rarity="mark.tier"
          >
            <dt class="rules__key rules__key--rarity">
              {{ mark.label.toUpperCase() }}
            </dt>
            <dd class="numeric rules__value">
              {{ mark.source }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          <i18n-t
            keypath="rules.rarity.foot"
            scope="global"
            tag="span"
          >
            <template #rare>
              <em>{{ t(rarityKey('rare')) }}</em>
            </template>
          </i18n-t>
        </p>
      </section>

      <!-- PACKS -->
      <section
        class="rules__panel"
        data-panel="packs"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.packs.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.packs.note', { count: PACK_SIZE }) }}
        </p>

        <dl class="rules__list">
          <div
            class="rules__line"
            data-rarity="common"
          >
            <dt class="rules__key">
              {{ t('rules.packs.common') }}
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ COMMON_SLOTS }}
            </dd>
          </div>
          <div
            class="rules__line"
            data-rarity="uncommon"
          >
            <dt class="rules__key">
              {{ t('rules.packs.uncommon') }}
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ UNCOMMON_SLOTS }}
            </dd>
          </div>
          <div
            class="rules__line"
            data-rarity="rare"
          >
            <dt class="rules__key">
              {{ t('rules.packs.rarePlus') }}
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ RARE_PLUS_SLOTS }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="numeric rules__key rules__key--small">
              {{ t('rules.packs.rarePlusRoll') }}
            </dt>
            <dd class="numeric rules__value rules__value--small">
              {{ rarePlusOdds }}
            </dd>
          </div>
          <div
            class="rules__line"
            data-rarity="ultra"
          >
            <dt class="rules__key">
              {{ t('rules.packs.pity') }}
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ t('rules.packCount', { count: PITY_THRESHOLD }, PITY_THRESHOLD) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.packs.shiny') }}
            </dt>
            <dd class="numeric rules__value rules__value--shiny">
              1 / {{ 1 / SHINY_ODDS }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          {{ t('rules.packs.foot') }}
        </p>
      </section>

      <!-- PÓ E FORJA -->
      <section
        class="rules__panel"
        data-panel="forge"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.forge.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.forge.note') }}
        </p>

        <dl class="rules__list">
          <div class="rules__line">
            <dt class="numeric rules__key rules__key--small">
              {{ t('rules.forge.tier') }}
            </dt>
            <dd class="numeric rules__value rules__value--small">
              {{ t('rules.forge.dustForge') }}
            </dd>
          </div>
          <div
            v-for="row in forgeRows"
            :key="row.key"
            class="rules__line"
            :data-rarity="row.tier"
          >
            <dt class="rules__key rules__key--rarity">
              {{ row.label.toLowerCase() }}
            </dt>
            <dd class="numeric rules__value">
              {{ gameNumber(row.dust) }} · {{ gameNumber(row.cost) }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          {{ t('rules.forge.foot', { ratio: FORGE_RATIO }) }}
        </p>
      </section>
    </div>

    <div class="rules__row rules__row--wide">
      <!-- BATALHA -->
      <section
        class="rules__panel"
        data-panel="battle"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.battle.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.battle.note', { level: BATTLE_LEVEL, iv: BATTLE_IV }) }}
        </p>

        <p class="numeric rules__formula">
          {{ damageFormula }}
        </p>

        <ul class="rules__chips">
          <li class="numeric rules__chip">
            {{ t('rules.battle.stab', { multiplier: decimal(STAB_MULTIPLIER) }) }}
          </li>
          <li class="numeric rules__chip">
            {{ t('rules.battle.effectiveness') }}
          </li>
          <li class="numeric rules__chip">
            {{ t('rules.battle.crit', {
              multiplier: decimal(CRIT_MULTIPLIER),
              chance: ratio(CRIT_CHANCE),
            }) }}
          </li>
          <li class="numeric rules__chip">
            {{ t('rules.battle.random', {
              min: RANDOM_MIN_PERCENT,
              max: RANDOM_MAX_PERCENT,
            }) }}
          </li>
        </ul>

        <p class="numeric rules__aside rules__aside--inline">
          <!-- `A/D` is the variable of the formula above and stays; the four
               stats it reads come from the locale, because they are the same
               badges the *Detail* board stamps on the bars. Spelled by hand
               here, this page would say `Atk/Def` inside a document whose bars
               say `ATQ/DEF`. -->
          <i18n-t
            keypath="rules.battle.ratios"
            scope="global"
            tag="span"
          >
            <template #ad>
              <b>A/D</b>
            </template>
            <template #physical>
              {{ t(statKey('attack')) }}/{{ t(statKey('defense')) }}
            </template>
            <template #special>
              {{ t(statKey('special-attack')) }}/{{ t(statKey('special-defense')) }}
            </template>
            <template #types>
              {{ TYPE_COUNT }}
            </template>
          </i18n-t>
        </p>

        <p class="rules__eyebrow rules__eyebrow--spaced">
          {{ t('rules.battle.turnOrder') }}
        </p>
        <!-- Os marcadores são `<span>`, e não `::marker`: a prancha os desenha
             em mono e azul, e um pseudo-elemento não recebe a classe `numeric`
             que traz fonte e `tabular-nums` juntos. -->
        <ol class="rules__steps">
          <li
            v-for="(step, index) in TURN_STEPS"
            :key="step"
          >
            <span class="numeric rules__step-mark">{{ index + 1 }}</span>
            <!-- Every slot the six messages can ask for, offered to all of them:
                 vue-i18n fills the placeholders a message actually spells and
                 ignores the rest, which is what keeps this a loop. Naming them
                 per step would mean six written `<li>` and the ordinal above
                 kept by hand. -->
            <i18n-t
              :keypath="turnStepKey(step)"
              scope="global"
              tag="span"
            >
              <!-- The spelled-out name and not the badge, which is the split
                   `battle.initiative` already draws: prose names the stat
                   (*empate resolve por Velocidade*), a badge beside a number
                   abbreviates it (*VEL ×0,5*, two panels down). -->
              <template #stat>
                {{ t(statNameKey('speed')) }}
              </template>
              <template #chance>
                {{ gamePercent(PARALYSIS_SKIP_CHANCE) }}
              </template>
              <template #seed>
                <b>{{ t('rules.battle.steps.seed') }}</b>
              </template>
              <template #struggle>
                <b>{{ t('rules.battle.steps.struggle') }}</b>
              </template>
            </i18n-t>
          </li>
        </ol>

        <p class="rules__foot">
          {{ t('rules.battle.moves', { slots: BATTLE_MOVE_SLOTS }) }}
          <!-- The item sentence carries the count and the emphasis, so it is its
               own message: folding it into the two around it would have written
               the whole paragraph twice per language for the sake of one
               plural. -->
          <i18n-t
            keypath="rules.battle.potion"
            scope="global"
            tag="span"
            :plural="POTIONS_PER_SIDE"
          >
            <template #count>
              {{ POTIONS_PER_SIDE }}
            </template>
            <template #potion>
              <em class="rules__potion">
                {{ t('rules.battle.potionWord', POTIONS_PER_SIDE) }}
              </em>
            </template>
            <template #heal>
              {{ gamePercent(POTION_HEAL_FRACTION) }}
            </template>
          </i18n-t>
          {{ t('rules.battle.rematch') }}
        </p>
      </section>

      <!-- CONDIÇÕES -->
      <section
        class="rules__panel"
        data-panel="conditions"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.conditions.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.conditions.note') }}
        </p>

        <dl class="rules__conditions">
          <div
            v-for="condition in conditions"
            :key="condition.name"
          >
            <dt
              class="numeric rules__condition-name"
              :data-type="condition.type"
            >
              {{ condition.label }}
            </dt>
            <dd class="rules__condition-effect">
              {{ condition.effect }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          {{ t('rules.conditions.foot') }}
        </p>
      </section>
    </div>

    <div class="rules__row rules__row--wide">
      <!-- A LIGA -->
      <section
        class="rules__panel"
        data-panel="league"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.league.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.league.note', { count: GYM_COUNT }) }}
        </p>

        <div class="rules__bands">
          <div
            v-for="band in GYM_BANDS"
            :key="band.band"
            class="rules__band bevel-tile"
          >
            <p class="numeric rules__band-range">
              {{ t('rules.league.band', { first: band.first, last: band.last }) }}
            </p>
            <p class="numeric rules__band-size">
              {{ band.teamSize }}
            </p>
            <p class="rules__band-cap">
              {{ t('rules.league.bandCap') }}
              <b class="numeric">{{ band.bstCap }}</b>
            </p>
          </div>
        </div>

        <p class="rules__foot">
          <i18n-t
            keypath="rules.league.foot"
            scope="global"
            tag="span"
          >
            <template #and>
              <b>{{ t('rules.league.and') }}</b>
            </template>
            <template #first>
              {{ noiseRange.first }}
            </template>
            <template #last>
              {{ noiseRange.last }}
            </template>
            <template #potion>
              {{ aiSteps.potion }}
            </template>
            <template #swap>
              {{ aiSteps.swap }}
            </template>
          </i18n-t>
        </p>
      </section>

      <!-- ECONOMIA -->
      <section
        class="rules__panel"
        data-panel="economy"
      >
        <h2 class="rules__panel-title">
          {{ t('rules.economy.title') }}
        </h2>
        <p class="rules__panel-note">
          {{ t('rules.economy.note') }}
        </p>

        <dl class="rules__list">
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.welcome') }}
            </dt>
            <dd class="numeric rules__value rules__value--forge">
              {{ t('rules.packCount', { count: WELCOME_PACKS }, WELCOME_PACKS) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.gymFirst') }}
            </dt>
            <dd class="numeric rules__value rules__value--coin">
              {{ rewardCurve }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.gymRematch') }}
            </dt>
            <dd class="numeric rules__value rules__value--coin">
              {{ gamePercent(REMATCH_RATE) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.flawless') }}
            </dt>
            <dd class="numeric rules__value rules__value--progress">
              +{{ gamePercent(FLAWLESS_RATE) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.daily') }}
            </dt>
            <dd class="numeric rules__value rules__value--progress">
              {{ t('rules.economy.free') }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              {{ t('rules.economy.shop') }}
            </dt>
            <dd class="numeric rules__value">
              {{ gameNumber(PACK_PRICE) }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          <!-- `packs` arrives already spelled, through the same plural message
               the pity line uses: written as `{packs} packs` the sentence would
               read *about 1 packs* the day the campaign paid for one. -->
          {{ t('rules.economy.foot', {
            coins: gameNumber(campaign.total),
            packs: t('rules.packCount', { count: campaign.packs }, campaign.packs),
          }) }}
        </p>
      </section>
    </div>

    <footer class="numeric rules__end">
      <i18n-t
        keypath="rules.end"
        scope="global"
        tag="span"
      >
        <template #weakness>
          <b class="rules__end-warn">{{ t('rules.weakness') }}</b>
        </template>
      </i18n-t><br>
      <span class="rules__credits">
        {{ t('rules.credits') }}
      </span>
    </footer>
  </main>
</template>

<style scoped>
.rules {
  max-width: 1360px;
  margin: 0 auto;
  padding: 34px 36px 44px;
}

.rules__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  padding-bottom: 20px;
  margin-bottom: 26px;
  border-bottom: 1px solid var(--border);
}

.rules__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.rules__eyebrow--spaced {
  margin: 22px 0 12px;
}

.rules__title {
  margin-top: 9px;
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--text);
}

.rules__aside {
  max-width: 560px;
  font-size: 12px;
  line-height: 1.7;
  text-align: right;
  color: var(--text-muted);
}

.rules__aside b {
  font-weight: 400;
  color: var(--text-body);
}

.rules__aside--inline {
  margin-top: 11px;
  max-width: none;
  text-align: left;
  font-size: 11px;
}

.rules__row {
  display: grid;
  gap: 22px;
  margin-bottom: 22px;
}

.rules__row--thirds {
  grid-template-columns: repeat(3, 1fr);
}

.rules__row--wide {
  grid-template-columns: 1.6fr 1fr;
}

@media (width < 1100px) {
  .rules__row--thirds,
  .rules__row--wide {
    grid-template-columns: 1fr;
  }
}

.rules__panel {
  padding: 22px 24px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.rules__panel-title {
  font-size: 19px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}

.rules__panel-note {
  margin: 4px 0 18px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.rules__list {
  margin: 0;
}

.rules__line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-raised);
}

.rules__line:last-child {
  border-bottom: none;
}

.rules__key {
  font-size: 13px;
  color: var(--text-body);
}

/**
 * O nome do tier na cor dele — `--rarity-label` cobre mítico, que não cabe numa
 * cor só e chega como imagem recortada no texto.
 */
.rules__key--rarity {
  font-weight: 700;
  color: var(--rarity-label, var(--text-body));
  background: var(--rarity-text, none);
  background-clip: text;
}

.rules__key--small,
.rules__value--small {
  font-size: 11px;
  color: var(--text-muted);
}

.rules__value {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  text-align: right;
  color: var(--text-body);
}

.rules__value--rarity {
  color: var(--rarity);
}

.rules__value--shiny {
  color: var(--shiny);
}

.rules__value--coin {
  color: var(--coin);
}

.rules__value--forge {
  color: var(--forge);
}

.rules__value--progress {
  color: var(--progress-high);
}

.rules__foot {
  margin-top: 15px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-muted);
}

.rules__foot b {
  font-weight: 700;
  color: var(--text-body);
}

.rules__foot em {
  font-style: normal;
  color: var(--text-body);
}

.rules__foot .rules__potion {
  color: var(--hp);
}

.rules__formula {
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-sunken);
  font-size: 13px;
  line-height: 1.7;
  white-space: nowrap;
  overflow-x: auto;
  color: var(--text-body);
}

.rules__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin: 13px 0 0;
  padding: 0;
  list-style: none;
}

.rules__chip {
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-raised);
  font-size: 11px;
  color: var(--text-body);
}

.rules__steps {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-body);
}

.rules__steps li {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.rules__step-mark {
  flex-shrink: 0;
  width: 14px;
  font-size: 11px;
  color: var(--accent);
}

.rules__steps b {
  font-weight: 700;
  color: var(--text);
}

.rules__conditions {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 0;
}

/**
 * O nome da condição na cor do tipo que a causa — `--type` chega pelo
 * `data-type` no próprio elemento. Ver `CONDITION_TYPES` no script.
 */
.rules__condition-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--type, var(--text-body));
}

.rules__condition-effect {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.rules__bands {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (width < 640px) {
  .rules__bands {
    grid-template-columns: 1fr;
  }
}

.rules__band {
  padding: 14px 16px;
  border: 1px solid var(--border);
  background: var(--surface-raised);
}

.rules__band-range {
  font-size: 11px;
  color: var(--text-muted);
}

.rules__band-size {
  margin: 8px 0 3px;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
}

.rules__band-cap {
  font-size: 12px;
  color: var(--text-muted);
}

.rules__band-cap b {
  font-weight: 700;
  color: var(--text-body);
}

.rules__end {
  margin-top: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-muted);
}

.rules__end-warn {
  font-weight: 700;
  color: var(--deficit);
}

.rules__credits {
  color: var(--text-faint);
}
</style>
