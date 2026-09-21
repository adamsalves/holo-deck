<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { dayKey } from '~~/shared/game/economy'
import { gameNumber } from '~~/shared/game/progress'
import type { SaveData } from '~~/shared/save/schema'
import { SCHEMA_VERSION, emptySave, migrate } from '~~/shared/save/schema'
import type { PreviousSummary } from '~~/shared/save/sync'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { initialsOf } from '~~/app/utils/initials'
import { agoLabel } from '~~/app/utils/relative-time'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import { NoPreviousVersion, SaveConflict } from '~~/app/utils/save-remote'
import { reasonKey } from '~~/app/utils/recovery-reason'
import { syncLabel } from '~~/app/utils/sync-label'
import { useAccount } from '~/composables/useAccount'
import { useGameClock } from '~/composables/useGameClock'
import { useMotionSwitch } from '~/composables/useMotion'
import { useSync } from '~/composables/useSync'

/**
 * `/settings` — a prancha *Ajustes*, do que existe.
 *
 * **A Fase 7 trouxe a metade da prancha que dependia de conta**: o painel da
 * conta com o estado da sincronização, *Restaurar versão anterior* e *Excluir
 * conta e save do servidor*. Sem conta a tela continua sendo a do aparelho — o
 * título diz isso —, e as três coisas somem em vez de aparecer desligadas.
 *
 * O que continua segurado é o que não tem a peça que o sustenta: idioma pede
 * i18n, som pede áudio, e *baixar tudo para offline* pede PWA. Decidido em 05/09:
 * entra só o que tem dado, e o resto fica **nomeado** num painel *Ainda não* e
 * registrado no README. Inventar um zero desenha um progresso que ninguém pode
 * mover.
 */
const collection = useCollectionStore()
const progress = useProgressStore()
const motion = useMotionSwitch()
const { account, signOut, deleteAccount } = useAccount()
const { status } = useSync()
const now = useGameClock()

/**
 * `$pinia` explícito, e não a instância ativa por acaso.
 *
 * `composeSave` e `hydrateSave` chamam as stores, e as duas rodam **fora do
 * setup** — uma dentro de um `computed`, a outra dentro de um handler. Ali o
 * `inject` do Pinia não existe mais, e ele cai no `activePinia` do módulo, que é
 * global. Numa SPA dá no mesmo; num render de servidor, duas requisições
 * simultâneas dividem esse global. Passar a instância fecha a porta antes de a
 * Fase 7 abrir qualquer coisa no servidor.
 */
const { $saveDriver, $pinia, $sync, $httpDriver } = useNuxtApp()
const { appVersion, gitSha } = useRuntimeConfig().public

const { t, localeProperties } = useI18n()

/**
 * *3 cartas*, and *1 carta* — the noun inflects, so the count picks the form.
 *
 * One helper because five notices interpolate it, and a count spelled by hand at
 * five call sites is five chances to write `{count} cartas` with a one in it.
 * The sentences receive it already spelled: a message that interpolates another
 * message keeps each of them a whole sentence in both languages, which is what
 * the evolution chain and the turn order each had to be rebuilt to do.
 *
 * **The count travels twice, and the two halves are not the same value.**
 * `gameNumber` fills the sentence, the raw number picks the form — which is
 * exactly what the third argument is for. Handing vue-i18n the bare number for
 * both dropped the pt-BR grouping: `1600 cartas`, three lines under a stat tile
 * still reading `1.600`, because named interpolation stringifies and never
 * formats. Issue #49 owns the locale of these numbers, and until it closes they
 * are pt-BR — which is what `gameNumber` keeps them.
 *
 * Not `cardCount`: the collection store already exports one, and that one counts
 * copies where this counts species.
 */
function cardsLabel(count: number): string {
  return t('settings.cardCount', { count: gameNumber(count) }, count)
}

const fileInput = ref<HTMLInputElement | null>(null)

