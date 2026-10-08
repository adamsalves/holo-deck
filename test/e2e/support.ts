import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import type { Browser, Locator, Page } from '@playwright/test'
import { defaultLocale, label, localeUrl, messagePattern } from '../support/locales'
import { pageAddresses } from '../support/source-tree'
import { ENGINE_VERSION } from '../../shared/game/battle.ts'
import { forgeCost } from '../../shared/game/dust.ts'
import { PACK_PRICE } from '../../shared/game/economy.ts'
import { PACK_SIZE } from '../../shared/game/packs.ts'
import { SCHEMA_VERSION } from '../../shared/save/schema.ts'
import { isSyncBody } from '../../shared/save/sync.ts'

/**
 * O rótulo que a barra **renderiza**, no idioma pedido.
 *
 * Os rótulos de `NavLink` viraram chave de i18n na Fase 8, e cinco suítes procuram
 * link da barra pelo nome acessível. Resolver a chave aqui mantém a inversão que
 * `nav-gate` e o e2e da barra aplicam — a lista continua vindo de `nav-links`, não
 * escrita à mão — e dá um segundo efeito de graça: chave sem tradução reprova o
 * teste, em vez de virar um link chamado `nav.collection` na tela.
 *
 * **O locale é parâmetro, e a primeira versão o fechava em pt-BR.** Isso deixava
 * o único idioma que este PR entrega fora do alcance de qualquer teste — e três
 * defeitos de `/en/…` atravessaram cinco checks verdes por causa disso. A leitura
 * mora em `test/support/locales.ts`, que o portão unitário também usa: os dois
 * medem a mesma fonte, que é o que o `CLAUDE.md` pede ao dizer que o e2e itera
 * sobre a mesma lista que o componente renderiza.
 */
export function navLabel(key: string, locale: string = defaultLocale()): string {
  if (!key.startsWith('nav.')) {
    throw new Error(`rótulo da barra fora do namespace \`nav\`: ${key}`)
  }

  return label(key, locale)
}

/**
 * O que toda suíte E2E precisa fazer antes de poder afirmar qualquer coisa:
 * ter cartas.
 *
 * **Ele nasceu extraído por um defeito de manutenção real.** A mesma função
 * estava copiada em `deck`, `league` e `collection`, e o PR da loja trocou o
 * baralho selado pelos três cartões — as três cópias quebraram no mesmo commit,
 * pelo mesmo motivo, e a correção seria escrita três vezes. Um helper por
 * arquivo é barato até o dia em que a tela muda.
 */

/**
 * The opener's progress line, as a pattern — *… / 10 reveladas*.
 *
 * A pattern and not a string because the left number counts up while the cards
 * flip, and all seven callers wait for the opener to exist rather than for a
 * particular card to have turned. The right number comes from `PACK_SIZE` for the
 * same reason `saveWith` reads `SCHEMA_VERSION`: the day the pack changes size,
 * the suites follow the rule instead of the nine literal `10`s this replaced.
 */
export function openingProgress(): RegExp {
  return messagePattern('packs.opening.revealed', defaultLocale(), { total: PACK_SIZE })
}

/**
 * Abre um pack de boas-vindas, que é como qualquer jogador chega ao deck.
 *
 * O `toPass` é a espera pela hidratação: antes dela o botão é marcação, e o
 * clique não faz nada. É o mesmo laço que a suíte da Pokédex usa nas abas.
 *
 * O seletor é a classe do cartão de estreia, e não o texto `ABRIR`: a loja tem
 * até três cartões e dois deles escrevem a mesma palavra — num perfil novo o
 * diário também está de pé, e um `getByRole` por nome pegaria o primeiro que
 * casasse.
 */
export async function openWelcomePack(page: Page): Promise<void> {
  await skipInvite(page)
  await page.goto('/packs')

  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText(openingProgress())).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
}

/**
 * Marca o convite como já visto, **antes de a página abrir**.
 *
 * O convite é pedido no fim de um pack que traz ultra ou acima, e o conteúdo do
 * pack é **sorteado**: qualquer suíte que abra packs passa a ter, de vez em
 * quando, um diálogo modal por cima da tela — e o `aria-modal` faz dele um
 * interceptador de clique. Foi assim que `collection.spec.ts` reprovou no clique
 * de *ABRIR O PRÓXIMO*, com o Playwright nomeando o culpado: `<div
 * role="dialog" class="invite"> intercepts pointer events`.
 *
 * **Localmente não há `retries` e no CI há dois**, então este é exatamente o
 * defeito que reprova aqui e passa lá — a tentativa seguinte sorteia um pack sem
 * ultra. Suíte que não é sobre o convite não pode depender de sorte; quem o
 * testa é `invite.spec.ts`, que semeia o save por conta própria e não passa por
 * este helper.
 */
