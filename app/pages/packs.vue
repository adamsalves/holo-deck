<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'
import {
  PACK_PRICE,
  WELCOME_PACKS,
  msUntilNextDay,
} from '~~/shared/game/economy'
import {
  COMMON_SLOTS,
  PACK_SIZE,
  PITY_THRESHOLD,
  RARE_PLUS_SLOTS,
  RARE_PLUS_TIERS,
  RARE_PLUS_WEIGHTS,
  SHINY_ODDS,
  UNCOMMON_SLOTS,
  buildPool,
  openPack,
} from '~~/shared/game/packs'
import { gameNumber } from '~~/shared/game/progress'
import type { SearchEntry } from '~~/shared/types/dex'
import type { PackCard } from '~~/shared/types/game'
import { RARITY_LABELS } from '~~/shared/types/game'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { useDex } from '~/composables/useDex'
import { useReduceMotion } from '~/composables/useMotion'

/**
 * A loja e a abertura — as pranchas *Loja* e *Abertura de pack*, nessa ordem.
 *
 * São dois estados da mesma tela, e não duas rotas: a prancha *Abertura* não
 * desenha nem barra de navegação nem caminho de volta, porque ela é o momento em
 * que o jogo pede a atenção inteira. A loja é o repouso; abrir é a ida.
 *
 * **Os três cartões são três fontes com regras diferentes.** Boas-vindas conta
 * um contador que só desce; o diário compara datas; o da loja debita saldo. O
 * que eles têm em comum é `openPack`, e é só isso — por isso o débito e a marca
 * ficam depois do crédito, cada um no seu ramo.
 */
type PackSource = 'welcome' | 'daily' | 'store'

const { loadIndex } = useDex()
const collection = useCollectionStore()
const progress = useProgressStore()
const reduced = useReduceMotion()

const { data: index } = await useAsyncData('packs-index', () => loadIndex())

/**
 * Os seis baldes, montados uma vez — não uma vez por abertura.
 *
 * `?? null` e não `!`: `useAsyncData` tipa o dado como possivelmente ausente, e
 * a asserção transformaria um índice que não carregou em `buildPool(undefined)`
 * — um erro de runtime no lugar de um botão desabilitado.
 */
const pool = computed(() => {
  const entries = index.value ?? null
  return entries === null ? null : buildPool(entries)
})

const entryById = computed(() => {
  const map = new Map<number, SearchEntry>()
  for (const entry of index.value ?? []) map.set(entry.id, entry)
  return map
})

/**
 * O relógio da loja, batendo de segundo em segundo.
 *
 * Ele existe pelo contador regressivo, que a prancha escreve como
 * `próximo em 14:22:07` — e um segundo é o passo que esse formato exige. Mas ele
 * é também o que faz o cartão do diário **voltar sozinho** à meia-noite com a
 * aba aberta, que é o caso que um `Date.now()` lido uma vez não cobre.
 *
 * `useIntervalFn` para o descarte vir junto: o intervalo morre com o escopo do
 * componente, sem `onUnmounted` escrito à mão. Ele só bate enquanto a loja está
 * na tela — durante a abertura a tela é outra e o cartão não está lá.
 */
const now = shallowRef(new Date())
useIntervalFn(() => {
  now.value = new Date()
}, 1000)

const opened = ref<readonly PackCard[]>([])
const revealed = ref(0)
const skipped = ref(false)
const source = ref<PackSource | null>(null)
const welcomeNumber = ref<number | null>(null)
const forcedByPity = ref(false)

/**
 * O interruptor de movimento e o botão de pular chegam ao mesmo lugar: as dez de
 * uma vez. Sem animação não há `animationend`, então o contador precisa saber
 * disso — do contrário ele ficaria em `0 / 10` com as dez cartas na tela.
 */
function revealAll(): void {
  revealed.value = opened.value.length
}

const openedEntries = computed(() =>
  opened.value.map(card => entryById.value.get(card.speciesId) ?? null))

const dailyReady = computed(() => progress.dailyReadyAt(now.value))

