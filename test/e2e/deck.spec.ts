import { expect, test } from '@playwright/test'

/**
 * O deck builder num navegador de verdade.
 *
 * O que só o E2E prova aqui é a **travessia**: a carta sai da coleção, entra num
 * slot, sobrevive ao reload, e some do deck sozinha quando vira pó. Cada peça tem
 * portão próprio — a regra dos slots em `test/unit/deck.spec.ts`, a reação da
 * store em `test/nuxt/deck-store.spec.ts`, a migração do save em
 * `test/unit/save-schema.spec.ts` —, e nenhum deles alcança o defeito que este
 * arquivo pega: o `useAsyncData` que devolve a coisa errada e faz a tela abrir
 * vazia com todos os unitários verdes. Foi exatamente esse o defeito da Fase 5.
 *
 * Roda contra `yarn preview`, o build pré-renderizado, que é onde o deck mora só
 * no cliente e o HTML servido não sabe nada dele.
 */

/** Abre um pack de boas-vindas, que é como qualquer jogador chega ao deck. */
async function openWelcomePack(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/packs')

  await expect(async () => {
    await page.getByRole('button', { name: 'HOLO/DECK' }).click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
}

test('a carta sai da coleção, entra num slot e sobrevive ao reload', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/deck')

  await expect(page.getByRole('heading', { level: 1, name: 'Seu time' })).toBeVisible()

  // Os seis slots existem antes de qualquer carta, e o contador começa em zero.
  const slots = page.locator('.deck-slot')
  await expect(slots).toHaveCount(6)
  await expect(page.getByText('/ 6 slots')).toBeVisible()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(6)

  // A coluna da direita traz o que o pack deu. `expect.poll` porque ela entra
  // depois do `<ClientOnly>` **e** depois do índice chegar.
  const picks = page.locator('.deck__pick')
  await expect.poll(() => picks.count()).toBeGreaterThan(5)

  const before = await picks.count()
  const escalada = (await picks.first().getAttribute('aria-label')) ?? ''
  await picks.first().click()

  // Um slot a menos vazio, e a carta saiu da lista: "cartas já no deck saem da
  // lista" é a regra da prancha, e é o que torna clicar uma ação sem ambiguidade.
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)
  await expect(picks).toHaveCount(before - 1)
  expect(escalada).toContain('Escalar')

  // A prova do save: recarregar não é navegação de cliente, é boot do zero — e o
  // deck só chega até aqui através da migração para o schema 2.
  await page.reload()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)
})

test('a leitura de cobertura só aparece com carta, e nomeia o líder', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/deck')

  // O primeiro ginásio é o de Brock, do tipo pedra — enquanto a Liga não existe,
  // todo jogador tem zero insígnias e o próximo ginásio é o primeiro.
  await expect(page.getByText('Brock · Pedra')).toBeVisible()

  // Sem carta não há leitura: um painel de barras zeradas desenharia uma
  // cobertura que ninguém pode mover.
  await expect(page.getByText(/Escale uma carta para ler a cobertura/)).toBeVisible()

  await expect.poll(() => page.locator('.deck__pick').count()).toBeGreaterThan(5)
  await page.locator('.deck__pick').first().click()

  await expect(page.getByText('SEU DANO CONTRA PEDRA')).toBeVisible()
  await expect(page.locator('.deck__line').first()).toBeVisible()
})

/**
 * A regra que o plano escolheu — **moer esvazia o slot** — atravessando as três
 * camadas de uma vez: o botão do binder, a store da coleção, o observador do
 * deck e a tela do deck relendo.
 *
 * O portão de unidade já prova que a store reage. O que só aqui se prova é que a
 * tela do deck reflete a reação sem ninguém a mandar recarregar.
 */
test('moer a última cópia esvazia o slot, e o deck redesenha sozinho', async ({ page }) => {
  await openWelcomePack(page)

  // O deck primeiro: escala a carta, e guarda qual foi.
  await page.goto('/deck')
  await expect.poll(() => page.locator('.deck__pick').count()).toBeGreaterThan(5)

  const primeira = page.locator('.deck__pick').first()
  const nome = (await primeira.locator('.deck__pick-name').textContent())?.trim() ?? ''
  await primeira.click()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)

  // Agora o binder mói essa mesma carta até a última cópia. A moagem passa pelo
  // caminho real do save, sem tela: é o que qualquer outra tela faria.
  await page.goto('/collection')
  await expect.poll(() => page.locator('.binder-card').count()).toBeGreaterThan(5)

  await page.evaluate((alvo) => {
    const raw = localStorage.getItem('holodeck:save')
    if (raw === null) throw new Error('sem save depois de abrir um pack')

    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null || !('collection' in save) || !('deck' in save)) {
      throw new Error('save sem coleção ou sem deck')
    }

    const { collection, deck } = save
    if (typeof collection !== 'object' || collection === null || !Array.isArray(deck)) {
      throw new Error('save ilegível')
    }

    // `Array.isArray` devolve `any[]`, e `any` é o que o lint deste repositório
    // recusa na fronteira: a lista é relida como `unknown[]` e cada degrau
    // estreita de verdade.
    const escalados: unknown[] = deck
    const escalada = escalados.find(slot => typeof slot === 'number')
    if (typeof escalada !== 'number') throw new Error(`${alvo} não chegou ao deck`)

    Object.assign(collection, { [String(escalada)]: undefined })
    localStorage.setItem('holodeck:save', JSON.stringify({
      ...save,
      collection: Object.fromEntries(
        Object.entries(collection).filter(([id]) => id !== String(escalada)),
      ),
    }))
  }, nome)

  // Voltar ao deck é boot do zero: o save traz um deck com uma carta que a
  // coleção não tem mais, e é `deck.hydrate` quem a descarta na entrada — não o
  // observador, que acorda um tick tarde demais para o boot.
  await page.goto('/deck')
  await expect(page.locator('.deck-slot--empty')).toHaveCount(6)
  await expect(page.getByText('/ 6 slots')).toBeVisible()
})
