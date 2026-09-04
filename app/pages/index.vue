<template>
  <main class="grid min-h-dvh place-items-center bg-default p-8">
    <div class="flex flex-col items-center gap-3 text-center">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">
        Holo Deck
      </h1>
      <p class="max-w-sm text-sm text-muted">
        Pack, coleção, Pokédex e deck estão de pé. A batalha e a Liga entram no
        próximo passo da Fase 6.
      </p>

      <nav class="home-doors">
        <NuxtLink
          to="/packs"
          class="home-link home-link--primary bevel-control"
        >
          Abrir pack
        </NuxtLink>
        <NuxtLink
          to="/collection"
          class="home-link bevel-control"
        >
          Coleção
        </NuxtLink>
        <NuxtLink
          to="/deck"
          class="home-link bevel-control"
        >
          Deck
        </NuxtLink>
        <NuxtLink
          to="/pokedex"
          class="home-link bevel-control"
        >
          Pokédex
        </NuxtLink>
      </nav>

      <AppVersion />
    </div>
  </main>
</template>

<style scoped>
/**
 * As quatro portas do jogo até aqui. A navegação global é da Fase 6 — a única
 * barra desenhada no canvas é a do Hub, e ela lista cinco destinos que ainda não
 * existem —, mas duas telas sem caminho até elas seria a Fase 5 entregue e
 * inalcançável.
 *
 * *Abrir pack* vem primeiro e é a única em destaque, porque é por onde o jogo
 * começa: um jogador novo tem três packs de boas-vindas esperando, e uma coleção
 * vazia não é uma primeira tela.
 */
.home-doors {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.home-link {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-body);
  text-decoration: none;
}

.home-link:hover,
.home-link:focus-visible {
  border-color: var(--border-strong);
  color: var(--text);
}

.home-link--primary {
  background: color-mix(in oklab, var(--accent) 14%, var(--surface));
  border-color: var(--accent);
  color: var(--accent);
}

.home-link--primary:hover,
.home-link--primary:focus-visible {
  background: color-mix(in oklab, var(--accent) 22%, var(--surface));
  border-color: var(--accent);
  color: var(--accent);
}
</style>