/**
 * O teto do arquivo importado — e ele existe antes do `await file.text()`.
 *
 * Sem teto, um JSON de centenas de MB escolhido no seletor trava a aba lendo o
 * arquivo inteiro para a memória antes de o `JSON.parse` ter chance de recusá-lo.
 * Nada é destruído (o save só é tocado depois da validação), mas a tela morre
 * sem dizer por quê, e o jogador não tem como saber que a culpa é do arquivo.
 *
 * Um megabyte é duas ordens de grandeza acima do pior caso real: o save de um
 * dex completo mede ~21 KB, e o desta tela mostra o número medido ao lado.
 */
const MAX_IMPORT_BYTES = 1_048_576

/**
 * O que aconteceu na última ação, para a tela responder.
 *
 * Um estado só, com tom: importar, apagar e falhar são exclusivos entre si, e
 * três flags separadas produziriam a combinação impossível em que a tela diz ao
 * mesmo tempo que importou e que falhou.
 */
const notice = ref<{ tone: 'done' | 'failed', text: string } | null>(null)

/** O save atual como texto — a mesma coisa que é exportada e que é medida. */
const saveText = computed(() => JSON.stringify(composeSave($pinia), null, 2))

/**
 * O tamanho do save em KB, medido em **bytes** e não em caracteres.
 *
 * `length` conta unidades UTF-16, e o save carrega nome de espécie: `Nidoran♀`
 * ocupa mais bytes do que letras. A prancha estampa `20,6 KB` ao lado da
 * contagem de cartas, e o número que importa é o que atravessa a rede na Fase 7.
 */
const sizeKb = computed(() => {
  const bytes = new TextEncoder().encode(saveText.value).length
  return (bytes / 1024).toFixed(1).replace('.', ',')
})

const stats = computed(() => [
  { key: 'cards', value: gameNumber(collection.ownedCount), label: t('settings.stats.cards') },
  { key: 'badges', value: gameNumber(progress.badges), label: t('settings.stats.badges') },
  { key: 'schema', value: `v${SCHEMA_VERSION}`, label: t('settings.stats.schema') },
  { key: 'size', value: sizeKb.value, label: t('settings.stats.size') },
])

/**
 * Baixa o save como JSON.
 *
 * O nome carrega a data para dois arquivos exportados em dias diferentes não se
 * sobreporem na pasta de downloads — que é onde eles vão parar, e onde o
 * jogador vai procurar o "de antes de eu ter moído tudo".
 *
 * **É `dayKey` e não `toISOString`**, pelo mesmo motivo que o pack diário: o
 * segundo converte para UTC antes de formatar, e às 22h de terça em São Paulo o
 * arquivo sairia carimbado de quarta. O jogador procuraria pela data de ontem e
 * não acharia, que é exatamente o contrário do que o nome existe para fazer.
 *
 * O `revoke` espera um tique: alguns navegadores ainda não começaram a gravar
 * quando o `click()` retorna, e revogar a URL no mesmo quadro cancela o
 * download antes de ele sair.
 */
function exportSave(): void {
  const blob = new Blob([saveText.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `holodeck-${dayKey(new Date())}.json`
  link.click()

  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
  notice.value = { tone: 'done', text: t('settings.notice.exported') }
}

/**
 * Substitui o save pelo do arquivo — **guardando o atual antes**.
 *
 * A ordem é a regra inegociável do plano aplicada ao caminho voluntário: o texto
 * que está no disco vai para `holodeck:backup:<instante>` antes de qualquer
 * coisa escrever por cima. Um arquivo trocado por engano custa uma chave no
 * armazenamento; sem esta linha, custa a coleção.
 *
 * O arquivo passa pela **mesma** `migrate` que o boot usa, então um save
 * exportado de uma versão anterior sobe sozinho, e um save de versão futura é
 * recusado em vez de adivinhado.
 */
async function importSave(event: Event): Promise<void> {
  const input = event.target
  const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined
  if (file === undefined) return

  /**
   * O reset vai no `finally`, e não no fim do caminho feliz.
   *
   * Sem ele, escolher o mesmo arquivo duas vezes seguidas não dispara `change` —
   * e é **no erro** que repetir o mesmo arquivo é mais provável: o jogador
   * escolhe um save truncado, lê "não é um JSON válido", re-exporta por cima do
   * mesmo caminho e escolhe de novo. Com o reset só no sucesso, esse segundo
   * clique não fazia nada e a mensagem de erro antiga continuava na tela,
   * indistinguível de uma nova.
   */
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      notice.value = { tone: 'failed', text: t('settings.notice.tooBig') }
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    }
    catch {
      notice.value = { tone: 'failed', text: t('settings.notice.notJson') }
      return
    }

    const { data, recovered } = migrate(parsed)
    if (recovered !== null) {
      notice.value = {
        tone: 'failed',
        text: t('settings.notice.unreadable', { reason: t(reasonKey(recovered)) }),
      }
      return
    }

    archiveCurrent()
    apply(data)
    refreshBackups()
    notice.value = {
      tone: 'done',
      text: t('settings.notice.imported', { cards: cardsLabel(collection.ownedCount) }),
    }
  }
  finally {
    if (fileInput.value !== null) fileInput.value.value = ''
  }
}

