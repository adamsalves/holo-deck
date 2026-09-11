<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDex } from '~/composables/useDex'
import { useFirstSync } from '~/composables/useFirstSync'
import type { ChoiceSide } from '~/composables/useFirstSync'
import { composeSave } from '~/utils/save-document'
import { summarize } from '~/utils/save-summary'
import type { SearchEntry } from '~~/shared/types/dex'

/**
 * A tela *Duas coleções* — a única do sistema que pede decisão ao jogador.
 *
 * A anotação `note-4` do canvas registra a exceção: o indicador de sync é
 * discreto e todo outro conflito resolve sozinho pelo flag de sujo. Aqui não são
 * dois estados do mesmo save, são **duas coleções reais**, e a regra normal
 * ("local sujo vence") faria o save do celular sobrescrever a do computador.
 *
 * Fica acima do layout, como o aviso de save recuperado, porque é estado do boot
 * e não de uma tela — e porque não pode ser fechada por navegação: enquanto ela
 * estiver de pé, o jogo não sabe qual coleção é a sua.
 *
 * **O lado local sai das stores, não de um retrato.** A página por baixo continua
 * montada e viva — esta tela é `position: fixed` —, então um `resume` de batalha
 * pagando moedas com o modal de pé mudaria as stores e não o retrato. O que a
 * tela mostra e o que o clique sobe passaram a ser a mesma coisa.
 */

const { pending, choose } = useFirstSync()
const { loadIndex } = useDex()

const index = ref<readonly SearchEntry[]>([])
const applying = ref<ChoiceSide | null>(null)
const failed = ref(false)

/**
 * O índice do dex — e os dois estados que faltavam em volta dele.
 *
 * **Sem eles a tela pedia decisão irreversível exibindo números errados.** O
 * `summarize` ignora espécie ausente do índice, então com ele vazio os dois lados
 * mostravam `0 shiny` e *nenhuma carta*, e os botões nasciam habilitados: o
 * `v-if` abre no mesmo tick em que a decisão chega, antes de esta leitura
 * resolver. Quem comparasse as duas colunas naquele instante compararia dois
 * retratos em branco — e o review da Fase 1 já registrou o deploy parcial do dex
 * como caso real neste repositório.
 *
 * A rejeição também não se perde mais: ela morria como `unhandledrejection` no
 * callback assíncrono do `watch`, e a tela ficava mentindo para sempre.
 */
const indexFailed = ref(false)
const ready = computed(() => index.value.length > 0)

// O índice só é carregado quando a tela precisa dele: a esmagadora maioria dos
// boots não passa por aqui, e 1025 linhas de dex é peso que não se paga à toa.
watch(pending, (value) => {
  if (value === null || index.value.length > 0) return

  indexFailed.value = false
  loadIndex()
    .then((entries) => {
      index.value = entries
    })
    .catch(() => {
      indexFailed.value = true
    })
}, { immediate: true })

/**
 * O lado deste aparelho, recomposto das stores a cada mudança delas.
 *
 * `composeSave` sem `pinia`: aqui estamos dentro de componente, onde a instância
 * ativa existe — ao contrário do plugin, que precisa passá-la.
 */
const localSave = computed(() => (pending.value === null ? null : composeSave()))

const local = computed(() => {
  const save = localSave.value
  return save === null || !ready.value ? null : summarize(save, index.value)
})

const remote = computed(() =>
  pending.value === null || !ready.value ? null : summarize(pending.value.remote, index.value))

/** A batalha em andamento é deste aparelho: a do servidor nunca sobe. */
const hasBattle = computed(() => localSave.value?.battle != null)

const remoteWhen = computed(() => {
  const iso = pending.value?.remoteUpdatedAt
  if (iso === undefined) return '—'

  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
})

const localWhen = computed(() => {
  const at = pending.value?.localAt
  if (at === null || at === undefined) return 'não se sabe'

  return new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
})

/**
 * O foco, preso dentro da folha enquanto ela está de pé.
 *
 * `aria-modal="true"` **promete** que o resto da página não existe para quem
 * navega por leitor de tela, e sem isto a promessa era falsa: o Tab saía do
 * diálogo e entrava na barra e no binder por baixo — numa tela que não pode ser
 * fechada por navegação. `Escape` continua sem fazer nada de propósito: não há
 * "cancelar" aqui, porque o jogo não sabe qual coleção é a do jogador até a
 * escolha.
 */
