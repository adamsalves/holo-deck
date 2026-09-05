import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { SaveData } from '../../shared/save/schema.ts'
import { isSaveData } from '../../shared/save/schema.ts'

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
  await page.goto('/packs')

  await expect(page.getByRole('heading', { level: 1, name: 'Packs' })).toBeVisible()

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

  // De volta à loja, o cartão do diário saiu e o contador tomou o lugar dele.
  await page.locator('.packs__skip--primary').click()
  await expect(page.locator('.packs__offer')).toHaveCount(1)
  await expect(page.locator('.packs__timer')).toContainText('próximo em')
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

  const toggle = page.getByRole('switch', { name: /Reduzir animações|ligado|desligado/i })
    .or(page.locator('.settings__switch'))
    .first()

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
