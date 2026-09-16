<script setup lang="ts">
import { useRoute } from 'nuxt/app'
import { computed, onMounted, ref, watch } from 'vue'
import {
  PACK_PRICE,
  WELCOME_PACKS,
  countdownLabel,
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
import { gameNumber, gamePercent } from '~~/shared/game/progress'
import type { SearchEntry } from '~~/shared/types/dex'
import type { PackCard } from '~~/shared/types/game'
import { rarityKey, rarityRank } from '~~/shared/types/game'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { useDex } from '~/composables/useDex'
import { useGameClock } from '~/composables/useGameClock'
import { useReduceMotion } from '~/composables/useMotion'
import { useInvite } from '~/composables/useInvite'

const { t } = useI18n()
const localePath = useLocalePath()

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
 * O relógio da loja. Ele bate durante a abertura também — loja e abertura são
 * dois `v-if` do mesmo componente, e o `setup` não roda de novo entre elas. Um
 * tique por segundo enquanto dez cartas viram não paga a complexidade de pausar.
 *
 * **Ele não serve de seed**, e essa distinção custou um defeito: ver `open`.
 */
const now = useGameClock()

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

/**
 * O convite de conta, no fim da virada de um pack que trouxe ultra ou acima — a
 * outra metade do "após o primeiro ginásio ou o primeiro ultra" da prancha
 * *Convite*.
 *
 * **No fim da virada, e não no crédito.** A coleção recebe as dez antes da
 * animação, e um convite aberto na frente da carta que ainda vai virar estragaria
 * a única revelação que o jogo tem. Pular e o interruptor de movimento chegam ao
 * mesmo lugar, porque os dois levam `revealed` ao total.
 */
const invite = useInvite()

watch(revealed, (count) => {
  if (count === 0 || count < opened.value.length) return
  if (opened.value.some(card => rarityRank(card.rarity) >= rarityRank('ultra'))) invite.offer()
})

const dailyReady = computed(() => progress.dailyReadyAt(now.value))

/** `14:22:07` — o que falta para a meia-noite local, no formato da prancha. */
const untilDaily = computed(() => countdownLabel(now.value))

/**
 * Quem pode abrir agora.
 *
 * O dex ainda carregando desabilita os três de uma vez, e não some com eles: um
 * cartão que desaparece por meio segundo e volta é pior que um botão parado.
 */
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
 * A seed é o relógio, em milissegundos. Ela não precisa ser imprevisível: o save
 * guarda o resultado, não a seed, e um jogador que quisesse trapacear já tem o
 * DevTools — o plano decidiu isso por escrito ao recusar checksum e ofuscação. O
 * que ela precisa ser é **diferente a cada abertura**, e é aí que a precisão
 * importa.
 */
function open(from: PackSource): void {
  const buckets = pool.value
  if (buckets === null || !canOpen(from)) return

  // `Date.now()` e **não** o relógio reativo: `now` anda de segundo em segundo,
  // e dois packs abertos dentro do mesmo tique receberiam a mesma seed — o que
  // em `openPack` significa exatamente as mesmas dez cartas. O caminho que
  // encosta nisso é o normal, não o patológico: `ABRIR O PRÓXIMO` encadeia as
  // três boas-vindas, e nada obriga o jogador a esperar um segundo entre elas.
  const result = openPack({ seed: Date.now(), pity: progress.pity, pool: buckets })

  collection.credit(result.cards)
  progress.setPity(result.pity)

  // `new Date()` e não `now.value`, pelo mesmo motivo da seed: o relógio reativo
  // pode estar até um segundo atrás do real. Na virada da meia-noite isso grava
  // o dia de ontem e devolve o diário de hoje — um pack a mais, uma vez por dia,
  // numa janela de um segundo. As duas leituras de relógio desta função passam a
  // ser do mesmo instante.
  if (from === 'welcome') welcomeNumber.value = progress.claimWelcome()
  else if (from === 'daily') progress.claimDaily(new Date())
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

/**
 * `?open=daily`, que é como o botão *ABRIR* do Hub chega aqui.
 *
 * A prancha *Hub* desenha o diário com um botão que abre, e a abertura mora
 * nesta rota — sem o parâmetro, o botão de lá viraria um link que pede um
 * segundo clique no cartão idêntico daqui.
 *
 * Não precisa de guarda contra reentrada: abrir o diário marca o dia, e
 * `canOpen` recusa a segunda tentativa. Voltar para esta URL depois de abrir
 * simplesmente cai na loja com o cartão fora.
 */
onMounted(() => {
  if (useRoute().query.open === 'daily') open('daily')
})

/** Volta da abertura para a loja. A prancha *Abertura* não desenha esta saída —
 * ela desenha `VER COLEÇÃO` —, mas sem ela abrir o segundo pack exigiria
 * recarregar a rota. */
function backToShop(): void {
  opened.value = []
  source.value = null
  welcomeNumber.value = null
}

/**
 * O botão primário da tela de abertura — repetir a mesma fonte, ou voltar.
 *
 * **Os três packs de boas-vindas são uma sequência**, e é isso que o cabeçalho
 * da prancha *Abertura* escreve: `BOAS-VINDAS · 1 DE 3`. Mandar o jogador de
 * volta à loja entre um e outro quebraria a única sequência que o jogo tem, e
 * foi o que a primeira versão desta tela fez — o E2E da coleção pegou, esperando
 * por um `ABRIR O PRÓXIMO` que tinha deixado de existir.
 *
 * O mesmo vale para o pack da loja com saldo de sobra: quem está gastando 600
 * moedas não quer quatro voltas à fileira de cartões. O diário nunca repete, e
 * por isso cai no `VOLTAR À LOJA` sozinho, sem caso especial.
 */
const again = computed(() => {
  const from = source.value
  if (from === null || !canOpen(from)) return null

  if (from === 'welcome') return { from, label: t('packs.again.welcome') }
  if (from === 'store') {
    return { from, label: t('packs.again.store', { coins: gameNumber(PACK_PRICE) }) }
  }

  return null
})

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
    label: t(rarityKey(tier)),
    share: RARE_PLUS_WEIGHTS[tier],
  })))

