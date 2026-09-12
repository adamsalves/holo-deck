import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { FakeSync } from './support'
import { backups, fakeSync, localDust, saveWith, seedLocalSave, seedSynced } from './support'

/**
 * A metade de Ajustes que depende de conta — a prancha *Ajustes*, com sessão.
 *
 * O servidor é o mesmo `fakeSync` do sync, com a coluna anterior, o restaurar e a
 * exclusão de conta: interceptação do Playwright, sem nada de mentira dentro do
 * build que vai ao ar.
 */

/** A coleção da conta: seis espécies e 100 de pó. */
const CURRENT = saveWith({
  dust: 100,
  collection: {
    1: { c: 1, s: 0 },
    4: { c: 1, s: 0 },
    7: { c: 1, s: 0 },
    25: { c: 1, s: 0 },
    133: { c: 1, s: 0 },
    143: { c: 1, s: 0 },
  },
})

/** A anterior do servidor: três espécies e 50 de pó. */
const OLDER = saveWith({
  dust: 50,
  collection: { 1: { c: 1, s: 0 }, 4: { c: 1, s: 0 }, 7: { c: 1, s: 0 } },
})

/** Um aparelho acertado na versão 2, com a anterior do servidor guardada. */
async function syncedDevice(page: Page): Promise<FakeSync> {
  const sync = await fakeSync(page, CURRENT, { previous: OLDER })
  await seedLocalSave(page, CURRENT)
  await seedSynced(page, { base: 2 })
  return sync
}

test('com conta, o título é da conta, e o painel mostra quem e o estado do sync', async ({ page }) => {
  await syncedDevice(page)
  await page.goto('/settings')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sua conta e seu save')
  await expect(page.getByText('e2e@exemplo.invalido')).toBeVisible()
  await expect(page.locator('.settings__sync')).toContainText('sincronizado')
  await expect(page.getByRole('button', { name: 'EXCLUIR TUDO' })).toBeVisible()
})

test('restaurar a versão anterior troca pela anterior, e a linha passa a oferecer a de antes', async ({ page }) => {
  const sync = await syncedDevice(page)
  await page.goto('/settings')

  const row = page.locator('.settings__row', { hasText: 'Restaurar versão anterior' })
  await expect(row).toContainText('3 cartas')

  await row.getByRole('button', { name: 'Restaurar a versão anterior do servidor' }).click()

  await expect(page.locator('.settings__notice')).toContainText('Versão anterior restaurada — 3 cartas')
  await expect.poll(() => localDust(page)).toBe(50)
  expect(sync.current()?.version, 'restaurar sobe a versão').toBe(3)

  // Desfazível: a que estava no ar virou a anterior, e é ela que a linha oferece.
  await expect(row).toContainText('6 cartas')
})

/**
 * Que o save vazio **não sobe** é o teste de unidade do `SyncDriver` que prova —
 * aqui não há sinal que venha depois do envio que não deveria acontecer. O que o
 * navegador prova é a travessia: a pergunta, a cópia, e a coleção da conta de
 * volta na tela.
 */
test('apagar o save deste aparelho, com conta: o da conta volta, e o daqui fica na cópia', async ({ page }) => {
  await syncedDevice(page)
  await page.goto('/settings')
  await expect(page.locator('.settings__sync')).toContainText('sincronizado')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('O da sua conta volta em seguida')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'APAGAR LOCAL' }).click()

  await expect(page.locator('.settings__notice')).toContainText('o da conta voltou — 6 cartas')
  await expect.poll(() => localDust(page)).toBe(100)
  expect((await backups(page)).some(raw => raw.includes('"dust":100'))).toBe(true)
})

test('excluir a conta com a sessão velha pede entrar de novo, e nada muda', async ({ page }) => {
  const sync = await syncedDevice(page)
  sync.staleSession()
  await page.goto('/settings')

  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'EXCLUIR TUDO' }).click()

  await expect(page.locator('.settings__notice')).toContainText('pede uma entrada recente')
  await expect(page.getByText('e2e@exemplo.invalido')).toBeVisible()
  expect(sync.current(), 'o save da conta continua lá').not.toBeNull()
})

test('excluir a conta sai dela, e o save deste aparelho fica', async ({ page }) => {
  const sync = await syncedDevice(page)
  await page.goto('/settings')
  await expect(page.getByText('e2e@exemplo.invalido')).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('O save deste aparelho continua aqui')
    await dialog.accept()
  })

  // A barreira é a recarga: a exclusão esquece a conta e volta para a raiz.
  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
    page.getByRole('button', { name: 'EXCLUIR TUDO' }).click(),
  ])

  await expect(page.locator('.nav').getByRole('link', { name: 'Entrar' })).toBeVisible()
  await expect.poll(() => localDust(page), 'a coleção deste aparelho continua jogável').toBe(100)
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:syncedWith'))).toBeNull()
  expect(sync.current(), 'o servidor não tem mais o save').toBeNull()
})
