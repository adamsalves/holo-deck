import { expect, test } from '@playwright/test'
import { NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '../../app/utils/nav-links.ts'
import {
  defaultLocale,
  defaultOnlyLabels,
  label,
  localeCodes,
  localeUrl,
  message,
  messagePattern,
  spells,
} from '../support/locales'
import { navLabel, openingProgress, saveWith, seedLocalSave, skipInvite } from './support'

/**
 * O ciclo da Fase 5, num navegador de verdade.
 *
 * O que só o E2E prova aqui é a **travessia**: o pack credita a coleção, a
 * coleção sobrevive ao reload, e o número que a Pokédex mostra é o mesmo que o
 * binder soma. Cada peça tem teste de unidade — a distribuição do pack, a
 * migração do save, os degraus da barra —, e nenhum deles alcança o defeito que
 * este arquivo pega: o `useAsyncData` que devolvia `true` e deixava o binder
 * abrir com `30 / 0`, verde no lint, verde nos 454 unitários, e quebrado na tela.
 *
 * Roda contra `yarn preview` — o build pré-renderizado, que é onde a coleção
 * mora só no cliente e o HTML servido não sabe nada dela.
 */

/**
 * Six species, which is what the Hub asks for before it writes *DESAFIAR*.
 *
 * They are spelled out rather than opened from packs because a pack draws at
 * random, and a test about links should not depend on what came out of one.
 *
 * **Not any six, and the earlier note here said otherwise.** The challenge door
 * only looks at the deck being full — that part was right — but the Hub also
 * calls `invite.offer()` when the profile owns an ultra or above, and the invite
 * is a `role="dialog" aria-modal="true"` over the whole screen. These six are
 * all common but for Snorlax, which is rare, so the dialog stays shut *by
 * accident*: swap one for a legendary — exactly what "any six do" invited — and
 * the test fails for a reason that has nothing to do with links. The
 * `skipInvite` below is what makes the choice not matter, and it is the house
 * pattern for it.
 */
const READY_DECK = [1, 4, 7, 25, 133, 143]

/**
 * **Não há `beforeEach` limpando o save, e isso é decisão.** O Playwright já dá
 * um contexto novo por teste, então `localStorage` nasce vazio — os três packs
 * de boas-vindas estão disponíveis sem ninguém pedir.
 *
 * A primeira versão deste arquivo limpava mesmo assim, com
 * `page.addInitScript(() => localStorage.clear())`. O script de init roda em
 * **toda navegação**, não uma vez por teste: os três packs eram abertos, o
 * `goto('/collection')` disparava a limpeza de novo, e o binder abria com
 * `0 / 1025`. O teste acusava o código, e o defeito era dele.
 */

test('os três packs de boas-vindas enchem o binder, e o save sobrevive ao reload', async ({ page }) => {
  // O convite sai da frente: um dos três packs pode sortear um ultra, e o
  // diálogo modal engoliria o clique de *ABRIR O PRÓXIMO*. Ver `skipInvite`.
  await skipInvite(page)
  await page.goto('/packs')

  // A loja abre em `Packs`, e o cartão de estreia é o primeiro da fileira. O
  // título vira `Abrir pack` só depois do clique, que é a outra metade da tela.
  await expect(page.getByRole('heading', {
    level: 1,
    name: label('packs.shop.title', defaultLocale()),
  })).toBeVisible()
  await expect(page.getByText(
    message('packs.welcome.eyebrow', defaultLocale(), { number: 1, total: 3 }),
  )).toBeVisible()

  // O clique só vale depois da hidratação — antes dela o botão é marcação. Mesmo
  // `toPass` que a suíte da Pokédex usa pelas abas.
  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText(openingProgress())).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  // Dez cartas, e a composição do pack: seis comuns, três incomuns, uma raro+.
  const cards = page.locator('.opener__slot')
  await expect(cards).toHaveCount(10)
  await expect(page.locator('.opener__slot[data-rarity="common"]')).toHaveCount(6)
  await expect(page.locator('.opener__slot[data-rarity="uncommon"]')).toHaveCount(3)

  // A tira termina em `10 / 10`, e não em `11 / 10`: o contador do opener é por
  // pack, e a instância do componente atravessa as três aberturas sem desmontar.
  const counter = page.getByText(/\d+ \/ 10 reveladas/)
  await expect(counter).toHaveText(message('packs.opening.revealed', defaultLocale(), { revealed: 10, total: 10 }))

  // Os dois packs restantes. A asserção do contador se repete aqui de propósito:
  // é no **segundo** pack que a contagem continuava de onde parou, e um laço que
  // só conte cartas veria dez das duas vezes sem notar `20 / 10` no cabeçalho.
  for (let pack = 2; pack <= 3; pack += 1) {
    await page.getByRole('button', { name: label('packs.again.welcome', defaultLocale()) }).click()
    await expect(cards).toHaveCount(10)
    await expect(counter).toHaveText(message('packs.opening.revealed', defaultLocale(), { revealed: 10, total: 10 }))
  }

  // Acabaram: o botão some e o baralho fica desabilitado.
  await expect(page.getByRole('button', { name: label('packs.again.welcome', defaultLocale()) })).toHaveCount(0)

  await page.goto('/collection')

  await expect(page.getByRole('heading', {
    level: 1,
    name: label('collection.title', defaultLocale()),
  })).toBeVisible()
  await expect(page.getByText('/ 1025')).toBeVisible()

  // Uma barra por região. `toHaveCount` e não `count()`: o binder inteiro é
  // `<ClientOnly>`, então no primeiro instante depois do `goto` não há barra
  // nenhuma — uma leitura de uma vez só mediria a tela antes de ela existir.
  await expect(page.locator('[role="progressbar"]')).toHaveCount(9)

  // 30 cartas em 3 packs, mas espécies **distintas** podem ser menos: duas
  // cartas podem repetir entre packs. A asserção é sobre a faixa e não sobre o
  // número exato — 30 aberturas de 1025 espécies quase nunca colidem, e "quase
  // nunca" não é coisa que um teste deva afirmar.
  //
  // `expect.poll` e não `count()` direto: as cartas entram depois do
  // `<ClientOnly>` **e** depois do índice chegar, então uma leitura única mede a
  // tela num instante em que ela ainda tem zero.
  const binderCards = page.locator('.binder-card')
  await expect.poll(() => binderCards.count()).toBeGreaterThan(20)

  const before = await binderCards.count()
  expect(before).toBeLessThanOrEqual(30)

  // A prova do save: recarregar não é navegação de cliente, é boot do zero.
  await page.reload()
  await expect(binderCards).toHaveCount(before)
})

