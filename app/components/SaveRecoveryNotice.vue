<script setup lang="ts">
import { computed, ref } from 'vue'
import { BACKUP_PREFIX } from '~~/app/utils/save-driver'
import type { RecoveryReason } from '~~/shared/save/schema'

/**
 * O aviso de save recuperado — a outra metade da regra de nunca apagar.
 *
 * A regra tem dois lados, e só um deles é o driver: um save que não entendemos
 * vira cópia de segurança **e o jogo avisa**. Sem o aviso, o jogador que abre a
 * coleção e a encontra vazia não tem como distinguir "o save estava ilegível e
 * foi guardado" de "o jogo apagou três meses de cartas" — e as duas hipóteses
 * levam a ações opostas, porque a primeira ainda tem conserto.
 *
 * É por isso que o plugin de save expõe `$saveRecovery` em vez de tratar a
 * recuperação como detalhe interno, e é este componente que fecha o circuito.
 *
 * Ele não oferece um botão de restaurar: a chave crua é de uma versão que este
 * código, por definição, não soube ler. O que o aviso dá é o **endereço** da
 * cópia, que é o que permite recuperá-la à mão hoje e por migração amanhã.
 */

/**
 * `$saveRecovery` só existe no cliente — o plugin é `.client`, porque não há
 * save no servidor. Ler com `??` e não com asserção mantém o componente
 * montável em qualquer contexto, inclusive num teste que não subiu o plugin.
 */
const { $saveRecovery } = useNuxtApp()
const reason = computed<RecoveryReason | null>(() => $saveRecovery ?? null)

const dismissed = ref(false)

/**
 * Uma frase por motivo, e nenhuma delas fala em "erro".
 *
 * Os três casos são situações diferentes para quem está do outro lado — arquivo
 * corrompido, jogo mais novo, formato que não subiu — e a única reação errada
 * seria mostrar a mesma mensagem genérica para todos, que é o que faz o jogador
 * parar de ler avisos.
 */
const MESSAGES: Readonly<Record<RecoveryReason, string>> = {
  'corrupt': 'Seu save anterior não pôde ser lido e o jogo começou limpo.',
  'unknown-version': 'Seu save foi gravado por uma versão mais nova do jogo, e esta não sabe lê-lo. O jogo começou limpo.',
  'failed-migration': 'Seu save não pôde ser atualizado para o formato atual, e o jogo começou limpo.',
}
</script>

<template>
  <div
    v-if="reason !== null && !dismissed"
    class="save-notice"
    role="status"
  >
    <p class="save-notice__text">
      <strong>Nada foi apagado.</strong>
      {{ MESSAGES[reason] }}
      A cópia original continua no seu navegador, em uma chave
      <code class="numeric save-notice__key">{{ BACKUP_PREFIX }}…</code>
    </p>

    <button
      type="button"
      class="numeric save-notice__dismiss"
      @click="dismissed = true"
    >
      ENTENDI
    </button>
  </div>
</template>

<style scoped>
.save-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 22px;
  background: var(--surface-raised);
  /* O fio inferior é o único traço colorido: `--deficit` é o token de "isto não
     está no estado que você esperava", e não o de erro — nada quebrou. */
  border-bottom: 1px solid var(--deficit);
}

.save-notice__text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-body);
  margin: 0;
}

.save-notice__text strong {
  color: var(--text);
}

/* A fonte vem do utilitário `numeric`, que é o único caminho do repositório até
   a mono — aqui fica só o que é desta caixa. */
.save-notice__key {
  font-size: 11px;
  color: var(--text-muted);
}

.save-notice__dismiss {
  flex-shrink: 0;
  font-size: 11px;
  padding: 5px 11px;
  color: var(--text-body);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.save-notice__dismiss:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
