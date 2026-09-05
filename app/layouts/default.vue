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
 *
 * **O link de pular é o primeiro foco de toda tela.** A barra põe nove elementos
 * focáveis antes do conteúdo, e sem ele quem navega por teclado atravessa os
 * nove em cada página — WCAG 2.4.1. Ele é invisível até receber foco, e aí
 * aparece por cima da barra.
 *
 * O alvo é um `<div>` e não um `<main>`: quase toda página já traz o próprio
 * `<main>`, e aninhar dois seria marcação inválida. O `tabindex="-1"` existe
 * porque um contêiner sem ele não recebe foco por âncora, e o salto ficaria
 * visual sem mover o cursor do leitor de tela.
 */
</script>

<template>
  <div class="shell">
    <a
      class="shell__skip"
      href="#conteudo"
    >
      Pular para o conteúdo
    </a>

    <AppNav />

    <div
      id="conteudo"
      tabindex="-1"
      class="shell__main"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
  background: var(--bg);
}

/**
 * Fora da tela até o foco chegar — e não `display: none`, que o tiraria da
 * ordem de tabulação junto e faria o link não existir para quem ele serve.
 */
.shell__skip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 30;
  transform: translateY(-120%);
  padding: 12px 20px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  color: var(--text);
}

.shell__skip:focus-visible {
  transform: translateY(8px);
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

/** O contêiner de foco não desenha nada: ele só recebe o salto do link. */
.shell__main:focus {
  outline: none;
}
</style>