test('a Pokédex conta o que o binder tem, e o filtro de posse separa os dois lados', async ({ page }) => {
  // Um ultra sorteado abriria o convite por cima da tela. Ver `skipInvite`.
  await skipInvite(page)
  await page.goto('/packs')

  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText(openingProgress())).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await page.goto('/pokedex/1')

  // A contagem do cabeçalho e a do filtro saem de caminhos diferentes — uma
  // conta espécies da região no save, a outra recebe o mesmo número como prop.
  // Elas discordarem é o defeito que este teste existe para pegar.
  const ownedChip = page.getByRole('button', {
    name: messagePattern('dex.filters.owned', defaultLocale()),
  })
  await expect(ownedChip).toBeVisible({ timeout: 15_000 })

  const chipText = (await ownedChip.textContent()) ?? ''
  const ownedCount = Number(chipText.replace(/\D/g, ''))

  await expect(page.getByText(
    message('pokedex.owned', defaultLocale(), { owned: ownedCount, total: 151 }),
  )).toBeVisible()

  // Possuídos e faltando particionam as 151: o rótulo de um é o complemento do
  // outro, e não há terceira classe.
  await expect(page.getByRole('button', {
    name: message('dex.filters.missing', defaultLocale(), { count: 151 - ownedCount }),
  })).toBeVisible()

  await ownedChip.click()

  const shown = page.locator('.dex-card')
  await expect(shown).toHaveCount(ownedCount)
  await expect(page.locator('.dex-card--missing')).toHaveCount(0)

  // Ligar *Faltando* desliga *Possuídos* — posse é exclusiva, ao contrário de
  // tipo e raridade.
  await page.getByRole('button', {
    name: messagePattern('dex.filters.missing', defaultLocale()),
  }).click()
  await expect(ownedChip).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.dex-card:not(.dex-card--missing)')).toHaveCount(0)
})

