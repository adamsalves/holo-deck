import { expect, test } from '@playwright/test'
import { STAT_NAMES, TYPE_NAMES } from '../../shared/types/dex.ts'
import { statKey, statNameKey, typeKey } from '../../shared/types/game.ts'
import {
  defaultLocale,
  foreignBadges,
  foreignPhrases,
  label,
  localeCodes,
  localeUrl,
  message,
  messagePattern,
  spells,
} from '../support/locales.ts'
import { screenText } from './support.ts'

/** The six stat badges of one locale, as that locale spells them. */
function badgesOf(code: string): string[] {
  return STAT_NAMES.map(stat => label(statKey(stat), code))
}

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
  // A razão de o grid ser renderizado inteiro no servidor: o que o rastreador lê
  // é o HTML servido, e ele precisa conter as 151 — não as 18 que a versão
  // virtualizada mostra.
  //
  // `page.request` e não `page.goto`: ele busca o documento sem abrir uma página,
  // então nenhum JavaScript roda e o que volta é literalmente o que o servidor
  // mandou. (Havia um `addInitScript(() => {})` aqui prometendo desligar o
  // JavaScript; ele não desligava nada — o teste sempre passou por causa do
  // `request`, e o comentário descrevia um mecanismo que não existia.)
  const response = await page.request.get('/pokedex/1')
  const html = await response.text()

  const links = html.match(/href="\/pokemon\/[a-z0-9-]+"/g) ?? []

  expect(new Set(links).size).toBe(151)
})

test('o grid virtualiza depois de montar — o DOM não segura as 151', async ({ page }) => {
  await page.goto('/pokedex/1')
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  // A troca de forma acontece no `onMounted`, e contar antes dela mede a
  // velocidade da máquina em vez do virtualizador — com a suíte rodando em
  // paralelo, a contagem pega as 151 do HTML servido e o teste reprova sem que
  // nada esteja errado. `poll` espera a forma virtualizada aparecer, e continua
  // reprovando se ela nunca aparecer.
  await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)
  expect(await page.locator('.dex-card').count()).toBeGreaterThan(0)

  // Rolar troca quem está no DOM sem trocar quantos.
  await page.evaluate(() => window.scrollTo(0, 3000))
  await page.waitForFunction(() => !document.querySelector('a[aria-label^="Bulbasaur,"]'))

  expect(await page.locator('.dex-card').count()).toBeLessThan(151)

  // O rodapé é a evidência visível dessa troca, e ele tem de contar o mesmo DOM
  // que este teste acabou de contar — no navegador de verdade, com a largura
  // real decidindo quantas colunas cabem. É o outro lado do
  // `test/nuxt/dex-grid.spec.ts`, que mede a mesma regra sem layout.
  const rendered = await page.locator('.dex-card').count()
  await expect(page.locator('.grid-footer__count')).toContainText(
    message('dex.grid.rendered', defaultLocale(), { rendered, total: 151 }),
  )
  await expect(page.locator('.grid-footer__count')).toContainText(
    messagePattern('dex.grid.virtualized', defaultLocale()),
  )
})

