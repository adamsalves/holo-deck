import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * A Liga e a batalha num navegador de verdade.
 *
 * O que só o E2E prova aqui é a **checagem nº 1 da persistência da fase**:
 * fechar a aba no meio de um ginásio e voltar para o mesmo turno. Ela não é
 * alcançável por unitário — o teste da store prova que o log reproduz, e prova
 * isso com duas stores na mesma memória; o que falta é o caminho inteiro,
 * passando por `localStorage`, pelo plugin de save, pelo `<ClientOnly>` e pelo
 * carregamento do dex numa rota pré-renderizada. Foi exatamente essa travessia
 * que a Fase 5 e a Fase 6 erraram, cada uma do seu jeito, com todos os unitários
 * verdes.
 *
 * Roda contra `yarn preview`, que é onde a batalha mora só no cliente e o HTML
 * servido não sabe nada dela.
 */

/** Abre um pack de boas-vindas, que é como qualquer jogador chega ao deck. */
async function openWelcomePack(page: Page): Promise<void> {
  await page.goto('/packs')

  await expect(async () => {
    await page.getByRole('button', { name: 'HOLO/DECK' }).click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
}

/** Escala as seis primeiras cartas que o pack deu. */
async function fillDeck(page: Page): Promise<void> {
  await page.goto('/deck')

  const picks = page.locator('.deck__pick')
  await expect.poll(() => picks.count()).toBeGreaterThan(5)

  for (let slot = 0; slot < 6; slot += 1) await picks.first().click()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(0)
}

/**
 * Um turno, seja qual for o que a tela está pedindo.
 *
 * Depois de um desmaio o motor exige troca e os golpes somem — um `click` no
 * primeiro `.move` travaria a suíte esperando um botão que a tela não desenha.
 */
async function playTurn(page: Page): Promise<void> {
  const forced = page.locator('.battle__forced')
  if (await forced.isVisible()) {
    await page.locator('.battle__pill:not([disabled])').first().click()
    return
  }
  await page.locator('.move').first().click()
}

test('a Liga abre no primeiro ginásio e mantém os outros fechados', async ({ page }) => {
  await page.goto('/league')

  await expect(page.getByRole('heading', { level: 1, name: 'A Liga' })).toBeVisible()

  // Nove cartas, e o desbloqueio sequencial visível: uma atual, oito trancadas.
  await expect(page.locator('.gym')).toHaveCount(9)
  await expect(page.locator('.gym--current')).toHaveCount(1)
  await expect(page.locator('.gym--locked')).toHaveCount(8)
  await expect(page.locator('.gym--won')).toHaveCount(0)

  // O painel do próximo traz o prêmio da estreia — `200 + 100 × 1` —, e a carta
  // do ginásio estampa o mesmo número no botão. Os dois vêm de `rewardPreview`.
  await expect(page.locator('.league__prize')).toHaveText('+300')
  await expect(page.locator('.gym--current .gym__challenge')).toHaveText('DESAFIAR · +300')

  // Sem deck não há desafio: a tela oferece o que falta em vez de um botão que
  // levaria a uma batalha que o motor recusa.
  await expect(page.getByRole('link', { name: /MONTE UM DECK/ })).toBeVisible()
})

test('um ginásio trancado recusa pela URL, e não só pelo botão', async ({ page }) => {
  // A trava é da store e é cobrada na página: `/battle/9` é uma URL, e digitá-la
  // no primeiro minuto de jogo seria o caminho mais curto para pular a campanha.
  await page.goto('/battle/9')

  await expect(page.getByRole('heading', { name: 'Ginásio fechado' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'IR PARA A LIGA' })).toBeVisible()
})

test('a batalha começa, sobrevive ao reload e termina', async ({ page }) => {
  await openWelcomePack(page)
  await fillDeck(page)

  await page.goto('/league')
  await page.getByRole('link', { name: 'DESAFIAR', exact: true }).click()

  // O campo montou: dois painéis de combatente, quatro golpes e o cabeçalho.
  await expect(page.getByText('Ginásio 1 / 9')).toBeVisible()
  await expect(page.locator('.combatant')).toHaveCount(2)
  await expect(page.locator('.move')).toHaveCount(4)
  await expect(page.getByText('TURNO 01')).toBeVisible()

  await playTurn(page)
  await expect(page.getByText('TURNO 02')).toBeVisible()

  /**
   * **A checagem que a fase inteira sustenta.**
   *
   * O reload é boot do zero: nada em memória sobrevive. O turno 2 só volta se o
   * log tiver ido para o `localStorage`, passado pelo guarda do save, sido
   * reconhecido como reproduzível — motor e dex conferidos — e reproduzido pelo
   * motor com a mesma seed. Qualquer elo quebrado devolve o turno 1.
   */
  await page.reload()
  await expect(page.getByText('TURNO 02')).toBeVisible()

  // E o Hub mostra a faixa de retomar, que é a superfície que o plano pede.
  await page.goto('/')
  await expect(page.locator('.hub__resume')).toBeVisible()
  await expect(page.getByText('Batalha em andamento')).toBeVisible()

  await page.getByRole('link', { name: 'RETOMAR' }).click()
  await expect(page.getByText('TURNO 02')).toBeVisible()

  // Até o fim. O limite é folgado: uma luta de ginásio 1 fecha em bem menos, e
  // um laço sem teto esconderia uma batalha que não termina — o defeito que o
  // teste de terminação do motor existe para pegar.
  const result = page.locator('.battle__result')
  for (let turn = 0; turn < 200 && !(await result.isVisible()); turn += 1) {
    await playTurn(page)
  }
  await expect(result).toBeVisible()

  // A luta acabou: o log foi apagado, então o Hub não oferece mais retomar.
  await page.goto('/')
  await expect(page.locator('.hub__resume')).toHaveCount(0)
})

test('a vitória paga, dá insígnia e abre o ginásio seguinte', async ({ page }) => {
  await openWelcomePack(page)
  await fillDeck(page)

  // Direto pela URL: o ginásio 1 está aberto para todo mundo.
  await page.goto('/battle/1')
  await expect(page.getByText('TURNO 01')).toBeVisible()

  const result = page.locator('.battle__result')
  for (let turn = 0; turn < 200 && !(await result.isVisible()); turn += 1) {
    await playTurn(page)
  }

  /**
   * A derrota é um desfecho legítimo — seis cartas de pack contra o Brock não
   * são vitória garantida —, e o plano diz que ela **não custa nada**. Por isso
   * o teste ramifica em vez de exigir a vitória: o que ele afirma é que o
   * resultado é coerente com o que ficou no save, nos dois casos.
   */
  const won = await page.getByRole('heading', { name: 'Vitória' }).isVisible()

  await page.goto('/league')
  if (won) {
    await expect(page.locator('.gym--won')).toHaveCount(1)
    await expect(page.getByText('REVANCHE +75')).toBeVisible()
    // A insígnia moveu o próximo ginásio, e com ele a leitura de cobertura.
    await expect(page.locator('.gym--current')).toHaveCount(1)
    await expect(page.locator('.gym--locked')).toHaveCount(7)
  }
  else {
    // Derrota não tem punição: a Liga volta exatamente como estava.
    await expect(page.locator('.gym--won')).toHaveCount(0)
    await expect(page.locator('.gym--current')).toHaveCount(1)
  }
})

/**
 * O Hub, e o número que só o navegador pegou.
 *
 * A contagem de coleção lia `collection.total`, que é o **tamanho do dex** e não
 * o que se tem: a tela abria dizendo `1.025 / 1.025` ao lado de `0,8% do dex` —
 * dois números da mesma linha se contradizendo. Nenhum unitário alcança isso,
 * porque o composable estava certo e quem errou foi quem o leu; o portão é
 * afirmar que o numerador é **menor** que o denominador.
 */
test('o Hub conta a coleção, o saldo e o próximo ginásio', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/')

  const count = page.locator('.hub__count')
  await expect(count).toBeVisible()

  const [ownedText, totalText] = ((await count.innerText()).match(/[\d.]+/g) ?? [])
  const owned = Number((ownedText ?? '').replace(/\./g, ''))
  const total = Number((totalText ?? '').replace(/\./g, ''))

  expect(total).toBe(1025)
  expect(owned).toBeGreaterThan(0)
  expect(owned).toBeLessThan(total)

  // As nove regiões, e o painel do próximo ginásio com o prêmio da estreia.
  await expect(page.locator('.hub__regions [role="progressbar"]')).toHaveCount(9)
  await expect(page.getByText('Próximo desafio · Ginásio 1 de 9')).toBeVisible()
  await expect(page.locator('.hub__reward')).toContainText('+300')

  // Sem batalha aberta a faixa de retomar não existe — ela não é uma casca vazia.
  await expect(page.locator('.hub__resume')).toHaveCount(0)
})

/**
 * Uma batalha aberta não é sobrescrita em silêncio pelo ginásio vizinho.
 *
 * O caminho é normal: a Liga oferece revanche em toda carta vencida e o Hub
 * oferece retomar, então chegar a `/battle/2` com o ginásio 1 no meio acontece.
 * A versão anterior desta tela começava por cima e apagava o turno de alguém sem
 * uma linha na tela — o mesmo defeito que ela já evitava para o **mesmo**
 * ginásio e deixava passar para o de ao lado.
 *
 * A insígnia é escrita direto no save, e isso é deliberado: vencer um ginásio
 * pela interface leva dezenas de cliques, e o que este teste mede é a **tela**,
 * não a economia — essa tem portão próprio em `test/unit/economy.spec.ts` e em
 * `test/unit/battle-store.spec.ts`. O log da batalha, esse **não** é forjado:
 * ele sai de uma luta de verdade, com seed, motor e dex reais.
 */
test('começar outro ginásio com uma batalha aberta pede confirmação', async ({ page }) => {
  await openWelcomePack(page)
  await fillDeck(page)

  await page.goto('/battle/1')
  await playTurn(page)
  await expect(page.getByText('TURNO 02')).toBeVisible()

  // A insígnia do primeiro abre o segundo. O resto do save fica como estava.
  await page.evaluate(() => {
    const raw = window.localStorage.getItem('holodeck:save')
    if (raw === null) throw new Error('sem save para editar')
    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null) throw new Error('save fora de forma')
    const record: Record<string, unknown> = { ...save }
    const progress = record.progress
    if (typeof progress !== 'object' || progress === null) throw new Error('save sem progresso')
    record.progress = { ...progress, badges: 1 }
    window.localStorage.setItem('holodeck:save', JSON.stringify(record))
  })

  await page.goto('/battle/2')
  await expect(page.getByRole('heading', { name: 'Você já está lutando' })).toBeVisible()
  await expect(page.getByText(/Ginásio 1 · Brock, no turno 2/)).toBeVisible()

  // Retomar aquela devolve o mesmo turno: nada foi perdido no caminho.
  await page.getByRole('link', { name: 'RETOMAR AQUELA' }).click()
  await expect(page.getByText('TURNO 02')).toBeVisible()

  // E desistir explicitamente começa a nova, do turno 1.
  await page.goto('/battle/2')
  await page.getByRole('button', { name: 'DESISTIR E COMEÇAR ESTA' }).click()
  await expect(page.getByText('Ginásio 2 / 9')).toBeVisible()
  await expect(page.getByText('TURNO 01')).toBeVisible()
})
