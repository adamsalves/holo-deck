import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { MOVES_IN_BATTLE, STAT_NAMES } from '../../shared/types/dex.ts'
import { statKey, statNameKey } from '../../shared/types/game.ts'
import {
  defaultLocale,
  label,
  leafEntries,
  localeCodes,
  localeUrl,
  message,
  messagePattern,
  readLocale,
} from '../support/locales'
import { openWelcomePack } from './support'

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

/**
 * The language this suite was written in, and where it reads every sentence from.
 *
 * The assertions stopped repeating the text by hand: a `TURNO 01` spelled here
 * ages next to the locale, and when the translation changes the test fails
 * saying the screen is gone rather than that the sentence moved.
 */
const PT = defaultLocale()

/** `TURNO 01` — the label from the locale plus the number the screen pads. */
function atTurn(turn: number): string {
  return `${label('battle.bar.turn', PT)} ${String(turn).padStart(2, '0')}`
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

  await expect(
    page.getByRole('heading', { level: 1, name: label('league.title', PT) }),
  ).toBeVisible()

  // Nove cartas, e o desbloqueio sequencial visível: uma atual, oito trancadas.
  await expect(page.locator('.gym')).toHaveCount(9)
  await expect(page.locator('.gym--current')).toHaveCount(1)
  await expect(page.locator('.gym--locked')).toHaveCount(8)
  await expect(page.locator('.gym--won')).toHaveCount(0)

  // O painel do próximo traz o prêmio da estreia — `200 + 100 × 1` —, e a carta
  // do ginásio estampa o mesmo número no botão. Os dois vêm de `rewardPreview`.
  await expect(page.locator('.league__prize')).toHaveText('+300')
  await expect(page.locator('.gym--current .gym__challenge'))
    .toHaveText(message('league.gym.challenge', PT, { coins: '300' }))

  // Sem deck não há desafio: a tela oferece o que falta em vez de um botão que
  // levaria a uma batalha que o motor recusa.
  await expect(
    page.getByRole('link', { name: messagePattern('league.next.buildDeck', PT) }),
  ).toBeVisible()
})

test('um ginásio trancado recusa pela URL, e não só pelo botão', async ({ page }) => {
  // A trava é da store e é cobrada na página: `/battle/9` é uma URL, e digitá-la
  // no primeiro minuto de jogo seria o caminho mais curto para pular a campanha.
  await page.goto('/battle/9')

  await expect(
    page.getByRole('heading', { name: label('battle.standing.lockedTitle', PT) }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: label('battle.standing.lockedAction', PT) }),
  ).toBeVisible()
})

