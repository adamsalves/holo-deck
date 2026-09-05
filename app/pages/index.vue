<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useLeague } from '~/composables/useLeague'
import { useCollection } from '~/composables/useCollection'
import { loadBattleContext } from '~/composables/useBattleContext'
import { useBattleStore } from '~~/app/stores/battle'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { activeOf, isFainted } from '~~/shared/game/battle'
import { gymLeader } from '~~/shared/game/gyms'
import { gameNumber } from '~~/shared/game/progress'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'
import { RARITY_LABELS, TYPE_LABELS } from '~~/shared/types/game'
import { multiplierLabel } from '~~/shared/game/typechart'

/**
 * A base do jogador — a prancha *Hub*.
 *
 * Ela entra inteira neste PR **menos duas peças**, e as duas por falta de dado e
 * não por escopo: a barra de navegação global liga destinos que só existem no PR
 * seguinte (`/packs` como loja, `/rules`, `/settings`), e o cartão do pack
 * diário depende da economia que chega junto com a loja. Até lá a fileira de
 * portas provisória continua — agora com a Liga —, porque um Hub sem caminho
 * para as outras telas seria a Fase 5 entregue e inalcançável.
 *
 * O que entra: a faixa de retomar batalha, o painel do próximo ginásio e o de
 * coleção. Os três são estado do jogador, então todos são `<ClientOnly>` — no
 * servidor a coleção é vazia, o progresso é zero e não há batalha nenhuma.
 */
const battle = useBattleStore()
const progress = useProgressStore()
const owned = useCollectionStore()

const league = await useLeague()
const collection = await useCollection()

useHead({ title: 'Holo Deck' })

/**
 * A faixa de retomar precisa do estado, e o estado precisa do dex.
 *
 * O plugin de save entrega o log cru — ver a store da batalha —, então o Hub é o
 * primeiro lugar que pode reconstruí-lo. É aqui também que a batalha de uma
 * build anterior é **descartada**: `resume` confere motor e dex antes de
 * reproduzir, e a faixa simplesmente não aparece.
 */
onMounted(async () => {
  const saved = battle.log
  if (saved === null || !isGymId(saved.gymId)) return

  try {
    const context = await loadBattleContext(saved.gymId, saved.team)
    battle.resume(context)
  }
  catch {
    // Sem dex não há como reconstruir. A batalha continua salva: quem falha aqui
    // é a rede, e apagar o log por isso perderia a luta por um erro de carga.
  }
})

const resumable = computed(() => {
  const state = battle.state
  if (state === null || state.outcome !== 'ongoing') return null

  const gym = state.gymId
  if (!isGymId(gym)) return null

  const mine = activeOf(state.player)
  const foe = activeOf(state.opponent)

  return {
    gym,
    leader: gymLeader(gym),
    mine,
    foe,
    turn: state.turn,
    standing: state.player.team.filter(card => !isFainted(card)).length,
  }
})

/** O chip verde do painel do próximo — um exemplo de cobertura, não um placar. */
const advantage = computed(() => {
  const strong = league.strongest.value
  if (strong === null) return null

  const leaderType = league.next.value.leader.type
  return `${strong.entry.displayName} contra ${TYPE_LABELS[leaderType]} `
    + multiplierLabel(strong.multiplier)
})

/**
 * `138 / 1025`, e os dois números vêm de lugares diferentes de propósito.
 *
 * O numerador é a **store** — espécies distintas possuídas — e o denominador é o
 * índice carregado, que é o mesmo par que o binder escreve. Ler os dois do
 * mesmo objeto foi o erro que esta tela cometeu antes de ir ao navegador:
 * `collection.total` é o tamanho do dex, não o que se tem, e o Hub abriu
 * dizendo `1.025 / 1.025` ao lado de `0,8% do dex`.
 */
const percent = computed(() => (collection.ratio.value * 100).toFixed(1).replace('.', ','))

/** Os quatro números do cabeçalho da prancha: três tiers e o brilho, que não é
 * tier nenhum — shiny rola sobre qualquer raridade e conta à parte. */