// A largura da barra é CSS e o rótulo é texto, e por isso são duas contas: o
// `gamePercent` escreve `4,5%` com a vírgula do pt-BR, que uma declaração de
// `width` não aceita. O que a tela lê e o que o navegador desenha divergem na
// pontuação, não no valor.

/** A chance de um pack trazer ao menos um shiny — `1 − (1 − p)^10`, em fração. */
const shinyPerPack = computed(() => 1 - (1 - SHINY_ODDS) ** PACK_SIZE)

/** `1 a cada 26`. O inverso da linha acima, que é como o jogador a lê. */
const packsPerShiny = computed(() => Math.round(1 / shinyPerPack.value))

useSeoMeta({
  title: () => t('packs.seo.title'),
  description: () => t('packs.seo.description'),
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
              {{ t('packs.shop.eyebrow') }}
            </p>
            <h1 class="packs__title">
              {{ t('packs.shop.title') }}
            </h1>
          </div>

          <p class="numeric packs__aside">
            {{ t('packs.shop.rng') }}<br>
            {{ t('packs.shop.testable') }}
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
                {{ t('packs.welcome.eyebrow', {
                  number: progress.welcomeClaimed + 1,
                  total: WELCOME_PACKS,
                }) }}
              </p>
              <h2 class="packs__offer-title">
                {{ t('packs.welcome.title') }}
              </h2>
              <p class="packs__offer-note">
                {{ t('packs.welcome.note', { count: progress.welcomeRemaining }) }}
              </p>

              <div class="packs__offer-foot">
                <!-- Os três cartões escrevem `ABRIR` ou um preço, e o rótulo
                     visível não distingue um do outro para quem não vê a
                     fileira. O nome acessível diz qual pack é. -->
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--gift bevel-control"
                  :aria-label="t('packs.welcome.openLabel')"
                  :disabled="!canOpen('welcome')"
                  @click="open('welcome')"
                >
                  {{ t('packs.open') }}
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
                {{ t('packs.daily.eyebrow') }}
              </p>
              <h2 class="packs__offer-title">
                {{ t('packs.daily.title') }}
              </h2>
              <p class="packs__offer-note">
                {{ t('packs.daily.note') }}
              </p>

              <div class="packs__offer-foot">
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--daily bevel-control"
                  :aria-label="t('packs.daily.openLabel')"
                  :disabled="!canOpen('daily')"
                  @click="open('daily')"
                >
                  {{ t('packs.open') }}
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
                {{ t('packs.store.eyebrow') }}
              </p>
              <h2 class="packs__offer-title">
                {{ t('packs.store.title') }}
              </h2>
              <p class="packs__offer-note">
                {{ t('packs.store.note') }}
              </p>

              <div class="packs__offer-foot">
                <button
                  type="button"
                  class="numeric packs__buy packs__buy--coin bevel-control"
                  :aria-label="t('packs.store.buyLabel', { coins: gameNumber(PACK_PRICE) })"
                  :disabled="!canOpen('store')"
                  @click="open('store')"
                >
                  {{ t('packs.store.price', { coins: gameNumber(PACK_PRICE) }) }}
                </button>

                <i18n-t
                  v-if="progress.canBuyPack"
                  class="numeric packs__offer-meta"
                  keypath="packs.store.left"
                  scope="global"
                  tag="p"
                >
                  <template #coins>
                    <b>{{ gameNumber(progress.coins - PACK_PRICE) }}</b>
                  </template>
                  <template #packs>
                    {{ progress.affordablePacks }}
                  </template>
                </i18n-t>
                <p
                  v-else
                  class="numeric packs__offer-meta packs__offer-meta--deficit"
                >
                  {{ t('packs.store.missing', { coins: gameNumber(progress.missingCoins) }) }}
                </p>
              </div>
            </div>
          </article>
        </section>

        <i18n-t
          v-if="!dailyReady"
          class="numeric packs__timer"
          keypath="packs.timer"
          scope="global"
          tag="p"
        >
          <template #time>
            <b>{{ untilDaily }}</b>
          </template>
        </i18n-t>

        <section class="packs__rates">
          <!-- TAXAS -->
          <div class="packs__panel">
            <div class="packs__panel-head">
              <p class="packs__eyebrow">
                {{ t('packs.rates.title') }}
              </p>
              <p class="numeric packs__panel-source">
                {{ t('packs.rates.source') }}
              </p>
            </div>

            <div class="packs__slots">
              <div
                class="packs__slot bevel-tile"
                data-rarity="common"
                :style="{ flexGrow: COMMON_SLOTS }"
              >
                <b class="numeric">{{ COMMON_SLOTS }}</b>
                <span class="numeric">{{ t('packs.rates.commons') }}</span>
              </div>
              <div
                class="packs__slot bevel-tile"
                data-rarity="uncommon"
                :style="{ flexGrow: UNCOMMON_SLOTS }"
              >
                <b class="numeric">{{ UNCOMMON_SLOTS }}</b>
                <span class="numeric">{{ t('packs.rates.uncommons') }}</span>
              </div>
              <div
                class="packs__slot bevel-tile"
                data-rarity="rare"
                :style="{ flexGrow: RARE_PLUS_SLOTS * 2 }"
              >
                <b class="numeric">{{ RARE_PLUS_SLOTS }}</b>
                <span class="numeric">{{ t('packs.rates.rarePlus') }}</span>
              </div>
            </div>

            <p class="numeric packs__label">
              {{ t('packs.rates.slotRolls') }}
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
                    :style="{ width: `${odd.share * 100}%` }"
                  />
                </div>
                <dd class="numeric">
                  {{ gamePercent(odd.share) }}
                </dd>
              </div>
            </dl>

            <p class="packs__shiny">
              <span class="numeric packs__shiny-chip">
                {{ t('packs.rates.shinyChip', { odds: 1 / SHINY_ODDS }) }}
              </span>
              <span class="numeric packs__shiny-note">
                {{ t('packs.rates.shinyNote', {
                  chance: gamePercent(shinyPerPack),
                  packs: packsPerShiny,
                }) }}
              </span>
            </p>
          </div>

          <!-- PITY -->
          <div class="packs__panel">
            <p class="packs__eyebrow">
              {{ t('packs.pity.title') }}
            </p>

            <p class="numeric packs__pity-count">
              <b>{{ progress.pity }}</b>
              <span>/ {{ PITY_THRESHOLD }}</span>
            </p>
            <p class="packs__offer-note">
              {{ t('packs.pity.note') }}
            </p>

            <div class="packs__pity-track">
              <span
                v-for="step in PITY_THRESHOLD"
                :key="step"
                class="packs__pity-step"
                :class="{ 'packs__pity-step--hit': step <= progress.pity }"
              />
            </div>

            <i18n-t
              class="packs__offer-note"
              keypath="packs.pity.rule"
              scope="global"
              tag="p"
            >
              <template #tier>
                <b>{{ t('packs.pity.tier') }}</b>
              </template>
              <template #left>
                {{ progress.untilPity }}
              </template>
            </i18n-t>
          </div>
        </section>

        <i18n-t
          class="numeric packs__foot"
          keypath="packs.foot.order"
          scope="global"
          tag="p"
        >
          <template #before>
            <b>{{ t('packs.foot.before') }}</b>
          </template>
        </i18n-t>
      </template>

      <!-- ABERTURA -->
      <template v-else>
        <header class="packs__header">
          <div>
            <div class="packs__eyebrow-row">
              <p class="packs__eyebrow">
                {{ t('packs.opening.eyebrow') }}
              </p>
              <span
                v-if="welcomeNumber !== null"
                class="numeric packs__badge"
              >
                {{ t('packs.welcome.eyebrow', { number: welcomeNumber, total: WELCOME_PACKS }) }}
              </span>
            </div>
            <h1 class="packs__title">
              {{ t('packs.opening.title') }}
            </h1>
          </div>

          <!-- As taxas ficam no cabeçalho porque é aqui que a decisão acontece.
               É a decisão do plano de ensinar no ponto de decisão em vez de num
               tutorial, e os números saem de `shared/game/packs.ts`. -->
          <p class="numeric packs__aside">
            {{ t('packs.opening.aside', {
              size: PACK_SIZE,
              commons: COMMON_SLOTS,
              uncommons: UNCOMMON_SLOTS,
              rarePlus: RARE_PLUS_SLOTS,
            }) }}<br>
            <span class="packs__aside-strong">
              {{ t('packs.opening.pity', {
                threshold: PITY_THRESHOLD,
                left: progress.untilPity,
              }) }}
            </span>
          </p>
        </header>

        <section class="packs__revealed">
          <div class="packs__progress">
            <p class="numeric packs__label">
              {{ t('packs.opening.revealed', { revealed, total: opened.length }) }}
            </p>
            <div class="packs__progress-actions">
              <button
                v-if="revealed < opened.length"
                type="button"
                class="numeric packs__skip"
                @click="skip()"
              >
                {{ t('packs.opening.skip') }}
              </button>
              <NuxtLink
                :to="localePath('/collection')"
                class="numeric packs__skip"
              >
                {{ t('packs.opening.toCollection') }}
              </NuxtLink>
              <button
                v-if="again"
                type="button"
                class="numeric packs__skip packs__skip--primary"
                @click="open(again.from)"
              >
                {{ again.label }}
              </button>
              <button
                type="button"
                class="numeric packs__skip"
                :class="{ 'packs__skip--primary': again === null }"
                @click="backToShop()"
              >
                {{ t('packs.opening.backToShop') }}
              </button>
            </div>
          </div>

          <p
            v-if="forcedByPity"
            class="numeric packs__pity-hit"
          >
            {{ t('packs.opening.pityHit', { threshold: PITY_THRESHOLD }) }}
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
          {{ t('packs.loading') }}
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
 * `auto-fit` com um mínimo, e não `repeat(3, 1fr)`: a fileira tem um, dois ou
 * três cartões conforme boas-vindas e diário existirem, e uma grade fixa
 * deixaria buraco nos dois dias em que um deles sai.
 */
.packs__offers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 22px;
}

/**
 * O caso de um cartão só — as boas-vindas acabaram e o diário já saiu, que é o
 * estado normal do jogo depois da primeira semana.
 *
 * `auto-fit` colapsa as trilhas vazias e entrega **toda** a fileira ao que
 * sobra: o Pack Holo esticava para 1128px, com a arte de 104px perdida num
 * painel largo. O teto o mantém do tamanho que ele tinha ao lado dos vizinhos.
 */
.packs__offers:has(> :only-child) {
  grid-template-columns: minmax(320px, 540px);
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