/** `14:22:07` — o que falta para a meia-noite local, no formato da prancha. */
const untilDaily = computed(() => {
  const total = Math.max(0, Math.floor(msUntilNextDay(now.value) / 1000))
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]

  return parts.map(part => String(part).padStart(2, '0')).join(':')
})

/**
 * Quem pode abrir agora, na ordem em que os cartões aparecem.
 *
 * O dex ainda carregando desabilita os três de uma vez, e não some com eles: um
 * cartão que desaparece por meio segundo e volta é pior que um botão parado.
 */
const available = computed<readonly PackSource[]>(() => {
  const sources: PackSource[] = []
  if (progress.hasWelcomePack) sources.push('welcome')
  if (dailyReady.value) sources.push('daily')
  sources.push('store')

  return sources
})

function canOpen(from: PackSource): boolean {
  if (pool.value === null) return false
  if (from === 'welcome') return progress.hasWelcomePack
  if (from === 'daily') return dailyReady.value

  return progress.canBuyPack
}

/**
 * Abre um pack e credita **antes** de cobrar por ele.
 *
 * A ordem é a regra de escrita do plano, e a prancha *Loja* a repete no rodapé:
 * as cartas entram na coleção, e só então o contador de boas-vindas desce, ou o
 * dia é marcado, ou o saldo é debitado. Uma falha no meio dá um pack de graça em
 * vez de cobrar por nada — o erro que o jogador perdoa.
 *
 * O ramo por fonte vem depois do crédito por isso, e não por organização: as
 * três cobranças são diferentes, o crédito é o mesmo, e é o crédito que precisa
 * acontecer primeiro nos três casos.
 *
 * A seed é o relógio. Ela não precisa ser imprevisível: o save guarda o
 * resultado, não a seed, e um jogador que quisesse trapacear já tem o DevTools —
 * o plano decidiu isso por escrito ao recusar checksum e ofuscação.
 */
function open(from: PackSource): void {
  const buckets = pool.value
  if (buckets === null || !canOpen(from)) return

  const result = openPack({ seed: now.value.getTime(), pity: progress.pity, pool: buckets })

  collection.credit(result.cards)
  progress.setPity(result.pity)

  if (from === 'welcome') welcomeNumber.value = progress.claimWelcome()
  else if (from === 'daily') progress.claimDaily(now.value)
  else progress.buyPack()

  opened.value = result.cards
  forcedByPity.value = result.forcedByPity
  source.value = from
  skipped.value = false
  revealed.value = reduced.value ? result.cards.length : 0
}

function skip(): void {
  skipped.value = true
  revealAll()
}

/** Volta da abertura para a loja. A prancha *Abertura* não desenha esta saída —
 * ela desenha `VER COLEÇÃO` —, mas sem ela abrir o segundo pack exigiria
 * recarregar a rota. */
function backToShop(): void {
  opened.value = []
  source.value = null
  welcomeNumber.value = null
}

/**
 * O que o slot raro+ paga, em porcentagem — derivado dos pesos, nunca escrito.
 *
 * A prancha desenha `80 / 15 / 4,5 / 0,5` e a barra de cada tier na mesma
 * proporção. Os quatro saem de `RARE_PLUS_WEIGHTS`, que é o mesmo objeto que
 * `openPack` sorteia: um peso alterado muda a tela no mesmo commit.
 */
const rarePlusOdds = computed(() =>
  RARE_PLUS_TIERS.map(tier => ({
    tier,
    label: RARITY_LABELS[tier],
    percent: RARE_PLUS_WEIGHTS[tier] * 100,
  })))

/** A chance de um pack trazer ao menos um shiny — `1 − (1 − p)^10`. */
const shinyPerPack = computed(() => (1 - (1 - SHINY_ODDS) ** PACK_SIZE) * 100)

/** `1 a cada 26`. O inverso da linha acima, que é como o jogador a lê. */
const packsPerShiny = computed(() => Math.round(100 / shinyPerPack.value))

const decimal = (value: number, places: number): string =>
  value.toFixed(places).replace('.', ',')

useSeoMeta({
  title: 'Packs — Holo Deck',
  description: 'Dez cartas: seis comuns, três incomuns e uma rara ou acima. Shiny a 1 em 256, e um ultra garantido a cada dez packs secos.',
})
</script>

