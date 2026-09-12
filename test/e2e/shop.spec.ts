import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { SaveData } from '../../shared/save/schema.ts'
import { isSaveData } from '../../shared/save/schema.ts'
import { skipInvite } from './support'

/**
 * A loja, as regras e os ajustes num navegador de verdade.
 *
 * O que só o E2E prova aqui é a **checagem `F6 · loja e regras`** do plano, e
 * ela tem duas metades que se olham: comprar um pack por 150 moedas debita o
 * saldo e credita as cartas *nesta ordem*, e `/rules` exibe os números do jogo
 * sem que nenhum deles esteja escrito no `.vue` — o que o portão de
 * `rules-gate.spec.ts` afirma lendo o disco, e este afirma lendo a tela.
 *
 * Os dois lados são necessários: o portão sozinho passaria numa página que não
 * renderiza nada, e este sozinho passaria numa página com os números digitados.
 */

/**
 * Um save plantado antes do boot — com moedas, e sem os packs de boas-vindas.
 *
 * Vencer um ginásio para ter 150 moedas levaria a suíte da loja por dentro da
 * batalha inteira, e o que ela precisa provar é o débito. Plantar o save exercita
 * de quebra o caminho que mais assusta: o guarda e a migração aceitando um
 * documento na versão corrente escrito por fora.
 */
async function seedSave(page: Page, coins: number): Promise<void> {
  await page.addInitScript((amount) => {
    window.localStorage.setItem('holodeck:save', JSON.stringify({
      schemaVersion: 4,
      collection: {},
      dust: 0,
      deck: [null, null, null, null, null, null],
      progress: {
        pity: 0,
        welcomeClaimed: 3,
        coins: amount,
        badges: 0,
        dailyClaimed: null,
      },
      battle: null,
    }))
  }, coins)
}

/**
 * O save do navegador, passado pelo **guarda de verdade**.
 *
 * `isSaveData` e não uma interface local: `JSON.parse` devolve `any`, que o lint
 * proíbe em todo o repositório, e o guarda resolve o tipo e afirma algo de
 * quebra — que o documento gravado pelo jogo continua sendo um save válido. Uma
 * forma escrita à mão aqui aceitaria um save que o próprio boot recusaria.
 */
async function readSave(page: Page): Promise<SaveData> {
  const raw = await page.evaluate(() => window.localStorage.getItem('holodeck:save'))
  const parsed: unknown = JSON.parse(raw ?? 'null')

  if (!isSaveData(parsed)) throw new Error(`o save gravado não passa no guarda: ${raw}`)

  return parsed
}

function copies(save: SaveData): number {
  return Object.values(save.collection).reduce((total, entry) => total + entry.c, 0)
}