export async function skipInvite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('holodeck:invite', '1')
  })
}

/** Volta da abertura para a loja, para abrir o próximo. */
export async function backToShop(page: Page): Promise<void> {
  await page.locator('.packs__skip--primary').click()
  await expect(page.locator('.packs__offers')).toBeVisible()
}

/** O que o servidor falso guarda, na forma que `GET /api/save` devolve. */
interface StoredSave {
  data: unknown
  version: number
  updatedAt: string
}

export interface FakeSync {
  /** Os corpos que o cliente tentou gravar, na ordem. */
  readonly puts: { data: unknown, baseVersion: number }[]
  /**
   * Quantas vezes o cliente perguntou quem está logado.
   *
   * **É a âncora positiva do boot**, e existe porque a outra não servia para o
   * teste que mais precisa dela: provar que um boot já acertado **não** faz algo
   * é provar uma ausência, e o que se nega não cresce para ancorá-la. Este cresce
   * — a sessão é lida em todo boot, antes da decisão —, então esperar por ele é
   * esperar o plugin ter chegado ao ponto em que decidiria. Era um
   * `waitForTimeout(1500)`, que é a mesma forma de falso verde que esta suíte
   * corrigiu nos outros testes: numa máquina lenta ele dá verde com o defeito.
   */
  sessions: () => number
  /**
   * Quantas leituras o cliente fez.
   *
   * **É o sinal que ancora as asserções de ausência da tela de escolha.**
   * `toHaveCount(0)` passa no instante em que roda, então "a tela não apareceu" é
   * verde antes de o plugin assíncrono ter tido chance de mostrá-la. Esperar o
   * `GET` acontecer é esperar a decisão ser tomada.
   */
  gets: () => number
  /** O que o servidor tem agora — nulo quando ninguém subiu nada. */
  current: () => StoredSave | null
  /**
   * Outro aparelho grava: a versão anda sem este navegador saber.
   *
   * É o que produz o 409 de verdade no meio da sessão — e o boot que encontra o
   * servidor à frente do que este aparelho conhece.
   */
  elsewhere: (data: unknown) => void
  /** O que a coluna anterior do servidor guarda agora. */
  previous: () => StoredSave | null
  /**
   * A próxima exclusão de conta responde como a de uma sessão com mais de um dia
   * — o `SESSION_EXPIRED` que o `better-auth` dá a conta sem senha.
   */
  staleSession: () => void
  /**
   * Fecha o teto de escritas depois de `n` gravações — o 429 do servidor de
   * verdade, que é o que produz "N mudanças na fila" **sem** falta de rede.
   */
  capWrites: (n: number) => void
}

/**
 * Um `/api/save` em memória, dentro do teste.
 *
 * **Interceptação no Playwright, e não um servidor falso ligado por variável de
 * ambiente.** A decisão 4 da fase pediu "servidor falso em memória"; um flag no
 * Nitro cumpriria a letra e criaria um caminho de fake **dentro do código de
 * produção**, que alguém pode ligar sem querer e nenhum portão pega. Aqui o
 * fake existe só enquanto o teste roda, e o build é o mesmo que vai ao ar.
 *
 * Ele fala o protocolo de verdade — 404 para quem nunca subiu, CAS em
 * `baseVersion`, 409 devolvendo o que está no servidor —, porque testar contra
 * um fake que não implementa a regra é testar o fake.
 *
 * A sessão também é falsa: o consentimento do GitHub exige um humano, e amarrar
 * a suíte a isso é o que faria o portão do sync não existir.
 *
 * O resto do protocolo vem pelo mesmo caminho: a coluna anterior que todo `PUT`
 * empurra, `GET /api/save/previous` com o resumo dela, `POST /api/save/restore`
 * trocando atual e anterior sob o CAS, e a exclusão de conta do `better-auth`.
 */