<template>
  <main class="packs">
    <ClientOnly>
      <!-- LOJA -->
      <template v-if="opened.length === 0">
        <header class="packs__header">
          <div>
            <p class="packs__eyebrow">
              Loja
            </p>
            <h1 class="packs__title">
              Packs
            </h1>
          </div>

          <p class="numeric packs__aside">
            Toda abertura sai de um RNG com seed.<br>
            A distribuição é testável, não prometida.
          </p>
        </header>

        <section class="packs__offers">
          <!-- Boas-vindas: primeiro da fila enquanto restar, e some depois. A
               prancha desenha dois cartões; o terceiro existe porque os três
               packs da Fase 5 existem, e precisam de onde ser abertos. -->
          <article
            v-if="progress.hasWelcomePack"
            class="packs__offer packs__offer--gift"
          >
            <div class="packs__art packs__art--gift bevel-card">
              <span class="packs__art-mark" />
            </div>

            <div class="packs__offer-body">
              <p class="packs__eyebrow packs__eyebrow--gift">
                Boas-vindas · {{ progress.welcomeClaimed + 1 }} de {{ WELCOME_PACKS }}
              </p>
              <h2 class="packs__offer-title">
                Pack de estreia
              </h2>
              <p class="packs__offer-note">
                {{ progress.welcomeRemaining }} de graça para o deck ter escolha.
              </p>

              <div class="packs__offer-foot">
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--gift bevel-control"
                  :disabled="!canOpen('welcome')"
                  @click="open('welcome')"
                >
                  ABRIR
                </button>
              </div>
            </div>
          </article>

          <!-- Diário: some depois de aberto e volta à meia-noite. -->
          <article
            v-if="dailyReady"
            class="packs__offer packs__offer--daily"
          >
            <div class="packs__art packs__art--daily bevel-card">
              <span class="packs__art-mark" />
            </div>

            <div class="packs__offer-body">
              <p class="packs__eyebrow packs__eyebrow--daily">
                Disponível agora
              </p>
              <h2 class="packs__offer-title">
                Pack diário
              </h2>
              <p class="packs__offer-note">
                Grátis, um por dia. Some da loja depois de aberto.
              </p>

              <div class="packs__offer-foot">
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--daily bevel-control"
                  :disabled="!canOpen('daily')"
                  @click="open('daily')"
                >
                  ABRIR
                </button>
              </div>
            </div>
          </article>

          <!-- Loja: sempre em estoque, e o único que custa. -->
          <article class="packs__offer">
            <div class="packs__art bevel-card">
              <span class="packs__art-mark" />
            </div>

            <div class="packs__offer-body">
              <p class="packs__eyebrow">
                Sempre em estoque
              </p>
              <h2 class="packs__offer-title">
                Pack Holo
              </h2>
              <p class="packs__offer-note">
                As mesmas taxas do diário. Sem limite de quantidade.
              </p>

              <div class="packs__offer-foot">
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--coin bevel-control"
                  :disabled="!canOpen('store')"
                  @click="open('store')"
                >
                  {{ gameNumber(PACK_PRICE) }} moedas
                </button>

                <p
                  v-if="progress.canBuyPack"
                  class="numeric packs__offer-meta"
                >
                  restam <b>{{ gameNumber(progress.coins - PACK_PRICE) }}</b>
                  · dá para {{ progress.affordablePacks }}
                </p>
                <p
                  v-else
                  class="numeric packs__offer-meta packs__offer-meta--deficit"
                >
                  faltam {{ gameNumber(progress.missingCoins) }} moedas
                </p>
              </div>
            </div>
          </article>
        </section>

        <p
          v-if="!dailyReady"
          class="numeric packs__timer"
        >
          O pack diário já saiu hoje — próximo em <b>{{ untilDaily }}</b>.
        </p>

        <section class="packs__rates">
          <!-- TAXAS -->
          <div class="packs__panel">
            <div class="packs__panel-head">
              <p class="packs__eyebrow">
                Taxas
              </p>
              <p class="numeric packs__panel-source">
                lidas de shared/game/packs.ts — a loja não tem número próprio
              </p>
            </div>

            <div class="packs__slots">
              <div
                class="packs__slot bevel-tile"
                data-rarity="common"
                :style="{ flexGrow: COMMON_SLOTS }"
              >
                <b class="numeric">{{ COMMON_SLOTS }}</b>
                <span class="numeric">comuns</span>
              </div>
              <div
                class="packs__slot bevel-tile"
                data-rarity="uncommon"
                :style="{ flexGrow: UNCOMMON_SLOTS }"
              >
                <b class="numeric">{{ UNCOMMON_SLOTS }}</b>
                <span class="numeric">incomuns</span>
              </div>
              <div
                class="packs__slot bevel-tile"
                data-rarity="rare"
                :style="{ flexGrow: RARE_PLUS_SLOTS * 2 }"
              >
                <b class="numeric">{{ RARE_PLUS_SLOTS }}</b>
                <span class="numeric">raro+</span>
              </div>
            </div>

            <p class="numeric packs__label">
              O slot raro+ rola assim
            </p>
            <dl class="packs__odds">
              <div
                v-for="odd in rarePlusOdds"
                :key="odd.tier"
                class="packs__odd"
                :data-rarity="odd.tier"
              >
                <dt class="numeric">
                  {{ odd.label.toUpperCase() }}
                </dt>
                <div class="packs__odd-track">
                  <div
                    class="packs__odd-fill"
                    :style="{ width: `${odd.percent}%` }"
                  />
                </div>
                <dd class="numeric">
                  {{ decimal(odd.percent, odd.percent < 10 ? 1 : 0) }}%
                </dd>
              </div>
            </dl>

            <p class="packs__shiny">
              <span class="numeric packs__shiny-chip">
                SHINY 1/{{ 1 / SHINY_ODDS }}
              </span>
              <span class="numeric packs__shiny-note">
                Rola sobre qualquer carta, de qualquer tier — {{ decimal(shinyPerPack, 1) }}%
                por pack, ou um a cada {{ packsPerShiny }}.
              </span>
            </p>
          </div>

          <!-- PITY -->
          <div class="packs__panel">
            <p class="packs__eyebrow">
              Garantia
            </p>

            <p class="numeric packs__pity-count">
              <b>{{ progress.pity }}</b>
              <span>/ {{ PITY_THRESHOLD }}</span>
            </p>
            <p class="packs__offer-note">
              packs sem ultra ou acima
            </p>

            <div class="packs__pity-track">
              <span
                v-for="step in PITY_THRESHOLD"
                :key="step"
                class="packs__pity-step"
                :class="{ 'packs__pity-step--hit': step <= progress.pity }"
              />
            </div>

            <p class="packs__offer-note">
              No décimo, o slot raro+ vira <b>ultra ou acima</b> garantido, e a
              contagem zera. Faltam {{ progress.untilPity }}.
            </p>
          </div>
        </section>

        <p class="numeric packs__foot">
          Ao abrir: as cartas são creditadas <b>antes</b> de as moedas serem
          debitadas. Uma falha no meio dá cartas de graça em vez de roubar moedas.
        </p>
      </template>

      <!-- ABERTURA -->
      <template v-else>
        <header class="packs__header">
          <div>
            <div class="packs__eyebrow-row">
              <p class="packs__eyebrow">
                Sequência de abertura
              </p>
              <span
                v-if="welcomeNumber !== null"
                class="numeric packs__badge"
              >
                Boas-vindas · {{ welcomeNumber }} de {{ WELCOME_PACKS }}
              </span>
            </div>
            <h1 class="packs__title">
              Abrir pack
            </h1>
          </div>

          <!-- As taxas ficam no cabeçalho porque é aqui que a decisão acontece.
               É a decisão do plano de ensinar no ponto de decisão em vez de num
               tutorial, e os números saem de `shared/game/packs.ts`. -->
          <p class="numeric packs__aside">
            {{ PACK_SIZE }} cartas · {{ COMMON_SLOTS }} comuns, {{ UNCOMMON_SLOTS }} incomuns,
            {{ RARE_PLUS_SLOTS }} raro+<br>
            <span class="packs__aside-strong">
              pity: {{ PITY_THRESHOLD }} packs sem ultra garante um ultra —
              faltam {{ progress.untilPity }}
            </span>
          </p>
        </header>

        <section class="packs__revealed">
          <div class="packs__progress">
            <p class="numeric packs__label">
              {{ revealed }} / {{ opened.length }} reveladas
            </p>
            <div class="packs__progress-actions">
              <button
                v-if="revealed < opened.length"
                type="button"
                class="numeric packs__skip"
                @click="skip()"
              >
                PULAR ANIMAÇÃO
              </button>
              <NuxtLink
                to="/collection"
                class="numeric packs__skip"
              >
                VER COLEÇÃO
              </NuxtLink>
              <button
                type="button"
                class="numeric packs__skip packs__skip--primary"
                @click="backToShop()"
              >
                {{ available.length > 1 || canOpen('store') ? 'ABRIR OUTRO' : 'VOLTAR À LOJA' }}
              </button>
            </div>
          </div>

          <p
            v-if="forcedByPity"
            class="numeric packs__pity-hit"
          >
            A rede disparou: {{ PITY_THRESHOLD }} packs sem ultra garantiram este.
          </p>

          <PackOpener
            :cards="opened"
            :entries="openedEntries"
            :skipped="skipped"
            @reveal="revealed = $event"
          />
        </section>
      </template>

      <template #fallback>
        <p class="packs__loading">
          Carregando…
        </p>
      </template>
    </ClientOnly>
  </main>