test('a batalha começa, sobrevive ao reload e termina', async ({ page }) => {
  await openWelcomePack(page)
  await fillDeck(page)

  await page.goto('/league')
  await page.getByRole('link', {
    name: label('league.next.challengeAction', PT),
    exact: true,
  }).click()

  // O campo montou: dois painéis de combatente, os golpes e o cabeçalho.
  await expect(page.getByText(message('battle.bar.gym', PT, { gym: 1, total: 9 }))).toBeVisible()
  await expect(page.locator('.combatant')).toHaveCount(2)

  // **De um a quatro golpes, e não quatro.** O deck sai das seis primeiras cartas
  // de um pack sorteado, e nem toda espécie tem quatro golpes elegíveis: com um
  // Caterpie na frente — Bug Bite e Tackle — a tela desenhava dois, certa, e o
  // teste reprovava uma vez a cada três rodadas da suíte em série.
  const moves = page.locator('.move')
  await expect.poll(() => moves.count()).toBeGreaterThan(0)
  expect(await moves.count()).toBeLessThanOrEqual(MOVES_IN_BATTLE)
  await expect(page.getByText(atTurn(1))).toBeVisible()

  await playTurn(page)
  await expect(page.getByText(atTurn(2))).toBeVisible()

  /**
   * **A checagem que a fase inteira sustenta.**
   *
   * O reload é boot do zero: nada em memória sobrevive. O turno 2 só volta se o
   * log tiver ido para o `localStorage`, passado pelo guarda do save, sido
   * reconhecido como reproduzível — motor e dex conferidos — e reproduzido pelo
   * motor com a mesma seed. Qualquer elo quebrado devolve o turno 1.
   */
  await page.reload()
  await expect(page.getByText(atTurn(2))).toBeVisible()

  // E o Hub mostra a faixa de retomar, que é a superfície que o plano pede.
  await page.goto('/')
  await expect(page.locator('.hub__resume')).toBeVisible()
  await expect(page.getByText(label('hub.resume.eyebrow', PT))).toBeVisible()

  await page.getByRole('link', { name: label('hub.resume.resume', PT) }).click()
  await expect(page.getByText(atTurn(2))).toBeVisible()

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
  await expect(page.getByText(atTurn(1))).toBeVisible()

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
  const won = await page.getByRole('heading', { name: label('battle.result.won', PT) }).isVisible()

  await page.goto('/league')
  if (won) {
    await expect(page.locator('.gym--won')).toHaveCount(1)
    await expect(page.getByText(message('league.gym.rematch', PT, { coins: 75 }))).toBeVisible()
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
  // Composed the way the Hub composes it: two keys and the `·` that lives in
  // the template between them. Written out by hand, this assertion would fail
  // with "element not found" the day the sentence changed — which is the
  // failure `label()`'s throw exists to prevent.
  const nextChallenge = [
    label('hub.next.challenge', defaultLocale()),
    message('hub.next.gym', defaultLocale(), { gym: 1, total: 9 }),
  ].join(' · ')
  await expect(page.getByText(nextChallenge)).toBeVisible()
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
  await expect(page.getByText(atTurn(2))).toBeVisible()

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
  await expect(
    page.getByRole('heading', { name: label('battle.standing.busyTitle', PT) }),
  ).toBeVisible()
  await expect(page.getByText(messagePattern(
    'battle.standing.busyNote',
    PT,
    { gym: 1, leader: 'Brock', count: 1 },
    1,
  ))).toBeVisible()

  // Retomar aquela devolve o mesmo turno: nada foi perdido no caminho.
  await page.getByRole('link', { name: label('battle.standing.busyResume', PT) }).click()
  await expect(page.getByText(atTurn(2))).toBeVisible()

  // E desistir explicitamente começa a nova, do turno 1.
  await page.goto('/battle/2')
  await page.getByRole('button', { name: label('battle.standing.busyDrop', PT) }).click()
  await expect(page.getByText(message('battle.bar.gym', PT, { gym: 2, total: 9 }))).toBeVisible()
  await expect(page.getByText(atTurn(1))).toBeVisible()
})

/**
 * **A batalha descartada tem de virar alguma tela — e nunca o campo montando.**
 *
 * O descarte é o caminho normal do plano, e este PR é o que o torna comum: antes
 * só `ENGINE_VERSION` o disparava, à mão e quase nunca; agora todo rebuild do dex
 * muda o `dexVersion` e descarta a luta de quem estava no meio de um ginásio.
 *
 * A página tratava o descarte caindo direto num `battle.start` de fora do `try`,
 * com o contexto que tinha sido montado para o time do **log** e sem reconferir o
 * deck. As duas coisas derrubam `buildSide` — espécie de uma geração que ninguém
 * carregou, ou time vazio —, a exceção saía de um `onMounted` async, e a tela
 * ficava em "Montando o campo…" para sempre: um beco, na única rota do jogo que
 * não tem barra de navegação.
 *
 * Nada disso é alcançável por unitário. O que ele prova é que a store descarta;
 * o que só o navegador percorre é o `onMounted`, a rota pré-renderizada, o dex
 * carregado por geração e a tela que sobra no fim.
 */
test('a batalha de outro dex é descartada sem deixar a tela montando o campo', async ({ page }) => {
  await openWelcomePack(page)
  await fillDeck(page)

  await page.goto('/battle/1')
  await playTurn(page)
  await expect(page.getByText(atTurn(2))).toBeVisible()

  /** Um deploy que mexeu no dex, encenado no save: a forma continua válida —
   * `isDexVersion` cobra oito hex — e só o valor diverge, que é exatamente o que
   * `replayable` recusa. */
  const forgeDexVersion = async (): Promise<void> => {
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('holodeck:save')
      if (raw === null) throw new Error('sem save para editar')
      const save: unknown = JSON.parse(raw)
      if (typeof save !== 'object' || save === null) throw new Error('save fora de forma')
      const record: Record<string, unknown> = { ...save }
      const battle = record.battle
      if (typeof battle !== 'object' || battle === null) throw new Error('save sem batalha')
      record.battle = { ...battle, dexVersion: 'deadbeef' }
      window.localStorage.setItem('holodeck:save', JSON.stringify(record))
    })
  }

  await forgeDexVersion()

  // Com deck montado, o descarte cai no caminho de quem chega sem batalha: luta
  // nova, do turno 1. O que ele **não** pode ser é o campo montando para sempre.
  await page.goto('/battle/1')
  await expect(page.getByText(atTurn(1))).toBeVisible()

  // De um a quatro golpes, pelo sorteio que o teste do começo de batalha já
  // registra: o deck sai das seis primeiras cartas de um pack, e com uma espécie
  // de golpe único na frente a tela desenha um. O `ab9c622` consertou lá e não
  // aqui.
  const moves = page.locator('.move')
  await expect.poll(() => moves.count()).toBeGreaterThan(0)
  expect(await moves.count()).toBeLessThanOrEqual(MOVES_IN_BATTLE)
  await expect(page.getByText(label('battle.standing.loading', PT))).toHaveCount(0)

  // A outra metade: o deck pode ter esvaziado desde que o log foi gravado — nada
  // trava o deck builder durante uma batalha. Aqui o descarte tem de encontrar a
  // conferência do deck, que o ramo de retomada não fazia.
  await playTurn(page)
  await forgeDexVersion()
  await page.evaluate(() => {
    const raw = window.localStorage.getItem('holodeck:save')
    if (raw === null) throw new Error('sem save para editar')
    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null) throw new Error('save fora de forma')
    window.localStorage.setItem(
      'holodeck:save',
      JSON.stringify({ ...save, deck: [null, null, null, null, null, null] }),
    )
  })

  await page.goto('/battle/1')
  await expect(
    page.getByRole('heading', { name: label('battle.standing.noDeckTitle', PT) }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: label('battle.standing.noDeckAction', PT) }),
  ).toBeVisible()
})

