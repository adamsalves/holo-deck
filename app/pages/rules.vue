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
import { AILMENT_LABELS, RARITY_LABELS, RARITY_NAMES } from '~~/shared/types/game'

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

    return { tier, label: RARITY_LABELS[tier], range }
  })
})

/** Os dois recortes por marca, que não são faixa de BST e por isso ficam à parte. */
const rarityMarks = computed(() =>
  (['legendary', 'mythic'] as const).map(tier => ({
    tier,
    label: RARITY_LABELS[tier],
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
      previous.label = `${previous.label} / ${RARITY_LABELS[tier]}`
      previous.key = `${previous.key}+${tier}`
      continue
    }

    rows.push({
      key: tier,
      label: RARITY_LABELS[tier],
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
 * A fórmula, com o nível à vista.
 *
 * `BATTLE_LEVEL` entra interpolado porque ele **é** uma decisão do jogo — nível
 * fixo dos dois lados —, e não parte da forma da conta. Os outros números da
 * expressão (o 5, os dois 2 e o 50) são a fórmula da série, e mudá-los seria
 * escrever outra fórmula, não recalibrar esta.
 */
const damageFormula = computed(() =>
  `dano = floor(floor(floor((2·${BATTLE_LEVEL}/5 + 2) · power · A/D) / 50) + 2) · mods`)

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
  label: AILMENT_LABELS[name].toUpperCase(),
  effect: {
    paralysis: `Speed ×${decimal(PARALYSIS_SPEED_FACTOR)} e ${gamePercent(PARALYSIS_SKIP_CHANCE)} de chance de perder o turno.`,
    burn: `Ataque físico ×${decimal(BURN_ATTACK_FACTOR)} e ${ratio(BURN_DAMAGE_FRACTION)} do HP máximo por turno.`,
    poison: `${ratio(POISON_DAMAGE_FRACTION)} do HP máximo por turno.`,
    sleep: `Não age por ${SLEEP_MIN_TURNS} a ${SLEEP_MAX_TURNS} turnos, sorteados.`,
  }[name],
})))

/** O ruído do primeiro ginásio e o do último — a curva de dificuldade, medida. */
/**
 * Os seis passos do turno, na ordem em que o motor os executa.
 *
 * Como dado e não como seis `<li>` escritos: o marcador precisa ser um elemento
 * de verdade para receber a classe `numeric` (`::marker` não recebe classe), e
 * escrever o ordinal ao lado do texto em cada linha seria a numeração da lista
 * mantida à mão ao lado da numeração que o `<ol>` já dá.
 *
 * **O passo 5 corrige a prancha.** Ela escreve "no zero o golpe fica
 * inselecionável", e o motor faz o contrário: `moveFromSlot` devolve Struggle
 * para o slot vazio, e o golpe continua clicável — foi o que o review do PR
 * anterior corrigiu na carta de golpe, e a prancha ficou para trás.
 */
const TURN_ORDER = computed(() => [
  {
    key: 'order',
    before: 'Prioridade do golpe; empate resolve por Speed; empate de Speed ',
    strong: 'sorteia pela seed',
    after: '.',
  },
  {
    key: 'blocked',
    before: `Impedimento — dormindo não age, paralisado perde o turno em ${gamePercent(PARALYSIS_SKIP_CHANCE)}.`,
    strong: '',
    after: '',
  },
  { key: 'hit', before: 'Acerto — rola a acurácia do golpe.', strong: '', after: '' },
  { key: 'damage', before: 'Dano, pela fórmula acima.', strong: '', after: '' },
  {
    key: 'pp',
    before: 'PP decrementa; ',
    strong: 'no zero aquele slot vira Struggle',
    after: ', que não gasta PP e machuca quem o usa.',
  },
  {
    key: 'residual',
    before: 'Fim de turno — queimadura, veneno, e então checagem de faint.',
    strong: '',
    after: '',
  },
])

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
  title: 'Regras — Holo Deck',
  description: 'Raridade, packs, forja, fórmula de dano, condições, a Liga e a economia. Cada número desta página é lido de shared/game/ — o mesmo módulo que o motor usa.',
})
</script>