export async function fakeSync(
  page: Page,
  remote: unknown | null = null,
  options: { previous?: unknown } = {},
): Promise<FakeSync> {
  // Com anterior, a atual está na versão 2: a anterior é a 1, que ela empurrou.
  let previous: StoredSave | null = options.previous === undefined
    ? null
    : { data: options.previous, version: 1, updatedAt: '2026-08-30T12:00:00.000Z' }

  let stored: StoredSave | null = remote === null
    ? null
    : { data: remote, version: previous === null ? 1 : 2, updatedAt: '2026-09-01T12:00:00.000Z' }

  const puts: { data: unknown, baseVersion: number }[] = []
  let gets = 0
  let sessions = 0
  let signedOut = false
  let stale = false
  let writeCap = Number.POSITIVE_INFINITY

  await page.route('**/api/auth/get-session', async (route) => {
    sessions += 1

    // Depois do logout a sessão acabou, e o fake precisa disso para o canto da
    // barra poder ser testado: sem estado, `SAIR` recarregaria a página e o
    // servidor falso diria que a conta continua logada.
    await route.fulfill({ json: signedOut ? null : session() })
  })

  await page.route('**/api/auth/sign-out', async (route) => {
    signedOut = true
    await route.fulfill({ json: { success: true } })
  })

  await page.route('**/api/save', async (route) => {
    const request = route.request()

    if (request.method() === 'GET') {
      gets += 1

      if (stored === null) {
        await route.fulfill({ status: 404, json: { statusMessage: 'Nenhum save no servidor' } })
        return
      }

      await route.fulfill({ json: stored })
      return
    }

    // `JSON.parse` devolve `any`, e o bloco type-aware do ESLint recusa deixá-lo
    // entrar — a mesma regra que vale para a fronteira de dados do jogo. Um
    // corpo fora do contrato vira `baseVersion: -1`, que nunca casa e cai no 409.
    const parsed: unknown = JSON.parse(request.postData() ?? '{}')
    const body = isPutBody(parsed) ? parsed : { data: null, baseVersion: -1 }
    puts.push(body)

    /**
     * As duas recusas que o servidor de verdade tem e este fake não tinha.
     *
     * `isSyncBody` é o mesmo guarda da rota — recusa chave desconhecida, batalha
     * não nula e `schemaVersion` acima do teto —, e sem ele o caminho 400 nunca
     * atravessava o navegador. O teto de escritas é o outro: ele produz o estado
     * 03 do indicador (*N mudanças na fila*) **sem** falta de rede.
     * That is the divergence from the board recorded in `docs/canvas-divergences.md`.
     */
    if (!isSyncBody(body.data)) {
      await route.fulfill({ status: 400, json: { statusMessage: 'Corpo inválido' } })
      return
    }

    if (puts.length > writeCap) {
      await route.fulfill({ status: 429, json: { statusMessage: 'Escritas demais nesta hora' } })
      return
    }

    if (body.baseVersion !== (stored?.version ?? 0)) {
      await route.fulfill({ status: 409, json: { data: stored } })
      return
    }

    previous = stored
    stored = {
      data: body.data,
      version: (stored?.version ?? 0) + 1,
      updatedAt: '2026-09-10T12:00:00.000Z',
    }
    await route.fulfill({ json: { version: stored.version, updatedAt: stored.updatedAt } })
  })

  await page.route('**/api/save/previous', async (route) => {
    if (previous === null) {
      await route.fulfill({ status: 404, json: { statusMessage: 'Nenhuma versão anterior no servidor' } })
      return
    }

    await route.fulfill({ json: { version: previous.version, updatedAt: previous.updatedAt, cards: speciesIn(previous.data) } })
  })

  // A ordem do SQL de verdade: troca sob o CAS; sem troca, versão diferente é
  // 409 com o que está lá, e versão igual é "não há anterior".
  await page.route('**/api/save/restore', async (route) => {
    const parsed: unknown = JSON.parse(route.request().postData() ?? '{}')
    const baseVersion = isRestoreBody(parsed) ? parsed.baseVersion : -1

    if (stored !== null && stored.version === baseVersion && previous !== null) {
      const restored: StoredSave = { data: previous.data, version: stored.version + 1, updatedAt: '2026-09-11T10:00:00.000Z' }
      previous = stored
      stored = restored
      await route.fulfill({ json: restored })
      return
    }

    if (stored !== null && stored.version !== baseVersion) {
      await route.fulfill({ status: 409, json: { data: stored } })
      return
    }

    await route.fulfill({ status: 404, json: { statusMessage: 'Nenhuma versão anterior no servidor' } })
  })

  await page.route('**/api/auth/delete-user', async (route) => {
    if (stale) {
      await route.fulfill({
        status: 400,
        json: { code: 'SESSION_EXPIRED', message: 'Session expired. Re-authenticate to perform this action.' },
      })
      return
    }

    // A conta e o save somem juntos — o `onDelete: 'cascade'` do banco.
    signedOut = true
    stored = null
    previous = null
    await route.fulfill({ json: { success: true, message: 'User deleted' } })
  })

  return {
    puts,
    gets: () => gets,
    sessions: () => sessions,
    current: () => stored,
    elsewhere: (data) => {
      previous = stored
      stored = { data, version: (stored?.version ?? 0) + 1, updatedAt: '2026-09-11T09:00:00.000Z' }
    },
    previous: () => previous,
    staleSession: () => {
      stale = true
    },
    capWrites: (n) => {
      writeCap = n
    },
  }
}