/**
 * Apaga o save deste aparelho, guardando a cópia antes.
 *
 * **A cópia fica, e a tela diz isso.** A alternativa — apagar de verdade — é
 * defensável e foi recusada: sem conta não existe segunda cópia em lugar nenhum,
 * e a regra que o plano chama de inegociável existe justamente para a coleção de
 * meses não depender de um clique não ter sido acidental. O anel guarda três, e
 * a mais antiga é podada, então nada cresce sem limite.
 */
async function clearSave(): Promise<void> {
  const synced = account.value !== null && $sync.running

  // `window.confirm` e não um modal próprio: é uma pergunta de sim ou não num
  // caminho destrutivo, e o nativo bloqueia de verdade — um diálogo escrito à
  // mão precisaria de foco, escape, e de não deixar o clique passar por baixo.
  const question = synced
    ? t('settings.confirm.clearWithAccount')
    : t('settings.confirm.clearDevice')
  if (!window.confirm(question)) return

  archiveCurrent()

  if (!synced) {
    void $saveDriver.clear()
    apply(emptySave())
    refreshBackups()
    notice.value = { tone: 'done', text: t('settings.notice.cleared') }
    return
  }

  /**
   * **Com conta, o vazio não sobe, e o servidor volta.** A tela promete "com
   * conta, ele volta na próxima sincronização", e sem o `discardLocal` o save
   * vazio seria uma mudança como outra qualquer: subiria por cima da coleção da
   * conta, que é exatamente o que a frase diz que não acontece.
   */
  const adopted = await $sync.discardLocal(() => {
    void $saveDriver.clear()
    apply(emptySave())
  })
  refreshBackups()

  /**
   * **Sem resposta do servidor, a tela diz isso** — e não a promessa.
   *
   * O `discardLocal` engolia a falha de rede e voltava como se tivesse trazido a
   * coleção da conta; a tela escrevia "o da conta volta na próxima
   * sincronização" e a jogada seguinte subia o vazio por cima dela. Agora o
   * driver para, nada sobe deste aparelho até o próximo boot com rede, e a frase
   * descreve o que de fato aconteceu.
   */
  if (!adopted) {
    notice.value = {
      tone: 'failed',
      text: t('settings.notice.clearedOffline'),
    }
    return
  }

  notice.value = {
    tone: 'done',
    text: collection.ownedCount > 0
      ? t('settings.notice.clearedRestored', { cards: cardsLabel(collection.ownedCount) })
      : t('settings.notice.clearedPending'),
  }
}

function archiveCurrent(): void {
  const raw = $saveDriver.readRaw()
  if (raw !== null) $saveDriver.archive(raw)
}

/**
 * As cópias de segurança que dá para voltar — e por que elas ganharam tela.
 *
 * **A interface prometia e o produto não devolvia.** Apagar diz "uma cópia de
 * segurança fica guardada" e importar diz "o anterior foi para a cópia de
 * segurança", e até aqui o único caminho de volta era abrir o DevTools e copiar
 * a chave à mão. Um jogador que clica `APAGAR LOCAL` por engano lê que a cópia
 * existe e não tem como alcançá-la.
 *
 * O painel *Ainda não* ajudava a esconder isso ao enquadrar *restaurar a
 * gravação anterior* como coisa de servidor. É outra coisa: aquela é a versão
 * remota da Fase 7, esta é o texto que este mesmo código escreveu neste
 * aparelho há um minuto.
 */