test('sem coleção, a Pokédex não afirma uma coleção vazia', async ({ page }) => {
  await page.goto('/pokedex/1')

  await expect(page.getByRole('heading', { level: 1, name: 'Kanto' })).toBeVisible()

  // Com save limpo a contagem é real e é zero — o que a tela não pode fazer é
  // escrever `0 / 151` **antes** de saber, que é o caso que `null` cobre. Aqui a
  // asserção é que o grupo de posse existe e diz a verdade.
  await expect(page.getByRole('button', {
    name: message('dex.filters.owned', defaultLocale(), { count: 0 }),
  })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', {
    name: message('dex.filters.missing', defaultLocale(), { count: 151 }),
  })).toBeVisible()
  await expect(page.locator('.dex-card:not(.dex-card--missing)')).toHaveCount(0)
})

/**
 * A porta, que agora é a barra global.
 *
 * A Fase 3 já teve um defeito desta família — a raiz não levava à Pokédex —, e
 * cada fase seguinte acrescentou tela: sem link, elas existem no build e não
 * existem para quem joga. Até o PR anterior quem guardava isso era a fileira
 * provisória de portas do Hub; agora é a barra, e a checagem passou a valer **de
 * qualquer tela**, não só da raiz.
 *
 * O que este teste prova e o portão de `nav-gate.spec.ts` não alcança é o
 * caminho inteiro: o link existe no `AppNav`, o layout o coloca na tela, o
 * clique navega, e a rota de destino renderiza o `<h1>` que se espera. O portão
 * lê o disco; este anda pelo produto.
 */
test('a barra global leva a todas as telas, e de qualquer tela', async ({ page }) => {
  /**
   * Onde cada destino chega. **A lista de destinos vem do módulo**, e este mapa
   * só diz o que esperar em cada um.
   *
   * A inversão importa: um destino novo na barra sem linha aqui reprova na
   * primeira asserção, em vez de silenciosamente deixar de ser visitado — que é
   * o que uma lista de portas escrita à mão fazia. Era a mesma lista de entrada
   * que o `nav-gate` tinha, e pela mesma razão ela falhava em silêncio.
   */
  const arrivals: Record<string, { url: RegExp, title: string, root: string }> = {
    '/': { url: /\/$/, title: 'Base', root: '.hub' },
    '/packs': { url: /\/packs$/, title: 'Packs', root: '.packs' },
    '/pokedex': { url: /\/pokedex$/, title: 'Pokédex', root: 'main' },
    '/collection': { url: /\/collection$/, title: 'Binder', root: '.collection' },
    '/deck': { url: /\/deck$/, title: 'Seu time', root: '.deck' },
    '/league': { url: /\/league$/, title: 'A Liga', root: '.league' },
    '/rules': { url: /\/rules$/, title: 'Regras', root: '.rules' },
    '/settings': { url: /\/settings$/, title: 'Seu save e este aparelho', root: '.settings' },
  }

  const destinations = [...NAV_LINKS, NAV_RULES, NAV_SETTINGS]

  // O par da lista de saída: todo destino que a barra declara é visitado abaixo.
  expect(destinations.filter(destination => !(destination.to in arrivals)).map(d => d.to)).toEqual([])
  expect(destinations.length).toBeGreaterThan(5)

  // De uma tela **interna**, não da raiz: é a barra que precisa estar em toda
  // parte, e sair sempre do Hub esconderia um layout aplicado só a ele.
  await page.goto('/collection')

  /**
   * Visível, e não presente no arquivo — é esta asserção que o portão de disco
   * não consegue fazer.
   *
   * `nav-gate.spec.ts` importa a mesma lista e prova que a rota existe; o que
   * ele não alcança é o link **renderizado**. Um `v-if="false"` em volta do
   * `<NuxtLink>`, ou um `v-if` de feature flag esquecido, deixa a lista intacta
   * e a barra sem o link — e só um clique de verdade percebe.
   */
  for (const destination of destinations) {
    await expect(page.getByRole('link', { name: navLabel(destination.label), exact: true })).toBeVisible()
  }

  for (const destination of destinations) {
    const expected = arrivals[destination.to]
    if (expected === undefined) continue

    await page.goto('/collection')
    await page.getByRole('link', { name: navLabel(destination.label), exact: true }).click()
    await expect(page).toHaveURL(expected.url)

    // The Hub's heading is hidden — its board draws no title — and still has the
    // one-pixel box that counts as visible, so every door is asserted the same way.
    await expect(page.getByRole('heading', { level: 1, name: expected.title })).toBeVisible()
    await expect(page.locator(expected.root).first()).toBeVisible()
  }
})