/** A sessão falsa. O consentimento do GitHub exige um humano — ver o docblock. */
function session(): unknown {
  return {
    user: { id: 'e2e', name: 'Treinadora Ash', email: 'e2e@exemplo.invalido', emailVerified: true, image: null },
    session: { id: 'e2e-session', userId: 'e2e', expiresAt: '2099-01-01T00:00:00.000Z' },
  }
}

/**
 * One turn of a battle, whatever the screen is asking for.
 *
 * After a faint the engine demands a switch and the moves go away — a `click` on
 * the first `.move` would hang the suite waiting for a button the screen does not
 * draw. Shared by the League's suite and the offline one, which plays a battle to
 * the end with the network gone.
 */
export async function playTurn(page: Page): Promise<void> {
  const forced = page.locator('.battle__forced')
  if (await forced.isVisible()) {
    await page.locator('.battle__pill:not([disabled])').first().click()
    return
  }
  await page.locator('.move').first().click()
}

/**
 * Semeia o save deste navegador antes de a página abrir.
 *
 * Direto no `localStorage` e não abrindo packs pela tela: aqui o que se afirma é
 * a **decisão** entre dois saves, e um pack sorteia cartas — a coleção local
 * mudaria a cada rodada e as asserções teriam de ser vagas. As suítes que testam
 * o jogo continuam passando pela interface.
 */
export async function seedLocalSave(page: Page, save: unknown): Promise<void> {
  // **Só quando ainda não há save**, e isto não é detalhe: `addInitScript` roda
  // em TODA navegação, não só na primeira. Sem a guarda, um `goto` posterior
  // re-semeia o save inicial por cima do que o jogo gravou — foi assim que o
  // teste do `adopt` acusou binder vazio com a adoção funcionando perfeitamente.
  await page.addInitScript((value) => {
    if (window.localStorage.getItem('holodeck:save') === null) {
      window.localStorage.setItem('holodeck:save', JSON.stringify(value))
    }
  }, save)
}

/**
 * Semeia um aparelho já acertado com a conta falsa — `syncedWith` e o estado do
 * sync contínuo —, como se o primeiro login tivesse acontecido antes.
 *
 * **Uma vez por aba**, e não "enquanto não houver marca" como em `seedLocalSave`.
 * `addInitScript` roda em toda navegação, e sair ou excluir a conta apagam o
 * `syncedWith` e recarregam: a guarda pela marca semearia de novo, na recarga, o
 * acerto que o teste acabou de desfazer.
 */
export async function seedSynced(page: Page, state: { base: number, pending?: number }): Promise<void> {
  await page.addInitScript((value) => {
    if (window.sessionStorage.getItem('e2e:synced-seeded') === null) {
      window.sessionStorage.setItem('e2e:synced-seeded', '1')
      window.localStorage.setItem('holodeck:syncedWith', 'e2e')
      window.localStorage.setItem('holodeck:syncState', JSON.stringify(value))
    }
  }, { base: state.base, pending: state.pending ?? 0, syncedAt: '2026-09-01T12:00:00.000Z', sent: null })
}

/** O pó do save deste navegador — o número que identifica cada save nos testes. */
export function localDust(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('holodeck:save')
    if (raw === null) return null

    const save: unknown = JSON.parse(raw)
    return typeof save === 'object' && save !== null && 'dust' in save && typeof save.dust === 'number'
      ? save.dust
      : null
  })
}

/**
 * The text of a screen, one text node per line — what a language sweep reads.
 *
 * **Neither `innerText` nor `textContent` can be handed to `foreignPhrases`,
 * and both were, one after the other.** `innerText` returns the text as drawn,
 * and this design uppercases small labels in CSS, so `spells` — case sensitive
 * by contract — walked past every transformed one. `textContent` fixes the case
 * and loses the borders instead: Vue's `condense` drops the whitespace node
 * between two elements, so `/en/settings` reads back as
 * `…offDanger zoneDelete the save on this device…` and the `(?<![\p{L}\p{N}])`
 * border of `spells` never matches. Measured on the built page, over the 33
 * phrases the screen actually writes:
 *
 * ```
 * innerText, case sensitive .... 23
 * innerText, case folded ....... 29
 * textContent .................. 9
 * one line per text node ....... 33
 * ```
 *
 * **The `textContent` reading looked proven, and that is the part worth
 * writing down.** The defect planted to prove it was a literal typed into the
 * template, and a literal is the one shape that survives: the compiler emits
 * `" Zona de perigo "`, spaces and all, while `{{ t('…') }}` emits the value
 * bare through `_toDisplayString`. So the proof used the only defect the gate
 * could still see, and every real one — a wrong key, a message left
 * untranslated — arrives by the path it cannot. A plant that proves this gate
 * has to go in the `<script>`.
 *
 * Reading node by node keeps the case (which is the real gain over `innerText`)
 * and gives the borders back, because the join is a newline the border matches.
 * Text inside hidden elements comes along, which is the right side to err on: a
 * Portuguese sentence behind a closed panel is still a Portuguese sentence.
 *
 * It lives here and not beside `foreignPhrases` because the body runs in the
 * browser, and `test/support/` is the one project compiled without `lib: dom` —
 * see the note in `tsconfig.tools.json`.
 */
