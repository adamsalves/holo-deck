<template>
  <main class="grid min-h-dvh place-items-center bg-default p-8">
    <div class="flex flex-col items-center gap-3 text-center">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">
        Holo Deck
      </h1>
      <p class="max-w-sm text-sm text-muted">
        A Pokédex está de pé. Packs, coleção, deck e batalha entram nas próximas fases.
      </p>
      <NuxtLink
        to="/pokedex"
        class="home-link bevel-control"
      >
        Abrir a Pokédex
      </NuxtLink>
      <AppVersion />
    </div>
  </main>
</template>

<style scoped>
/* O único caminho para a Pokédex a partir da raiz. A navegação global é da
   Fase 6; até lá, esta é a porta. */
.home-link {
  margin-top: 4px;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: color-mix(in oklab, var(--accent) 14%, var(--surface));
  border: 1px solid var(--accent);
  color: var(--accent);
  text-decoration: none;
}

.home-link:hover,
.home-link:focus-visible {
  background: color-mix(in oklab, var(--accent) 22%, var(--surface));
}
</style>