/**
 * O `aria-current` acompanha o sublinhado, inclusive em rota aninhada.
 *
 * O `NuxtLink` pronto só emite `aria-current` em casamento **exato**, então em
 * `/pokedex/kanto` o sublinhado de *Pokédex* aparecia e quem navega por leitor
 * de tela não recebia indicação nenhuma de seção atual. As duas coisas saem do
 * mesmo booleano agora, e este teste é o que impede elas de divergirem de novo.
 *
 * **Ele itera os locales, e a versão de um idioma só deixou o defeito voltar.**
 * Com `prefix_except_default`, `route.path` em inglês é `/en/collection` e o
 * `to` do link é `/collection`: nenhum dos dois ramos de `isCurrent` casava, e
 * **toda** rota `/en/…` saía sem seção marcada — medido no `.output`, zero
 * `aria-current` contra um no português. O portão rodava no único idioma em que
 * o código quebrado funcionava, que é o mesmo modo de falhar da Fase 3.
 */
test('a barra marca a seção atual, e só uma, em todo idioma', async ({ page }) => {
  const locales = localeCodes()

  // O outro lado: com um locale só, o laço abaixo não mede idioma nenhum.
  expect(locales.length).toBeGreaterThan(1)

  for (const locale of locales) {
    await page.goto(localeUrl('/pokedex/1', locale))

    const current = page.locator('.nav__link[aria-current="page"]')
    await expect(current, `seção atual em ${locale}`).toHaveCount(1)
    await expect(current).toHaveText(navLabel('nav.pokedex', locale))

    // A raiz é o caso em que a marca e *Base* apontam para o mesmo lugar: só o
    // link da seção carrega `aria-current`, e a marca não.
    await page.goto(localeUrl('/', locale))
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(page.locator('[aria-current="page"]')).toHaveText(navLabel('nav.base', locale))
  }
})

/**
 * Sair do idioma tem de ser escolha do jogador, nunca consequência de clicar.
 *
 * `NuxtLink` com caminho literal **não** é localizado pelo módulo — quem faz
 * isso é `localePath`. Sem ele, a barra de `/en/collection` saía com
 * `href="/deck"`: o jogador clicava em *Deck*, a interface inteira virava
 * português, e não havia caminho de volta sem editar a URL à mão. As 1.052
 * páginas de `/en` existiam no build e não existiam para quem joga, que é o
 * defeito que o `nav-gate` e o `AppAccount` desta base já pagaram duas vezes.
 *
 * Os destinos vêm de `nav-links`, não de uma lista escrita aqui: um destino novo
 * entra nesta varredura por existir.
 */
test('a barra não tira o jogador do idioma em que ele está', async ({ page }) => {
  const prefixed = localeCodes().filter(code => code !== defaultLocale())

  // O outro lado: sem locale prefixado, o laço abaixo não visita nada.
  expect(prefixed.length).toBeGreaterThan(0)

  for (const locale of prefixed) {
    for (const link of [...NAV_LINKS, NAV_RULES, NAV_SETTINGS]) {
      await page.goto(localeUrl('/collection', locale))
      await page.getByRole('link', { name: navLabel(link.label, locale), exact: true }).click()

      await expect(page, `${link.to} em ${locale}`).toHaveURL(new RegExp(`/${locale}(/|$)`))
    }
  }
})

