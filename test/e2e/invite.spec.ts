import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  defaultLocale,
  foreignPhrases,
  label,
  localeCodes,
  localeUrl,
  message,
  namespaceLabels,
} from '../support/locales'
import { fakeSync, navLabel, pathPattern, saveWith, screenText, seedLocalSave, seedSynced } from './support'

/**
 * O convite de conta — a prancha *Convite de conta*, num navegador de verdade.
 *
 * O que o navegador prova é a regra inteira atravessando o boot: sem conta, com
 * carta, uma vez por aparelho, e recusável. Dos três pedidos, os dois de evento —
 * a vitória e o pack que trouxe ultra — dependem de sorteio; o que se percorre
 * aqui é o do Hub, que cobre quem já cumpria antes de o convite existir e passa
 * pelo mesmo `AccountInvite` que os outros dois.
 */

/** Quem já venceu o primeiro ginásio, com três espécies e uma delas shiny. */
const WINNER = saveWith({
  collection: { 1: { c: 2, s: 1 }, 4: { c: 1, s: 0 }, 7: { c: 1, s: 0 } },
  progress: { pity: 0, welcomeClaimed: 3, coins: 300, badges: 1, dailyClaimed: null },
})

/**
 * No badge, and a single card that is legendary.
 *
 * It is the invite at the end of a pack that brought ultra or above, which can
 * come before any gym — and the Hub offers it to this save too: `index.vue`
 * asks for a badge **or** a top-tier card. Mewtwo is legendary in the dex.
 */
const LEGENDARY_ONLY = saveWith({
  collection: { 150: { c: 1, s: 0 } },
  progress: { pity: 0, welcomeClaimed: 3, coins: 300, badges: 0, dailyClaimed: null },
})

/** Sem sessão, de propósito e sem depender do servidor de verdade. */
async function anonymous(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({ json: null })
  })
}

/**
 * The dialog, found by the first line of its title in the language asked for.
 *
 * The first line and not the whole title: the break between the two is a
 * newline inside the message, and what an accessible name does with it is the
 * browser's business, not this suite's.
 */
function invite(page: Page, code: string = defaultLocale()) {
  return page.getByRole('dialog', { name: label('invite.title', code).split('\n')[0] })
}

test('quem já venceu um ginásio vê o convite no Hub, com o que está em jogo', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await expect(invite(page)).toBeVisible()

  // Espécie nas duas contas: duas cópias do Bulbasaur, uma shiny, contam uma.
  await expect(page.locator('.invite__number--cards')).toHaveText('3')
  await expect(page.locator('.invite__number--shiny')).toHaveText('1')
  await expect(page.locator('.invite__number--badges')).toHaveText('1')
})

test('recusado, ele não volta — uma vez por aparelho', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await invite(page).getByRole('button', { name: label('invite.later', defaultLocale()) }).click()
  await expect(invite(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem('holodeck:invite'))).not.toBeNull()

  /**
   * **A barreira é o *Entrar* da recarga.** Ele só aparece depois de a sessão ser
   * lida, e é a mesma leitura que o convite espera para decidir: quando ele está
   * na tela, o convite já teve a chance dele. Sem isto, a ausência seria medida
   * antes de o pedido do Hub existir.
   */
  await page.reload()
  await expect(page.locator('.nav').getByRole('link', { name: navLabel('nav.account') })).toBeVisible()
  await expect(invite(page)).toHaveCount(0)
})