export function screenText(scope: Locator): Promise<string> {
  return scope.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const parts: string[] = []

    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? '')

    return parts.join('\n')
  })
}

/**
 * A URL whose path is exactly `path`, on whatever origin the suite runs against.
 *
 * Anchored at both ends on purpose. `/login$` alone also matches `/en/login`, so
 * asserting the default locale's destination that way passes on the very defect
 * it is there to catch — a link that kept the wrong prefix. The first draft of
 * the sign-in test did exactly that for the Hub, where `/?$` matches every URL
 * there is.
 */
export function pathPattern(path: string): RegExp {
  const escaped = path.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`^https?://[^/]+${escaped}$`)
}

/**
 * What an icon would ask the network for: Nuxt Icon's own route, the public API it
 * falls back to, and the address it builds when it has no endpoint at all —
 * `undefined/lucide.json`, which is where the loader of a custom collection goes
 * for an icon missing from the bundle when the module's provider is `none`.
 */
export const ICON_REQUEST = /\/api\/_nuxt_icon|iconify\.design|\/lucide\.json/

/**
 * What is wrong with the icons on screen, by name: the ones asked for that are
 * not drawn, and the ones that are there with no picture.
 *
 * **An icon with no picture is invisible to every other check.** Nuxt Icon draws
 * one as an empty `<span class="iconify i-lucide:search">` and writes its CSS —
 * the `mask-image` that is the picture — once it has the icon's data. One it
 * could not get is the same span with no rule, a computed `mask-image` of `none`,
 * and a blank square: no console error, no failed text assertion, only a gap
 * where the glyph was.
 *
 * It lives here for the reason `screenText` does: the body runs in the browser.
 */
export function iconProblems(page: Page, names: readonly string[]): Promise<{ missing: string[], bare: string[] }> {
  return page.evaluate((wanted) => {
    const icons = Array.from(document.querySelectorAll('.iconify')).map(icon => ({
      name: Array.from(icon.classList).find(className => className.startsWith('i-')) ?? icon.className,
      drawn: getComputedStyle(icon).maskImage !== 'none',
    }))

    return {
      missing: wanted.filter(name => !icons.some(icon => icon.drawn && icon.name === name)),
      bare: icons.filter(icon => !icon.drawn).map(icon => icon.name),
    }
  }, names)
}

/** O texto de cada cópia de segurança deste navegador. */
export function backups(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage)
    .filter(key => key.startsWith('holodeck:backup:'))
    .map(key => window.localStorage.getItem(key) ?? ''))
}

/** Espécies na coleção de um save cru — o `cards` do resumo da anterior. */
function speciesIn(data: unknown): number {
  if (typeof data !== 'object' || data === null || !('collection' in data)) return 0

  const collection = data.collection
  return typeof collection === 'object' && collection !== null ? Object.keys(collection).length : 0
}

function isRestoreBody(value: unknown): value is { baseVersion: number } {
  return typeof value === 'object' && value !== null
    && 'baseVersion' in value && typeof value.baseVersion === 'number'
}

function isPutBody(value: unknown): value is { data: unknown, baseVersion: number } {
  return typeof value === 'object' && value !== null
    && 'baseVersion' in value && typeof value.baseVersion === 'number'
}

/**
 * Um save válido, com o que cada teste precisar por cima.
 *
 * A versão vem de `SCHEMA_VERSION` e não de um `4` literal, pela mesma razão que
 * o repositório escreve `GYM_COUNT` em vez de `9`: no dia em que ela subir, cinco
 * suítes passariam a semear um save de migração sem ninguém ter decidido isso — e
 * o teste que falhasse acusaria a tela, não o número.
 */
export function saveWith(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    collection: {},
    dust: 0,
    deck: [null, null, null, null, null, null],
    progress: { pity: 0, welcomeClaimed: 0, coins: 0, badges: 0, dailyClaimed: null },
    battle: null,
    ...over,
  }
}

/**
 * The dex version the served game uses: what a saved battle has to carry.
 *
 * **It has to be the real one.** `resume` checks the engine and the dex before
 * replaying, and drops a battle recorded against another: with an invented
 * `dexVersion` there is no battle left to assert anything about. The first
 * version of the sync suite's warning test got that wrong and passed anyway,
 * because the screen read a snapshot taken on boot, before the drop — it warned
 * about a fight that no longer existed.
 */
