import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fakeSync, saveWith, seedLocalSave, seedSynced } from './support'

/**
 * O convite de conta — a prancha *Convite de conta*, num navegador de verdade.
 *
 * O que o navegador prova é a regra inteira atravessando o boot: sem conta, com
 * carta, uma vez por aparelho, e recusável. Dos três pedidos, os dois de evento —
 * a vitória e o pack que trouxe ultra — dependem de sorteio; o que se percorre
 * aqui é o do Hub, que cobre quem já cumpria antes de o convite existir e passa
 * pelo mesmo `AccountInvite` que os outros dois.
 */

/** Quem já venceu o primeiro ginásio, com três espécies e uma delas shiny. */
const WINNER = saveWith({
  collection: { 1: { c: 2, s: 1 }, 4: { c: 1, s: 0 }, 7: { c: 1, s: 0 } },
  progress: { pity: 0, welcomeClaimed: 3, coins: 300, badges: 1, dailyClaimed: null },
})

/** Sem sessão, de propósito e sem depender do servidor de verdade. */
async function anonymous(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({ json: null })
  })
}

function invite(page: Page) {
  return page.getByRole('dialog', { name: /Sua coleção existe/ })
}

test('quem já venceu um ginásio vê o convite no Hub, com o que está em jogo', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await expect(invite(page)).toBeVisible()

  // Espécie nas duas contas: duas cópias do Bulbasaur, uma shiny, contam uma.
  await expect(page.locator('.invite__number--cards')).toHaveText('3')
  await expect(page.locator('.invite__number--shiny')).toHaveText('1')
  await expect(page.locator('.invite__number--badges')).toHaveText('1')
})

test('recusado, ele não volta — uma vez por aparelho', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await invite(page).getByRole('button', { name: 'Agora não' }).click()
  await expect(invite(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:invite'))).not.toBeNull()

  /**
   * **A barreira é o *Entrar* da recarga.** Ele só aparece depois de a sessão ser
   * lida, e é a mesma leitura que o convite espera para decidir: quando ele está
   * na tela, o convite já teve a chance dele. Sem isto, a ausência seria medida
   * antes de o pedido do Hub existir.
   */
  await page.reload()
  await expect(page.locator('.nav').getByRole('link', { name: 'Entrar' })).toBeVisible()
  await expect(invite(page)).toHaveCount(0)
})

test('Escape recusa, como o Agora não', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await expect(invite(page)).toBeVisible()

  /**
   * **O foco dentro da folha é o que faz o Escape chegar ao diálogo** — evento de
   * teclado sobe, e do `body` ele nunca entraria. É também a metade que torna o
   * `aria-modal` verdadeiro, e foi o que faltou: medido no navegador, o
   * `document.activeElement` era `BODY` e o Escape não fechava nada.
   */
  await expect(page.locator('.invite__card')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(invite(page)).toHaveCount(0)
})

test('CRIAR CONTA leva à tela de entrar', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await invite(page).getByRole('link', { name: 'CRIAR CONTA' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A conta guarda')
  await expect(invite(page)).toHaveCount(0)
})

/**
 * O convite só existe para quem não tem conta — e um aparelho que já viu uma
 * sessão se marca, para o convite não mentir no dia em que a sessão não puder ser
 * lida. A marca é o sinal positivo: ela é escrita pela mesma leitura que decide.
 */
test('com conta, o convite não aparece — e o aparelho fica marcado', async ({ page }) => {
  await fakeSync(page, WINNER)
  await seedLocalSave(page, WINNER)
  await seedSynced(page, { base: 1 })
  await page.goto('/')

  await expect(page.locator('.nav').getByText('Conectada como Treinadora Ash')).toBeAttached()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('holodeck:invite'))).not.toBeNull()
  await expect(invite(page)).toHaveCount(0)
})
