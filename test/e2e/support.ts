import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SCHEMA_VERSION } from '../../shared/save/schema.ts'
import { isSyncBody } from '../../shared/save/sync.ts'

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
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
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
     * 03 do indicador (*N mudanças na fila*) **sem** falta de rede, que é
     * exatamente a divergência da prancha que o README registra neste PR.
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
