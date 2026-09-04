<script setup lang="ts">
import { computed } from 'vue'
import { useLeague } from '~/composables/useLeague'
import { useProgressStore } from '~~/app/stores/progress'
import { DECK_SIZE } from '~~/shared/game/deck'
import { gameNumber } from '~~/shared/game/progress'
import { GYM_COUNT } from '~~/shared/types/brand'
import { TYPE_LABELS } from '~~/shared/types/game'

/**
 * A Liga — a prancha *Liga*.
 *
 * Trilha de dez células: os nove ginásios e, na décima, o painel do próximo. A
 * divisão em duas fileiras de cinco é a do canvas, e não uma consequência do
 * grid: é ela que deixa a linha da trilha atravessar a primeira fileira.
 *
 * **O conteúdo de estado é `<ClientOnly>`**, pela mesma razão do binder e do
 * deck: a rota é pré-renderizada e as insígnias moram no `localStorage`, então
 * no servidor todo jogador tem zero — qualquer contagem no HTML seria um número
 * que muda na hidratação. O cabeçalho e o rodapé são estáticos e ficam de fora.
 */
const progress = useProgressStore()
const view = await useLeague()

useHead({ title: 'A Liga' })

const firstRow = computed(() => view.gyms.value.slice(0, 5))
const secondRow = computed(() => view.gyms.value.slice(5))

/** A barra de insígnias do cabeçalho — `1/9` dá os 11% que a prancha desenha. */
const badgeWidth = computed(() => `${(progress.badges / GYM_COUNT) * 100}%`)

/**
 * Até onde a trilha está acesa.
 *
 * A prancha desenha o degradê parando na carta atual; aqui ele para na mesma
 * fração que a barra do cabeçalho, sobre uma fileira de cinco.
 */
const trackWidth = computed(() => `${Math.min(1, progress.nextGym / 5) * 100}%`)

const next = computed(() => view.next.value)
</script>

<template>
  <div class="league">
    <header class="league__head">
      <div>
        <p class="league__eyebrow">
          Uma geração, um líder
        </p>
        <h1 class="league__title">
          A Liga
        </h1>
      </div>

      <ClientOnly>
        <div class="league__score">
          <div class="league__count">
            <p class="numeric league__badges">
              {{ progress.badges }}<span>/{{ GYM_COUNT }}</span>
            </p>
            <p class="league__eyebrow">
              insígnias
            </p>
          </div>
          <div class="league__meter">
            <div
              class="league__meter-fill"
              :style="{ width: badgeWidth }"
            />
          </div>
        </div>
      </ClientOnly>
    </header>

    <ClientOnly>
      <div class="league__track">
        <div
          class="league__line"
          :style="{ '--lit': trackWidth }"
          aria-hidden="true"
        />

        <div class="league__row">
          <LeagueGymCard
            v-for="gym in firstRow"
            :key="gym.leader.gym"
            :view="gym"
          />
        </div>

        <div class="league__row league__row--second">
          <LeagueGymCard
            v-for="gym in secondRow"
            :key="gym.leader.gym"
            :view="gym"
          />

          <!-- A décima célula: o painel do próximo desafio. -->
          <section
            class="league__next bevel-tile"
            :data-type="next.leader.type"
          >
            <p class="league__eyebrow">
              {{ progress.leagueComplete ? 'Revanche' : 'Próximo' }}
            </p>
            <h2 class="league__next-name">
              {{ next.leader.name }}
            </h2>
            <p class="numeric league__next-meta">
              Ginásio {{ next.leader.gym }} · {{ TYPE_LABELS[next.leader.type] }}
            </p>

            <dl class="numeric league__facts">
              <div>
                <dt>Time</dt>
                <dd>{{ next.leader.teamSize }} Pokémon</dd>
              </div>
              <div>
                <dt>Nível</dt>
                <dd>Lv50</dd>
              </div>
              <div>
                <dt>Prêmio</dt>
                <dd class="league__prize">
                  +{{ gameNumber(next.reward.total) }}
                </dd>
              </div>
              <div>
                <dt>Seu deck</dt>
                <!--
                  `N ajuste(s)` é a leitura de cobertura: quantas cartas apanham
                  mais que o normal deste líder. A prancha escreve o número e não
                  diz o que ele conta; esta é a única leitura que o código produz,
                  e é a mesma que o deck builder desenha como faixa `LEVA ×2`.
                -->
                <dd :class="view.risky.value > 0 ? 'league__risk' : ''">
                  {{ view.risky.value > 0
                    ? `${view.risky.value} ajuste${view.risky.value > 1 ? 's' : ''}`
                    : 'sem ajustes' }}
                </dd>
              </div>
            </dl>

            <NuxtLink
              v-if="view.deckReady.value"
              :to="`/battle/${next.leader.gym}`"
              class="league__action bevel-control"
            >
              {{ progress.hasBadge(next.leader.gym) ? 'REVANCHE' : 'DESAFIAR' }}
            </NuxtLink>
            <!-- Sem os seis, não há batalha: o motor recusa um lado vazio e a
                 tela não deve oferecer o que ela sabe que não vai acontecer. -->
            <NuxtLink
              v-else
              to="/deck"
              class="league__action league__action--empty bevel-control"
            >
              MONTE UM DECK DE {{ DECK_SIZE }}
            </NuxtLink>
          </section>
        </div>
      </div>

      <template #fallback>
        <p class="league__loading">
          Carregando a Liga…
        </p>
      </template>
    </ClientOnly>

    <footer class="league__foot">
      <span>Desbloqueio sequencial — cada líder só abre com a insígnia anterior</span>
      <span>Times montados pela regra: mesmo tipo, mesma geração, sob o teto de BST da faixa</span>
    </footer>
  </div>
