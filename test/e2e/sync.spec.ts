import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { ENGINE_VERSION } from '../../shared/game/battle.ts'
import { fakeSync, navLabel, saveWith, seedLocalSave } from './support'

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
  // `level: 2` e não 1: a página por baixo continua montada com o `h1` dela, e
  // dois `h1` na mesma árvore é sumário quebrado para quem navega por cabeçalho.
  await expect(choice.getByRole('heading', { level: 2 })).toHaveText('Qual delas você quer continuar?')

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

  /**
   * **A barreira é uma segunda recarga, e não um relógio.**
   *
   * Afirmar que algo não aconteceu exige primeiro provar que houve tempo de
   * acontecer. A primeira versão disto era `waitForTimeout(1500)`, que dá verde
   * numa máquina lenta; a segunda esperava a **sessão** do boot 2 e era pior, por
   * ser errada de forma e não só frágil: a sessão é lida *antes* da decisão, então
   * ela chega enquanto o `GET` que se quer negar ainda está por vir. Medido — com
   * o `syncedWith` desligado, o teste passava.
   *
   * Uma recarga é barreira de verdade: quando a sessão do boot 3 é pedida, o
   * boot 2 já rodou inteiro. O contador de sessões é o sinal positivo que cresce,
   * e o que precisa ter ficado parado é a tela e o `PUT`.
   *
   * **O PR 2 mudou a forma da prova, não o defeito.** O boot acertado passou a
   * ler o servidor — é o sync contínuo, e é assim que ele sabe se outro aparelho
   * gravou. A versão anterior deste teste afirmava "nem lê o servidor", o que
   * deixou de ser verdade de propósito; a tela que não volta e o save que não é
   * regravado continuam sendo o que ele tranca.
   */
  await page.reload()
  await expect(page.locator('.hub')).toBeVisible()
  await expect.poll(() => sync.sessions()).toBe(3)

  expect(sync.gets(), 'o boot 2 leu o servidor — o sync contínuo').toBeGreaterThanOrEqual(2)
  await expect(page.locator('.choice')).toHaveCount(0)
  expect(sync.puts, 'boot já acertado não regrava o que o servidor já tem').toHaveLength(1)
})

/**
 * A versão do dex que o jogo servido usa.
 *
 * **Ela precisa ser a de verdade**, e é o que a primeira versão deste teste errava:
 * com um `dexVersion` inventado, o Hub descarta a batalha no `resume` — motor e dex
 * são conferidos antes de reproduzir — e não há batalha nenhuma para avisar. O teste
 * passava porque a tela lia um retrato tirado no boot, antes do descarte: ele avisava
 * sobre uma luta que já não existia. Com a tela lendo as stores, o aviso só aparece
 * quando a batalha sobrevive — e o fixture precisa ser uma batalha que sobreviva.
 */
const DEX_VERSION: string = (() => {
  const core: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../public/data/core.json', import.meta.url)), 'utf8'),
  )

  if (typeof core !== 'object' || core === null || !('dexVersion' in core)) {
    throw new Error('core.json sem dexVersion: rodar `yarn data:build`')
  }

  const version = core.dexVersion
  if (typeof version !== 'string') throw new Error('dexVersion não é texto')

  return version
})()

test('a batalha em andamento é avisada antes da escolha', async ({ page }) => {
  await fakeSync(page, REMOTE)
  await seedLocalSave(page, saveWith({
    ...LOCAL,
    battle: {
      gymId: 1,
      seed: 7,
      engineVersion: ENGINE_VERSION,
      dexVersion: DEX_VERSION,
      team: [25, 133],
      actions: [],
    },
  }))

  await page.goto('/')

  const warning = page.locator('.choice__warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Na sua conta')
})

/**
 * E o outro lado: batalha de **outra build** não é avisada, porque não existe.
 *
 * `resume` a descarta no Hub — é a regra de `engineVersion`/`dexVersion`, que
 * prefere perder uma luta a reproduzir uma partida sobre números diferentes —, e
 * avisar que escolher a conta "encerra a batalha" seria avisar sobre algo que o
 * próprio boot já encerrou.
 */
test('batalha de outra build não gera aviso: ela já foi descartada', async ({ page }) => {
  await fakeSync(page, REMOTE)
  await seedLocalSave(page, saveWith({
    ...LOCAL,
    battle: {
      gymId: 1,
      seed: 7,
      engineVersion: ENGINE_VERSION,
      dexVersion: '0123abcd',
      team: [25, 133],
      actions: [],
    },
  }))

  await page.goto('/')

  // A tela de escolha é o sinal positivo: ela prova que a decisão chegou, e só
  // então a ausência do aviso significa alguma coisa.
  await expect(page.locator('.choice')).toBeVisible()
  await expect(page.locator('.choice__warning')).toHaveCount(0)
})

test('sem sessão, a barra oferece entrar — e leva à tela de entrar', async ({ page }) => {
  // Sem `fakeSync`: a sessão é a que o servidor de verdade responde, que sem
  // `.env` é erro — a condição do CI, e o caminho de 99% dos boots deste jogo.
  await page.goto('/')

  const enter = page.locator('.nav').getByRole('link', { name: navLabel('nav.account') })
  await expect(enter, 'a conta precisa ter entrada pela interface').toBeVisible()

  await enter.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A conta guarda')

  // E a tela vende em vez de barrar: a saída é tão visível quanto a entrada.
  await expect(page.getByRole('link', { name: 'CONTINUAR SEM CONTA' })).toBeVisible()
})

test('com sessão, a barra mostra a conta — e sair volta a oferecer entrar', async ({ page }) => {
  const sync = await fakeSync(page, null)
  await seedLocalSave(page, saveWith())

  await page.goto('/')

  const nav = page.locator('.nav')
  await expect(nav.getByText('Conectada como Treinadora Ash')).toBeAttached()
  await expect(nav.getByRole('link', { name: navLabel('nav.account') })).toHaveCount(0)

  // O acerto do primeiro login ficou marcado; sair precisa desfazê-lo, senão
  // entrar de novo pularia a pergunta com duas coleções em desacordo.
  await expect.poll(() => sync.sessions()).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('holodeck:syncedWith'))).toBe('e2e')

  /**
   * **A barreira é o `load` da recarga, e não o *Entrar*.** `SAIR` zera a conta e
   * só depois recarrega a página, então o *Entrar* aparece **antes** da recarga:
   * ler o `localStorage` logo depois dele caía no meio da navegação — `Execution
   * context was destroyed`, uma vez a cada três rodadas na suíte em série.
   */
  await Promise.all([
    page.waitForEvent('load'),
    nav.getByRole('button', { name: 'SAIR' }).click(),
  ])

  await expect(nav.getByRole('link', { name: navLabel('nav.account') })).toBeVisible()
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:syncedWith'))).toBeNull()

  // Sair não é apagar o save deste aparelho: a coleção continua aqui.
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:save'))).not.toBeNull()
})
