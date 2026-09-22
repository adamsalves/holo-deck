import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { ENGINE_VERSION } from '../../shared/game/battle.ts'
import {
  defaultLocale,
  foreignPhrases,
  label,
  localeCodes,
  localeUrl,
  message,
  namespaceLabels,
} from '../support/locales'
import { fakeSync, navLabel, pathPattern, saveWith, screenText, seedLocalSave } from './support'

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
  await expect(choice.getByRole('heading', { level: 2 })).toHaveText(label('save.choice.title', defaultLocale()))

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

  await sides.first().getByRole('button', { name: label('save.choice.use', defaultLocale()) }).click()

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
  await page.locator('.choice__side').first()
    .getByRole('button', { name: label('save.choice.use', defaultLocale()) })
    .click()
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
  await expect(warning).toContainText(label('save.choice.remote.title', defaultLocale()))
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label('login.title', defaultLocale()))

  // E a tela vende em vez de barrar: a saída é tão visível quanto a entrada.
  await expect(page.getByRole('link', { name: label('login.skip.action', defaultLocale()) })).toBeVisible()
})

test('com sessão, a barra mostra a conta — e sair volta a oferecer entrar', async ({ page }) => {
  const sync = await fakeSync(page, null)
  await seedLocalSave(page, saveWith())

  await page.goto('/')

  const nav = page.locator('.nav')
  await expect(nav.getByText(message('account.signedInAs', defaultLocale(), { name: 'Treinadora Ash' }))).toBeAttached()
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
    nav.getByRole('button', { name: label('account.signOut', defaultLocale()) }).click(),
  ])

  await expect(nav.getByRole('link', { name: navLabel('nav.account') })).toBeVisible()
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:syncedWith'))).toBeNull()

  // Sair não é apagar o save deste aparelho: a coleção continua aqui.
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:save'))).not.toBeNull()
})

/**
 * The two-collections choice in the language of the URL.
 *
 * It is a boot panel, not a screen: it draws over whichever route the first
 * sign-in lands on, so no per-screen measurement of this phase reached it. Of
 * everything the player reads, it is the one that asks for an irreversible
 * decision — a sentence left in the wrong language here is a sentence the
 * player has to guess at before choosing which collection survives.
 *
 * The sweep reads the panel only after both columns have their miniatures: the
 * dex index arrives after the panel does, and before it the columns hold dashes
 * and a loading line — a sweep there would measure the loading state and call
 * the columns translated.
 */
for (const code of localeCodes()) {
  test(`the two-collections choice speaks ${code}`, async ({ page }) => {
    const foreign = localeCodes()
      .filter(other => other !== code)
      .flatMap(other => namespaceLabels('save.choice.', code, other))

    // The other side of the subtraction: an empty list would sweep for nothing.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(0)

    await fakeSync(page, REMOTE)
    await seedLocalSave(page, LOCAL)
    await page.goto(localeUrl('/', code))

    const choice = page.locator('.choice')
    await expect(choice.getByRole('heading', { level: 2 })).toHaveText(label('save.choice.title', code))
    await expect(choice.locator('.choice__side--account .choice__mini')).toHaveCount(3)

    // Each column is found by the name a screen reader announces for it. That
    // name is an attribute, and no sweep reads attributes: `screenText` walks
    // text nodes, so a column labelled in the wrong language would pass it.
    const [local, remote] = [
      choice.getByRole('region', { name: label('save.choice.local.region', code), exact: true }),
      choice.getByRole('region', { name: label('save.choice.remote.region', code), exact: true }),
    ]
    await expect(local, `the device column is not named in ${code}`).toBeVisible()
    await expect(remote, `the account column is not named in ${code}`).toBeVisible()

    // The units inflect with the count each column shows: two cards and one
    // badge here, three cards and four badges on the account side.
    await expect(local.locator('.choice__numbers .choice__unit')).toHaveText([
      message('save.choice.cards', code, {}, 2),
      message('save.choice.badges', code, {}, 1),
      label('save.choice.shiny', code),
    ])
    await expect(remote.locator('.choice__numbers .choice__unit')).toHaveText([
      message('save.choice.cards', code, {}, 3),
      message('save.choice.badges', code, {}, 4),
      label('save.choice.shiny', code),
    ])

    await expect(choice).toContainText(message('save.choice.footnote', code, {
      path: `${label('nav.settings', code)} → ${label('settings.backups.title', code)}`,
    }))

    expect(
      foreignPhrases(await screenText(choice), foreign),
      `the two-collections choice in ${code} wrote a sentence from another language`,
    ).toEqual([])
  })
}