const backups = ref<{ key: string, at: number }[]>([])

function refreshBackups(): void {
  backups.value = $saveDriver.listBackups()
}

/**
 * `05/09, 14:22` — o instante da cópia, no fuso de quem está olhando.
 *
 * **The locale comes from the URL, and it used to be `'pt-BR'` written by hand.**
 * That is the defect of issue #49 in its date form: inside `/en` the same backup
 * read `05/09, 14:22` where English reads `09/05, 02:22 PM`, and `05/09` in
 * en-US **is the fifth of September read as May the ninth** — a wrong date, not
 * an odd-looking one. The issue lists four origins and this is a fifth: it
 * formats a date rather than a number, so a sweep for `toLocaleString('pt-BR')`
 * on numbers would have walked past it.
 *
 * `localeProperties.language` and not `locale`: the first is the BCP-47 tag the
 * config declares — `en-US`, not the `en` that names the route — and it is the
 * same one `app.vue` writes into `<html lang>`. `Intl` reads the two alike
 * today, so this is one source rather than two agreeing by luck.
 *
 * The numbers on this screen — `20,6 KB`, the card counts — are the origins the
 * issue does name, and they stay pt-BR until it is closed.
 */
function backupLabel(at: number): string {
  return new Date(at).toLocaleString(localeProperties.value.language, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Volta para uma cópia — **guardando a atual antes**, como todo caminho que
 * escreve por cima.
 *
 * O texto passa pela mesma `migrate` do boot e do import: uma cópia gravada por
 * uma versão anterior sobe sozinha, e uma que não seja legível é recusada em vez
 * de adivinhada. Sem isso, restaurar seria o único caminho do jogo que confia
 * num texto sem validá-lo.
 */
function restoreBackup(key: string): void {
  const raw = $saveDriver.readBackup(key)
  if (raw === null) {
    notice.value = { tone: 'failed', text: t('settings.notice.backupGone') }
    refreshBackups()
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    notice.value = { tone: 'failed', text: t('settings.notice.backupShape') }
    return
  }

  const { data, recovered } = migrate(parsed)
  if (recovered !== null) {
    notice.value = {
      tone: 'failed',
      text: t('settings.notice.backupUnreadable', { reason: t(reasonKey(recovered)) }),
    }
    return
  }

  archiveCurrent()
  apply(data)
  refreshBackups()
  notice.value = {
    tone: 'done',
    text: t('settings.notice.backupRestored', { cards: cardsLabel(collection.ownedCount) }),
  }
}

onMounted(refreshBackups)

/** As iniciais, para quem não tem foto no provedor — o mesmo cálculo da barra. */
const initials = computed(() => initialsOf(account.value?.name ?? ''))

/** A frase do indicador da barra, repetida na linha da conta como a prancha faz. */
const syncText = computed(() => (status.value === null ? null : syncLabel(status.value, now.value, t)))

/**
 * O resumo da versão anterior do servidor — *Restaurar versão anterior*.
 *
 * **Relido a cada acerto com o servidor, e não só ao abrir a tela.** Cada
 * gravação aceita empurra a atual para a anterior, e um resumo lido antes dela
 * descreveria uma versão que o botão já não restaura. Pelo mesmo motivo o botão
 * espera a fila: restaurar sobe o pendente antes, e a anterior passaria a ser
 * outra.
 */
const previous = ref<PreviousSummary | null>(null)
const restoring = ref(false)

const idle = computed(() => status.value?.phase === 'synced')

const previousAgo = computed(() => {
  const at = previous.value?.updatedAt ?? null
  return at === null ? null : agoLabel(at, now.value, t)
})

async function refreshPrevious(): Promise<void> {
  try {
    previous.value = await $httpDriver.fetchPrevious()
  }
  catch {
    // Sem rede, ou o servidor fora: a linha some em vez de oferecer um restaurar
    // que ninguém consegue conferir.
    previous.value = null
  }
}

watch(
  () => [account.value?.id ?? null, status.value?.phase ?? null] as const,
  ([id, phase], before) => {
    if (id === null) {
      previous.value = null
      return
    }

    // **Só na transição para `synced`.** O observador incluía `syncedAt`, que
    // muda a cada gravação aceita: com a tela aberta, cada carta escalada virava
    // um `GET /api/save/previous`. Toda gravação passa por `sending` antes de
    // voltar a `synced`, então a transição não perde nenhuma troca de versão
    // anterior — e o restaurar relê por conta própria, no `finally`.
    if (phase === 'synced' && before?.[1] !== 'synced') void refreshPrevious()
  },
  { immediate: true },
)

/**
 * Troca a atual do servidor pela anterior, e adota.
 *
 * **Sem confirmação, porque desfaz.** A que estava no ar vira a anterior, a um
 * clique de volta — é o mesmo motivo de o *restaurar* das cópias locais não
 * perguntar nada.
 */
async function restorePrevious(): Promise<void> {
  restoring.value = true

  try {
    await $sync.restore()
    notice.value = {
      tone: 'done',
      text: t('settings.notice.previousRestored', { cards: cardsLabel(collection.ownedCount) }),
    }
  }
  catch (error) {
    notice.value = { tone: 'failed', text: restoreFailure(error) }
  }
  finally {
    restoring.value = false
    await refreshPrevious()
  }
}

function restoreFailure(error: unknown): string {
  if (error instanceof NoPreviousVersion) return t('settings.notice.previousMissing')

  if (error instanceof SaveConflict) {
    return t('settings.notice.previousConflict')
  }

  return t('settings.notice.previousFailed')
}

/** O botão não aceita dois cliques: o segundo sairia de uma sessão já encerrada. */
const signingOut = ref(false)

async function leave(): Promise<void> {
  signingOut.value = true
  await signOut()
}

const deleting = ref(false)

/**
 * *Excluir conta e save do servidor* — o `deleteUser` do `better-auth`.
 *
 * `window.confirm`, como o *APAGAR LOCAL*. O save deste aparelho fica, e a
 * pergunta diz isso: é a diferença entre as duas linhas da zona de perigo.
 */
async function removeAccount(): Promise<void> {
  if (!window.confirm(t('settings.confirm.deleteAccount'))) return

  deleting.value = true
  const outcome = await deleteAccount()
  if (outcome === 'deleted') return

  deleting.value = false
  notice.value = {
    tone: 'failed',
    text: outcome === 'stale-session'
      ? t('settings.notice.accountRecent')
      : t('settings.notice.accountFailed'),
  }
}

/**
 * Devolve o save às stores e grava.
 *
 * O `save` explícito não é redundante com o observador do plugin: ele grava a
 * cada mutação, mas de forma assíncrona e um tique depois, e o que se quer aqui
 * é o disco já batendo com a tela quando a mensagem aparece.
 */
function apply(data: SaveData): void {
  hydrateSave(data, $pinia)
  void $saveDriver.save(data)
}

useSeoMeta({
  title: () => t('settings.seo.title'),
  description: () => t('settings.seo.description'),
})
</script>

<template>
  <main class="settings">
    <header class="settings__header">
      <p class="settings__eyebrow">
        {{ t('nav.settings') }}
      </p>
      <!-- O título diz de quem é a tela: com conta, o da prancha; sem ela, o do
           aparelho, que era o único até a Fase 7. -->
      <h1 class="settings__title">
        {{ account ? t('settings.title.account') : t('settings.title.device') }}
      </h1>
    </header>

    <ClientOnly>
      <p
        v-if="notice"
        class="settings__notice"
        :class="`settings__notice--${notice.tone}`"
        role="status"
      >
        {{ notice.text }}
      </p>

      <!-- A CONTA E OS NÚMEROS — com conta, a prancha põe os dois no mesmo
           painel; sem ela, sobram os números. -->
      <section class="settings__panel">
        <div
          v-if="account"
          class="settings__account"
        >
          <span class="settings__avatar">
            <img
              v-if="account.image !== null"
              :src="account.image"
              alt=""
              width="46"
              height="46"
            >
            <span
              v-else
              aria-hidden="true"
            >{{ initials }}</span>
          </span>

          <div class="settings__who">
            <p class="settings__email">
              {{ account.email }}
            </p>
            <p class="numeric settings__sync-line">
              <span
                v-if="status && syncText"
                class="settings__sync"
                :class="`settings__sync--${status.phase}`"
              >
                <span
                  v-if="status.phase === 'synced'"
                  class="settings__sync-dot"
                  aria-hidden="true"
                />
                {{ syncText }}
              </span>
              <span
                v-if="status"
                aria-hidden="true"
              >·</span>
              {{ t('settings.via') }}
            </p>
          </div>

          <button
            type="button"
            class="settings__action bevel-control"
            :disabled="signingOut"
            @click="leave()"
          >
            {{ t('account.signOut') }}
          </button>
        </div>

        <dl class="settings__stats">
          <div
            v-for="stat in stats"
            :key="stat.key"
          >
            <dd class="numeric settings__stat-value">
              {{ stat.value }}
            </dd>
            <dt class="settings__eyebrow settings__eyebrow--small">
              {{ stat.label }}
            </dt>
          </div>
        </dl>
      </section>

      <!-- SAVE -->
      <section class="settings__panel">
        <div class="settings__panel-head">
          <p class="settings__eyebrow">
            {{ t('settings.save.title') }}
          </p>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              {{ t('settings.save.exportTitle') }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.save.exportNote') }}
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--accent bevel-control"
            @click="exportSave()"
          >
            {{ t('settings.save.exportAction') }}
          </button>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              {{ t('settings.save.importTitle') }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.save.importNote') }}
            </p>
          </div>
          <label class="settings__action bevel-control">
            {{ t('settings.save.importAction') }}
            <input
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              class="settings__file"
              @change="importSave"
            >
          </label>
        </div>

        <!-- A rede do servidor: a gravação anterior, que todo PUT guarda. Só com
             conta e só quando há uma — como as cópias locais, a linha não existe
             sem ter o que devolver. -->
        <div
          v-if="account && previous"
          class="settings__row"
        >
          <div>
            <p class="settings__row-title">
              {{ t('settings.save.previousTitle') }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.save.previousNote') }}
              <!-- The count arrives already spelled, and the two shapes are two
                   whole sentences: `{cards} {carta|cartas}` glued in the
                   template put the noun after the number, which is Portuguese
                   word order and not a rule of English. -->
              <i18n-t
                v-if="previousAgo"
                keypath="settings.save.previousMade"
                scope="global"
                tag="span"
              >
                <template #when>
                  <span class="numeric settings__when">{{ previousAgo }}</span>
                </template>
                <template #cards>
                  {{ cardsLabel(previous.cards) }}
                </template>
              </i18n-t>
              <template v-else>
                {{ t('settings.save.previousHolds', { cards: cardsLabel(previous.cards) }) }}
              </template>
              <template v-if="!idle">
                {{ t('settings.save.previousWaiting') }}
              </template>
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--caution bevel-control"
            :aria-label="t('settings.save.previousAria')"
            :disabled="restoring || !idle"
            @click="restorePrevious()"
          >
            {{ restoring ? t('settings.save.previousBusy') : t('settings.save.previousAction') }}
          </button>
        </div>
      </section>

      <!-- CÓPIAS DE SEGURANÇA -->
      <section
        v-if="backups.length > 0"
        class="settings__panel"
      >
        <div class="settings__panel-head">
          <p class="settings__eyebrow">
            {{ t('settings.backups.title') }}
          </p>
          <span class="numeric settings__scope">
            {{ t('settings.backups.scope') }}
          </span>
        </div>

        <div
          v-for="backup in backups"
          :key="backup.key"
          class="settings__row"
        >
          <div>
            <p class="settings__row-title">
              {{ backupLabel(backup.at) }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.backups.note') }}
            </p>
          </div>
          <button
            type="button"
            class="settings__action bevel-control"
            :aria-label="t('settings.backups.aria', { when: backupLabel(backup.at) })"
            @click="restoreBackup(backup.key)"
          >
            {{ t('settings.backups.action') }}
          </button>
        </div>
      </section>

      <!-- PREFERÊNCIAS -->
      <section class="settings__panel">
        <div class="settings__panel-head">
          <p class="settings__eyebrow">
            {{ t('settings.prefs.title') }}
          </p>
          <span class="numeric settings__scope">
            {{ t('settings.backups.scope') }}
          </span>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              {{ t('settings.prefs.motionTitle') }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.prefs.motionNote') }}
            </p>
          </div>
          <!-- `aria-label` porque o texto de dentro é o **estado**, não o nome:
               sem ele o leitor de tela anuncia "ligado, switch, marcado", que
               diz duas vezes a mesma coisa e nunca diz do que se trata. O estado
               já viaja em `aria-checked`. -->
          <button
            type="button"
            role="switch"
            :aria-label="t('settings.prefs.motionTitle')"
            :aria-checked="motion.forced.value"
            class="settings__switch"
            :class="{ 'settings__switch--on': motion.forced.value }"
            @click="motion.set(!motion.forced.value)"
          >
            <span class="settings__switch-knob" />
            <span class="settings__switch-label">
              {{ motion.forced.value ? t('settings.prefs.motionOn') : t('settings.prefs.motionOff') }}
            </span>
          </button>
        </div>
      </section>

      <!-- ZONA DE PERIGO -->
      <section class="settings__panel settings__panel--danger">
        <div class="settings__panel-head">
          <p class="settings__eyebrow settings__eyebrow--danger">
            {{ t('settings.danger.title') }}
          </p>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              {{ t('settings.danger.clearTitle') }}
            </p>
            <p
              v-if="account"
              class="settings__row-note"
            >
              {{ t('settings.danger.clearWithAccount') }}
            </p>
            <p
              v-else
              class="settings__row-note"
            >
              {{ t('settings.danger.clearDevice') }}
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--danger bevel-control"
            @click="clearSave()"
          >
            {{ t('settings.danger.clearAction') }}
          </button>
        </div>

        <div
          v-if="account"
          class="settings__row"
        >
          <div>
            <p class="settings__row-title">
              {{ t('settings.danger.accountTitle') }}
            </p>
            <p class="settings__row-note">
              {{ t('settings.danger.accountNote') }}
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--destroy bevel-control"
            :disabled="deleting"
            @click="removeAccount()"
          >
            {{ deleting ? t('settings.danger.accountBusy') : t('settings.danger.accountAction') }}
          </button>
        </div>
      </section>

      <template #fallback>
        <p class="settings__loading">
          {{ t('settings.loading') }}
        </p>
      </template>
    </ClientOnly>

    <!-- O QUE AINDA NÃO EXISTE -->
    <section class="settings__panel settings__panel--quiet">
      <div class="settings__panel-head">
        <p class="settings__eyebrow">
          {{ t('settings.held.title') }}
        </p>
      </div>
      <p class="settings__row-note settings__held">
        <i18n-t
          keypath="settings.held.note"
          scope="global"
          tag="span"
        >
          <template #language>
            <b>{{ t('settings.held.language') }}</b>
          </template>
          <template #sound>
            <b>{{ t('settings.held.sound') }}</b>
          </template>
          <template #offline>
            <b>{{ t('settings.held.offline') }}</b>
          </template>
        </i18n-t>
      </p>
    </section>

    <p class="numeric settings__version">
      {{ t('settings.version', { app: appVersion, sha: gitSha, schema: SCHEMA_VERSION }) }}
    </p>

    <p class="numeric settings__foot">
      {{ t('settings.footAnimation') }}
      <!-- Two whole sentences and not one with a tail: the em-dash clause is
           glued to the end in Portuguese, and English wants the whole sentence
           rewritten around *once there is an account*. -->
      {{ account ? t('settings.footSyncs') : t('settings.footSyncsNoAccount') }}
    </p>
  </main>
</template>

<style scoped>
.settings {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 36px 48px;
}

.settings__header {
  margin-bottom: 32px;
}

.settings__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.settings__eyebrow--small {
  font-size: 10px;
}

.settings__eyebrow--danger {
  color: var(--deficit);
}

.settings__title {
  margin-top: 10px;
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text);
}

.settings__notice {
  margin-bottom: 20px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-body);
}

.settings__notice--done {
  border-color: color-mix(in oklab, var(--progress-high) 45%, var(--border));
}

.settings__notice--failed {
  border-color: color-mix(in oklab, var(--deficit) 45%, var(--border));
  color: var(--deficit);
}

.settings__panel {
  margin-bottom: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.settings__panel--danger {
  border-color: color-mix(in oklab, var(--deficit) 40%, var(--border));
}

.settings__panel--quiet {
  background: var(--surface-sunken);
}

.settings__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--surface-raised);
}

/**
 * O *SÓ NESTE APARELHO* é `--caution`, e não o ouro das moedas que ele usava: a
 * prancha dá o mesmo amarelo a ele, à fila offline e ao *Restaurar versão
 * anterior* — isto não está no servidor, ou vai substituir o que está.
 */
.settings__scope {
  padding: 4px 9px;
  border: 1px solid color-mix(in oklab, var(--caution) 45%, var(--bg));
  border-radius: var(--radius);
  background: color-mix(in oklab, var(--caution) 8%, transparent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--caution);
}

.settings__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--surface-raised);
}

.settings__stats > div {
  padding: 16px 22px;
  background: var(--surface);
}

.settings__stat-value {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
}

.settings__stats dt {
  margin-top: 5px;
}

.settings__account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 22px;
  border-bottom: 1px solid var(--surface-raised);
}

.settings__avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 46px;
  height: 46px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-raised);
  font-size: 15px;
  font-weight: 700;
  color: var(--text-body);
}

