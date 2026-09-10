import { expect, test } from '@playwright/test'
import { fakeSync, saveWith, seedLocalSave } from './support'

/**
 * A decisão do primeiro login num navegador de verdade.
 *
 * **É a única tela do jogo que pode custar uma coleção**, e a lição da Fase 6 é
 * que a suíte não a alcançaria: os três piores defeitos daquele PR só apareceram
 * na varredura visual. A regra pura tem portão em `test/unit/save-sync.spec.ts`;
 * o que só o navegador prova é a travessia — o plugin roda no boot, lê o
 * `localStorage`, fala com a rede e a tela aparece (ou não) por causa disso.
 *
 * O servidor é falso e mora no teste — ver `fakeSync`. Um fake ligado por
 * variável de ambiente cumpriria a decisão 4 pela letra e deixaria um caminho de
 * mentira dentro do build que vai ao ar.
 */

/** Uma coleção que se distingue à vista: lendário no topo e insígnias. */
const REMOTE = saveWith({
  dust: 1180,
  collection: { 150: { c: 1, s: 0 }, 151: { c: 1, s: 1 }, 6: { c: 4, s: 1 } },
  progress: { pity: 3, welcomeClaimed: 3, coins: 1640, badges: 4, dailyClaimed: null },
})

const LOCAL = saveWith({
  dust: 340,
  collection: { 25: { c: 2, s: 0 }, 133: { c: 1, s: 0 } },
  progress: { pity: 1, welcomeClaimed: 3, coins: 300, badges: 1, dailyClaimed: null },
})

test('sem save no servidor, o local sobe sozinho e nada pergunta', async ({ page }) => {
  const sync = await fakeSync(page, null)
  await seedLocalSave(page, LOCAL)

  await page.goto('/')
  await expect(page.locator('.hub')).toBeVisible()

  // O `PUT` primeiro: ele prova que a decisão já foi tomada. Afirmar a ausência
  // da tela antes disso seria afirmar que ela ainda não teve tempo de aparecer.
  await expect.poll(() => sync.puts.length).toBe(1)
  await expect(page.locator('.choice')).toHaveCount(0)
  expect(sync.puts[0]?.baseVersion, 'quem nunca subiu manda zero').toBe(0)
  expect(sync.current()?.version).toBe(1)
})

test('sem nada local, adota o do servidor sem perguntar', async ({ page }) => {
  const sync = await fakeSync(page, REMOTE)
  await seedLocalSave(page, saveWith())

  await page.goto('/')
  await expect(page.locator('.hub')).toBeVisible()

  // O `GET` prova que a decisão foi tomada; só então a ausência da tela
  // significa alguma coisa.
  await expect.poll(() => sync.gets()).toBe(1)
  await expect(page.locator('.choice')).toHaveCount(0)

  // Adotar não sobe nada: o servidor já tem o que vale.
  expect(sync.puts).toHaveLength(0)

  // E a coleção adotada aparece de verdade — três espécies, não as duas locais.
  await page.goto('/collection')
  await expect(page.getByRole('heading', { level: 1, name: 'Binder' })).toBeVisible()
  // `.binder-card` é o seletor que a suíte da coleção usa; `expect.poll` porque
  // o binder inteiro é `<ClientOnly>` e as cartas só entram depois do índice.
  await expect.poll(() => page.locator('.binder-card').count()).toBe(3)
})

test('com os dois lados cheios, pergunta — e a escolha local sobe o local', async ({ page }) => {
  const sync = await fakeSync(page, REMOTE)
  await seedLocalSave(page, LOCAL)

  await page.goto('/')

  const choice = page.locator('.choice')
  await expect(choice).toBeVisible()
  await expect(choice.getByRole('heading', { level: 1 })).toHaveText('Qual delas você quer continuar?')

  // Os dois lados, com os números de cada save — é o que torna a escolha uma
  // escolha, e não um botão de roleta.
  const sides = choice.locator('.choice__side')
  await expect(sides).toHaveCount(2)
  await expect(sides.first()).toContainText('2')
  await expect(sides.last()).toContainText('4')

  // As miniaturas que a prancha desenha, dos dois lados.
  await expect(sides.first().locator('.choice__mini')).toHaveCount(2)
  await expect(sides.last().locator('.choice__mini')).toHaveCount(3)

  // Sem batalha em andamento, o aviso não aparece — ele não é decoração fixa.
  await expect(choice.locator('.choice__warning')).toHaveCount(0)

  await sides.first().getByRole('button', { name: 'USAR ESTA' }).click()

  // A tela some, e o que subiu foi o **local**.
  await expect(choice).toHaveCount(0)
  await expect.poll(() => sync.puts.length).toBe(1)
  expect(sync.puts[0]?.baseVersion, 'a base é a versão que o GET trouxe').toBe(1)
  expect(JSON.stringify(sync.puts[0]?.data)).toContain('"25"')
})

test('a escolha não reaparece no boot seguinte', async ({ page }) => {
  const sync = await fakeSync(page, REMOTE)
  await seedLocalSave(page, LOCAL)

  await page.goto('/')
  await page.locator('.choice__side').first().getByRole('button', { name: 'USAR ESTA' }).click()
  await expect(page.locator('.choice')).toHaveCount(0)

  // O defeito que isto tranca: escolher o local sobe o local, e no boot seguinte
  // os dois lados estão cheios outra vez — a tela reapareceria para sempre,
  // arquivando uma cópia da coleção a cada vez.
  await page.reload()
  await expect(page.locator('.hub')).toBeVisible()

  // **A asserção que tranca o defeito**: o boot acertado sai antes de ler, então
  // uma segunda leitura é a reconciliação rodando de novo. Sem esta linha o
  // teste dava verde com a marca removida — `toHaveCount(0)` mede a tela antes
  // de o plugin assíncrono ter chance de mostrá-la.
  await page.waitForTimeout(1500)
  expect(sync.gets(), 'boot já acertado nem lê o servidor').toBe(1)
  await expect(page.locator('.choice')).toHaveCount(0)
  expect(sync.puts, 'boot já acertado não regrava').toHaveLength(1)
})

test('a batalha em andamento é avisada antes da escolha', async ({ page }) => {
  await fakeSync(page, REMOTE)
  await seedLocalSave(page, saveWith({
    ...LOCAL,
    battle: {
      gymId: 1,
      seed: 7,
      engineVersion: 1,
      dexVersion: '0123abcd',
      team: [25, 133],
      actions: [],
    },
  }))

  await page.goto('/')

  const warning = page.locator('.choice__warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Na sua conta')
})
