<script setup lang="ts">
/**
 * O layout padrão: a barra global, e a tela por baixo dela.
 *
 * Ele nasce agora, com os destinos que a barra liga. **Duas telas ficam de
 * fora**, e as duas por decisão do canvas e não por descuido:
 * `/battle/[gymId]`, que a prancha *Batalha* desenha com uma barra **própria** —
 * ginásio, líder, região e tipo, no lugar dos seis destinos —, e `/styleguide`,
 * que é o espelho do sistema e não uma tela do jogo. As duas pedem
 * `definePageMeta({ layout: false })`.
 */
</script>

<template>
  <div class="shell">
    <AppNav />
    <slot />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
  background: var(--bg);
}
</style>