</template>

<style scoped>
.packs {
  max-width: 1200px;
  margin: 0 auto;
  padding: 34px 36px 44px;
}

.packs__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  padding-bottom: 22px;
  margin-bottom: 26px;
  border-bottom: 1px solid var(--border);
}

.packs__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.packs__eyebrow--gift {
  color: var(--accent);
}

.packs__eyebrow--daily {
  color: var(--forge);
}

.packs__eyebrow-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.packs__title {
  margin-top: 9px;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--text);
}

.packs__aside {
  font-size: 12px;
  line-height: 1.7;
  text-align: right;
  color: var(--text-muted);
}

.packs__aside-strong {
  color: var(--text-body);
}

.packs__badge {
  padding: 3px 8px;
  border-radius: var(--radius);
  background: var(--forge);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bg);
}

/**
 * Os cartões da loja, um por fonte de pack.
 *
 * `auto-fit` com um mínimo, e não `repeat(3, 1fr)`: a fileira tem dois ou três
 * cartões conforme boas-vindas e diário existirem, e uma grade de três deixaria
 * um buraco no dia em que o diário sai.
 */
.packs__offers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 22px;
}

.packs__offer {
  position: relative;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 24px 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.packs__offer--gift {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
}

.packs__offer--daily {
  border-color: color-mix(in oklab, var(--forge) 45%, var(--border));
}

.packs__art {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 146px;
  border: 1px solid var(--border-strong);
  background: linear-gradient(150deg, var(--surface-raised), var(--bg));
}

.packs__art-mark {
  width: 44px;
  height: 44px;
  border: 3px solid var(--border-strong);
  border-radius: 50%;
}

.packs__art--gift {
  border-color: var(--accent);
  box-shadow: 0 0 40px -14px color-mix(in oklab, var(--accent) 80%, transparent);
}

.packs__art--gift .packs__art-mark {
  border-color: var(--accent);
}

.packs__art--daily {
  border-color: var(--forge);
  box-shadow: 0 0 40px -14px color-mix(in oklab, var(--forge) 80%, transparent);
}

.packs__art--daily .packs__art-mark {
  border-color: var(--forge);
}

.packs__offer-body {
  flex-grow: 1;
  min-width: 0;
}

.packs__offer-title {
  margin: 7px 0 6px;
  font-size: 25px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--text);
}

