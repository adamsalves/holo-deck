<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAccount } from '~/composables/useAccount'
import { useInvite } from '~/composables/useInvite'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { inviteSeen, markInviteSeen } from '~~/app/utils/invite'
import { NAV_ACCOUNT } from '~~/app/utils/nav-links'
import { gameNumber } from '~~/shared/game/progress'

/**
 * O convite de conta — a prancha *Convite de conta*.
 *
 * **Jogar nunca exige conta**, e o convite é a única tela que fala disso sem o
 * jogador ter pedido. Por isso as travas: uma vez por aparelho, nunca antes do
 * primeiro pack, nunca para quem já tem conta, e sempre recusável — *Agora não*
 * é tão grande quanto a entrada, e `Escape` faz o mesmo.
 *
 * Fica acima do layout, como a escolha do primeiro login, porque quem pede é o
 * momento e não a tela: a vitória, o pack, o Hub. Ver `useInvite`.
 *
 * **Marca ao mostrar, e não ao fechar.** "Aparece uma vez" é o que a prancha
 * escreve, e um convite que voltasse porque a aba fechou com ele de pé seria o
 * mesmo convite duas vezes.
 */
const { requested, open } = useInvite()
const { account, known } = useAccount()
const collection = useCollectionStore()
const progress = useProgressStore()

watch([requested, known, account, () => collection.ownedCount], () => {
  if (!requested.value || open.value || !known.value) return

  // O pedido é consumido aqui, abra ou não: ele valia para este momento.
  requested.value = false

  if (account.value !== null || collection.ownedCount === 0 || inviteSeen()) return

  markInviteSeen()
  open.value = true
}, { immediate: true })

/**
 * O que está em jogo — as três contas da prancha, **na mesma unidade**.
 *
 * Cartas e shiny contam espécie, como a *Duas coleções* depois do review do PR 1:
 * a store soma cópias em `shinyCount`, e "3 cartas / 5 shiny" lado a lado se lê
 * como contradição.
 */
const stakes = computed(() => {
  const shiny = Object.values(collection.entries).filter(entry => entry.s > 0).length

  return [
    { key: 'cards', value: gameNumber(collection.ownedCount), label: collection.ownedCount === 1 ? 'carta' : 'cartas' },
    { key: 'shiny', value: gameNumber(shiny), label: 'shiny' },
    { key: 'badges', value: gameNumber(progress.badges), label: progress.badges === 1 ? 'insígnia' : 'insígnias' },
  ]
})

/**
 * O foco entra na folha ao abrir e volta para onde estava ao fechar.
 *
 * `aria-modal="true"` promete que o resto da página não existe para quem navega
 * por leitor de tela, e a promessa só é verdade com o Tab preso aqui dentro — a
 * lição da *Duas coleções*. Diferente dela, este diálogo se fecha: é recusável,
 * e o foco precisa voltar ao botão que o jogador estava usando.
 *
 * **O `immediate` é load-bearing, e a falta dele foi um defeito medido.** Este
 * componente vive dentro do `ClientOnly` do `app.vue`, que só cria os filhos
 * depois de montar; a página fica **fora** dele, monta antes e já pede o convite
 * no `onMounted` dela. Quando o `setup` daqui roda, o pedido pode já estar feito,
 * e aí o diálogo abre na primeira execução do observador de cima — sem
 * `immediate`, este só veria a *próxima* mudança de `open`, e não havia próxima.
 * O foco ficava no `body`: o Tab passeava pela página por baixo e o `Escape` não
 * chegava ao diálogo, porque evento de teclado sobe, não desce.
 */
const sheet = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    sheet.value?.focus()
    return
  }

  returnFocus?.focus()
  returnFocus = null
}, { immediate: true })

function trapTab(event: KeyboardEvent): void {
  const root = sheet.value
  if (root === null) return

  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')]
  const first = items[0]
  const last = items[items.length - 1]
  if (first === undefined || last === undefined) return

  if (event.shiftKey && event.target === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && event.target === last) {
    event.preventDefault()
    first.focus()
  }
}

function dismiss(): void {
  open.value = false
}
</script>

