<script setup lang="ts">
useHead({ title: 'Holo Deck' })
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-ink-950 p-8">
    <div class="flex flex-col items-center gap-3 text-center">
      <h1 class="text-3xl font-semibold tracking-tight text-white">
        Holo Deck
      </h1>
      <p class="max-w-sm text-sm text-ink-450">
        Fundação de pé. O jogo entra a partir da Fase 1.
      </p>
      <AppVersion />
    </div>
  </main>
</template>