/**
 * The League and the battle inside `/en`, which no gate on disk can reach.
 *
 * The disk gates read what is written: that every `NuxtLink` goes through
 * `localePath`, and that every key the screens ask for is translated. What they
 * cannot see is the page — and the defect of PR 1 of this phase went through
 * exactly there, with nothing in the suite visiting `/en`.
 *
 * The turn log is the reason this test plays a turn instead of just reading the
 * header. Its sentences are the only screen text in the game built by a plain
 * function, and the patterns below come from the locale files rather than from
 * this file: a message that changes wording stays measured, and one that is
 * translated wrong is what fails.
 *
 * **Both languages, and the default one first.** A sweep that only visited `/en`
 * would pass just as happily against a page stuck in English, and a gate that
 * cannot tell the two apart is not measuring the language — it is measuring that
 * some text exists.
 */

/** Every sentence the log can print in one language, as a pattern. */
function logPatterns(code: string): { key: string, pattern: RegExp }[] {
  return leafEntries(readLocale(code))
    .filter(([key, value]) => (
      key.startsWith('battle.log.') && key !== 'battle.log.title' && typeof value === 'string'
    ))
    .map(([key]) => ({ key, pattern: messagePattern(key, code) }))
}

/**
 * The stat badges that belong to another language, and only those.
 *
 * A badge both languages write the same way — `DEF`, which the `i18n-gate` names
 * in `IDENTICAL_LABELS` — is dropped: demanding it stay out would fail on a
 * screen that is right.
 */
