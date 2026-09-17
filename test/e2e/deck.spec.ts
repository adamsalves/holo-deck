import { expect, test } from '@playwright/test'
import { STAT_NAMES } from '../../shared/types/dex.ts'
import { statKey } from '../../shared/types/game.ts'
import {
  defaultLocale,
  foreignBadges,
  label,
  localeCodes,
  localeUrl,
  message,
  messagePattern,
  spells,
} from '../support/locales'
import { openWelcomePack, saveWith, seedLocalSave } from './support'

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

/**
 * Six species picked so the advice line lands on the **plural** form.
 *
 * The first gym is Brock's, and rock hits fire, bug and flying for more than
 * normal — so Charmander, Caterpie and Pidgey are three incoming risks, and
 * Bulbasaur, Squirtle and Pikachu are none. Three and not one on purpose: the
 * first version of this deck put exactly one risk on screen, and a test that
 * renders the singular proves nothing about the branch it exists for.
 *
 * Spelled out rather than opened from packs for the reason `READY_DECK` gives in
 * `collection.spec.ts`: a pack draws at random. All six are common, which keeps
 * the invite dialog shut.
 */
const ADVICE_DECK = [1, 4, 7, 10, 16, 25]

test('a carta sai da coleção, entra num slot e sobrevive ao reload', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/deck')

  await expect(page.getByRole('heading', {
    level: 1,
    name: label('deck.title', defaultLocale()),
  })).toBeVisible()

  // Os seis slots existem antes de qualquer carta, e o contador começa em zero.
  const slots = page.locator('.deck-slot')
  await expect(slots).toHaveCount(6)
  await expect(page.getByText(
    messagePattern('deck.slotsCount', defaultLocale(), { total: 6 }),
  )).toBeVisible()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(6)

  // A coluna da direita traz o que o pack deu. `expect.poll` porque ela entra
  // depois do `<ClientOnly>` **e** depois do índice chegar.
  const picks = page.locator('.deck__pick')
  await expect.poll(() => picks.count()).toBeGreaterThan(5)

  const before = await picks.count()
  const firstPickLabel = (await picks.first().getAttribute('aria-label')) ?? ''
  await picks.first().click()

  // Um slot a menos vazio, e a carta saiu da lista: "cartas já no deck saem da
  // lista" é a regra da prancha, e é o que torna clicar uma ação sem ambiguidade.
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)
  await expect(picks).toHaveCount(before - 1)
  expect(firstPickLabel).toContain('Escalar')

  // A prova do save: recarregar não é navegação de cliente, é boot do zero — e o
  // deck só chega até aqui através da migração para o schema 2.
  await page.reload()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)

  /**
   * **E a linha de stats traz número, não travessão.**
   *
   * Esta asserção existe por um defeito que passou por 499 unitários e 4 e2e: os
   * stats de Lv50 vinham de um `useAsyncData` de chave estática, e numa rota
   * pré-renderizada o cliente casava com o mapa vazio que o servidor pôs no
   * payload e nunca buscava. A tela abria com `—` nos seis slots em **toda carga
   * fria** — e o único e2e que recarregava só contava `.deck-slot--empty`.
   *
   * Contar slot vazio não vê conteúdo de slot cheio. É a asserção que faltava.
   */
  const stats = page.locator('.deck-slot__foot').first()
  await expect(stats).toBeVisible()
  await expect(stats).toHaveText(
    new RegExp(`${label(statKey('hp'), defaultLocale())} \\d+`),
  )
  await expect(stats).not.toHaveText(/—/)
})

/**
 * A faixa `LEVA ×2` e a linha de stats, que dividem o pé da carta.
 *
 * A faixa era `position: absolute; bottom: 0` e cobria 9,5px da linha de stats —
 * medido no navegador, porque `happy-dom` não resolve caixa. Escondia a metade
 * inferior de `HP 145 / ATK 100` justamente na carta que apanha, que é a que o
 * jogador mais precisa ler antes de trocar.
 *
 * Ela passou para o fluxo, logo abaixo dos stats, e por construção não tem mais
 * como sobrepor. O que este teste guarda é a consequência que a mudança podia
 * quebrar: **a fileira de seis continua com a mesma altura**, porque a arte é
 * `flex: 1` e encolhe no lugar.
 *
 * O caso é plantado no formato real do save: uma espécie voadora contra Brock,
 * que é de pedra. Sortear até cair uma seria um teste que às vezes não testa.
 */