const tiers = computed(() => [
  { label: RARITY_LABELS.uncommon, value: collection.ownedByRarity.value.uncommon },
  { label: RARITY_LABELS.rare, value: collection.ownedByRarity.value.rare },
  { label: RARITY_LABELS.ultra, value: collection.ownedByRarity.value.ultra },
  { label: 'Shiny', value: owned.shinyCount },
])
</script>

<template>
  <main class="hub">
    <header class="hub__bar">
      <NuxtLink
        to="/"
        class="hub__brand"
      >
        HOLO<span>/</span>DECK
      </NuxtLink>

      <ClientOnly>
        <p class="numeric hub__coins">
          {{ gameNumber(progress.coins) }}
          <span>moedas</span>
        </p>
      </ClientOnly>
    </header>

    <div class="hub__body">
      <ClientOnly>
        <!-- A faixa de retomar, acima de tudo: é a única coisa da tela que o
             jogador deixou pela metade. Sai sozinha quando não há batalha. -->
        <section
          v-if="resumable"
          class="hub__resume"
        >
          <div class="hub__resume-mark" />

          <div class="hub__resume-who">
            <img
              :src="`/sprites/${resumable.mine.speciesId}.webp`"
              :alt="resumable.mine.displayName"
              width="128"
              height="128"
            >
            <div>
              <p class="hub__eyebrow hub__eyebrow--warm">
                Batalha em andamento
              </p>
              <p class="hub__resume-title">
                Ginásio {{ resumable.gym }} · {{ resumable.leader.name }}
              </p>
            </div>
          </div>

          <div class="hub__resume-bars">
            <div
              v-for="side in [resumable.mine, resumable.foe]"
              :key="side.speciesId"
              class="hub__resume-bar"
            >
              <p class="numeric hub__resume-hp">
                {{ side.displayName.toUpperCase() }}
                <b>{{ Math.max(0, side.hp) }}</b>/{{ side.maxHp }}
              </p>
              <div class="hub__track">
                <div
                  class="hub__fill"
                  :style="{ width: `${Math.max(0, side.hp) / side.maxHp * 100}%` }"
                />
              </div>
            </div>
            <p class="numeric hub__resume-meta">
              turno {{ resumable.turn }} · seu banco {{ resumable.standing }} de pé
            </p>
          </div>

          <div class="hub__resume-actions">
            <button
              type="button"
              class="numeric hub__give-up"
              @click="battle.discard()"
            >
              DESISTIR
            </button>
            <NuxtLink
              :to="`/battle/${resumable.gym}`"
              class="hub__button hub__button--warm bevel-control"
            >
              RETOMAR
            </NuxtLink>
          </div>
        </section>
      </ClientOnly>

      <div class="hub__grid">
        <ClientOnly>
          <!-- Próximo desafio. O pack diário, que a prancha põe ao lado, chega
               com a loja: sem ela não há como gastar o que ele rende. -->
          <section
            class="hub__panel"
            :data-type="league.next.value.leader.type"
          >
            <div class="hub__panel-head">
              <div>
                <p class="hub__eyebrow hub__eyebrow--type">
                  {{ progress.leagueComplete ? 'Revanche' : 'Próximo desafio' }}
                  · Ginásio {{ league.next.value.leader.gym }} de {{ GYM_COUNT }}
                </p>
                <h2 class="hub__panel-title">
                  {{ league.next.value.leader.name }}
                </h2>
                <p class="numeric hub__panel-meta">
                  {{ TYPE_LABELS[league.next.value.leader.type] }}
                </p>
              </div>

              <p
                v-if="advantage"
                class="numeric hub__chip"
              >
                {{ advantage }}
              </p>
            </div>

            <p class="numeric hub__label">
              Time do líder
            </p>
            <div class="hub__team">
              <div
                v-for="(species, index) in league.next.value.team"
                :key="species.id"
                class="hub__team-slot"
                :class="{ 'hub__team-slot--ace': index === league.next.value.team.length - 1 }"
              >
                <img
                  :src="`/sprites/${species.id}.webp`"
                  :alt="species.displayName"
                  width="128"
                  height="128"
                  loading="lazy"
                >
              </div>
            </div>

            <div class="hub__panel-foot">
              <NuxtLink
                v-if="league.deckReady.value"
                :to="`/battle/${league.next.value.leader.gym}`"
                class="hub__button hub__button--type bevel-control"
              >
                DESAFIAR
              </NuxtLink>
              <NuxtLink
                v-else
                to="/deck"
                class="hub__button bevel-control"
              >
                MONTAR O DECK
              </NuxtLink>
              <p class="numeric hub__reward">
                recompensa <b>+{{ gameNumber(league.next.value.reward.total) }}</b> moedas
              </p>
            </div>
          </section>

          <!-- Coleção: os mesmos números do binder, resumidos. -->
          <section class="hub__panel">
            <div class="hub__panel-head">
              <div>
                <p class="hub__eyebrow">
                  Sua coleção
                </p>
                <p class="numeric hub__count">
                  <b>{{ gameNumber(owned.ownedCount) }}</b>
                  <span>/ {{ gameNumber(collection.total.value) }}</span>
                  <em>{{ percent }}% do dex</em>
                </p>
              </div>

              <dl class="numeric hub__tiers">
                <div
                  v-for="tier in tiers"
                  :key="tier.label"
                >
                  <dd>{{ tier.value }}</dd>
                  <dt>{{ tier.label }}</dt>
                </div>
              </dl>
            </div>

            <div class="hub__regions">
              <CollectionProgressBar
                v-for="region in collection.byRegion.value"
                :key="region.slug"
                :owned="region.owned"
                :total="region.speciesCount"
                :label="region.label"
              />
            </div>
          </section>
        </ClientOnly>
      </div>

      <!--
        A fileira provisória de portas. Ela sai no PR seguinte, quando a barra de
        navegação global do canvas passa a existir com todos os destinos de pé.
      -->
      <nav class="hub__doors">
        <NuxtLink
          to="/packs"
          class="hub__door hub__door--primary bevel-control"
        >
          Abrir pack
        </NuxtLink>
        <NuxtLink
          to="/league"
          class="hub__door bevel-control"
        >
          Liga
        </NuxtLink>
        <NuxtLink
          to="/deck"
          class="hub__door bevel-control"
        >
          Deck
        </NuxtLink>
        <NuxtLink
          to="/collection"
          class="hub__door bevel-control"
        >
          Coleção
        </NuxtLink>
        <NuxtLink
          to="/pokedex"
          class="hub__door bevel-control"
        >
          Pokédex
        </NuxtLink>
      </nav>

      <AppVersion />
    </div>
  </main>