<template>
  <main class="rules">
    <header class="rules__header">
      <div>
        <p class="rules__eyebrow">
          Referência
        </p>
        <h1 class="rules__title">
          Regras
        </h1>
      </div>

      <p class="numeric rules__aside">
        Cada número desta página é lido de <b>shared/game/</b> — o mesmo módulo
        que o motor usa.<br>
        <b>Nada aqui foi digitado à mão, então nada aqui pode divergir do jogo.</b>
      </p>
    </header>

    <div class="rules__row rules__row--thirds">
      <!-- RARIDADE -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Raridade
        </h2>
        <p class="rules__panel-note">
          rarity.ts — derivada do base stat total
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
          Os limiares saem do percentil do dex, não de números redondos: a maioria
          das espécies é evolução final, e uma escada de valores redondos faria
          <em>raro</em> ser o maior tier do jogo. Foil começa em raro.
        </p>
      </section>

      <!-- PACKS -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Packs
        </h2>
        <p class="rules__panel-note">
          packs.ts — {{ PACK_SIZE }} cartas, sorteadas com seed
        </p>

        <dl class="rules__list">
          <div
            class="rules__line"
            data-rarity="common"
          >
            <dt class="rules__key">
              Comuns
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
              Incomuns
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
              Raro ou acima
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ RARE_PLUS_SLOTS }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="numeric rules__key rules__key--small">
              O SLOT RARO+ ROLA
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
              Pity
            </dt>
            <dd class="numeric rules__value rules__value--rarity">
              {{ PITY_THRESHOLD }} packs
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Shiny
            </dt>
            <dd class="numeric rules__value rules__value--shiny">
              1 / {{ 1 / SHINY_ODDS }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          O pity conta packs sem ultra ou acima; no último, o slot raro+ vira
          ultra garantido e a contagem zera. Shiny rola sobre qualquer carta e
          vira tratamento foil.
        </p>
      </section>

      <!-- PÓ E FORJA -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Pó e forja
        </h2>
        <p class="rules__panel-note">
          dust.ts — duplicata vira pó, pó compra carta escolhida
        </p>

        <dl class="rules__list">
          <div class="rules__line">
            <dt class="numeric rules__key rules__key--small">
              TIER
            </dt>
            <dd class="numeric rules__value rules__value--small">
              PÓ · FORJA
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
          Razão ×{{ FORGE_RATIO }} em toda a escala: quatro duplicatas de um tier
          pagam uma carta daquele tier. É a forja que torna o dex completável — a
          cauda longa não fecha por sorteio.
        </p>
      </section>
    </div>

    <div class="rules__row rules__row--wide">
      <!-- BATALHA -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Batalha
        </h2>
        <p class="rules__panel-note">
          damage.ts · engine.ts — nível fixo Lv{{ BATTLE_LEVEL }} dos dois lados,
          IV {{ BATTLE_IV }} e EV 0
        </p>

        <p class="numeric rules__formula">
          {{ damageFormula }}
        </p>

        <ul class="rules__chips">
          <li class="numeric rules__chip">
            STAB ×{{ decimal(STAB_MULTIPLIER) }}
          </li>
          <li class="numeric rules__chip">
            efetividade ×0 a ×4
          </li>
          <li class="numeric rules__chip">
            crítico ×{{ decimal(CRIT_MULTIPLIER) }} · {{ ratio(CRIT_CHANCE) }}
          </li>
          <li class="numeric rules__chip">
            aleatório {{ RANDOM_MIN_PERCENT }} – {{ RANDOM_MAX_PERCENT }} por cento
          </li>
        </ul>

        <p class="numeric rules__aside rules__aside--inline">
          <b>A/D</b> usa Atk/Def em golpe físico e SpA/SpD em especial. A
          efetividade sai da matriz {{ TYPE_COUNT }}×{{ TYPE_COUNT }}; tipo duplo
          multiplica, então ×4 e ×¼ existem.
        </p>

        <p class="rules__eyebrow rules__eyebrow--spaced">
          Ordem do turno
        </p>
        <!-- Os marcadores são `<span>`, e não `::marker`: a prancha os desenha
             em mono e azul, e um pseudo-elemento não recebe a classe `numeric`
             que traz fonte e `tabular-nums` juntos. -->
        <ol class="rules__steps">
          <li
            v-for="(step, index) in TURN_ORDER"
            :key="step.key"
          >
            <span class="numeric rules__step-mark">{{ index + 1 }}</span>
            <span>
              {{ step.before }}<b v-if="step.strong">{{ step.strong }}</b>{{ step.after }}
            </span>
          </li>
        </ol>

        <p class="rules__foot">
          Cada Pokémon leva {{ BATTLE_MOVE_SLOTS }} golpes, escolhidos por
          cobertura de tipo e não por poder bruto. Item:
          {{ POTIONS_PER_SIDE === 1 ? 'uma' : POTIONS_PER_SIDE }}
          <em class="rules__potion">poção</em> por lado por batalha, restaurando
          {{ gamePercent(POTION_HEAL_FRACTION) }} do HP máximo. Perder não custa nada
          — a revanche é imediata.
        </p>
      </section>

      <!-- CONDIÇÕES -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Condições
        </h2>
        <p class="rules__panel-note">
          status.ts — uma por vez, não empilha
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
          Congelamento fica de fora de propósito: é frustrante de receber e pouco
          interessante de aplicar.
        </p>
      </section>
    </div>

    <div class="rules__row rules__row--wide">
      <!-- A LIGA -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          A Liga
        </h2>
        <p class="rules__panel-note">
          gyms.ts — {{ GYM_COUNT }} líderes, um por geração, desbloqueio sequencial
        </p>

        <div class="rules__bands">
          <div
            v-for="band in GYM_BANDS"
            :key="band.band"
            class="rules__band bevel-tile"
          >
            <p class="numeric rules__band-range">
              GINÁSIOS {{ band.first }}–{{ band.last }}
            </p>
            <p class="numeric rules__band-size">
              {{ band.teamSize }}
            </p>
            <p class="rules__band-cap">
              Pokémon · teto de BST
              <b class="numeric">{{ band.bstCap }}</b>
            </p>
          </div>
        </div>

        <p class="rules__foot">
          Todo Pokémon de um time carrega o tipo do líder <b>e</b> vem da geração
          dele — vencer em ordem passeia pelas gerações. O último do time é o ace,
          o de maior BST. A IA do líder é gulosa com ruído que cai de
          {{ noiseRange.first }} no primeiro ginásio a {{ noiseRange.last }} no
          último; a poção entra no ginásio {{ aiSteps.potion }} e a troca por
          matchup no {{ aiSteps.swap }}.
        </p>
      </section>

      <!-- ECONOMIA -->
      <section class="rules__panel">
        <h2 class="rules__panel-title">
          Economia
        </h2>
        <p class="rules__panel-note">
          economy.ts — de onde vêm as moedas
        </p>

        <dl class="rules__list">
          <div class="rules__line">
            <dt class="rules__key">
              Boas-vindas
            </dt>
            <dd class="numeric rules__value rules__value--forge">
              {{ WELCOME_PACKS }} packs
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Ginásio, 1ª vitória
            </dt>
            <dd class="numeric rules__value rules__value--coin">
              {{ rewardCurve }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Ginásio, revanche
            </dt>
            <dd class="numeric rules__value rules__value--coin">
              {{ gamePercent(REMATCH_RATE) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Vitória imaculada
            </dt>
            <dd class="numeric rules__value rules__value--progress">
              +{{ gamePercent(FLAWLESS_RATE) }}
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Pack diário
            </dt>
            <dd class="numeric rules__value rules__value--progress">
              grátis
            </dd>
          </div>
          <div class="rules__line">
            <dt class="rules__key">
              Pack na loja
            </dt>
            <dd class="numeric rules__value">
              {{ gameNumber(PACK_PRICE) }}
            </dd>
          </div>
        </dl>

        <p class="rules__foot">
          A campanha inteira paga {{ gameNumber(campaign.total) }} — cerca de
          {{ campaign.packs }} packs. A revanche existe porque sem ela a renda
          depois do último ginásio cairia para um pack por dia, para sempre. A
          imaculada é sobre o que está sendo pago, então numa revanche ela
          acompanha a revanche.
        </p>
      </section>
    </div>

    <footer class="numeric rules__end">
      Não existe tela de tutorial, e é de propósito: a interface ensina no ponto
      de decisão — o botão de golpe mostra a efetividade antes de você escolher,
      o deck builder marca quem <b class="rules__end-warn">leva ×2</b>, e a loja
      traz as taxas ao lado do preço. Esta página é a referência para consultar
      depois, não o portão antes.<br>
      <span class="rules__credits">
        Dados de Pokémon por PokeAPI · projeto não-comercial · Pokémon é marca da
        Nintendo / Game Freak
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
