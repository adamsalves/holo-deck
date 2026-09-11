<script setup lang="ts">
import { computed } from 'vue'
import { useGameClock } from '~/composables/useGameClock'
import { useSync } from '~/composables/useSync'
import { syncLabel } from '~~/app/utils/sync-label'

/**
 * O indicador de sync — os estados 01 a 03 da prancha *Estados de sync*.
 *
 * **Mora no canto da conta**, como a prancha escreve ("no canto da barra
 * superior, discreto"), e só existe com conta: sem ela `status` é nulo, e o jogo
 * não menciona o assunto. Com conta, ele também espera o primeiro acerto — a
 * leitura do servidor no boot, ou a decisão do primeiro login —, porque antes
 * disso o aparelho não sabe se está sincronizado.
 *
 * **Não é região viva, de propósito.** Ele muda a cada jogada — enviando,
 * sincronizado, enviando de novo —, e anunciar isso a quem navega por leitor de
 * tela seria um aviso a cada carta escalada. Só o conflito fala com o jogador, e
 * ele mora em `SyncConflictNotice`.
 *
 * O *sincronizado há X* é o `updatedAt` do servidor, e não o instante da última
 * conferência: a prancha o nomeia assim, e é o único uso que o plano dá a ele.
 */
const { status } = useSync()

/** Um minuto é o passo do rótulo; o relógio de segundo é o que o jogo já tem. */
const now = useGameClock()

const label = computed(() => (status.value === null ? '' : syncLabel(status.value, now.value)))
</script>

<template>
  <span
    v-if="status"
    class="sync"
    :class="`sync--${status.phase}`"
  >
    <span
      v-if="status.phase === 'synced'"
      class="sync__dot"
      aria-hidden="true"
    />
    <svg
      v-else-if="status.phase === 'sending'"
      class="sync__icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 12a8 8 0 10-2.3 5.6"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </svg>
    <svg
      v-else
      class="sync__icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4l16 16M8.5 15.5a5 5 0 017 0M5 12a10 10 0 0114 0"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
    {{ label }}
  </span>
</template>

<style scoped>
.sync {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.sync--synced {
  border-color: color-mix(in oklab, var(--synced) 45%, var(--bg));
  background: color-mix(in oklab, var(--synced) 8%, var(--surface));
  color: var(--synced);
}

.sync--sending {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--bg));
  background: color-mix(in oklab, var(--accent) 8%, var(--surface));
  color: var(--accent);
}

.sync--queued {
  border-color: color-mix(in oklab, var(--caution) 45%, var(--bg));
  background: color-mix(in oklab, var(--caution) 8%, var(--surface));
  color: var(--caution);
}

.sync__dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.sync__icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
</style>
