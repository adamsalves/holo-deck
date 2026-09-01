import { expect, test } from '@playwright/test'

/**
 * O que só o navegador prova.
 *
 * A suíte unitária cobre a regra (raridade, matriz, condição de evolução) e os
 * portões cobrem a disciplina. O que sobra para o E2E é o comportamento que
 * depende de hidratação, rolagem e teclado — e é exatamente onde esta fase tem
 * as decisões mais delicadas: o grid que troca de forma depois de montar, e a
 * paleta que só carrega o índice quando abre.
 *
 * Roda contra `yarn preview`, ou seja, contra o build pré-renderizado — que é o
 * artefato que a Vercel serve, não o servidor de desenvolvimento.
 */

test('o índice leva à região e a região leva à espécie', async ({ page }) => {
  await page.goto('/pokedex')

  await expect(page.getByRole('heading', { level: 1, name: 'Pokédex' })).toBeVisible()

  await page.getByRole('link', { name: /Kanto/ }).click()
  await expect(page).toHaveURL(/\/pokedex\/1$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Kanto' })).toBeVisible()

  await page.getByRole('link', { name: /^Charizard,/ }).click()
  await expect(page).toHaveURL(/\/pokemon\/charizard$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Charizard' })).toBeVisible()
})

test('o HTML servido já traz um link por espécie, antes de qualquer JavaScript', async ({ page }) => {
  // A razão de o grid ser renderizado inteiro no servidor. Com JavaScript
  // desligado o que resta é o HTML que o rastreador lê — e ele precisa conter
  // as 151, não as 18 que a versão virtualizada mostra.
  await page.context().addInitScript(() => {})
  const response = await page.request.get('/pokedex/1')
  const html = await response.text()

  const links = html.match(/href="\/pokemon\/[a-z0-9-]+"/g) ?? []

  expect(new Set(links).size).toBe(151)
})

test('o grid virtualiza depois de montar — o DOM não segura as 151', async ({ page }) => {
  await page.goto('/pokedex/1')
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  const noDom = await page.locator('a.dex-card').count()
  expect(noDom).toBeGreaterThan(0)
  expect(noDom).toBeLessThan(151)

  // Rolar troca quem está no DOM sem trocar quantos.
  await page.evaluate(() => window.scrollTo(0, 3000))
  await page.waitForFunction(() => !document.querySelector('a[aria-label^="Bulbasaur,"]'))

  expect(await page.locator('a.dex-card').count()).toBeLessThan(151)
})

test('os filtros de tipo e raridade compõem — OU dentro do grupo, E entre eles', async ({ page }) => {
  await page.goto('/pokedex/1')
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  const contador = page.getByRole('button', { name: /^Todos/ })
  await expect(contador).toHaveText(/151$/)

  // Kanto tem 12 espécies de fogo.
  await page.getByRole('button', { name: 'Fogo', exact: true }).click()
  await expect(contador).toHaveText(/12 de 151/)

  // Ligar um segundo tipo amplia — é OU dentro do grupo.
  await page.getByRole('button', { name: 'Água', exact: true }).click()
  await expect(contador).toHaveText(/44 de 151/)

  // Ligar raridade restringe — é E entre os grupos.
  await page.getByRole('button', { name: 'Raro', exact: true }).click()
  const comRaridade = await page.locator('a.dex-card').count()
  expect(comRaridade).toBeGreaterThan(0)
  expect(comRaridade).toBeLessThan(44)

  // A chip Todos limpa os dois grupos.
  await contador.click()
  await expect(contador).toHaveText(/151$/)
})

test('a busca abre por atalho, filtra e navega', async ({ page }) => {
  await page.goto('/pokedex/1')

  // O atalho só existe depois da hidratação — `goto` resolve no `load`, que é
  // antes. Sem esta espera o teste falha por corrida e não por defeito.
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // A paleta só busca `index.json` quando abre — 15 KB que a maioria das visitas
  // nunca precisa. Digitar antes de ele chegar filtra uma lista vazia, e é o que
  // um usuário rápido faria também: esperar a primeira opção é esperar o índice.
  await expect(dialog.getByRole('option').first()).toBeVisible()

  await dialog.getByPlaceholder('Nome, número ou tipo…').fill('gengar')
  await expect(dialog.getByRole('option', { name: /Gengar/ })).toBeVisible()

  await dialog.getByRole('option', { name: /Gengar/ }).first().click()
  await expect(page).toHaveURL(/\/pokemon\/gengar$/)
})

test('a espécie mostra stats, relações de dano e a linha evolutiva', async ({ page }) => {
  await page.goto('/pokemon/charizard')

  // As asserções são feitas **dentro do painel**, e não na página: com
  // `unmount-on-hide` desligado os três ficam no DOM ao mesmo tempo, e um
  // `getByText('BST 534')` solto casa também a carta do Charizard na linha
  // evolutiva. É a mesma decisão que põe o conteúdo das três abas no HTML.
  await page.getByRole('tab', { name: 'Stats' }).click()
  const stats = page.getByRole('tabpanel', { name: 'Stats' })

  await expect(stats.getByText('BST 534')).toBeVisible()
  await expect(stats.getByText('Recebe mais dano')).toBeVisible()
  await expect(stats.getByText('×4', { exact: true })).toBeVisible()
  await expect(stats.getByText('×0', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Evolução' }).click()
  const evolution = page.getByRole('tabpanel', { name: 'Evolução' })

  await expect(evolution.getByRole('link', { name: /Charmander/ })).toBeVisible()
  await expect(evolution.getByText('Nível 16')).toBeVisible()
})

test('espécie que não existe responde 404, e não uma página vazia', async ({ page }) => {
  const response = await page.goto('/pokemon/missingno')

  expect(response?.status()).toBe(404)
})