.packs__offer-note {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-body);
}

.packs__offer-note b {
  font-weight: 700;
  color: var(--forge);
}

.packs__offer-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.packs__buy {
  padding: 11px 22px;
  border: 1px solid var(--border-strong);
  background: transparent;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-body);
  cursor: pointer;
}

.packs__buy--gift {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}

.packs__buy--daily {
  border-color: var(--forge);
  background: var(--forge);
  color: var(--bg);
}

.packs__buy--coin {
  border-color: var(--coin);
  background: var(--coin);
  color: var(--bg);
}

.packs__buy:disabled {
  border-color: var(--border);
  background: transparent;
  color: var(--text-faint);
  cursor: not-allowed;
}

.packs__buy:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

.packs__offer-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.packs__offer-meta b {
  font-weight: 700;
  color: var(--coin);
}

.packs__offer-meta--deficit {
  color: var(--deficit);
}

.packs__timer {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-muted);
}

.packs__timer b {
  font-weight: 700;
  color: var(--text-body);
}

.packs__rates {
  display: grid;
  grid-template-columns: 1.42fr 1fr;
  gap: 22px;
  margin-top: 22px;
}

@media (width < 900px) {
  .packs__rates {
    grid-template-columns: 1fr;
  }
}

.packs__panel {
  padding: 22px 26px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.packs__panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 18px;
}

