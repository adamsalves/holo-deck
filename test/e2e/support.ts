import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

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