/**
 * And the screens, which is the half that was missing — and the one the defect
 * walked through.
 *
 * The gate in `test/unit/locale-link-gate.spec.ts` reads the source and demands
 * `localePath` of every link; **disk does not reach the screen**. That gap is
 * exactly the one PR 1 paid for: nothing in the suite visited `/en`, and the bar
 * shipped `href="/deck"` on every English route with no check going red.
 *
 * It names no link: it sweeps **every** internal `href` on the page and demands
 * the prefix. A new link enters this measurement by existing, which is the same
 * inversion the disk gate applies from the other side.
 *
 * **And it demands the language of the text, not only of the link.** Without
 * that, `/en` had both halves of the measurement for the *link* and only the
 * disk half for the *sentence*: a key translated into nothing, or a screen
 * wired to the wrong one, reached the player with no assertion in its way.
 *
 * **What it still does not reach is a literal that was never a key**, and an
 * earlier version of this docblock claimed the opposite. Measured, not argued:
 * `<p class="packs__eyebrow">Aguarde um instante, estamos carregando</p>` was
 * planted in `packs.vue`, and `/packs` passed every assertion below. It cannot
 * be otherwise — the sweep's list is built from the locale files, and a sentence
 * that is in no locale file cannot be in it. `defaultOnlyLabels` says this in
 * its own docblock, and that is the half that was right.
 *
 * What does guard it is a **template-text gate on disk**, which does not exist
 * yet. Until it does, this is the boundary, written where the next person will
 * look for it rather than in a claim that reads as covered.
 *
 * Each screen's key is picked from inside the panel the screen already waits
 * for, and the test **refuses a key whose two languages are identical**: a label
 * that does not change between locales would pass without measuring anything,
 * which is how a language assertion dies without saying so.
 *
 * The profile is new on purpose. With cards, the binder draws the grid's
 * `PokeCard`, and their `to` is one of the links issue #37 still owes — the
 * assertion would go red over a defect this PR did not set out to fix, and the
 * gate's exception list is what records it.
 */
test('from inside `/en`, the screens keep the locale in links and in text', async ({ page }) => {
  const prefixed = localeCodes().filter(code => code !== defaultLocale())

  // The other side: with no prefixed locale, the loop below visits nothing.
  expect(prefixed.length).toBeGreaterThan(0)

  // `speaks` lives inside the panel `ready` waits for, and not in some corner
  // of the screen: a key picked outside it would measure the bar, which PR 1
  // already fixed, and would call the screen translated when only the frame is.
  const screens = [
    { path: '/', ready: '.hub__panel', speaks: 'hub.next.challenge' },
    { path: '/packs', ready: '.packs__offer', speaks: 'packs.shop.rng' },
    { path: '/collection', ready: '.collection__empty', speaks: 'collection.eyebrow' },
    { path: '/deck', ready: '.deck-slot', speaks: 'deck.eyebrow' },
  ]

  for (const locale of prefixed) {
    const leaked = defaultOnlyLabels(locale)

    // The other side, derived instead of arbitrary. The floor was `> 50` against
    // 108 labels, so 57 could leave the list before the assertion moved — and
    // leaving the list is what an untranslated label **does**, since
    // `defaultOnlyLabels` drops whatever is identical in both languages. Now the
    // list has to carry the default label of every key this test will look for
    // on screen: without it, the sweep could not catch that screen's regression.
    expect(leaked, `nada difere entre ${defaultLocale()} e ${locale}`).not.toEqual([])
    expect(
      screens.map(({ speaks }) => label(speaks, defaultLocale()))
        .filter(text => !leaked.includes(text)),
      `estes rótulos saíram da varredura de ${locale}`,
    ).toEqual([])

    for (const { path, ready, speaks } of screens) {
      await page.goto(localeUrl(path, locale))

      // Everything these screens show lives inside `ClientOnly`: before
      // hydration the page has the bar and nothing else, and the sweep would
      // measure only the links the previous PR already fixed.
      await expect(page.locator(ready).first()).toBeVisible()

      // The other side of the language assertion: a label identical in both
      // locales would pass in `/en` without proving any translation.
      expect(
        label(speaks, locale),
        `\`${speaks}\` é igual nos dois idiomas e não mede tradução`,
      ).not.toBe(label(speaks, defaultLocale()))

      await expect(
        page.getByText(label(speaks, locale)).first(),
        `${path} em ${locale} desenha o corpo da tela em português`,
      ).toBeVisible()

      // And no label of the default locale leaked into this screen. The list
      // comes from the two locale files and is never written here: a new label
      // enters the measurement by being translated differently.
      //
      // **Case-insensitive, and that was measured, not assumed.** `innerText`
      // returns the text as the CSS draws it, and this theme carries 36
      // `text-transform: uppercase` declarations across 20 files of `app/`: with
      // `Montagem de deck` planted on the screen by hand, the case-sensitive
      // sweep looked for that while the page said `MONTAGEM DE DECK` — defect on
      // screen, assertion green. `textContent` would return the text without the
      // transform, but it drags along the content of `<script>`, where the Nuxt
      // payload carries labels in both languages.
      //
      // **And it matches on a letter border, not as a substring.** `includes`
      // was enough while every label was a word or a phrase, and stopped being
      // enough at the first three-letter one: `ATE`, the pt-BR badge for special
      // attack, is inside *rate*, *duplicate* and *separate*, so it reported
      // `/en/packs` as leaking Portuguese while that screen was right. It is the
      // same border the `rules-gate` docblock explains — a sweep has to exclude
      // every class the value can hide in, and for a word that class is letters
      // and digits, not only the one it is matching. It lives in `spells()` in
      // `test/support/locales.ts`, because the three stat e2e ask it too.
      const body = (await page.locator('body').innerText())
        .replaceAll(/\s+/g, ' ')
        .toLowerCase()

      expect(
        leaked.filter(text => spells(body, text.toLowerCase())),
        `${path} em ${locale} mostra rótulo em ${defaultLocale()}`,
      ).toEqual([])

      const hrefs = await page.locator('a[href^="/"]').evaluateAll(
        links => links.map(link => link.getAttribute('href') ?? ''),
      )

      // Derived too: `> 5` was a hand-written floor against 12 real links. The
      // global bar reaches six destinations on every screen, and those are what
      // this demands — a new destination enters the measurement by existing in
      // `nav-links`, the same inversion the disk gate applies.
      expect(
        [...NAV_LINKS, NAV_RULES, NAV_SETTINGS]
          .map(link => localeUrl(link.to, locale))
          .filter(href => !hrefs.includes(href)),
        `${path} em ${locale} perdeu destinos da barra`,
      ).toEqual([])
      expect(
        hrefs.filter(href => !href.startsWith(`/${locale}/`) && href !== `/${locale}`).sort(),
        `${path} em ${locale} devolve o jogador ao idioma padrão`,
      ).toEqual([])
    }
  }
})

