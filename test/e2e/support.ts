import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SCHEMA_VERSION } from '../../shared/save/schema.ts'

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
  await page.goto('/packs')

  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
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
   * teste que mais precisa dela: provar que um boot já acertado **não** lê o save
   * é provar uma ausência, e `gets()` não cresce para ancorá-la. Este cresce — a
   * sessão é lida em todo boot, antes da decisão —, então esperar por ele é
   * esperar o plugin ter chegado ao ponto em que leria. Era um
   * `waitForTimeout(1500)`, que é a mesma forma de falso verde que esta suíte
   * corrigiu nos outros testes: numa máquina lenta ele dá verde com o defeito.
   */
  sessions: () => number
  /**
   * Quantas leituras o cliente fez.
   *
   * **É o sinal que ancora as asserções de ausência.** `toHaveCount(0)` passa no
   * instante em que roda, então "a tela não apareceu" é verde antes de o plugin
   * assíncrono ter tido chance de mostrá-la — o portão dava verde com o defeito
   * reintroduzido. Esperar o `GET` acontecer é esperar a decisão ser tomada.
   *
   * E ele mede a coisa certa por construção: o boot já acertado com a conta sai
   * **antes** de ler, então um `GET` a mais é exatamente o defeito.
   */
  gets: () => number
  /** O que o servidor tem agora — nulo quando ninguém subiu nada. */
  current: () => StoredSave | null
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
 */
export async function fakeSync(page: Page, remote: unknown | null = null): Promise<FakeSync> {
  let stored: StoredSave | null = remote === null
    ? null
    : { data: remote, version: 1, updatedAt: '2026-09-01T12:00:00.000Z' }

  const puts: { data: unknown, baseVersion: number }[] = []
  let gets = 0
  let sessions = 0
  let signedOut = false

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

    if (body.baseVersion !== (stored?.version ?? 0)) {
      await route.fulfill({ status: 409, json: { data: stored } })
      return
    }

    stored = {
      data: body.data,
      version: (stored?.version ?? 0) + 1,
      updatedAt: '2026-09-10T12:00:00.000Z',
    }
    await route.fulfill({ json: { version: stored.version, updatedAt: stored.updatedAt } })
  })

  return { puts, gets: () => gets, sessions: () => sessions, current: () => stored }
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