export const DEX_VERSION: string = (() => {
  const core: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../public/data/core.json', import.meta.url)), 'utf8'),
  )

  if (typeof core !== 'object' || core === null || !('dexVersion' in core)) {
    throw new Error('core.json has no dexVersion: run `yarn data:build`')
  }

  const version = core.dexVersion
  if (typeof version !== 'string') throw new Error('dexVersion is not a string')

  return version
})()

/**
 * The team of the page-structure gate: six commons, so no invite opens.
 *
 * The scenes below are the one list the gates that walk the screens share — the
 * ring of `focus-ring.spec.ts`, the census of `keyboard-focus.spec.ts` and the
 * names sweep of `accessible-names.spec.ts`. Each of them had, or was about to
 * have, its own copy of the seeds, and a seed that ages in one copy is a state
 * the other gates stop measuring without anybody noticing.
 */
export const TEAM = [1, 4, 7, 10, 16, 25]

/** Two cards more than the team, so the deck's pick list has something to field. */
const OWNED = [...TEAM, 2, 5]

/**
 * A full deck everywhere — the battle needs one to land on the fight — except on
 * the deck page, where a full deck disables every pick and takes them out of
 * the tab order: the picks, inside a list that cuts what leaves its items, are
 * one of the two places the ring disappeared. And duplicates on the collection
 * page, where each card offers its spares to scrap.
 */
export function saveFor(path: string): Record<string, unknown> {
  return saveWith({
    collection: Object.fromEntries(OWNED.map(id => [id, { c: path.endsWith('/collection') ? 3 : 1, s: 0 }])),
    deck: path.endsWith('/deck') ? [...TEAM.slice(0, 5), null] : TEAM,
    // The three packs of the shop open: a welcome pack left, the daily one due,
    // and coins for the one on sale.
    progress: { pity: 0, welcomeClaimed: 0, coins: PACK_PRICE * 2, badges: 0, dailyClaimed: null },
  })
}

/** A state the walks go through: a page, the save it opens with, and what brings the state about. */
export interface Scene {
  readonly name: string
  readonly address: string
  readonly save: Record<string, unknown>
  /** What shows the state is on the screen, waited for before the walk. */
  readonly ready?: string
  /** An account, or a session answered as none, before the page opens. */
  readonly before?: (page: Page) => Promise<unknown>
  /** What brings the state about once the page is up. */
  readonly open?: (page: Page) => Promise<unknown>
  /** Only here may the invite open: anywhere else it would sit over the page. */
  readonly invite?: true
  /**
   * What takes the focus here and draws no ring, by decision, and why. Each is
   * measured for that — no ring anywhere around it —, and each has to come up.
   */
  readonly noRing?: Readonly<Record<string, string>>
}

/** A fight against the first leader, as a save records one. */
const FIGHT = { gymId: 1, seed: 7, engineVersion: ENGINE_VERSION, dexVersion: DEX_VERSION, team: TEAM, actions: [] }

const NO_DECK = [null, null, null, null, null, null]

/**
 * The states no page's own save draws. Each is here for a control that a
 * `:hover` rule styles and that lives only there — `hoverClasses` holds the ring
 * gate to that —, or for a control measured nowhere else: the palette's Close,
 * and the invite, whose sheet drew a ring once the bevel did.
 */
export const STATES: readonly Scene[] = [
  { name: 'the Hub with a fight on', address: '/', save: { ...saveFor('/'), battle: FIGHT }, ready: '.hub__give-up' },
  { name: 'the League with a deck to finish', address: '/league', save: { ...saveFor('/league'), deck: NO_DECK }, ready: '.league__action--empty' },
  {
    name: 'a gym while another fight is on',
    address: '/battle/2',
    save: { ...saveFor('/battle/2'), progress: { pity: 0, welcomeClaimed: 0, coins: 0, badges: 1, dailyClaimed: null }, battle: FIGHT },
    ready: '.battle__standing',
  },
  {
    name: 'the forge with a search typed',
    address: '/collection',
    save: saveFor('/collection'),
    // The walk starts at the first suggestion and goes on to the end of the page.
    // The field behind it is measured empty on the page itself: holding a search,
    // a `type="search"` field shows the browser's own clear button under focus.
    open: async (page) => {
      await page.locator('#forge-search').fill('char')
      await page.keyboard.press('Tab')
      await expect(page.locator('.collection__suggestion').first()).toBeFocused()
    },
  },
  {
    name: 'the search palette',
    address: '/pokedex/1',
    save: saveFor('/pokedex/1'),
    open: async (page) => {
      await page.locator('.dex-search__trigger').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('[role="dialog"] input')).toBeFocused()
    },
    noRing: { '[role="dialog"] input': 'the palette\'s field keeps Nuxt UI\'s `focus:outline-none`, and the caret marks it' },
  },
  {
    name: 'the account invite',
    address: '/',
    save: { ...saveFor('/'), progress: { pity: 0, welcomeClaimed: 3, coins: 300, badges: 1, dailyClaimed: null } },
    before: page => page.route('**/api/auth/get-session', route => route.fulfill({ json: null })),
    invite: true,
    open: page => expect(page.locator('.invite__card')).toBeFocused(),
    noRing: { '.invite__card': 'the sheet takes the focus to be read out, and is no stop of the Tab key: the *Convite de conta* board draws no ring on it' },
  },
  {
    name: 'an account',
    address: '/settings',
    save: saveFor('/settings'),
    before: async (page) => {
      await fakeSync(page, saveFor('/settings'))
      await seedSynced(page, { base: 1 })
    },
    ready: '.account__out',
  },
]

