<script setup lang="ts">
import { computed } from 'vue'
import type { GymView } from '~/composables/useLeague'
import { generationLabel, REGION_LABELS, TYPE_LABELS } from '~~/shared/types/game'
import { gameNumber } from '~~/shared/game/progress'
import { aceOf } from '~~/shared/game/gyms'

/**
 * Uma das nove cartas da trilha — a prancha *Liga*, nos três estados.
 *
 * O que muda entre eles não é só cor: o vencido mostra o **ace** e oferece
 * revanche, o atual mostra o time inteiro e o prêmio cheio, e o bloqueado não
 * mostra ninguém — a geração dele nem foi carregada.
 *
 * **A cor do estado atual é a do tipo do líder**, como no canvas: a prancha
 * pinta a carta do Falkner no roxo de voador e o botão `DESAFIAR` na mesma cor,
 * que é o mesmo papel que `DexTypeBadge` já dá a ela. O vencido é `--coin`, o
 * ouro que a Liga usa para insígnia, prêmio e saldo.
 */
const props = defineProps<{ view: GymView }>()

const leader = computed(() => props.view.leader)
const unlocked = computed(() => props.view.status !== 'locked')

/**
 * Quem aparece na carta.
 *
 * Vencido mostra o ace sozinho — é o retrato do ginásio, e é o que a prancha
 * desenha no Brock. O atual mostra o time inteiro, porque é contra ele que o
 * jogador está montando deck agora, e esconder um dos seis trabalharia contra a
 * mecânica que três telas ensinam. Todos são do tipo do líder, então não há
 * surpresa de cobertura a preservar.
 */
const shown = computed(() => {
  const team = props.view.team
  if (team.length === 0) return []
  return props.view.status === 'won' ? [aceOf(team)] : team
})

const label = computed(() => {
  const name = `${leader.value.name}, ginásio ${leader.value.gym}`
  if (props.view.status === 'won') return `Revanche contra ${name}`
  return `Desafiar ${name}`
})
</script>

<template>
  <article
    class="gym bevel-tile"
    :class="`gym--${view.status}`"
    :data-type="leader.type"
  >
    <!-- O link cobre a carta e não tem texto dentro: o `aria-label` é o único
         nome que ele tem. Camada interna, como na `PokeCard` — aqui não há ação
         dentro do rodapé, mas a escada é a mesma e o brilho fica por baixo. -->
    <NuxtLink
      v-if="unlocked"
      :to="`/battle/${leader.gym}`"
      class="gym__link"
      :aria-label="label"
    />

    <div
      class="gym__glow"
      aria-hidden="true"
    />

    <template v-if="unlocked">
      <header class="gym__top">
        <span class="numeric gym__generation">{{ generationLabel(leader.generation) }}</span>

        <svg
          v-if="view.status === 'won'"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span
          v-else
          class="numeric gym__now"
        >AGORA</span>
      </header>

      <div class="gym__team">
        <img
          v-for="species in shown"
          :key="species.id"
          :src="`/sprites/${species.id}.webp`"
          :alt="species.displayName"
          width="128"
          height="128"
          loading="lazy"
          decoding="async"
          class="gym__sprite"
        >
      </div>

      <div class="gym__meta">
        <p class="gym__name">
          {{ leader.name }}
        </p>
        <p class="numeric gym__region">
          {{ REGION_LABELS[leader.region] }}
        </p>
        <DexTypeBadge :type="leader.type" />
      </div>

      <footer class="numeric gym__foot">
        <template v-if="view.status === 'won'">
          <span class="gym__badge">VENCIDO</span>
          <span class="gym__rematch">REVANCHE +{{ gameNumber(view.reward.total) }}</span>
        </template>
        <span
          v-else
          class="gym__challenge"
        >DESAFIAR · +{{ gameNumber(view.reward.total) }}</span>
      </footer>
    </template>

    <!-- Bloqueado: sem time, sem prêmio e sem link. "Cada líder só abre com a
         insígnia anterior", diz o rodapé da prancha. -->
    <div
      v-else
      class="gym__locked"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="4.5"
          y="10.5"
          width="15"
          height="10"
          rx="2"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M8 10.5V7.5a4 4 0 018 0v3"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>

      <div>
        <p class="numeric gym__generation">
          {{ generationLabel(leader.generation) }}
        </p>
        <p class="gym__name">
          {{ leader.name }}
        </p>
        <p class="numeric gym__region">
          {{ REGION_LABELS[leader.region] }} · {{ TYPE_LABELS[leader.type] }}
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped>
/**
 * Altura fixa, como a prancha: as dez células da trilha são uma fileira, e uma
 * carta que crescesse com o tamanho do time faria a linha subir e descer entre
 * as faixas A, B e C — 3, 4 e 6 Pokémon.
 */