/**
 * The instant each column was last written, in the date format of the URL.
 *
 * The component formatted both with `'pt-BR'` written by hand, and inside `/en`
 * the server's copy read `01/09/2026` — the ninth of January to an English
 * reader, on the screen where the player picks a collection by how recent it
 * is. Nothing measured it: every suite drove the choice in pt-BR, where the
 * hard-coded locale is also the right one.
 *
 * **Measured as shape, in the other language**, the way the backup stamp of
 * Settings is. Comparing the stamp against `Intl` with the same locale would
 * agree with a hard-coded string just as happily, since both sides move
 * together. What tells them apart is that the URLs have to disagree. The
 * account side is the one read, because its instant comes from the fake server
 * and is always there; the device side can legitimately say it does not know.
 *
 * **And once with the browser in each language**, because the browser's
 * language is an input here. A locale that loses its `language` sends `stamp()`
 * to the browser's own format, and the two URLs still disagree whenever the
 * browser speaks the language that lost it: a browser in pt-BR hides a pt-BR
 * without `language`, a browser in English hides an `en` without it. With no
 * `locale` set, the runner opens every page in en-US — Playwright's fixtures
 * default it — so this test used to pass over an `en` without `language`,
 * measured by planting one. Each run below catches the other language's
 * fallback, and both catch a hard-coded tag and a `stamp()` that stopped
 * passing any.
 */
for (const browserLocale of localeCodes()) {
  test.describe(`with the browser in ${browserLocale}`, () => {
    test.use({ locale: browserLocale })

    test('the choice stamps the server copy in the date format of the URL', async ({ page }) => {
      const codes = localeCodes()
      expect(codes.length).toBeGreaterThan(1)

      const stamps: string[] = []

      for (const code of codes) {
        await fakeSync(page, REMOTE)
        await seedLocalSave(page, LOCAL)
        await page.goto(localeUrl('/', code))

        const when = page.locator('.choice__side--account .choice__facts dd').first()
        await expect(when, `no server stamp in ${code}`).toBeVisible()

        const stamp = ((await when.textContent()) ?? '').trim()

        // The other side: an empty or placeholder stamp would make every language
        // agree, and the assertion below would call that a pass.
        expect(stamp, `the server copy in ${code} is stamped with nothing`).not.toMatch(/^(—)?$/)
        stamps.push(stamp)
      }

      expect(
        new Set(stamps).size,
        `the server copy reads ${stamps.join(' and ')} — the same in every language`,
      ).toBeGreaterThan(1)
    })
  })
}

/**
 * The sign-in screen in the language of the URL, and its way out stays in it.
 *
 * `/login` was the one screen of the game that no list named: it was built in
 * Phase 7, before the translation, and the per-screen cut of Phase 8 went by the
 * screens of the game proper. Its *continue without an account* link was one of
 * the last two of issue #37 — from `/en/login`, a literal `/` sent the player to
 * the Portuguese Hub.
 */
for (const code of localeCodes()) {
  test(`the sign-in screen speaks ${code}, and continuing without an account stays in ${code}`, async ({ page }) => {
    const foreign = localeCodes()
      .filter(other => other !== code)
      .flatMap(other => namespaceLabels('login.', code, other))

    // The other side of the subtraction: an empty list would sweep for nothing.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(0)

    await page.goto(localeUrl('/login', code))

    const screen = page.locator('.login')
    await expect(screen.getByRole('heading', { level: 1 })).toHaveText(label('login.title', code))
    await expect(page).toHaveTitle(label('login.seo.title', code))

    expect(
      foreignPhrases(await screenText(screen), foreign),
      `the sign-in screen in ${code} wrote a sentence from another language`,
    ).toEqual([])

    await screen.getByRole('link', { name: label('login.skip.action', code) }).click()
    await expect(page).toHaveURL(pathPattern(localeUrl('/', code)))
    await expect(page.locator('.hub')).toBeVisible()
  })
}