test('a faixa de alerta divide o pé da carta com os stats, sem cobri-los', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/deck')
  await expect.poll(() => page.locator('.deck__pick').count()).toBeGreaterThan(5)

  // Pidgey (#16) é normal/voador e apanha ×2 de pedra — o alerta contra Brock.
  await page.evaluate(() => {
    const raw = localStorage.getItem('holodeck:save')
    if (raw === null) throw new Error('sem save depois de abrir um pack')

    const save: unknown = JSON.parse(raw)
    if (typeof save !== 'object' || save === null || !('collection' in save)) {
      throw new Error('save sem coleção')
    }

    const { collection } = save
    if (typeof collection !== 'object' || collection === null) throw new Error('coleção ilegível')

    localStorage.setItem('holodeck:save', JSON.stringify({
      ...save,
      collection: { ...collection, 16: { c: 1, s: 0 } },
      deck: [16, null, null, null, null, null],
    }))
  })
  await page.reload()

  const warningBand = page.locator('.deck-slot__warning').first()
  await expect(warningBand).toBeVisible()
  await expect(warningBand).toHaveText(
    message('deck.slot.takes', defaultLocale(), { multiplier: '×2' }),
  )

  const stats = page.locator('.deck-slot__foot').first()
  await expect(stats).toHaveText(
    new RegExp(`${label(statKey('hp'), defaultLocale())} \\d+`),
  )

  // As duas caixas não se cruzam: a faixa começa depois de o rodapé terminar.
  const [warningBox, statsBox] = await Promise.all([warningBand.boundingBox(), stats.boundingBox()])
  if (warningBox === null || statsBox === null) throw new Error('faixa ou rodapé sem caixa')
  expect(warningBox.y).toBeGreaterThanOrEqual(statsBox.y + statsBox.height)

  // E os seis slots continuam com a mesma altura, apesar de um deles ter faixa.
  const heights = await page.locator('.deck-slot').evaluateAll(slots =>
    slots.map(slot => Math.round(slot.getBoundingClientRect().height)))
  expect(new Set(heights).size, `alturas divergentes: ${heights.join(', ')}`).toBe(1)
})

test('a leitura de cobertura só aparece com carta, e nomeia o líder', async ({ page }) => {
  await openWelcomePack(page)
  await page.goto('/deck')

  // O primeiro ginásio é o de Brock, do tipo pedra — enquanto a Liga não existe,
  // todo jogador tem zero insígnias e o próximo ginásio é o primeiro.
  await expect(page.getByText(`Brock · ${label('type.rock', defaultLocale())}`)).toBeVisible()

  // Sem carta não há leitura: um painel de barras zeradas desenharia uma
  // cobertura que ninguém pode mover.
  await expect(page.getByText(
    messagePattern('deck.coverage.empty', defaultLocale(), { leader: 'Brock' }),
  )).toBeVisible()

  await expect.poll(() => page.locator('.deck__pick').count()).toBeGreaterThan(5)
  await page.locator('.deck__pick').first().click()

  await expect(page.getByText(message('deck.coverage.outgoing', defaultLocale(), {
    type: label('type.rock', defaultLocale()).toUpperCase(),
  }))).toBeVisible()
  await expect(page.locator('.deck__line').first()).toBeVisible()
})

/**
 * The one plural message that reaches a screen a player looks at.
 *
 * `test/unit/locale-message.spec.ts` drives `pluralForm` against the real
 * vue-i18n, and `i18n-gate` holds the two locales to the same forms. Neither
 * renders the app: the branch that ships is picked by `t(key, values, count)` in
 * `deck.vue`, and until this test nothing exercised that call. The other two
 * plural messages of the game are `aria-label`s, so this line is the only place
 * where picking the wrong form is something a person can see.
 *
 * The count is read **from the screen** and the sentence from the locale — the
 * opposite of writing the expected string here, which would pass while the
 * screen agreed with the test and both disagreed with the locale.
 *
 * What it ties, measured by breaking it: invert the rule inside `pluralForm` and
 * this assertion goes red with `deck.vue` untouched. So the live vue-i18n
 * rendering and the helper's reimplementation of its rule are held to each other
 * on a real screen, at a real count — which is what `locale-message` cannot do,
 * since it drives the library directly.
 *
 * It does **not** measure the third argument of `t(key, values, count)`: a
 * `count` among the named values is what vue-i18n picks the branch from, so
 * hard-coding that argument to `1` changes nothing on screen. Measured, after a
 * first version of this note claimed otherwise.
 */