</template>

<style scoped>
.hub {
  min-height: 100dvh;
  background: var(--bg);
}

.hub__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 66px;
  padding: 0 40px;
  border-bottom: 1px solid var(--border);
}

.hub__brand {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-decoration: none;
  color: var(--text);
}

.hub__brand span {
  color: var(--text-muted);
}

.hub__coins {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in oklab, var(--coin) 45%, var(--bg));
  background: color-mix(in oklab, var(--coin) 8%, var(--surface));
  font-size: 14px;
  font-weight: 700;
  color: var(--coin);
}

.hub__coins span {
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hub__body {
  padding: 36px 40px 40px;
}

.hub__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hub__eyebrow--warm {
  color: var(--coin);
}

.hub__eyebrow--type {
  color: var(--type);
}

/* A faixa de retomar: uma barra de acento à esquerda e o degradê da prancha. */
.hub__resume {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  overflow: hidden;
  margin-bottom: 22px;
  padding-right: 26px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in oklab, var(--coin) 45%, var(--bg));
  background: linear-gradient(96deg, color-mix(in oklab, var(--coin) 8%, var(--surface)), var(--surface) 46%);
}

.hub__resume-mark {
  align-self: stretch;
  width: 4px;
  background: var(--coin);
}

.hub__resume-who {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 18px 0;
}

.hub__resume-who img {
  width: 52px;
  height: 52px;
  padding: 5px;
  border-radius: var(--radius);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  object-fit: contain;
}