test('comprar um pack debita 150 e credita dez cartas', async ({ page }) => {
  await seedSave(page, 400)
  // Ver `skipInvite`: um ultra sorteado abre um modal por cima da tela.
  await skipInvite(page)
  await page.goto('/packs')

  await expect(page.getByRole('heading', { level: 1, name: 'Packs' })).toBeVisible()

  // Os três cartões escrevem `ABRIR` ou um preço, e o rótulo visível não
  // distingue um do outro para quem não vê a fileira. Aqui só há dois — as
  // boas-vindas já foram no save plantado.
  await expect(page.getByRole('button', { name: 'Abrir pack diário' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Comprar Pack Holo por 150 moedas' })).toBeVisible()

  // O cartão da loja diz o que sobra e quantos cabem, e os dois saem da mesma
  // divisão — a prancha escreve `restam 1.090 · dá para 8` com outro saldo.
  await expect(page.locator('.packs__offer-meta').last()).toContainText('restam 250')
  await expect(page.locator('.packs__offer-meta').last()).toContainText('dá para 2')

  const antes = await readSave(page)
  expect(antes.progress.coins).toBe(400)
  expect(copies(antes)).toBe(0)

  await expect(async () => {
    await page.locator('.packs__buy--coin').click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await expect(page.locator('.opener__slot')).toHaveCount(10)

  // As duas metades do que a ordem de escrita promete: o saldo caiu exatamente o
  // preço, e as dez cartas estão no save. Uma falha entre as duas daria cartas
  // de graça — nunca moedas cobradas por nada.
  const depois = await readSave(page)
  expect(depois.progress.coins).toBe(250)
  expect(copies(depois)).toBe(10)
})

test('sem saldo, o botão da loja fecha e diz quanto falta', async ({ page }) => {
  await seedSave(page, 90)
  await page.goto('/packs')

  await expect(page.locator('.packs__buy--coin')).toBeDisabled()
  await expect(page.locator('.packs__offer-meta').last()).toHaveText('faltam 60 moedas')
})

test('o pack diário sai de graça, some da loja e volta a contar', async ({ page }) => {
  await seedSave(page, 0)
  // Depois da revelação este teste **clica** — em `.packs__skip--primary` —, e é
  // aí que o convite intercepta o ponteiro. Ver `skipInvite`.
  await skipInvite(page)
  await page.goto('/packs')

  // Dois cartões: o diário e o da loja. As boas-vindas já foram no save plantado.
  await expect(page.locator('.packs__offer')).toHaveCount(2)

  await expect(async () => {
    await page.locator('.packs__buy--daily').click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  const depois = await readSave(page)
  expect(copies(depois)).toBe(10)
  // Grátis: o saldo não se mexeu, e o dia ficou marcado.
  expect(depois.progress.coins).toBe(0)
  expect(depois.progress.dailyClaimed).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  /**
   * E é o dia **local** do aparelho, não o UTC.
   *
   * Afirmar só o formato deixava passar exatamente a regressão que a decisão do
   * pack diário existe para impedir: `toISOString().slice(0, 10)` também casa
   * com essa regex, e a oeste de Greenwich ele carimba o dia seguinte a partir
   * das 21h. O dia local é calculado no próprio navegador para o teste não
   * depender do fuso de quem roda a suíte.
   */
  const hojeLocal = await page.evaluate(() => {
    const agora = new Date()
    const mes = String(agora.getMonth() + 1).padStart(2, '0')
    const dia = String(agora.getDate()).padStart(2, '0')
    return `${agora.getFullYear()}-${mes}-${dia}`
  })
  expect(depois.progress.dailyClaimed).toBe(hojeLocal)

  // De volta à loja, o cartão do diário saiu e o contador tomou o lugar dele.
  await page.locator('.packs__skip--primary').click()
  await expect(page.locator('.packs__offer')).toHaveCount(1)
  await expect(page.locator('.packs__timer')).toContainText('próximo em')
})

/**
 * **Dois packs abertos em sequência não podem ser iguais.**
 *
 * A seed de `openPack` é o relógio, e a precisão dela é a coisa inteira: com um
 * relógio de segundo em segundo, dois cliques dentro do mesmo tique recebem a
 * mesma seed — e a mesma seed, sobre o mesmo pool, é exatamente as mesmas dez
 * cartas. Foi o defeito que a primeira versão desta tela tinha, quando a seed
 * passou a sair do `ref` reativo que alimenta o contador do diário.
 *
 * O caminho que encosta nisso é o **normal**, não o patológico: `ABRIR O
 * PRÓXIMO` encadeia os três packs de estreia, e nada obriga o jogador a esperar
 * um segundo entre eles.
 *
 * Duas tiras de dez saírem iguais por acaso, sobre ~500 comuns, é
 * astronomicamente improvável — a asserção não é frágil, é a definição do
 * defeito.
 */
test('dois packs abertos em sequência não saem idênticos', async ({ page }) => {
  // O clique imediato do segundo pack é a coisa inteira deste teste, e é
  // exatamente o clique que o convite engole. Ver `skipInvite`.
  await skipInvite(page)
  await page.goto('/packs')

  const sprites = async (): Promise<string[]> =>
    page.locator('.opener__slot img').evaluateAll(images =>
      images.map(image => image.getAttribute('src') ?? ''))

  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await expect(page.locator('.opener__slot')).toHaveCount(10)
  const primeiro = await sprites()

  // Sem pausa nenhuma: é o clique imediato que o defeito exige.
  await page.locator('.packs__skip--primary').click()
  await expect(page.locator('.opener__slot')).toHaveCount(10)
  const segundo = await sprites()

  expect(primeiro).toHaveLength(10)
  expect(segundo).not.toEqual(primeiro)
})

/**
 * `/rules` renderizando o que os módulos dizem.
 *
 * A checagem do plano nomeia estes números — pity, shiny, os limiares de
 * raridade e a tabela de forja —, e o par deste teste é o portão que garante que
 * nenhum deles está escrito na página.
 */
test('as regras exibem os números do jogo, vindos dos módulos', async ({ page }) => {
  await page.goto('/rules')

  await expect(page.getByRole('heading', { level: 1, name: 'Regras' })).toBeVisible()

  const rules = page.locator('.rules')
  await expect(rules).toContainText('BST < 475')
  await expect(rules).toContainText('475 – 528')
  await expect(rules).toContainText('529 – 580')
  await expect(rules).toContainText('10 packs')
  await expect(rules).toContainText('1 / 256')
  await expect(rules).toContainText('80% / 15% / 4,5% / 0,5%')
  await expect(rules).toContainText('400 · 1.600')
  await expect(rules).toContainText('200 + 100×n')
  await expect(rules).toContainText('6.300')

  // O passo 5 da ordem do turno **corrige a prancha**, que escreve "no zero o
  // golpe fica inselecionável". O motor cai em Struggle por slot.
  await expect(rules).toContainText('vira Struggle')
})

test('o interruptor de animação atravessa o reload', async ({ page }) => {
  await page.goto('/settings')

  // Por papel e por nome, e não pela classe: o que este teste também guarda é
  // que o controle **tem** nome acessível. O texto de dentro dele é o estado
  // (`ligado`/`desligado`), e sem `aria-label` o leitor de tela anunciaria o
  // estado no lugar do rótulo.
  const toggle = page.getByRole('switch', { name: 'Reduzir animações' })

  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  await page.reload()

  // O que precisa sobreviver não é só o estado da tela: é o carimbo no `<html>`,
  // que é o que a folha de estilo observa. Ele é escrito pelo plugin no boot.
  await expect(page.locator('.settings__switch')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '')
})

/**
 * Apagar o save **guarda a cópia antes**, e é a regra inegociável do plano
 * aplicada ao caminho voluntário.
 *
 * O que se prova aqui é a ordem: a chave principal sai e a de backup entra. Sem
 * ela, um clique acidental na zona de perigo custa a coleção inteira e não há
 * segunda cópia em lugar nenhum — não existe conta ainda.
 */
test('apagar o save deixa a cópia de segurança para trás', async ({ page }) => {
  await seedSave(page, 500)
  await page.goto('/settings')

  await expect(page.locator('.settings__stat-value').first()).toBeVisible()

  page.on('dialog', dialog => dialog.accept())
  await page.locator('.settings__action--danger').click()

  await expect(page.locator('.settings__notice')).toContainText('Save apagado')

  const keys = await page.evaluate(() => Object.keys(window.localStorage))
  expect(keys.filter(key => key.startsWith('holodeck:backup:'))).toHaveLength(1)

  // E o jogo recomeça do zero, sem moeda e sem carta.
  const depois = await readSave(page)
  expect(depois.progress.coins).toBe(0)
  expect(copies(depois)).toBe(0)
})

/**
 * Importar: os quatro ramos, e o que cada um faz com o save que já está lá.
 *
 * **Nenhum deles tinha cobertura.** É a fronteira mais arriscada do PR — um
 * arquivo escolhido pelo jogador substituindo a coleção inteira —, e `apagar`
 * tinha e2e enquanto `importar` não tinha nada. Os três ramos de erro precisam
 * provar a mesma coisa: a mensagem certa **e o save intacto**.
 */
async function escolherArquivo(page: Page, nome: string, conteudo: string): Promise<void> {
  await page.locator('.settings__file').setInputFiles({
    name: nome,
    mimeType: 'application/json',
    buffer: Buffer.from(conteudo, 'utf8'),
  })
}

test('importar um arquivo ilegível não toca no save, e diz por quê', async ({ page }) => {
  await seedSave(page, 500)
  await page.goto('/settings')
  await expect(page.locator('.settings__stat-value').first()).toBeVisible()

  // Ramo 1: não é JSON.
  await escolherArquivo(page, 'quebrado.json', '{"collection":')
  await expect(page.locator('.settings__notice')).toContainText('não é um JSON válido')
  expect((await readSave(page)).progress.coins).toBe(500)

  // Ramo 2: JSON válido, forma errada — a migração não o reconhece.
  await escolherArquivo(page, 'forma.json', '{"foo":"bar"}')
  await expect(page.locator('.settings__notice')).toContainText('não pôde ser lido')
  expect((await readSave(page)).progress.coins).toBe(500)

  // Ramo 3: versão futura. Ela é **recusada**, e não adivinhada — a mensagem
  // diz que tem conserto, porque tem: é só atualizar o jogo.
  await escolherArquivo(page, 'futuro.json', JSON.stringify({ schemaVersion: 99, collection: {} }))
  await expect(page.locator('.settings__notice')).toContainText('versão mais nova')
  expect((await readSave(page)).progress.coins).toBe(500)

  // E nenhum dos três deixou cópia de segurança para trás: nada foi
  // sobrescrito, então não havia o que guardar.
  const chaves = await page.evaluate(() => Object.keys(window.localStorage))
  expect(chaves.filter(key => key.startsWith('holodeck:backup:'))).toHaveLength(0)
})

test('e o mesmo arquivo pode ser escolhido de novo depois de um erro', async ({ page }) => {
  await seedSave(page, 500)
  await page.goto('/settings')
  await expect(page.locator('.settings__stat-value').first()).toBeVisible()

  await escolherArquivo(page, 'igual.json', '{"collection":')
  await expect(page.locator('.settings__notice')).toContainText('não é um JSON válido')

  /**
   * O `<input type="file">` precisa ter sido reiniciado no caminho de erro.
   *
   * Sem isso, escolher o **mesmo** arquivo de novo não dispara `change` — e é no
   * erro que repetir o mesmo caminho é mais provável: o jogador re-exporta por
   * cima e tenta outra vez. O segundo arquivo aqui é válido e tem nome igual,
   * que é o caso exato que ficava travado.
   */
  await escolherArquivo(page, 'igual.json', JSON.stringify({
    schemaVersion: 4,
    collection: { 25: { c: 2, s: 0 } },
    dust: 0,
    deck: [null, null, null, null, null, null],
    progress: { pity: 0, welcomeClaimed: 3, coins: 77, badges: 0, dailyClaimed: null },
    battle: null,
  }))

  await expect(page.locator('.settings__notice')).toContainText('Save importado')
  expect((await readSave(page)).progress.coins).toBe(77)
})

test('importar guarda o save anterior, e dá para voltar por ele', async ({ page }) => {
  await seedSave(page, 500)
  await page.goto('/settings')
  await expect(page.locator('.settings__stat-value').first()).toBeVisible()

  await escolherArquivo(page, 'outro.json', JSON.stringify({
    schemaVersion: 4,
    collection: { 25: { c: 1, s: 0 } },
    dust: 0,
    deck: [null, null, null, null, null, null],
    progress: { pity: 0, welcomeClaimed: 3, coins: 12, badges: 0, dailyClaimed: null },
    battle: null,
  }))

  await expect(page.locator('.settings__notice')).toContainText('Save importado')
  expect((await readSave(page)).progress.coins).toBe(12)

  /**
   * A volta — o caminho que a interface prometia e o produto não tinha.
   *
   * As duas telas dizem "uma cópia de segurança fica guardada", e até aqui a
   * única forma de alcançá-la era pelo DevTools. Restaurar guarda o save de
   * agora antes, então a operação é reversível nos dois sentidos.
   */
  const restaurar = page.getByRole('button', { name: /^Restaurar a cópia de/ })
  await expect(restaurar).toHaveCount(1)
  await restaurar.click()

  await expect(page.locator('.settings__notice')).toContainText('Cópia restaurada')
  expect((await readSave(page)).progress.coins).toBe(500)

  // E o save importado virou a cópia mais recente: nada se perdeu na troca.
  await expect(page.getByRole('button', { name: /^Restaurar a cópia de/ })).toHaveCount(2)
})

test('e o arquivo grande demais é recusado antes de ser lido', async ({ page }) => {
  await seedSave(page, 500)
  await page.goto('/settings')
  await expect(page.locator('.settings__stat-value').first()).toBeVisible()

  // Dois megabytes de JSON válido. O save realista tem ~3 KB, e o pior caso
  // documentado 21 KB — o teto existe para a aba não morrer lendo o arquivo
  // inteiro para a memória antes de o `JSON.parse` ter chance de recusá-lo.
  const gigante = `{"lixo":"${'x'.repeat(2_000_000)}"}`
  await escolherArquivo(page, 'gigante.json', gigante)

  await expect(page.locator('.settings__notice')).toContainText('grande demais')
  expect((await readSave(page)).progress.coins).toBe(500)
})