const sheet = ref<HTMLElement | null>(null)

watch(pending, async (value) => {
  if (value === null) return

  await nextTick()
  sheet.value?.focus()
})

function focusables(): HTMLElement[] {
  const root = sheet.value
  if (root === null) return []

  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]')]
}

function trapTab(event: KeyboardEvent): void {
  const items = focusables()
  const first = items[0]
  const last = items[items.length - 1]
  if (first === undefined || last === undefined) return

  const target = event.target
  if (event.shiftKey && target === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && target === last) {
    event.preventDefault()
    first.focus()
  }
}

async function pick(side: ChoiceSide): Promise<void> {
  applying.value = side
  failed.value = false

  try {
    await choose(side)
  }
  catch {
    // Falhar aqui é falhar antes de decidir: nada foi apagado, e a tela continua
    // de pé para o jogador tentar de novo. O contrário — fechar e seguir — seria
    // escolher por ele em silêncio.
    applying.value = null
    failed.value = true
  }
}
</script>

<template>
  <div
    v-if="pending"
    class="choice"
    role="dialog"
    aria-modal="true"
    aria-labelledby="choice-title"
  >
    <div
      ref="sheet"
      class="choice__sheet"
      tabindex="-1"
      @keydown.tab="trapTab"
    >
      <header class="choice__head">
        <p class="choice__eyebrow">
          Duas coleções encontradas
        </p>
        <!-- `h2` e não `h1`: a página por baixo continua montada com o dela, e
             dois `h1` na mesma árvore é sumário quebrado para quem navega por
             cabeçalho. -->
        <h2
          id="choice-title"
          class="choice__title"
        >
          Qual delas você quer continuar?
        </h2>
        <p class="choice__lede">
          Você já jogava neste navegador, e a conta que acabou de entrar também
          tem progresso. Escolha uma — <strong>a outra não é apagada</strong>,
          fica guardada na cópia de segurança deste aparelho.
        </p>
      </header>

      <p
        v-if="hasBattle"
        class="choice__warning"
      >
        Há uma batalha em andamento neste aparelho. Escolher
        <strong>Na sua conta</strong> a encerra sem pagar a recompensa — a
        batalha nunca sobe para o servidor.
      </p>

      <!-- Enquanto o índice não volta, nenhum número é confiável: a escolha fica
           esperando em vez de oferecer dois retratos em branco. -->
      <p
        v-if="indexFailed"
        class="choice__failed"
        role="status"
      >
        Não deu para ler os dados das cartas agora, e sem eles as duas colunas não
        podem ser comparadas. Recarregue a página — <strong>nada foi
          alterado</strong>, e a pergunta volta.
      </p>
      <p
        v-else-if="!ready"
        class="choice__loading"
        role="status"
      >
        Lendo as cartas das duas coleções…
      </p>

      <div class="choice__sides">
        <section
          v-for="side in ([
            { key: 'local' as const, label: 'Neste aparelho', sum: local, when: localWhen, dust: localSave?.dust ?? 0 },
            { key: 'remote' as const, label: 'Na sua conta', sum: remote, when: remoteWhen, dust: pending.remote.dust },
          ])"
          :key="side.key"
          class="choice__side"
          :class="{ 'choice__side--account': side.key === 'remote' }"
          :aria-label="`Coleção ${side.label}`"
        >
          <p class="choice__eyebrow">
            {{ side.label }}
          </p>

          <!-- `dt` antes de `dd` em cada par: a ordem inversa não é HTML válido,
               e a inversão visual é do CSS, não da marcação. -->
          <dl class="choice__numbers">
            <div>
              <dt class="choice__unit">
                cartas
              </dt>
              <dd class="numeric choice__number">
                {{ side.sum?.cards ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="choice__unit">
                insígnias
              </dt>
              <dd class="numeric choice__number">
                {{ side.sum?.badges ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="choice__unit">
                shiny
              </dt>
              <dd class="numeric choice__number choice__number--shiny">
                {{ side.sum?.shiny ?? '—' }}
              </dd>
            </div>
          </dl>

          <p class="choice__unit choice__minis-label">
            Melhores cartas
          </p>
          <ul class="choice__minis">
            <li
              v-for="card in side.sum?.best ?? []"
              :key="card.id"
              class="choice__mini"
              :class="`rarity-${card.rarity}`"
            >
              <img
                :src="`/sprites/${card.id}.webp`"
                :alt="card.name"
                loading="lazy"
                width="42"
                height="42"
              >
            </li>
            <li
              v-if="ready && (side.sum?.best.length ?? 0) === 0"
              class="choice__unit"
            >
              nenhuma carta
            </li>
          </ul>

          <dl class="choice__facts">
            <div>
              <dt>{{ side.key === 'local' ? 'Última gravação' : 'Última sincronização' }}</dt>
              <dd class="numeric">
                {{ side.when }}
              </dd>
            </div>
            <div>
              <dt>Pó acumulado</dt>
              <dd class="numeric">
                {{ side.dust }}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            class="choice__use bevel-control"
            :class="{ 'choice__use--account': side.key === 'remote' }"
            :disabled="applying !== null || !ready"
            :aria-label="`USAR ESTA — ${side.label}`"
            @click="pick(side.key)"
          >
            {{ applying === side.key ? 'APLICANDO…' : 'USAR ESTA' }}
          </button>
        </section>
      </div>

      <p
        v-if="failed"
        class="choice__failed"
        role="status"
      >
        Não deu para aplicar a escolha agora — nada foi apagado. Tente de novo.
      </p>

      <p class="choice__footnote">
        A coleção não escolhida vai para a cópia de segurança deste aparelho e
        volta por <strong>Ajustes → Cópias de segurança</strong>. Nada é apagado
        por esta escolha.
      </p>
    </div>
  </div>
</template>

<style scoped>
.choice {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow-y: auto;
  background: color-mix(in oklab, var(--bg) 88%, transparent);
  backdrop-filter: blur(6px);
}

.choice__sheet {
  width: min(1040px, 100%);
  padding: 36px 32px 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.choice__head {
  text-align: center;
}

.choice__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.choice__title {
  margin-top: 10px;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--text);
}

.choice__lede {
  max-width: 62ch;
  margin: 12px auto 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-body);
}

.choice__lede strong {
  color: var(--text);
}

.choice__warning {
  margin: 22px auto 0;
  max-width: 66ch;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--coin);
  border-radius: var(--radius);
  background: var(--surface-sunken);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-body);
}

.choice__sides {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 26px;
}

@media (max-width: 820px) {
  .choice__sides {
    grid-template-columns: minmax(0, 1fr);
  }
}

.choice__side {
  padding: 22px 22px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-raised);
}

