<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { TYPE_LABELS } from '~~/shared/types/game'
import { dexNumber } from '~~/shared/dex/regions'
import { useDex } from '~/composables/useDex'

/**
 * A busca global — `Cmd/Ctrl+K` em qualquer tela da Pokédex.
 *
 * O `UCommandPalette` já filtra com `fuse.js` por dentro (é de onde a
 * dependência vem), então a busca aproximada que o plano pede não precisa de uma
 * segunda implementação: o que este componente faz é dar a ele as 1025 linhas e
 * o vocabulário certo.
 *
 * **O índice só é carregado quando a paleta abre.** São 15 KB gzipados que a
 * maioria das visitas nunca precisa — quem chega pelo grid navega clicando. Uma
 * vez carregado ele fica no cache de `useDex()`, compartilhado com a rota de
 * detalhe, que usa o mesmo arquivo para resolver o slug.
 */
const { index, loadIndex } = useDex()

const open = ref(false)
const loading = ref(false)

/**
 * O carregamento pendura num `watch`, e **não** no `@update:open` do `UModal`.
 *
 * O evento só dispara quando o próprio modal muda o estado — clique no gatilho,
 * Esc, clique fora. O atalho `Cmd/Ctrl+K` mexe no ref por fora, e aí o evento
 * não acontece: a paleta abria vazia por teclado e cheia por clique, que é o
 * tipo de diferença que ninguém encontra clicando. O `watch` vê as duas.
 */
watch(open, async (isOpen) => {
  if (!isOpen || index.value !== null) return

  loading.value = true
  try {
    await loadIndex()
  }
  finally {
    loading.value = false
  }
})

/**
 * O sufixo carrega número e tipos porque é por eles que se procura quando não se
 * lembra o nome — *"aquele planta/venenoso do começo"* — e porque o `fuse` do
 * `UCommandPalette` indexa o sufixo junto com o rótulo. Buscar por `venenoso`
 * passa a funcionar sem nenhuma configuração de índice.
 */
const groups = computed(() => [{
  id: 'species',
  label: 'Espécies',
  items: (index.value ?? []).map(entry => ({
    label: entry.displayName,
    suffix: `${dexNumber(entry.id)} · ${entry.types.map(type => TYPE_LABELS[type]).join(' · ')}`,
    to: `/pokemon/${entry.slug}`,
    avatar: { src: `/sprites/${entry.id}.webp`, loading: 'lazy' as const },
  })),
}])

defineShortcuts({
  meta_k: () => {
    open.value = !open.value
  },
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Buscar Pokémon"
    description="Procure por nome, número ou tipo entre as 1025 espécies."
    :ui="{ content: 'max-w-xl' }"
  >
    <button
      type="button"
      class="dex-search__trigger"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="11"
          cy="11"
          r="7"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M16.5 16.5L21 21"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span class="dex-search__label">Buscar Pokémon</span>
      <!-- O atalho é anunciado no `aria-label` do botão, não aqui: a tecla é
           dica visual, e um leitor de tela lendo "meta K" no meio do rótulo
           atrapalha mais do que ajuda. -->
      <kbd
        class="numeric dex-search__kbd"
        aria-hidden="true"
      >⌘K</kbd>
    </button>

    <template #content>
      <UCommandPalette
        close
        :groups="groups"
        :loading="loading"
        placeholder="Nome, número ou tipo…"
        class="h-96"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>

<style scoped>
.dex-search__trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 230px;
  padding: 9px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-faint);
  cursor: pointer;
  text-align: left;
}

.dex-search__trigger:hover,
.dex-search__trigger:focus-visible {
  border-color: var(--border-strong);
}

.dex-search__label {
  font-size: 13px;
  color: var(--text-muted);
}

.dex-search__kbd {
  margin-left: auto;
  padding: 2px 6px;
  font-size: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-faint);
}
</style>
