import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { GYM_LEADERS } from '../../shared/game/gyms.ts'
import { fakeSync, saveWith, seedLocalSave } from './support'

/**
 * O time do líder aparece — no Hub e na Liga —, pela porta que o jogador usar.
 *
 * **Ele sumia para todo jogador sem insígnia desde a `v0.7.0`, e nenhum teste
 * olhava para esta fileira.** `useLeague` devolvia o time num `Map`; no
 * pré-render o Nuxt 4 reaproveita o resultado de uma chave entre as páginas que a
 * usam, num storage que só guarda JSON, e a segunda página gerada recebia `null`.
 * O cliente trata `null` como dado já carregado e nunca buscava. Com uma insígnia
 * a chave muda e a busca acontece — por isso o defeito só existia na estreia, que
 * é justamente a tela que todo jogador vê primeiro.
 *
 * Achado em produção, testando o primeiro login numa janela anônima. O portão
 * que lê o payload, e pega a classe inteira, é `prerender-payload.spec.ts`.
 *
 * Cada teste é uma porta diferente para o mesmo dado, e o `null` chegava a cada
 * uma por um caminho diferente do Nuxt: a carga direta pela hidratação, a
 * navegação interna pelo `_payload.json` da rota. **Hoje quem perdia era o Hub;
 * a Liga está aqui porque é a ordem do pré-render que decide quem perde**, e com
 * a ordem invertida ela seria a vítima — este teste não tem como ser provado
 * contra a ordem atual, e quem cobre esse lado de verdade é o portão do payload.
 */

const FIRST = GYM_LEADERS.find(leader => leader.gym === 1)
if (FIRST === undefined) throw new Error('a Liga ficou sem o primeiro líder')

/** Quantos o time da estreia tem — da regra, e não de um número escrito aqui. */
const TEAM = FIRST.teamSize

function hubTeam(page: Page): Locator {
  return page.locator('.hub__team-slot')
}

test('carga direta do Hub, sem conta: o time do líder aparece', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hub')).toBeVisible()

  await expect.poll(() => hubTeam(page).count()).toBe(TEAM)
})

test('chegar ao Hub por outra página: o time do líder aparece', async ({ page }) => {
  await page.goto('/packs')
  await expect(page.locator('.packs__offers')).toBeVisible()

  await page.locator('.nav').getByRole('link', { name: 'Base' }).click()
  await expect(page.locator('.hub')).toBeVisible()

  await expect.poll(() => hubTeam(page).count()).toBe(TEAM)
})

test('depois de adotar o save da conta: o time do líder continua no Hub', async ({ page }) => {
  // Sem insígnia, como estava em produção: com insígnia a chave muda e o
  // defeito não aparece.
  const sync = await fakeSync(page, saveWith({
    collection: { 1: { c: 1, s: 0 }, 25: { c: 1, s: 0 }, 133: { c: 1, s: 0 } },
    progress: { pity: 0, welcomeClaimed: 3, coins: 0, badges: 0, dailyClaimed: null },
  }))
  await seedLocalSave(page, saveWith())

  await page.goto('/')
  await expect(page.locator('.hub')).toBeVisible()

  // A adoção terminou quando o acerto é marcado; só depois disso o time prova
  // alguma coisa sobre ela.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('holodeck:syncedWith'))).toBe('e2e')
  expect(sync.gets()).toBe(1)

  await expect.poll(() => hubTeam(page).count()).toBe(TEAM)
})

test('carga direta da Liga: o ginásio da vez mostra o time', async ({ page }) => {
  await page.goto('/league')

  await expect.poll(() => page.locator('.gym--current .gym__sprite').count()).toBe(TEAM)
})
