<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { gameNumber } from '~~/shared/game/progress'
import type { SaveData } from '~~/shared/save/schema'
import { SCHEMA_VERSION, emptySave, migrate } from '~~/shared/save/schema'
import { useCollectionStore } from '~~/app/stores/collection'
import { useProgressStore } from '~~/app/stores/progress'
import { composeSave, hydrateSave } from '~~/app/utils/save-document'
import { useMotionSwitch } from '~/composables/useMotion'

/**
 * `/settings` — a prancha *Ajustes*, do que existe.
 *
 * **Ela desenha quatro painéis e três deles dependem do que ainda não há.** A
 * conta, o estado de sincronização e o *restaurar versão anterior* são da Fase 7;
 * idioma pede i18n, som pede áudio, e *baixar tudo para offline* pede PWA —
 * nenhum dos três existe no repositório. Decidido em 05/09: entra só o que tem
 * dado, e o resto fica **segurado e registrado** no README, pela mesma regra que
 * segurou o contador de coleção na Fase 5. Inventar um zero desenha um progresso
 * que ninguém pode mover.
 *
 * O que sobra é o painel *Save* — que o plano quer desde o começo, e que é o
 * único backup possível sem servidor —, a fileira de números, o interruptor de
 * movimento e a versão.
 */
const collection = useCollectionStore()
const progress = useProgressStore()
const motion = useMotionSwitch()

const { $saveDriver } = useNuxtApp()
const { appVersion, gitSha } = useRuntimeConfig().public

const fileInput = ref<HTMLInputElement | null>(null)

/**
 * O que aconteceu na última ação, para a tela responder.
 *
 * Um estado só, com tom: importar, apagar e falhar são exclusivos entre si, e
 * três flags separadas produziriam a combinação impossível em que a tela diz ao
 * mesmo tempo que importou e que falhou.
 */
const notice = ref<{ tone: 'done' | 'failed', text: string } | null>(null)

/** O save atual como texto — a mesma coisa que é exportada e que é medida. */
const document_ = computed(() => JSON.stringify(composeSave(), null, 2))

/**
 * O tamanho do save em KB, medido em **bytes** e não em caracteres.
 *
 * `length` conta unidades UTF-16, e o save carrega nome de espécie: `Nidoran♀`
 * ocupa mais bytes do que letras. A prancha estampa `20,6 KB` ao lado da
 * contagem de cartas, e o número que importa é o que atravessa a rede na Fase 7.
 */
const sizeKb = computed(() => {
  const bytes = new TextEncoder().encode(document_.value).length
  return (bytes / 1024).toFixed(1).replace('.', ',')
})

const stats = computed(() => [
  { key: 'cards', value: gameNumber(collection.ownedCount), label: 'cartas' },
  { key: 'badges', value: gameNumber(progress.badges), label: 'insígnias' },
  { key: 'schema', value: `v${SCHEMA_VERSION}`, label: 'versão do save' },
  { key: 'size', value: sizeKb.value, label: 'KB' },
])

/**
 * Baixa o save como JSON.
 *
 * O nome carrega a data para dois arquivos exportados em dias diferentes não se
 * sobreporem na pasta de downloads — que é onde eles vão parar, e onde o
 * jogador vai procurar o "de antes de eu ter moído tudo".
 */