test('the coverage advice picks the plural form the locale dictates', async ({ page }) => {
  await seedLocalSave(page, saveWith({
    collection: Object.fromEntries(ADVICE_DECK.map(id => [id, { c: 1, s: 0 }])),
    deck: ADVICE_DECK,
  }))
  await page.goto('/deck')

  const advice = page.locator('.deck__advice')
  await expect(advice).toBeVisible()

  const shown = (await advice.innerText()).trim()
  const count = Number(shown.split(' ')[0])

  // The other side: with no number in front, `message` below would be handed
  // `NaN` and the comparison would become two wrong strings equal to each other.
  expect(Number.isInteger(count), `\`.deck__advice\` não começa com um número: ${shown}`)
    .toBe(true)
  // The other side, and the one that matters here: at a count of 1 this test
  // renders the singular and proves nothing about the branch it exists for.
  expect(count, `\`.deck__advice\` mostra ${count}, e no singular não mede plural`)
    .toBeGreaterThan(1)

  expect(shown).toBe(message('deck.coverage.advice', defaultLocale(), { count }, count))
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

  const first = page.locator('.deck__pick').first()
  const name = (await first.locator('.deck__pick-name').textContent())?.trim() ?? ''
  await first.click()
  await expect(page.locator('.deck-slot--empty')).toHaveCount(5)

  // Agora o binder mói essa mesma carta até a última cópia. A moagem passa pelo
  // caminho real do save, sem tela: é o que qualquer outra tela faria.
  await page.goto('/collection')
  await expect.poll(() => page.locator('.binder-card').count()).toBeGreaterThan(5)

  await page.evaluate((target) => {
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
    const deckSlots: unknown[] = deck
    const firstDeckCardId = deckSlots.find(slot => typeof slot === 'number')
    if (typeof firstDeckCardId !== 'number') throw new Error(`${target} não chegou ao deck`)

    Object.assign(collection, { [String(firstDeckCardId)]: undefined })
    localStorage.setItem('holodeck:save', JSON.stringify({
      ...save,
      collection: Object.fromEntries(
        Object.entries(collection).filter(([id]) => id !== String(firstDeckCardId)),
      ),
    }))
  }, name)

  // Voltar ao deck é boot do zero: o save traz um deck com uma carta que a
  // coleção não tem mais, e é `deck.hydrate` quem a descarta na entrada — não o
  // observador, que acorda um tick tarde demais para o boot.
  await page.goto('/deck')
  await expect(page.locator('.deck-slot--empty')).toHaveCount(6)
  await expect(page.getByText(
    messagePattern('deck.slotsCount', defaultLocale(), { total: 6 }),
  )).toBeVisible()
})

/**
 * The card footer names its two stats in the language of the URL.
 *
 * The deck is the second of the three screens that used to draw these
 * abbreviations by hand, and the reason the six of them became locale keys in a
 * PR of their own: translating only the Pokédex would have left this footer
 * saying `HP` and `SPD` inside a `/en` document whose bars said the same thing,
 * and inside a pt-BR one whose bars said `PV` and `VEL`. One document, two
 * vocabularies, and no gate on disk able to see it.
 *
 * Unlike the Detail panel, this screen draws **one** of the five candidates —
 * whichever stat is highest on that card — so the assertion asks which badge is
 * there rather than demanding a particular one. What it can demand is that the
 * badge belongs to this locale: `HP` against `PV` is the pair that tells the two
 * apart in the footer, and it is measured in both directions.
 */
/** The six stat badges of one locale, as that locale spells them. */
function badgesOf(code: string): string[] {
  return STAT_NAMES.map(stat => label(statKey(stat), code))
}

test('the slot footer names its stats in the language of the URL', async ({ page }) => {
  const others = localeCodes().filter(code => code !== defaultLocale())

  expect(others.length).toBeGreaterThan(0)

  await seedLocalSave(page, saveWith({
    collection: Object.fromEntries(ADVICE_DECK.map(id => [id, { c: 1, s: 0 }])),
    deck: ADVICE_DECK,
  }))

  for (const locale of [defaultLocale(), ...others]) {
    await page.goto(localeUrl('/deck', locale))

    const foot = page.locator('.deck-slot__foot').first()
    await expect(foot).toBeVisible()

    // The HP badge is the fixed half of the footer, so it can be demanded by
    // name — and it is the half that differs between the two languages.
    await expect(
      foot.getByText(label(statKey('hp'), locale), { exact: false }),
      `/deck in ${locale} did not name HP from its own locale`,
    ).toBeVisible()

    const shown = (await foot.innerText()).replaceAll(/\s+/g, ' ')
    const mine = badgesOf(locale)
    const drawn = mine.filter(badge => spells(shown, badge))

    // The other side, and it counts **two**: the footer draws the HP badge and
    // whichever of the other four is highest, so anything less means one of the
    // two halves rendered the key or nothing — and every absence assertion below
    // would be measuring a footer that never spoke.
    expect(
      drawn.length,
      `/deck in ${locale} drew ${drawn.length} of the two stat badges: ${shown}`,
    ).toBe(2)

    const foreign = foreignBadges(locale, badgesOf)

    expect(foreign.length, `no badge left that tells ${locale} apart`).toBeGreaterThan(0)
    expect(
      foreign.filter(badge => spells(shown, badge)),
      `/deck in ${locale} drew a stat badge of another language: ${shown}`,
    ).toEqual([])
  }
})