function foreignBadges(locale: string): string[] {
  const mine = STAT_NAMES.map(stat => label(statKey(stat), locale))

  return localeCodes()
    .filter(code => code !== locale)
    .flatMap(code => STAT_NAMES.map(stat => label(statKey(stat), code)))
    .filter(badge => !mine.includes(badge))
}

/** The links that would take the player out of the language they are reading. */
function strayLinks(hrefs: string[], locale: string, prefixed: string[]): string[] {
  if (locale === defaultLocale()) {
    return hrefs.filter(
      href => prefixed.some(code => href === `/${code}` || href.startsWith(`/${code}/`)),
    ).sort()
  }

  return hrefs.filter(href => href !== `/${locale}` && !href.startsWith(`/${locale}/`)).sort()
}

test('the league and the battle speak the language of the URL, from link to log', async ({ page }) => {
  const prefixed = localeCodes().filter(code => code !== defaultLocale())

  // The other side: with a single locale on disk the loop below proves nothing.
  expect(prefixed.length).toBeGreaterThan(0)

  await openWelcomePack(page)
  await fillDeck(page)

  for (const locale of [defaultLocale(), ...prefixed]) {
    await page.goto(localeUrl('/league', locale))

    await expect(
      page.getByRole('heading', { level: 1, name: label('league.title', locale) }),
      `/league in ${locale} did not translate the heading`,
    ).toBeVisible()
    await expect(page.locator('.gym')).toHaveCount(9)

    const leagueLinks = await page.locator('a[href^="/"]').evaluateAll(
      links => links.map(link => link.getAttribute('href') ?? ''),
    )

    // The gym cards build their destination in a template literal, which is the
    // shape no list of links can see — and the reason the disk gate had to read
    // source. Here it is the rendered `href` that answers.
    expect(
      leagueLinks.filter(href => href.includes('/battle/')).length,
      `/league in ${locale} drew no gym link at all`,
    ).toBeGreaterThan(0)
    expect(
      strayLinks(leagueLinks, locale, prefixed),
      `/league in ${locale} sends the player back to another language`,
    ).toEqual([])

    await page.goto(localeUrl('/battle/1', locale))

    await expect(
      page.getByText(message('battle.bar.gym', locale, { gym: 1, total: 9 })),
      `/battle/1 in ${locale} did not translate the header`,
    ).toBeVisible()

    // The HUD and the initiative line name the same stat, and this screen is
    // where they can contradict each other: the combatant footer drew `SPD` by
    // hand and the three `battle.initiative` messages spelled `SPD` inside the
    // translation, so the two agreed by coincidence and stopped agreeing the
    // moment the badge came from the locale. Both are measured together for that
    // reason — either one alone passes while the screen says two things.
    const speed = label(statKey('speed'), locale)
    const foreignSpeed = localeCodes()
      .filter(code => code !== locale)
      .flatMap(code => [label(statKey('speed'), code), label(statNameKey('speed'), code)])
      .filter(badge => !STAT_NAMES.some(stat => label(statKey(stat), locale) === badge))

    // **Read after the barrier, never before it.** The body of this screen is
    // `ClientOnly`, so both lines below exist only once the client has rendered
    // — and a first version of this block called `innerText()` first and asserted
    // afterwards. It passed alone and failed inside the full suite, which is the
    // signature of reading state before the thing that guarantees the state.
    await expect(
      page.locator('.combatant__stats').first().getByText(speed, { exact: false }),
      `/battle/1 in ${locale} did not name the speed stat from its own locale`,
    ).toBeVisible()

    const footer = (await page.locator('.combatant__stats').first().innerText())
      .replaceAll(/\s+/g, ' ')

    // The footer draws two badges: the speed, always, and whichever of the other
    // four is highest on that Pokémon. The second one is data, so it cannot be
    // demanded by name — what can be demanded is that neither is a raw locale
    // key. That is the defect no gate on disk can see: `statKey(stat)` where a
    // `t(statKey(stat))` belongs puts `stat.short.attack` on the HUD and leaves
    // every sweep of the source green. Measured by planting it.
    expect(
      footer.match(/stat\.(short|long)\.[a-z-]+/g) ?? [],
      `/battle/1 in ${locale} drew a locale key instead of a badge: ${footer}`,
    ).toEqual([])
    expect(
      foreignBadges(locale).filter(
        badge => new RegExp(`(?<![A-Za-z])${badge}(?![A-Za-z])`).test(footer),
      ),
      `/battle/1 in ${locale} drew a stat badge of another language: ${footer}`,
    ).toEqual([])

    // **Scoped to the move-choice eyebrow, and not by class alone.**
    // `.battle__initiative` names two different lines in this template — the
    // turn order beside *choose a move*, and the standing beside *bench* — so
    // `.first()` reads whichever exists, and during the client render that is the
    // bench. A selector that can silently answer about another element is not
    // measuring the one it names.
    const order = page
      .locator('.battle__eyebrow', { hasText: label('battle.choose.move', locale) })
      .locator('.battle__initiative')

    await expect(
      order,
      `/battle/1 in ${locale} drew no turn order line`,
    ).toBeVisible()

    const header = (await order.innerText()).replaceAll(/\s+/g, ' ')

    // The other side: an empty header would make the absence check below
    // vacuous, and a tie renders the spelled-out name instead of the badge —
    // both spellings count as this locale naming the stat.
    expect(
      [speed, label(statNameKey('speed'), locale)].some(name => header.includes(name)),
      `/battle/1 in ${locale} named no speed stat in the initiative line: ${header}`,
    ).toBe(true)
    expect(foreignSpeed.length, `no spelling left that tells ${locale} apart`)
      .toBeGreaterThan(0)
    expect(
      foreignSpeed.filter(badge => header.includes(badge)),
      `the ${locale} initiative line named the speed stat of another language`,
    ).toEqual([])

    // The log is page state, so it starts empty in whatever language the URL
    // says — and a turn is what puts a narrated sentence in it.
    await expect(page.locator('.battle__log-empty')).toBeVisible()
    await playTurn(page)
    await expect(page.locator('.battle__log-empty')).toHaveCount(0)

    const log = (await page.locator('.battle__log').innerText()).replaceAll(/\s+/g, ' ')
    const spoken = logPatterns(locale).filter(({ pattern }) => pattern.test(log))

    expect(spoken.length, `the ${locale} log matches no sentence from its own locale`)
      .toBeGreaterThan(0)

    // And nothing from the other language got in. Messages that read the same in
    // both are dropped: matching one would prove nothing, and demanding it stay
    // out would fail on a screen that is right.
    for (const other of localeCodes().filter(code => code !== locale)) {
      const candidates = logPatterns(other).filter(
        ({ key }) => label(key, other) !== label(key, locale),
      )

      // The other side, and it is the same one the two assertions above take: if
      // dropping the identical messages empties the list, what follows compares
      // nothing and passes on a page narrating in the wrong language.
      expect(candidates.length, `no sentence left that tells ${locale} apart from ${other}`)
        .toBeGreaterThan(0)

      expect(
        candidates.filter(({ pattern }) => pattern.test(log)).map(({ key }) => key),
        `the ${locale} log narrated in ${other}`,
      ).toEqual([])
    }

    const battleLinks = await page.locator('a[href^="/"]').evaluateAll(
      links => links.map(link => link.getAttribute('href') ?? ''),
    )

    expect(
      strayLinks(battleLinks, locale, prefixed),
      `/battle/1 in ${locale} sends the player back to another language`,
    ).toEqual([])
  }
})