function exportSave(): void {
  const blob = new Blob([document_.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const day = new Date().toISOString().slice(0, 10)

  const link = document.createElement('a')
  link.href = url
  link.download = `holodeck-${day}.json`
  link.click()

  URL.revokeObjectURL(url)
  notice.value = { tone: 'done', text: 'Save exportado.' }
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

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  }
  catch {
    notice.value = { tone: 'failed', text: 'O arquivo não é um JSON válido.' }
    return
  }

  const { data, recovered } = migrate(parsed)
  if (recovered !== null) {
    notice.value = { tone: 'failed', text: `Esse arquivo não pôde ser lido: ${REASONS[recovered]}.` }
    return
  }

  archiveCurrent()
  apply(data)
  notice.value = {
    tone: 'done',
    text: `Save importado — ${gameNumber(collection.ownedCount)} cartas. O anterior foi para a cópia de segurança.`,
  }

  // Sem isto, escolher o mesmo arquivo duas vezes seguidas não dispara `change`.
  if (fileInput.value !== null) fileInput.value.value = ''
}

const REASONS: Record<'corrupt' | 'unknown-version' | 'failed-migration', string> = {
  'corrupt': 'não tem a forma de um save',
  'unknown-version': 'é de uma versão mais nova do jogo',
  'failed-migration': 'não sobreviveu à migração',
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
function clearSave(): void {
  // `window.confirm` e não um modal próprio: é uma pergunta de sim ou não num
  // caminho destrutivo, e o nativo bloqueia de verdade — um diálogo escrito à
  // mão precisaria de foco, escape, e de não deixar o clique passar por baixo.
  if (!window.confirm('Apagar o save deste aparelho? Uma cópia de segurança fica guardada.')) return

  archiveCurrent()
  void $saveDriver.clear()
  apply(emptySave())
  notice.value = { tone: 'done', text: 'Save apagado. A cópia de segurança continua no navegador.' }
}

function archiveCurrent(): void {
  const raw = $saveDriver.readRaw()
  if (raw !== null) $saveDriver.archive(raw)
}

/**
 * Devolve o save às stores e grava.
 *
 * O `save` explícito não é redundante com o observador do plugin: ele grava a
 * cada mutação, mas de forma assíncrona e um tique depois, e o que se quer aqui
 * é o disco já batendo com a tela quando a mensagem aparece.
 */
function apply(data: SaveData): void {
  hydrateSave(data)
  void $saveDriver.save(data)
}

useSeoMeta({
  title: 'Ajustes — Holo Deck',
  description: 'Exportar e importar o save, o interruptor de animações e a versão do jogo.',
})
</script>

<template>
  <main class="settings">
    <header class="settings__header">
      <p class="settings__eyebrow">
        Ajustes
      </p>
      <h1 class="settings__title">
        Seu save e este aparelho
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

      <!-- OS NÚMEROS -->
      <section class="settings__panel">
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
            Save
          </p>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              Exportar
            </p>
            <p class="settings__row-note">
              Baixa um JSON com coleção, deck e progresso.
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--accent bevel-control"
            @click="exportSave()"
          >
            BAIXAR
          </button>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              Importar
            </p>
            <p class="settings__row-note">
              O save atual vai para a cópia de segurança antes de ser substituído
              — nada é apagado.
            </p>
          </div>
          <label class="settings__action bevel-control">
            ESCOLHER ARQUIVO
            <input
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              class="settings__file"
              @change="importSave"
            >
          </label>
        </div>
      </section>

      <!-- PREFERÊNCIAS -->
      <section class="settings__panel">
        <div class="settings__panel-head">
          <p class="settings__eyebrow">
            Preferências
          </p>
          <span class="numeric settings__scope">
            SÓ NESTE APARELHO
          </span>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              Reduzir animações
            </p>
            <p class="settings__row-note">
              Desliga o foil que segue o ponteiro e a virada dos packs. Se o seu
              sistema já pede menos movimento, o jogo obedece sem isto.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="motion.forced.value"
            class="settings__switch"
            :class="{ 'settings__switch--on': motion.forced.value }"
            @click="motion.set(!motion.forced.value)"
          >
            <span class="settings__switch-knob" />
            <span class="settings__switch-label">
              {{ motion.forced.value ? 'ligado' : 'desligado' }}
            </span>
          </button>
        </div>
      </section>

      <!-- ZONA DE PERIGO -->
      <section class="settings__panel settings__panel--danger">
        <div class="settings__panel-head">
          <p class="settings__eyebrow settings__eyebrow--danger">
            Zona de perigo
          </p>
        </div>

        <div class="settings__row">
          <div>
            <p class="settings__row-title">
              Apagar save deste aparelho
            </p>
            <p class="settings__row-note">
              Coleção, deck e progresso voltam ao zero. Uma cópia de segurança
              fica guardada no navegador — exporte antes se quiser levá-la junto.
            </p>
          </div>
          <button
            type="button"
            class="settings__action settings__action--danger bevel-control"
            @click="clearSave()"
          >
            APAGAR LOCAL
          </button>
        </div>
      </section>

      <template #fallback>
        <p class="settings__loading">
          Carregando…
        </p>
      </template>
    </ClientOnly>

    <!-- O QUE AINDA NÃO EXISTE -->
    <section class="settings__panel settings__panel--quiet">
      <div class="settings__panel-head">
        <p class="settings__eyebrow">
          Ainda não
        </p>
      </div>
      <p class="settings__row-note settings__held">
        A prancha desta tela desenha mais quatro coisas, e nenhuma delas tem de
        onde tirar dado ainda: <b>conta e sincronização</b> e <b>restaurar a
          gravação anterior do servidor</b> chegam com a conta; <b>idioma</b>,
        <b>som</b> e <b>baixar tudo para offline</b> chegam com o que os
        sustenta. Elas não aparecem aqui de propósito — um controle desligado
        promete uma coisa que o jogo não faz.
      </p>
    </section>

    <p class="numeric settings__version">
      v{{ appVersion }} · {{ gitSha }} · save v{{ SCHEMA_VERSION }}
    </p>

    <p class="numeric settings__foot">
      Animação é preferência de aparelho e não sincroniza, de propósito.
      Coleção, progresso e deck sincronizam — quando houver conta.
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

.settings__scope {
  padding: 4px 9px;
  border: 1px solid color-mix(in oklab, var(--coin) 45%, var(--bg));
  border-radius: var(--radius);
  background: color-mix(in oklab, var(--coin) 8%, transparent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--coin);
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