<template>
  <div
    v-if="open"
    class="invite"
    role="dialog"
    aria-modal="true"
    aria-labelledby="invite-title"
    @keydown.esc="dismiss()"
  >
    <div class="invite__frame">
      <div
        ref="sheet"
        class="invite__card bevel-card"
        tabindex="-1"
        @keydown.tab="trapTab"
      >
        <div class="invite__head">
          <svg
            class="invite__shield"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 3l7.5 3.4v5.2c0 4.3-3.1 7.9-7.5 9.4-4.4-1.5-7.5-5.1-7.5-9.4V6.4L12 3z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M9 12l2.2 2.2L15.5 10"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <p class="invite__eyebrow">
            Proteger coleção
          </p>
        </div>

        <!-- `h2` e não `h1`: a página por baixo continua montada com o dela. -->
        <h2
          id="invite-title"
          class="invite__title"
        >
          Sua coleção existe<br>só neste navegador
        </h2>

        <p class="invite__lede">
          O Safari apaga dados de sites depois de <strong>7 dias sem visita</strong>.
          Limpar o navegador também apaga. Uma conta guarda seu progresso fora
          daqui — e libera jogar no celular e no computador com a mesma coleção.
        </p>

        <!-- `dt` antes de `dd`, que é o que o HTML permite; o número em cima é
             o CSS, que é o que a prancha desenha. -->
        <dl class="invite__stakes">
          <div
            v-for="stake in stakes"
            :key="stake.key"
            class="invite__stake"
          >
            <dt class="invite__unit">
              {{ stake.label }}
            </dt>
            <dd
              class="numeric invite__number"
              :class="`invite__number--${stake.key}`"
            >
              {{ stake.value }}
            </dd>
          </div>
        </dl>

        <div class="invite__actions">
          <NuxtLink
            :to="NAV_ACCOUNT.to"
            class="invite__create bevel-control"
            @click="dismiss()"
          >
            CRIAR CONTA
          </NuxtLink>
          <button
            type="button"
            class="invite__later"
            @click="dismiss()"
          >
            Agora não
          </button>
        </div>

        <p class="numeric invite__foot">
          Dá para continuar jogando sem conta — nada trava. Também dá para baixar o
          save em <strong>Ajustes → Exportar</strong>.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.invite {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow-y: auto;
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  backdrop-filter: blur(7px) saturate(0.7);
}

/**
 * O brilho azul da prancha mora num invólucro, e não na folha: a folha é
 * chanfrada por `clip-path`, que corta a `box-shadow` junto. O `drop-shadow`
 * de fora segue o recorte.
 */
.invite__frame {
  width: min(588px, 100%);
  filter: drop-shadow(0 0 36px color-mix(in oklab, var(--accent) 30%, transparent));
}

.invite__card {
  padding: 38px 42px 34px;
  border: 1px solid color-mix(in oklab, var(--accent) 50%, var(--border));
  background: linear-gradient(168deg, var(--surface-raised), var(--surface-cell));
}

@media (width < 560px) {
  .invite__card {
    padding: 28px 22px 24px;
  }
}

.invite__card:focus {
  outline: none;
}

.invite__head {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 22px;
  color: var(--accent);
}

.invite__shield {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.invite__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.invite__title {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.015em;
  color: var(--text);
}

.invite__lede {
  margin-top: 14px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-body);
}

.invite__lede strong {
  color: var(--text);
}

.invite__stakes {
  display: flex;
  gap: 10px;
  margin: 24px 0 0;
}

.invite__stake {
  display: flex;
  flex: 1 1 0;
  flex-direction: column-reverse;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-sunken);
}

.invite__number {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.invite__number--shiny {
  color: var(--shiny);
}

.invite__number--badges {
  color: var(--coin);
}

.invite__unit {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.invite__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
}

.invite__create {
  padding: 13px 30px;
  background: var(--accent);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-decoration: none;
  color: var(--bg);
}

.invite__later {
  padding: 13px 18px;
  border: 0;
  background: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.invite__later:hover {
  color: var(--text-body);
}

.invite__create:focus-visible,
.invite__later:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

.invite__foot {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-muted);
}

.invite__foot strong {
  font-weight: 400;
  color: var(--text-body);
}
</style>