/** Each page of `app/pages`, as its own save draws it. */
export function pageScene(address: string): Scene {
  const scene: Scene = { name: address, address, save: saveFor(address) }
  if (address.startsWith('/battle/')) return { ...scene, open: page => expect(page.locator('.combatant'), 'the battle is being fought').toHaveCount(2) }
  return scene
}

/**
 * The scene's page, up and in the state: its routes, its save, its session, and
 * whatever brings the state about — in the order the walks always had.
 *
 * The page is the caller's, so the viewport and the media emulation are set
 * first. Another host's answer is refused: none of the walks depends on one, and
 * the barrier below would wait for the slowest of them.
 *
 * **Hydration is a barrier of its own.** `networkidle` says the network went
 * quiet, and a click or an Enter before the client has taken the page over runs
 * no handler at all — the press looks like it did nothing, and a walk that asks
 * where the focus ended up passes over a defect that never got to happen.
 */
export async function openScene(page: Page, scene: Scene, options: { origin: string, locale?: string }): Promise<void> {
  await page.route(url => url.origin !== options.origin, route => route.abort())
  await scene.before?.(page)
  // On every navigation, the scene's save: it lands in the state it is
  // measured in, whatever the page wrote before.
  await page.addInitScript(({ save, invite }) => {
    window.localStorage.setItem('holodeck:save', JSON.stringify(save))
    if (invite) window.localStorage.removeItem('holodeck:invite')
    else window.localStorage.setItem('holodeck:invite', '1')
  }, { save: scene.save, invite: scene.invite === true })

  await page.goto(localeUrl(scene.address, options.locale ?? defaultLocale()))
  await page.waitForLoadState('networkidle')
  await hydrated(page)
  await scene.open?.(page)
  if (scene.ready !== undefined) {
    await expect(page.locator(scene.ready).first(), `${scene.name}: the state is not on the screen`).toBeVisible()
  }
}

/** Waits for the client to take the page over: Nuxt says so, on the app it built. */
export function hydrated(page: Page): Promise<unknown> {
  return page.waitForFunction(() => {
    const app: unknown = Reflect.get(window, 'useNuxtApp')
    if (typeof app !== 'function') return false

    const nuxt: unknown = Reflect.apply(app, window, [])
    return typeof nuxt === 'object' && nuxt !== null && Reflect.get(nuxt, 'isHydrating') === false
  })
}

/** What one turn of a fight is, as the save records it. */
type Turn = { readonly kind: 'move', readonly slot: number } | { readonly kind: 'switch', readonly index: number }

/** The save of a weak team against the first leader: five forced switches, then a loss. */
function weakSave(actions: readonly Turn[]): Record<string, unknown> {
  const team = [10, 13, 129, 16, 4, 12]

  return saveWith({
    collection: Object.fromEntries(team.map(id => [id, { c: 1, s: 0 }])),
    deck: team,
    progress: { pity: 0, welcomeClaimed: 0, coins: PACK_PRICE * 2, badges: 0, dailyClaimed: null },
    battle: { gymId: 1, seed: 7, engineVersion: ENGINE_VERSION, dexVersion: DEX_VERSION, team, actions },
  })
}

/** How many actions the saved fight has — `null` once it is over, when the save drops it. */
async function savedTurns(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('holodeck:save')
    if (raw === null) return null

    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null || !('battle' in save)) return null

    const { battle } = save
    if (typeof battle !== 'object' || battle === null || !('actions' in battle)) return null

    return Array.isArray(battle.actions) ? battle.actions.length : null
  })
}

/**
 * Plays the weak team's fight through the screen until `stop` shows, and returns
 * what it played.
 *
 * **Recorded, and not written out.** A saved fight ends with its log: the save
 * drops it the moment the outcome is settled, so the state *after* the last
 * action cannot be read back — only played. Playing it once per run keeps the
 * seeds of the deep states from being lists of actions that age with the engine:
 * an engine that changes what a move does changes them too, and nobody types
 * them again.
 */