.settings__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.settings__who {
  flex-grow: 1;
  min-width: 0;
}

.settings__email {
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.settings__sync-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-muted);
}

.settings__sync {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.settings__sync--synced {
  color: var(--synced);
}

.settings__sync--sending {
  color: var(--accent);
}

.settings__sync--queued {
  color: var(--caution);
}

.settings__sync-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.settings__when {
  color: var(--text-body);
}

.settings__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--surface-raised);
}

.settings__row:last-child {
  border-bottom: none;
}

.settings__row-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.settings__row-note {
  max-width: 62ch;
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

.settings__action {
  flex-shrink: 0;
  padding: 10px 20px;
  border: 1px solid var(--border);
  background: transparent;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-body);
  cursor: pointer;
}

.settings__action--accent {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
  color: var(--accent);
}

.settings__action--danger {
  border-color: color-mix(in oklab, var(--deficit) 55%, var(--border));
  color: var(--deficit);
}

.settings__action--caution {
  border-color: color-mix(in oklab, var(--caution) 55%, var(--border));
  color: var(--caution);
}

/* O único botão cheio da zona de perigo, como a prancha o desenha: é o que não
   tem cópia de segurança do outro lado. */
.settings__action--destroy {
  border-color: transparent;
  background: color-mix(in oklab, var(--deficit) 22%, var(--surface));
  color: var(--deficit);
}

