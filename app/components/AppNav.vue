<script setup lang="ts">
import { gameNumber } from '~~/shared/game/progress'
import { useProgressStore } from '~~/app/stores/progress'

/**
 * A barra de navegação global — a que as pranchas *Hub*, *Loja* e *Regras*
 * desenham no topo, idêntica nas três.
 *
 * **Ela chega agora e não antes por dependência, não por escopo.** O plano a
 * pedia na Fase 6 inteira; o PR da Liga a segurou porque ela liga destinos que
 * só passaram a existir aqui — `/rules`, `/settings` e `/packs` como loja. Um PR
 * com link quebrado não fecha verde, e a fileira provisória de portas do Hub
 * existiu exatamente para cobrir esse intervalo. Ela sai junto com esta barra.
 *
 * **Duas coisas da prancha não entram**, e as duas por falta de dado: o avatar
 * de 32px no canto direito é a conta, que é Fase 7; e a cor do sublinhado ativo
 * é `--accent` em toda página, contra o azul do *Hub* e o roxo da *Loja* — o
 * mesmo papel em duas cores é variação de mockup desenhado à mão, como o
 * `2px`/`3px` do raio que a Fase 2 normalizou.
 */
const progress = useProgressStore()

/**
 * Os seis destinos da esquerda, na ordem da prancha.
 *
 * `exact` só na Base: `NuxtLink` marca `router-link-active` por prefixo de rota,
 * o que é o que se quer em `/pokedex/1` acendendo *Pokédex* — e o que não se
 * quer na raiz, que é prefixo de tudo.
 */
const LINKS = [
  { to: '/', label: 'Base', exact: true },
  { to: '/packs', label: 'Packs', exact: false },
  { to: '/pokedex', label: 'Pokédex', exact: false },
  { to: '/collection', label: 'Coleção', exact: false },
  { to: '/deck', label: 'Deck', exact: false },
  { to: '/league', label: 'Liga', exact: false },
]
</script>

<template>
  <header class="nav">
    <div class="nav__side">
      <NuxtLink
        to="/"
        class="nav__brand"
      >
        <svg
          class="nav__mark"
          viewBox="0 0 100 100"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="38"
            stroke="currentColor"
            stroke-width="6"
          />
          <path
            d="M12 50h26M62 50h26"
            stroke="currentColor"
            stroke-width="6"
            stroke-linecap="round"
          />
          <circle
            cx="50"
            cy="50"
            r="12"
            stroke="var(--brand)"
            stroke-width="6"
          />
        </svg>
        HOLO<span>/</span>DECK
      </NuxtLink>

      <nav
        class="nav__links"
        aria-label="Seções do jogo"
      >
        <NuxtLink
          v-for="link in LINKS"
          :key="link.to"
          :to="link.to"
          class="nav__link"
          :class="{ 'nav__link--exact': link.exact }"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </div>

    <div class="nav__side nav__side--end">
      <ClientOnly>
        <NuxtLink
          to="/packs"
          class="numeric nav__coins"
        >
          <svg
            class="nav__coin-mark"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              stroke-width="2"
            />
            <path
              d="M12 7v10M9.5 9.5h5M9.5 14.5h5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          {{ gameNumber(progress.coins) }}
          <span class="nav__coins-label">moedas</span>
        </NuxtLink>
      </ClientOnly>

      <NuxtLink
        to="/rules"
        class="nav__link"
      >
        Regras
      </NuxtLink>

      <NuxtLink
        to="/settings"
        class="nav__gear"
        aria-label="Ajustes"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="3.1"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M12 3.4v2.3M12 18.3v2.3M20.6 12h-2.3M5.7 12H3.4M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6M18.1 18.1l-1.6-1.6M7.5 7.5L5.9 5.9"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </NuxtLink>
    </div>
  </header>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 66px;
  padding: 0 40px;
  border-bottom: 1px solid var(--border);
  /* A barra é fixa e o conteúdo passa por baixo dela; um fundo translúcido sem
     desfoque deixaria a arte da carta atravessar o rótulo. */
  background: color-mix(in oklab, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
}

@media (width < 720px) {
  .nav {
    padding: 10px 20px;
  }
}

.nav__side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 30px;
}

.nav__side--end {
  gap: 14px;
}

.nav__brand {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-decoration: none;
  color: var(--text);
}

.nav__brand span {
  color: var(--text-muted);
}

.nav__mark {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.nav__links {
  display: flex;
  flex-wrap: wrap;
  gap: 26px;
}

.nav__link {
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  color: var(--text-muted);
}

.nav__link:hover {
  color: var(--text-body);
}

/**
 * O sublinhado do destino atual.
 *
 * `router-link-active` casa por prefixo, que é o que acende *Pokédex* em
 * `/pokedex/1`. A Base pede `exact` porque `/` é prefixo de toda rota — sem
 * isso, ela ficaria acesa junto com a página em que se está.
 */
.nav__link.router-link-active:not(.nav__link--exact),
.nav__link.router-link-exact-active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.nav__link:focus-visible,
.nav__brand:focus-visible,
.nav__coins:focus-visible,
.nav__gear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

/**
 * O saldo leva à loja, e não é enfeite: é a única tela que gasta moeda, e um
 * número que o jogador olha querendo saber o que fazer com ele deve ser
 * clicável.
 */
.nav__coins {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid color-mix(in oklab, var(--coin) 45%, var(--bg));
  border-radius: var(--radius);
  background: color-mix(in oklab, var(--coin) 8%, var(--surface));
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  color: var(--coin);
}

.nav__coin-mark {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.nav__coins-label {
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nav__gear {
  display: flex;
  color: var(--text-muted);
}

.nav__gear svg {
  width: 19px;
  height: 19px;
}

.nav__gear:hover,
.nav__gear.router-link-active {
  color: var(--text-body);
}
</style>