async function playFight(page: Page, stop: string): Promise<Turn[]> {
  await page.addInitScript((save) => {
    if (window.localStorage.getItem('holodeck:save') === null) {
      window.localStorage.setItem('holodeck:save', JSON.stringify(save))
    }
    window.localStorage.setItem('holodeck:invite', '1')
  }, weakSave([]))
  await page.goto('/battle/1')
  await expect(page.locator('.combatant'), 'the seeded fight did not resume').toHaveCount(2)

  const played: Turn[] = []
  while (!(await page.locator(stop).isVisible()) && played.length < 80) {
    if (await page.locator('.battle__forced').isVisible()) {
      const index = await page.locator('.battle__pill')
        .evaluateAll(pills => pills.findIndex(pill => pill instanceof HTMLButtonElement && !pill.disabled))
      await page.locator('.battle__pill').nth(index).click()
      played.push({ kind: 'switch', index })
    }
    else {
      await page.locator('.move').first().click()
      played.push({ kind: 'move', slot: 0 })
    }

    await expect
      .poll(async () => (await savedTurns(page)) === played.length || await page.locator('.battle__result').isVisible())
      .toBe(true)
  }

  await expect(page.locator(stop), `the weak team's fight never reached ${stop}`).toBeVisible()
  return played
}

/** The two deep states of a fight, as the actions that lead to them. */
export interface Fights {
  /** Up to the first fainted lead: the moves are gone and the bench is what the screen asks for. */
  readonly forced: readonly Turn[]
  /** Up to the loss: the result has taken the place of the choice. */
  readonly lost: readonly Turn[]
}

export async function recordFights(browser: Browser, baseURL: string): Promise<Fights> {
  const record = async (stop: string): Promise<Turn[]> => {
    // A context of its own each: what the first fight left in the storage would
    // be the second one's starting save.
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
    try {
      return await playFight(await context.newPage(), stop)
    }
    finally {
      await context.close()
    }
  }

  return { forced: await record('.battle__forced'), lost: await record('.battle__result') }
}

/**
 * Every state the walks that are about controls go through: the pages, the
 * states no page draws, and the deep ones — a fight at each of its phases, the
 * opening of a pack while it turns and once it is up, the deck with room to
 * spare, and the forge with the dust for what it was asked to make.
 *
 * The battle is the one page whose own scene is a **seeded** fight: with the
 * random seed of a fresh one, what a move does — and so which screen the press
 * lands on — would change from run to run.
 */
export function sceneList(fights: Fights): Scene[] {
  const pages = pageAddresses().map((address): Scene => (address.startsWith('/battle/')
    ? { name: 'the fight', address, save: { ...saveFor(address), battle: FIGHT }, ready: '.move' }
    : pageScene(address)))

  const opening = async (page: Page): Promise<void> => {
    // The button is markup until hydration: the press is retried until it opens.
    await expect(async () => {
      await page.locator('.packs__buy--gift').click()
      await expect(page.locator('.packs__progress')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
  }

  return [
    ...pages,
    ...STATES,
    { name: 'a fight whose lead faints on the first move', address: '/battle/1', save: weakSave([]), ready: '.move' },
    { name: 'a fight one move from its end', address: '/battle/1', save: weakSave(fights.lost.slice(0, -1)), ready: '.move' },
    { name: 'a fight asking for a switch', address: '/battle/1', save: weakSave(fights.forced), ready: '.battle__forced' },
    { name: 'a fight that was lost', address: '/battle/1', save: weakSave(fights.lost), ready: '.battle__result' },
    { name: 'a pack opening, turning', address: '/packs', save: saveFor('/packs'), open: opening },
    {
      name: 'a pack opening, all revealed',
      address: '/packs',
      save: saveFor('/packs'),
      open: async (page) => {
        await opening(page)
        // By class and not by name: the scene is opened in every language, and
        // the first button of the row that is not the primary one is the skip —
        // the link to the collection is an `<a>`.
        await page.locator('button.packs__skip:not(.packs__skip--primary)').first().click()
        await expect(page.locator('.packs__skip--primary')).toBeVisible()
      },
    },
    {
      name: 'the deck with room for more',
      address: '/deck',
      save: { ...saveFor('/deck'), deck: [...TEAM.slice(0, 3), null, null, null] },
      ready: '.deck__pick',
    },
    {
      name: 'the forge with a card chosen and the dust to make it',
      address: '/collection',
      // Charmander, the first suggestion for `char`, is a common.
      save: { ...saveFor('/collection'), dust: forgeCost('common') },
      open: async (page) => {
        await page.locator('#forge-search').fill('char')
        await page.locator('.collection__suggestion').first().click()
        await expect(page.locator('.collection__forge-button')).toBeEnabled()
      },
    },
  ]
}