.choice__side--account {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
}

.choice__numbers {
  display: flex;
  gap: 22px;
  margin-top: 16px;
}

/* O rótulo vem antes do número na marcação, porque é o que o HTML permite, e
   depois dele na tela, porque é o que a prancha desenha. */
.choice__numbers > div {
  display: flex;
  flex-direction: column-reverse;
}

.choice__number {
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
}

.choice__number--shiny {
  color: var(--shiny, var(--accent));
}

.choice__unit {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.choice__minis-label {
  margin-top: 18px;
}

.choice__minis {
  display: flex;
  gap: 7px;
  margin-top: 8px;
  padding: 0;
  list-style: none;
}

.choice__mini {
  display: grid;
  place-items: center;
  width: 52px;
  height: 72px;
  border: 1px solid var(--border);
  background: var(--surface-sunken);
}

.choice__facts {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.choice__facts > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.choice__facts > div + div {
  margin-top: 6px;
}

.choice__facts dt {
  color: var(--text-muted);
}

.choice__facts dd {
  color: var(--text-body);
}

.choice__use {
  width: 100%;
  margin-top: 18px;
  padding: 13px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-body);
  cursor: pointer;
}

.choice__use--account {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}

.choice__use:disabled {
  cursor: progress;
  opacity: 0.7;
}

.choice__use:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.choice__loading {
  margin-top: 18px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.choice__sheet:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.choice__failed {
  margin-top: 16px;
  font-size: 13px;
  color: var(--deficit);
  text-align: center;
}

.choice__footnote {
  margin-top: 22px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-faint);
  text-align: center;
}

.choice__footnote strong {
  color: var(--text-muted);
}
</style>