/**
 * The destination built in a template literal, which is the shape no list sees.
 *
 * `` :to="`/battle/${gym}`" `` appears neither in `NAV_DESTINATIONS` nor in a
 * search for `to="/…"`, and it is the shape the Hub uses for both doors into a
 * battle. The test above only reaches it with a full deck — without six cards
 * the Hub writes *MONTAR O DECK* — so it gets a seeded save and an assertion
 * that **names** the link: a sweep that failed to find the door would pass in
 * silence.
 */
test('the Hub battle link, built in a template literal, carries the locale', async ({ page }) => {
  const prefixed = localeCodes().filter(code => code !== defaultLocale())
  expect(prefixed.length).toBeGreaterThan(0)

  for (const locale of prefixed) {
    // The invite gets out of the way before the save: with an ultra or a
    // legendary in the profile, the Hub opens the modal dialog on top and the
    // battle link becomes unreachable. See `READY_DECK`, which does not trigger
    // it today — and should not depend on that.
    await skipInvite(page)
    await seedLocalSave(page, saveWith({
      collection: Object.fromEntries(READY_DECK.map(id => [id, { c: 1, s: 0 }])),
      deck: READY_DECK,
    }))
    await page.goto(localeUrl('/', locale))

    const challenge = page.getByRole('link', { name: label('hub.next.fight', locale) })
    await expect(challenge).toBeVisible()
    await expect(challenge).toHaveAttribute('href', new RegExp(`^/${locale}/battle/\\d+$`))
  }
})

/**
 * O link de pular navegação, que é a primeira parada de tabulação de toda tela.
 *
 * A barra põe nove elementos focáveis antes do conteúdo; sem ele, quem navega
 * por teclado atravessa os nove em cada página (WCAG 2.4.1).
 */
test('a primeira tabulação de qualquer tela é pular para o conteúdo', async ({ page }) => {
  await page.goto('/collection')

  await page.keyboard.press('Tab')

  const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo' })
  await expect(skipLink).toBeFocused()

  await skipLink.click()
  await expect(page.locator('#content')).toBeFocused()
})