.hub__resume-title {
  margin-top: 5px;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}

.hub__resume-bars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 26px;
  flex-grow: 1;
}

.hub__resume-bar {
  min-width: 132px;
}

.hub__resume-hp {
  margin-bottom: 5px;
  font-size: 10px;
  color: var(--text-muted);
}

.hub__resume-hp b {
  font-weight: 700;
  color: var(--text-body);
}

.hub__track {
  overflow: hidden;
  height: 5px;
  border-radius: 2px;
  background: var(--progress-track);
}

.hub__fill {
  height: 100%;
  background: var(--hp);
}

.hub__resume-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.hub__resume-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hub__give-up {
  padding: 4px 6px;
  border-radius: var(--radius);
  background: none;
  border: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  cursor: pointer;
}

.hub__give-up:hover,
.hub__give-up:focus-visible {
  color: var(--deficit);
}

.hub__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 22px;
}

.hub__panel {
  padding: 26px 28px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
}

.hub__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.hub__panel-title {
  margin-top: 8px;
  font-size: 29px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--text);
}

.hub__panel-meta {
  margin-top: 6px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--type);
}

/* O chip de vantagem — verde, porque é a leitura boa. */
.hub__chip {
  padding: 5px 10px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in oklab, var(--hp) 45%, var(--bg));
  background: color-mix(in oklab, var(--hp) 8%, var(--surface));
  font-size: 11px;
  font-weight: 700;
  color: var(--hp);
}

.hub__label {
  margin-bottom: 9px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hub__team {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-bottom: 18px;
}

.hub__team-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: var(--radius);
  background: var(--surface-raised);
  border: 1px solid var(--border);
}

.hub__team-slot img {
  max-width: 48px;
  max-height: 48px;
}

/* O ace é o último a entrar, e é o que a prancha destaca. */
.hub__team-slot--ace {
  border-color: var(--type);
  box-shadow: 0 0 24px -8px var(--type);
}

.hub__panel-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.hub__reward {
  font-size: 11px;
  color: var(--text-muted);
}

.hub__reward b {
  font-weight: 700;
  color: var(--coin);
}

.hub__count {
  display: flex;
  align-items: baseline;
  gap: 11px;
  margin-top: 8px;
}

.hub__count b {
  font-size: 38px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.hub__count span {
  font-size: 17px;
  color: var(--text-muted);
}

.hub__count em {
  font-size: 13px;
  font-style: normal;
  color: var(--accent);
}

.hub__tiers {
  display: flex;
  gap: 22px;
  text-align: right;
}

.hub__tiers dd {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-body);
}

.hub__tiers dt {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hub__regions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.hub__button {
  padding: 12px 26px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-decoration: none;
  color: var(--text-body);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  cursor: pointer;
}

.hub__button:hover,
.hub__button:focus-visible {
  color: var(--text);
  border-color: var(--accent);
}

.hub__button--type {
  color: var(--bg);
  background: var(--type);
  border-color: var(--type);
}

.hub__button--type:hover,
.hub__button--type:focus-visible {
  color: var(--bg);
  background: color-mix(in oklab, var(--type) 82%, var(--text));
}

.hub__button--warm {
  color: var(--bg);
  background: var(--coin);
  border-color: var(--coin);
}

.hub__button--warm:hover,
.hub__button--warm:focus-visible {
  color: var(--bg);
  background: color-mix(in oklab, var(--coin) 82%, var(--text));
}

.hub__doors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
}

.hub__door {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-decoration: none;
  color: var(--text-body);
  background: var(--surface);
  border: 1px solid var(--border);
}

.hub__door:hover,
.hub__door:focus-visible {
  color: var(--text);
  border-color: var(--border-strong);
}

.hub__door--primary {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, var(--surface));
  border-color: var(--accent);
}

.hub__door--primary:hover,
.hub__door--primary:focus-visible {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 22%, var(--surface));
}

@media (max-width: 720px) {
  .hub__bar {
    padding: 0 20px;
  }

  .hub__body {
    padding: 24px 20px 32px;
  }
}
</style>