test('os filtros de tipo e raridade compõem — OU dentro do grupo, E entre eles', async ({ page }) => {
  await page.goto('/pokedex/1')
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  const counter = page.getByRole('button', { name: /^Todos/ })
  await expect(counter).toHaveText(/151$/)

  /**
   * O primeiro clique espera a hidratação; os seguintes não precisam.
   *
   * Antes dela o chip é marcação servida, e o clique cai no vazio: a chip fica
   * `Todos · 151` e a asserção seguinte estoura. É o mesmo `toPass` que as
   * suítes de pack e de aba usam, e ele está **só aqui** de propósito — depois
   * do primeiro clique a página já respondeu, e repetir o laço esconderia uma
   * regressão de verdade atrás de uma re-tentativa.
   *
   * Ele passou a ser necessário quando a barra global entrou em toda rota: o
   * atraso sempre existiu, e este teste reprovava de vez em quando com os seis
   * workers. Com mais um componente para hidratar, "de vez em quando" virou
   * "sempre" — o defeito não é novo, o que mudou foi a margem.
   */
  await expect(async () => {
    await page.getByRole('button', { name: 'Fogo', exact: true }).click()
    // Kanto tem 12 espécies de fogo.
    await expect(counter).toHaveText(/12 de 151/, { timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  // Ligar um segundo tipo amplia — é OU dentro do grupo.
  await page.getByRole('button', { name: 'Água', exact: true }).click()
  await expect(counter).toHaveText(/44 de 151/)

  // Ligar raridade restringe — é E entre os grupos.
  await page.getByRole('button', { name: 'Raro', exact: true }).click()
  const withRarity = await page.locator('.dex-card').count()
  expect(withRarity).toBeGreaterThan(0)
  expect(withRarity).toBeLessThan(44)

  // A chip Todos limpa os dois grupos.
  await counter.click()
  await expect(counter).toHaveText(/151$/)
})

/**
 * The 18 types, read off the screen instead of off the disk.
 *
 * The pair of the rarity test in `test/e2e/shop.spec.ts`, and the half that was
 * missing: `test/unit/i18n-gate.spec.ts` folds every vocabulary key into
 * `USED_KEYS` unconditionally — it has to, because `t(typeKey(x))` is not a
 * literal any scan can see — so a screen that renders `typeKey(type)` instead of
 * `t(typeKey(type))` keeps the whole gate green while `type.electric` sits on
 * the card. Only the browser can tell the difference, and only in both languages.
 *
 * `/pokedex/1` and not the species page because the filter row iterates
 * `TYPE_NAMES` itself (`app/components/dex/DexFilters.vue`), so this walks the
 * same list the component renders — all 18 on one server-rendered page, instead
 * of the one or two a species happens to carry.
 *
 * Scoped to `.filters` and asserted with `toHaveText`, not `toContainText` on the
 * page: the grid below renders the same badges, and `Fire` is a substring of
 * `Firefox` the same way `comum` is one of `incomum`.
 */
test('the type vocabulary reaches the screen in the language of the URL', async ({ page }) => {
  const codes = localeCodes()

  // The other side of the loop: with one locale it would prove nothing, and with
  // none it would not run at all.
  expect(codes.length).toBeGreaterThan(1)

  for (const code of codes) {
    await page.goto(localeUrl('/pokedex/1', code))

    const filters = page.locator('.filters')
    await expect(filters).toBeVisible()

    for (const type of TYPE_NAMES) {
      await expect(
        filters.locator(`.type-badge[data-type="${type}"]`),
        `${type} em ${code}`,
      ).toHaveText(label(typeKey(type), code))
    }
  }
})

test('a busca abre por atalho, filtra e navega', async ({ page }) => {
  await page.goto('/pokedex/1')

  // O atalho só existe depois da hidratação — `goto` resolve no `load`, que é
  // antes. Sem esta espera o teste falha por corrida e não por defeito.
  await expect(page.getByRole('link', { name: /^Bulbasaur,/ })).toBeVisible()

  // Mas o link do Bulbasaur **não** prova hidratação: ele está no HTML servido,
  // então fica visível antes de qualquer JavaScript rodar, e o `press` abaixo cai
  // no vazio. O sinal que só existe depois do `onMounted` é a troca de forma do
  // grid — as 151 do servidor virando as poucas do virtualizador. Com o servidor
  // frio a diferença é de centenas de milissegundos, e é assim que o CI sobe.
  await expect.poll(() => page.locator('.dex-card').count()).toBeLessThan(151)

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
  const stats = page.getByRole('tabpanel', { name: 'Stats' })

  // O clique só tem efeito depois da hidratação: antes dela ele cai no HTML
  // servido, onde a aba é marcação e não componente. `toPass` repete o par
  // clique + asserção em vez de apostar que a hidratação chegou primeiro — que
  // é uma aposta que se perde quando a máquina está ocupada.
  await expect(async () => {
    await page.getByRole('tab', { name: 'Stats' }).click()
    await expect(stats.getByText('BST 534')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(stats.getByText('Recebe mais dano')).toBeVisible()
  await expect(stats.getByText('×4', { exact: true })).toBeVisible()
  await expect(stats.getByText('×0', { exact: true })).toBeVisible()

  const evolution = page.getByRole('tabpanel', { name: 'Evolução' })

  await expect(async () => {
    await page.getByRole('tab', { name: 'Evolução' }).click()
    await expect(evolution.getByRole('link', { name: /Charmander/ })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(evolution.getByText('Nível 16')).toBeVisible()
})

test('espécie que não existe responde 404, e não uma página vazia', async ({ page }) => {
  const response = await page.goto('/pokemon/missingno')

  expect(response?.status()).toBe(404)
})

/**
 * The six stat badges, on the one screen that draws all six at once.
 *
 * This is the half of `test/unit/stat-label-gate.spec.ts` that a gate on disk
 * cannot take. That gate reads what is written — that nobody spells an
 * abbreviation by hand, and that no two of them collide once case is folded —
 * and stays perfectly green on a page that renders the **key**: a
 * `statKey(stat)` where a `t(statKey(stat))` belongs puts `stat.short.hp` on the
 * bar and nothing on disk can tell. PR #48 paid for that lesson with the rarity
 * labels, and it is proved here the same way, by planting it.
 *
 * It also measures the `sr-only` name beside each badge, which is the reason
 * there are two namespaces: `PV` is the badge and *Pontos de vida* is what a
 * screen reader is handed, through a span rather than an `aria-label`, because a
 * `dt` maps to the `term` role and ARIA 1.2 prohibits a name on it. A screen
 * reader getting the badge twice is the defect that hides best — nothing looks
 * wrong.
 *
 * **Both languages, and the abbreviations of the other one must be absent.** Five
 * of the six differ between pt-BR and English (`DEF` is the one both shorten the
 * same way, and the `i18n-gate` names it in `IDENTICAL_LABELS`), so the wrong
 * language on this panel is visible — a page stuck in Portuguese would pass a
 * sweep that only asked whether *some* badge was there.
 *
 * `/en/pokemon/charizard` renders on demand rather than from the prerender: the
 * crawler reaches nine `/en` pages and stops, because the region links of
 * `/en/pokedex` are still literal `NuxtLink`s pointing at `/pokedex/1`. That is
 * issue #37, and it is the Pokédex screens that close it — measured on this
 * build, which is still 1.061 pages with nine of them under `/en`. Written here
 * rather than left for a reader to assume this page is reachable by clicking
 * today.
 */
test('the six stat badges, and their spelled-out names, follow the URL', async ({ page }) => {
  const others = localeCodes().filter(code => code !== defaultLocale())

  // The other side: with a single locale on disk, the absence assertion below
  // compares nothing and passes on a panel that never translated.
  expect(others.length).toBeGreaterThan(0)

  for (const locale of [defaultLocale(), ...others]) {
    await page.goto(localeUrl('/pokemon/charizard', locale))

    const tab = label('species.tabs.stats', locale)
    const stats = page.getByRole('tabpanel', { name: tab })

    // The same `toPass` the test above explains: the tab is markup until
    // hydration arrives, and clicking before it lands on nothing.
    await expect(async () => {
      await page.getByRole('tab', { name: tab }).click()
      await expect(stats.getByText(`${label('dex.bst', locale)} 534`)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })

    for (const stat of STAT_NAMES) {
      await expect(
        stats.getByText(label(statKey(stat), locale), { exact: true }),
        `/pokemon/charizard in ${locale} did not draw the badge of ${stat}`,
      ).toBeVisible()
      await expect(
        stats.getByText(label(statNameKey(stat), locale), { exact: true }),
        `/pokemon/charizard in ${locale} did not name ${stat} for a screen reader`,
      ).toBeAttached()
    }

    // And no badge of the other language got in. The one both languages write
    // the same way is dropped by `foreignBadges`: demanding it stay out would
    // fail on a panel that is right.
    //
    // **Subtracted as a set, not stat by stat.** Asking whether `other` spells
    // *this* stat differently keeps a badge that this locale legitimately draws
    // for a different stat — the two agree on the two locales that exist today
    // and stop agreeing the moment a third one shows up.
    const foreign = foreignBadges(locale, badgesOf)

    expect(foreign.length, `no badge left that tells ${locale} apart`).toBeGreaterThan(0)

    const panel = await stats.innerText()

    expect(
      foreign.filter(badge => spells(panel, badge)),
      `/pokemon/charizard in ${locale} drew the badges of another language`,
    ).toEqual([])
  }
})

/**
 * The Detail screen, in the language of the URL — panels, sentence and links.
 *
 * Three things a gate on disk cannot take, and each one is a defect this phase
 * has already shipped once somewhere else:
 *
 * - **The evolution condition is composed at runtime**, from a message and a
 *   number, and nothing on disk can tell `Nível 16` from `evolution.main.level`
 *   under the arrow. That is the `statKey` defect of PR #53, on the one panel
 *   that builds a sentence instead of printing a label.
 * - **The habitat is the value the panel highlights**, and it is the last label
 *   map that left `shared/`. A page stuck in Portuguese still draws *Montanha*
 *   in `--accent` inside a `lang="en"` document.
 * - **The three links of issue #37 that this PR closes** are only links once
 *   they are rendered: `localePath()` is a function call on disk and an `href`
 *   here. `test/unit/locale-link-gate.spec.ts` reads how they were written;
 *   this reads where they point.
 *
 * Charmander and not Charizard: it is the species the *Detalhe* board draws the
 * evolution line of, its habitat is one of the nine (`mountain`), and the two
 * conditions of its chain are the `Lv 16` / `Lv 36` the board writes.
 */
test('the Detail screen reads in the language of the URL, links included', async ({ page }) => {
  const codes = localeCodes()

  // The other side: with a single locale on disk this loop would run once and
  // every absence assertion in it would compare nothing.
  expect(codes.length).toBeGreaterThan(1)

  for (const locale of codes) {
    await page.goto(localeUrl('/pokemon/charmander', locale))

    for (const key of ['species.height', 'species.weight', 'species.rarity'] as const) {
      await expect(
        page.getByText(label(key, locale), { exact: true }),
        `/pokemon/charmander in ${locale} did not draw ${key}`,
      ).toBeVisible()
    }

    // The *About* panel opens without a click — it is the tab the board marks.
    const about = page.getByRole('tabpanel', { name: label('species.tabs.about', locale) })

    await expect(about.getByText(label('species.about.captureRate', locale))).toBeVisible()
    await expect(
      about.getByText(label('habitat.mountain', locale), { exact: true }),
      `/pokemon/charmander in ${locale} did not translate the habitat`,
    ).toBeVisible()

    // And the habitat of the other language is not on the panel. `Montanha` and
    // `Mountain` are two words, so a page stuck in one language is visible here.
    const foreign = codes
      .filter(code => code !== locale)
      .map(code => label('habitat.mountain', code))
      .filter(word => word !== label('habitat.mountain', locale))

    expect(foreign.length, `no habitat left that tells ${locale} apart`).toBeGreaterThan(0)

    const panel = await about.innerText()

    expect(
      foreign.filter(word => spells(panel, word)),
      `/pokemon/charmander in ${locale} drew the habitat of another language`,
    ).toEqual([])

    const evolutionTab = label('species.tabs.evolution', locale)
    const evolution = page.getByRole('tabpanel', { name: evolutionTab })

    await expect(async () => {
      await page.getByRole('tab', { name: evolutionTab }).click()
      await expect(evolution.getByText(label('dex.chain.title', locale))).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })

    // The sentence, composed: the message with the number in it, and not the
    // message with `{level}` still in it — which is what an unfilled
    // placeholder would leave on the arrow.
    const condition = label('evolution.main.level', locale).replace('{level}', '16')

    await expect(
      evolution.getByText(condition, { exact: true }).first(),
      `/pokemon/charmander in ${locale} did not write the evolution condition`,
    ).toBeVisible()

    // The three links that left the exception list of `locale-link-gate`: the
    // two crumbs and the card of the next stage.
    const prefix = locale === defaultLocale() ? '' : `/${locale}`

    await expect(page.locator(`.hero__crumbs a[href="${prefix}/pokedex"]`)).toBeVisible()
    await expect(page.locator(`.hero__crumbs a[href="${prefix}/pokedex/1"]`)).toBeVisible()
    await expect(
      evolution.locator(`a[href="${prefix}/pokemon/charmeleon"]`),
      `the evolution line of /pokemon/charmander in ${locale} left the locale`,
    ).toBeVisible()
  }
})

/**
 * The two Pokédex screens, in the language of the URL — and the links that make
 * the rest of `/en` exist at all.
 *
 * **The links are the load-bearing half, and they are load-bearing twice.** For
 * the player they are issue #37: from `/en/pokedex`, a literal `to="/pokedex/1"`
 * renders the same `href` it renders in Portuguese and drops whoever clicks it
 * out of English with no way back but the URL bar. For the build they are the
 * crawler's only path: with them literal, the prerender stopped after nine `/en`
 * pages, and with them localized it reaches 1.043 — measured, and asserted route
 * by route in `test/e2e/prerender-payload.spec.ts`.
 *
 * So this walks the same two hops a player walks, in both languages, and reads
 * the `href` at each one: index → region → species. The species page itself is
 * the previous PR's test; what is new is that a click gets there.
 */
test('the Pokédex screens read in the language of the URL, links included', async ({ page }) => {
  const codes = localeCodes()

  expect(codes.length).toBeGreaterThan(1)

  for (const locale of codes) {
    const prefix = locale === defaultLocale() ? '' : `/${locale}`

    await page.goto(localeUrl('/pokedex', locale))

    await expect(page.getByText(label('pokedex.overline', locale))).toBeVisible()
    await expect(page.getByText(label('pokedex.intro', locale))).toBeVisible()

    // The word of the other language is absent. `pokedex.overline` is two words
    // in both, so a page stuck in one of them is visible here — which a shared
    // abbreviation would not be.
    const foreign = codes
      .filter(code => code !== locale)
      .map(code => label('pokedex.overline', code))
      .filter(text => text !== label('pokedex.overline', locale))

    expect(foreign.length, `no wording left that tells ${locale} apart`).toBeGreaterThan(0)

    // **`main > header` and not `header`, and `screenText` and not `innerText`
    // — this assertion was dead on both counts, found while fixing the sweep of
    // `/settings`.** `locator('header').first()` is the global bar, which never
    // writes `pokedex.overline` at all; and the overline is a Tailwind
    // `uppercase`, so `innerText` returned `COMPLETE REFERENCE` against a token
    // spelled `Complete reference`, which `spells` compares case sensitive.
    // Either one alone made this pass over a page stuck in one language.
    const header = await screenText(page.locator('main > header'))

    expect(
      foreignPhrases(header, foreign),
      `/pokedex in ${locale} wrote the other language`,
    ).toEqual([])

    // The progress bar's `aria-valuetext`, which nothing else reaches. It is an
    // attribute, so it never lands in `innerText` and the sweep above walks past
    // it; it is interpolated, so `defaultOnlyLabels` skips it too. It held a raw
    // `capturados` until this PR — on this very screen, in English — and the
    // unit test that mounts the bar cannot see that: it builds its expectation
    // from the same locale file the component reads, so it agrees with a
    // hardcoded string as readily as with a translated one. Only the other
    // language tells the two apart, which is why the assertion lives here.
    const bar = page.locator('[role="progressbar"]').first()

    await expect(bar, `/pokedex in ${locale} drew no progress bar`).toBeVisible()

    const valueText = await bar.getAttribute('aria-valuetext') ?? ''

    expect(
      spells(valueText, progressWord(locale)),
      `the progress bar in ${locale} does not read from the locale`,
    ).toBe(true)
    expect(
      codes
        .filter(code => code !== locale && progressWord(code) !== progressWord(locale))
        .filter(code => spells(valueText, progressWord(code))),
      `the progress bar in ${locale} wrote the other language`,
    ).toEqual([])

    // Hop one: the region card. This is the link the prerender crawler follows.
    const region = page.locator(`a[href="${prefix}/pokedex/1"]`)

    await expect(region, `/pokedex in ${locale} did not link the region in-locale`).toBeVisible()
    await region.click()
    await expect(page).toHaveURL(new RegExp(`${prefix}/pokedex/1$`))

    // The chips carry a word and a count, and the count is a slot inside the
    // message — a chip that lost its number would still match the word.
    await expect(page.getByRole('button', {
      name: message('dex.filters.all', locale, { count: 151 }),
    })).toBeVisible()

    await expect(page.locator('.grid-footer__note')).toHaveText(label('dex.grid.note', locale))

    // Hop two: a card. `PokeCard` renders the link for every screen that draws a
    // card, so this is the one assertion covering all 1025 of them.
    const card = page.locator(`a[href="${prefix}/pokemon/bulbasaur"]`)

    await expect(card, `/pokedex/1 in ${locale} did not link the species in-locale`).toBeVisible()

    // And the accessible name of that link is a sentence, not a key: it is built
    // from four messages and read out in place of the card's artwork.
    //
    // Read with `spells()` rather than a regular expression of our own: it is
    // the same escaping `locales.ts` already does in two places, plus the word
    // borders a bare `new RegExp` has no way to carry — without them, a rarity
    // that is a prefix of another matches inside it.
    const cardLabel = await card.getAttribute('aria-label') ?? ''

    expect(
      spells(cardLabel, label('rarity.common', locale)),
      `the card in ${locale} does not name its rarity`,
    ).toBe(true)
  }
})

/**
 * The word `collection.progress.valueText` spells around its count.
 *
 * Taken from the message with the placeholder cut out, and not written here:
 * *capturados* and *caught* are the halves that tell the two renderings apart,
 * and a copy of either in this file would go stale the day the wording changes —
 * leaving an assertion that still passes and no longer means anything.
 */
function progressWord(code: string): string {
  return label('collection.progress.valueText', code).replaceAll(/\{\w+\}/g, '').trim()
}