.settings__action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.settings__action:focus-visible,
.settings__action:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

/** O `<input type="file">` some, e o `<label>` em volta dele é o botão. */
.settings__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.settings__switch {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.settings__switch-knob {
  position: relative;
  width: 38px;
  height: 21px;
  border-radius: 11px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
}

.settings__switch-knob::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: transform 140ms var(--ease-out), background 140ms var(--ease-out);
}

.settings__switch--on .settings__switch-knob {
  border-color: var(--accent);
  background: var(--accent);
}

.settings__switch--on .settings__switch-knob::after {
  background: var(--bg);
  transform: translateX(17px);
}

.settings__switch-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.settings__switch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

/**
 * O botão que desliga o movimento **não** anima ao ser clicado, e é a única
 * regra de movimento que não precisa do par: ela é incondicional.
 */
@media (prefers-reduced-motion: reduce) {
  .settings__switch-knob::after {
    transition: none;
  }
}

:root[data-reduce-motion] .settings__switch-knob::after {
  transition: none;
}

.settings__held {
  max-width: none;
  padding: 16px 22px;
}

.settings__held b {
  font-weight: 600;
  color: var(--text-body);
}

.settings__version {
  margin-top: 26px;
  font-size: 11px;
  color: var(--text-muted);
}

.settings__foot {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-faint);
}

.settings__loading {
  padding: 48px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
