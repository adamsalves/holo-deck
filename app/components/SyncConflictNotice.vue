<script setup lang="ts">
import { computed } from 'vue'
import { useSync } from '~/composables/useSync'

/**
 * O aviso de conflito — o estado 04 da prancha *Estados de sync*, o único que
 * fala com o jogador.
 *
 * **Ele fala depois de resolvido, e nunca pede escolha.** Quando aparece, o
 * documento deste aparelho já venceu e já subiu, e a cópia do outro aparelho já
 * está no anel de backup: o `SyncDriver` só chama `onConflict` depois do envio
 * aceito. Por isso o único botão é ENTENDI — não há o que decidir, há o que
 * saber.
 *
 * **O texto nomeia o painel que devolve a cópia.** A prancha dizia "a cópia
 * anterior ficou salva no backup local", e o jogador não sabe onde fica "o
 * backup local". É a lição da *Duas coleções*, cujo rodapé mandava para uma porta
 * que não abria: aviso que promete uma saída precisa dizer qual é.
 *
 * **A região viva existe sempre, e o aviso entra nela.** Um `role="status"` que
 * nasce junto com o próprio texto não é anunciado por todo leitor de tela — a
 * região precisa estar no documento antes de o conteúdo chegar.
 */
const { conflict, dismiss } = useSync()
const { t } = useI18n()

/**
 * How many local changes won, as a sentence.
 *
 * The count travels twice, as in `syncLabel`: once to fill `{count}` and once to
 * pick the form. The two forms are whole sentences and not one sentence with a
 * number swapped in — Portuguese inflects the verb and the article with the
 * count (*A mudança … venceu* against *As 3 mudanças … venceram*), which a
 * placeholder alone cannot carry.
 */
const lede = computed(() => {
  const won = conflict.value?.won ?? 0
  return t('conflict.won', { count: won }, won)
})
</script>

<template>
  <div
    class="conflict-region"
    role="status"
  >
    <div
      v-if="conflict"
      class="conflict bevel-tile"
    >
      <p class="conflict__title">
        {{ t('conflict.title') }}
      </p>
      <!-- The panel is named from its own labels — the gear's name and the
           backups panel's title — so the notice cannot promise a door that the
           screen calls something else. -->
      <p class="conflict__text">
        {{ lede }}
        <i18n-t
          keypath="conflict.kept"
          scope="global"
          tag="span"
        >
          <template #path>
            <strong>{{ t('nav.settings') }} → {{ t('settings.backups.title') }}</strong>
          </template>
        </i18n-t>
      </p>
      <button
        type="button"
        class="conflict__ok bevel-control"
        @click="dismiss()"
      >
        {{ t('conflict.dismiss') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/**
 * Abaixo do canto da conta, onde o indicador mora — o aviso é a continuação
 * dele. A região não recebe clique: vazia, ela não pode engolir o da página.
 */
.conflict-region {
  position: fixed;
  top: 78px;
  right: 24px;
  z-index: 40;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

/* Abaixo de 720px a barra quebra em mais de uma linha, e o topo fixo cairia em
   cima dela. */
@media (width < 720px) {
  .conflict-region {
    top: auto;
    right: 16px;
    bottom: 16px;
  }
}

.conflict {
  padding: 15px 17px;
  border: 1px solid color-mix(in oklab, var(--conflict) 50%, var(--border));
  background: color-mix(in oklab, var(--conflict) 10%, var(--surface));
  pointer-events: auto;
}

.conflict__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.conflict__text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-body);
}

.conflict__text strong {
  color: var(--text);
}

.conflict__ok {
  margin-top: 13px;
  padding: 8px 16px;
  border: 0;
  background: var(--conflict);
  font-size: 12px;
  font-weight: 700;
  color: var(--bg);
  cursor: pointer;
}

.conflict__ok:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
</style>