test('Escape recusa, como o Agora não', async ({ page }) => {
  await anonymous(page)
  await seedLocalSave(page, WINNER)
  await page.goto('/')

  await expect(invite(page)).toBeVisible()

  /**
   * **O foco dentro da folha é o que faz o Escape chegar ao diálogo** — evento de
   * teclado sobe, e do `body` ele nunca entraria. É também a metade que torna o
   * `aria-modal` verdadeiro, e foi o que faltou: medido no navegador, o
   * `document.activeElement` era `BODY` e o Escape não fechava nada.
   */
  await expect(page.locator('.invite__card')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(invite(page)).toHaveCount(0)
})

/**
 * The invite in the language of the URL — and its way out stays in it.
 *
 * The invite is not a screen: it opens over whichever route asked for it, which
 * is why the per-screen measurement of this phase never reached it. From the Hub
 * of each locale it has to speak that language **and** send CREATE ACCOUNT to
 * the sign-in screen of the same language. That link was one of the last two of
 * issue #37: the disk gate reads that it goes through `localePath`, and this
 * reads where the rendered one actually lands.
 *
 * One test per locale rather than a loop inside one: the invite shows **once
 * per device**, and a second language in the same browser context would find it
 * already seen and measure its absence.
 *
 * **Absence of the other language and presence of this one, both.** The sweep
 * only sees the labels a translator wrote plainly — the lede and the footnote
 * interpolate, and the units are plural — so those are asserted as the sentence
 * this locale renders. The units carry the plural rule too: three cards and one
 * badge. One is also what a count that never reached `t()` renders, so the
 * badge's plural is held by the test below, at zero.
 */
for (const code of localeCodes()) {
  test(`the invite speaks ${code}, and CREATE ACCOUNT stays in ${code}`, async ({ page }) => {
    const foreign = localeCodes()
      .filter(other => other !== code)
      .flatMap(other => namespaceLabels('invite.', code, other))

    // The other side of the subtraction: an empty list would sweep for nothing.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(0)

    await anonymous(page)
    await seedLocalSave(page, WINNER)
    await page.goto(localeUrl('/', code))

    const dialog = invite(page, code)
    await expect(dialog, `no invite in ${code}`).toBeVisible()

    await expect(dialog.locator('.invite__unit')).toHaveText([
      message('invite.stakes.cards', code, {}, 3),
      label('invite.stakes.shiny', code),
      message('invite.stakes.badges', code, {}, 1),
    ])
    await expect(dialog).toContainText(message('invite.lede', code, { days: label('invite.days', code) }))
    await expect(dialog).toContainText(message('invite.foot', code, {
      path: `${label('nav.settings', code)} → ${label('settings.save.exportTitle', code)}`,
    }))

    expect(
      foreignPhrases(await screenText(dialog), foreign),
      `the invite in ${code} wrote a sentence from another language`,
    ).toEqual([])

    await dialog.getByRole('link', { name: label('invite.create', code) }).click()

    await expect(page).toHaveURL(pathPattern(localeUrl('/login', code)))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(label('login.title', code))
    await expect(invite(page, code)).toHaveCount(0)
  })
}

/**
 * The units at counts where a lost count shows.
 *
 * A plural message rendered without its count falls to the singular — vue-i18n
 * reads the missing count as -1 and takes its absolute value — so a unit
 * asserted at 1 agrees with a call that never passed one. The test above holds
 * the badge at 1; this one holds it at 0, the invite of a player with no gym
 * yet, and renders the card's singular, which the test above never does.
 */
for (const code of localeCodes()) {
  test(`the invite's units follow the count in ${code}: one card, no badges`, async ({ page }) => {
    await anonymous(page)
    await seedLocalSave(page, LEGENDARY_ONLY)
    await page.goto(localeUrl('/', code))

    const dialog = invite(page, code)
    await expect(dialog, `no invite in ${code}`).toBeVisible()
    await expect(dialog.locator('.invite__unit')).toHaveText([
      message('invite.stakes.cards', code, {}, 1),
      label('invite.stakes.shiny', code),
      message('invite.stakes.badges', code, {}, 0),
    ])
  })
}

/**
 * O convite só existe para quem não tem conta — e um aparelho que já viu uma
 * sessão se marca, para o convite não mentir no dia em que a sessão não puder ser
 * lida. A marca é o sinal positivo: ela é escrita pela mesma leitura que decide.
 */
test('com conta, o convite não aparece — e o aparelho fica marcado', async ({ page }) => {
  await fakeSync(page, WINNER)
  await seedLocalSave(page, WINNER)
  await seedSynced(page, { base: 1 })
  await page.goto('/')

  await expect(page.locator('.nav').getByText(
    message('account.signedInAs', defaultLocale(), { name: 'Treinadora Ash' }),
  )).toBeAttached()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('holodeck:invite'))).not.toBeNull()
  await expect(invite(page)).toHaveCount(0)
})