/**
 * A batalha **não** recebe a barra, e a prancha *Batalha* é quem decide isso:
 * ela desenha uma barra própria no lugar dos seis destinos.
 *
 * Vale um teste porque o mecanismo é uma linha fácil de perder — um
 * `definePageMeta({ layout: false })` some num refactor sem nada reclamar, e o
 * sintoma é uma tela de batalha oferecendo sair no meio do turno 12.
 */
test('a tela de batalha não recebe a barra global', async ({ page }) => {
  await page.goto('/battle/1')

  await expect(page.locator('.battle')).toBeVisible()
  await expect(page.locator('.nav')).toHaveCount(0)
})

/**
 * O link da carta virou **camada**, e isso é comportamento que só o navegador vê.
 *
 * Até a Fase 5 o link envolvia a carta e o botão de moer vivia fora dela, embaixo
 * — era essa a razão de a altura divergir (issue #24). Agora o link é um
 * `position: absolute` cobrindo a carta por dentro, e o rodapé com ação sobe uma
 * camada para receber o próprio clique.
 *
 * A troca move o risco para onde nenhum teste de unidade alcança: `happy-dom` não
 * resolve empilhamento, então lá o botão e o link coexistem felizes mesmo que na
 * tela um cubra o outro. O que o portão de unidade prova é a **estrutura** (o
 * botão não está dentro do `<a>`); o que falta provar é que o clique vai para o
 * elemento certo — e um `z-index` errado aqui faria o jogador **navegar** quando
 * pediu para moer, perdendo o pó sem nenhum erro aparecer.
 */
test('a carta navega pelo link-camada, e o rodapé de moer fica acima dele', async ({ page }) => {
  // Este teste é sobre qual elemento recebe o clique: um modal sorteado por cima
  // dele mediria o convite, não o empilhamento. Ver `skipInvite`.
  await skipInvite(page)
  await page.goto('/packs')

  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText(openingProgress())).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await page.goto('/collection')

  const binderCards = page.locator('.binder-card')
  await expect.poll(() => binderCards.count()).toBeGreaterThan(5)

  // 1. Clicar a carta navega — em qualquer ponto dela, e não só sobre um texto.
  //    Um `z-index` baixo demais deixaria a arte e o nome por cima do link, e o
  //    clique morreria neles. O Playwright afirma isso de graça: a checagem de
  //    acionabilidade exige que o elemento no ponto do clique seja a carta ou um
  //    descendente dela, e é o link que está lá.
  const first = binderCards.first()
  const name = (await first.locator('.poke-card__name').textContent())?.trim() ?? ''
  await first.click()

  await expect(page).toHaveURL(/\/pokemon\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // 2. Agora o outro lado. Uma duplicata não é garantida em 10 cartas de 1025,
  //    então ela é plantada **no formato real do save** — lido, alterado e
  //    devolvido, sem um documento escrito à mão que envelheceria com o schema.
  await page.goto('/collection')
  await page.evaluate(() => {
    const raw = localStorage.getItem('holodeck:save')
    if (raw === null) throw new Error('sem save depois de abrir um pack')

    // Sem `as`: cada degrau estreita de verdade, que é a mesma regra que o resto
    // do repositório aplica na fronteira de `JSON.parse`.
    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null || !('collection' in save)) {
      throw new Error('save sem coleção')
    }

    const { collection } = save
    if (typeof collection !== 'object' || collection === null) {
      throw new Error('coleção ilegível')
    }

    const first = Object.keys(collection)[0]
    if (first === undefined) throw new Error('coleção vazia depois de abrir um pack')

    Object.assign(collection, { [first]: { c: 3, s: 0 } })
    localStorage.setItem('holodeck:save', JSON.stringify(save))
  })
  await page.reload()

  // A linha `2 dup · N pó` existe porque a espécie plantada tem três cópias.
  const scrap = page.locator('.binder-card__scrap').first()
  await expect(scrap).toBeVisible({ timeout: 15_000 })

  await scrap.click()

  // O clique moeu, e **não** navegou: continuamos no binder, e a linha sumiu
  // porque a espécie deixou de ter duplicata. Se o link tivesse engolido o
  // clique, a URL seria a da espécie.
  await expect(page).toHaveURL(/\/collection$/)
  await expect(scrap).toHaveCount(0)
})