.packs__panel-source {
  font-size: 11px;
  color: var(--text-faint);
}

.packs__slots {
  display: flex;
  gap: 9px;
  margin-bottom: 20px;
}

/**
 * Os três blocos de slot, largos na proporção dos slots que representam.
 *
 * O raro+ leva peso dobrado: um slot em dez daria uma faixa de 26px, estreita
 * demais para caber `raro+` — e é justamente o slot que carrega o pack.
 */
.packs__slot {
  flex-basis: 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in oklab, var(--rarity) 40%, var(--border));
  background: color-mix(in oklab, var(--rarity) 8%, var(--surface-raised));
}

.packs__slot b {
  font-size: 20px;
  font-weight: 800;
  color: var(--rarity);
}

.packs__slot span {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.packs__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.packs__odds {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 11px 0 0;
}

.packs__odd {
  display: flex;
  align-items: center;
  gap: 13px;
}

.packs__odd dt {
  width: 82px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--rarity-label, var(--text-body));
  background: var(--rarity-text, none);
  background-clip: text;
}

.packs__odd dd {
  width: 52px;
  margin: 0;
  flex-shrink: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-body);
}

.packs__odd-track {
  flex-grow: 1;
  height: 8px;
  border-radius: 2px;
  background: var(--progress-track);
  overflow: hidden;
}

.packs__odd-fill {
  height: 100%;
  min-width: 2px;
  background: var(--rarity);
}

.packs__shiny {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 13px;
  margin-top: 19px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.packs__shiny-chip {
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid color-mix(in oklab, var(--shiny) 45%, var(--bg));
  border-radius: var(--radius);
  background: color-mix(in oklab, var(--shiny) 7%, transparent);
  font-size: 12px;
  font-weight: 800;
  color: var(--shiny);
}

.packs__shiny-note {
  flex: 1 1 220px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
}

.packs__pity-count {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 18px 0 6px;
}

.packs__pity-count b {
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
  color: var(--forge);
}

.packs__pity-count span {
  font-size: 16px;
  color: var(--text-muted);
}

.packs__pity-track {
  display: flex;
  gap: 4px;
  margin: 16px 0;
}

.packs__pity-step {
  flex: 1;
  height: 9px;
  border: 1px solid var(--border);
  border-radius: 1px;
  background: var(--progress-track);
}

.packs__pity-step--hit {
  border-color: var(--forge);
  background: var(--forge);
}

.packs__foot {
  margin-top: 22px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-muted);
}

.packs__foot b {
  font-weight: 700;
  color: var(--text-body);
}

.packs__loading {
  padding: 72px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.packs__revealed {
  padding-top: 4px;
}

.packs__progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.packs__progress-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.packs__skip {
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  font-size: 11px;
  color: var(--text-body);
  text-decoration: none;
  cursor: pointer;
}

.packs__skip--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.packs__skip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.packs__pity-hit {
  margin: 22px 0 0;
  font-size: 12px;
  color: var(--forge);
}
</style>