</template>

<style scoped>
.league {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 38px 44px 44px;
  background: var(--bg);
}

.league__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border);
}

.league__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.league__title {
  margin-top: 9px;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--text);
}

.league__score {
  display: flex;
  align-items: center;
  gap: 26px;
}

.league__count {
  text-align: right;
}

.league__badges {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.league__badges span {
  font-size: 16px;
  color: var(--text-muted);
}

.league__meter {
  overflow: hidden;
  width: 170px;
  height: 5px;
  border-radius: 2px;
  background: var(--progress-track);
}

.league__meter-fill {
  height: 100%;
  background: var(--coin);
  box-shadow: 0 0 12px var(--coin);
}

.league__track {
  position: relative;
  margin-top: 38px;
}

/**
 * A trilha que liga os ginásios, atrás da primeira fileira.
 *
 * Decorativa, e só existe na largura em que a fileira de cinco existe: abaixo
 * dela o grid quebra em outra contagem de colunas e uma linha reta atravessando
 * o meio das cartas não liga mais nada.
 */
.league__line {
  position: absolute;
  left: 0;
  right: 0;
  top: 125px;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--coin) 0,
    var(--border) var(--lit),
    var(--border) 100%
  );
}

.league__row {
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}

.league__row--second {
  margin-top: 20px;
}

.league__next {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 250px;
  padding: 20px 22px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.league__next-name {
  margin: 14px 0 6px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.league__next-meta {
  margin-bottom: 16px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--type);
}

.league__facts {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-bottom: 18px;
  font-size: 11px;
}

.league__facts > div {
  display: flex;
  justify-content: space-between;
}

.league__facts dt {
  color: var(--text-muted);
}

.league__facts dd {
  margin: 0;
  color: var(--text-body);
}

.league__prize {
  font-weight: 700;
  color: var(--coin);
}

/* O risco concreto em `--deficit`, como no deck builder: a prancha usa o
   amarelo de terrestre, que é primitivo de tipo e o portão de token recusa. */
.league__risk {
  color: var(--deficit);
}

.league__action {
  margin-top: auto;
  padding: 11px 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
  text-decoration: none;
  color: var(--bg);
  background: var(--type);
}

.league__action:hover,
.league__action:focus-visible {
  background: color-mix(in oklab, var(--type) 80%, var(--text));
}

.league__action--empty {
  color: var(--text-body);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
}

.league__action--empty:hover,
.league__action--empty:focus-visible {
  color: var(--text);
  background: var(--surface-raised);
  border-color: var(--accent);
}

.league__loading {
  margin-top: 38px;
  font-size: 13px;
  color: var(--text-muted);
}

.league__foot {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-top: 30px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}

/**
 * Abaixo da largura da prancha as duas fileiras viram uma grade solta, e a
 * linha da trilha sai junto: ela liga cinco cartas em fila, e três por linha
 * não são uma fila.
 */
@media (max-width: 1180px) {
  .league {
    padding: 28px 20px 32px;
  }

  .league__row {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }

  .league__line {
    display: none;
  }

  .league__foot {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