.gym {
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 250px;
  background: var(--surface-cell);
  border: 1px solid var(--border);
}

/* Camada 1: o link cobre a carta inteira e fica embaixo de qualquer conteúdo
   que venha a ter ação própria. Mesma escada da `PokeCard`. */
.gym__link {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.gym__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -3px;
}

/* O brilho do tipo atrás da arte — o mesmo mecanismo do resto do sistema:
   `--type` vem do `data-type` e a intensidade é derivada, não escrita. */
.gym__glow {
  position: absolute;
  left: 50%;
  top: 96px;
  width: 190px;
  height: 190px;
  transform: translate(-50%, -50%);
  background: radial-gradient(
    circle,
    color-mix(in oklab, var(--type) 26%, transparent),
    transparent 66%
  );
}

.gym--locked .gym__glow {
  display: none;
}

.gym__top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 0;
}

.gym__generation {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.gym__now {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 7px;
  border-radius: var(--radius);
  color: var(--bg);
  background: var(--type);
}

.gym__team {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 96px;
  padding: 0 10px;
}

/* Seis sprites numa carta de 250px: o `min-width: 0` é o que deixa o flex
   encolhê-los em vez de estourar a carta na faixa C. */
.gym__sprite {
  min-width: 0;
  max-width: 84px;
  max-height: 84px;
  object-fit: contain;
}

.gym__meta {
  position: relative;
  padding: 0 14px;
}

.gym__name {
  font-size: 19px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.gym__region {
  margin-top: 5px;
  margin-bottom: 9px;
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.gym__foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.gym__badge,
.gym__rematch,
.gym__challenge {
  flex-grow: 1;
  padding: 5px;
  text-align: center;
}

.gym__badge {
  color: var(--bg);
  background: var(--coin);
}

.gym__rematch {
  color: var(--coin);
  background: color-mix(in oklab, var(--coin) 12%, var(--surface-cell));
  border-left: 1px solid color-mix(in oklab, var(--coin) 45%, var(--bg));
}

.gym__challenge {
  color: var(--bg);
  background: var(--type);
}

/* Vencido: o ouro da Liga, e o tipo continua no brilho e no chip. */
.gym--won {
  background: linear-gradient(
    168deg,
    color-mix(in oklab, var(--coin) 14%, var(--surface-cell)),
    var(--surface-cell)
  );
  border-color: var(--coin);
  box-shadow: 0 0 34px -16px color-mix(in oklab, var(--coin) 90%, transparent);
}

.gym--won .gym__generation {
  color: color-mix(in oklab, var(--coin) 60%, var(--text-muted));
}

.gym--won .gym__top {
  color: var(--coin);
}

/* Atual: a cor do líder, como no canvas. */
.gym--current {
  background: linear-gradient(
    168deg,
    color-mix(in oklab, var(--type) 14%, var(--surface-cell)),
    var(--surface-cell)
  );
  border-color: var(--type);
  box-shadow: 0 0 44px -14px color-mix(in oklab, var(--type) 95%, transparent);
}

.gym--current .gym__generation {
  color: var(--type);
}

.gym--locked {
  background: var(--surface-sunken);
  border-style: dashed;
  border-color: var(--border);
}

/**
 * O bloqueado é apagado, e não ilegível.
 *
 * A prancha pinta o nome do líder num degrau de superfície sobre outro degrau de
 * superfície: **1,5:1**, que some. O sistema já resolveu essa classe na Fase 2,
 * quando `--text-muted` e `--text-faint` deixaram de apontar para degraus que
 * não sustentam texto. Vale o mesmo aqui — o cadeado e a moldura tracejada já
 * dizem "fechado", e o nome continua legível.
 */
.gym__locked {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  text-align: center;
  color: var(--border-strong);
}

.gym--locked .gym__name {
  margin-top: 6px;
  font-size: 17px;
  color: var(--text-muted);
}

.gym--locked .gym__region {
  margin-bottom: 0;
  font-size: 9px;
  color: var(--text-faint);
}
</style>
