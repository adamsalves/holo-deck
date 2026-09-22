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
import type { FakeSync } from './support'
import { backups, fakeSync, localDust, saveWith, screenText, seedLocalSave, seedSynced } from './support'

/**
 * O sync contínuo num navegador de verdade — depois do primeiro login.
 *
 * As regras moram no `SyncDriver` e têm teste de unidade com servidor falso e
 * agendador manual. O que só o navegador prova é a travessia: a jogada passa pelo
 * observador do plugin de save, pelo hook `holodeck:saved`, pelo *debounce* de
 * relógio de verdade e pelos eventos do navegador até chegar ao `fetch`. É o mesmo
 * `fakeSync` do primeiro login — interceptação do Playwright, sem nada de mentira
 * dentro do build que vai ao ar.
 *
 * **A jogada é escalar uma carta**, e não abrir um pack: um clique, uma mutação,
 * nada sorteado. O tempo entre ela e o `PUT` é o que estes testes medem, e um pack
 * espalharia a mutação por uma animação.
 *
 * **E ela acontece sem navegar.** Um `goto` é um boot novo, e boot com o servidor
 * à frente adota — que é o certo, e foi o que a primeira versão do teste de
 * conflito mediu sem querer: ela abria o deck *depois* de o outro aparelho gravar,
 * o boot adotava a gravação dele, e o 409 nunca acontecia.
 */

/** Seis espécies, para o deck ter o que escalar, e pó que identifica este save. */
const SYNCED = saveWith({
  dust: 100,
  collection: {
    1: { c: 1, s: 0 },
    4: { c: 1, s: 0 },
    7: { c: 1, s: 0 },
    25: { c: 1, s: 0 },
    133: { c: 1, s: 0 },
    143: { c: 1, s: 0 },
  },
})

/** O que "outro aparelho" gravou — pó que só existe lá, para reconhecê-lo depois. */
const OTHER = saveWith({ ...SYNCED, dust: 777 })

/** Um aparelho acertado na versão 1, com o mesmo save dos dois lados. */
async function syncedDevice(page: Page): Promise<FakeSync> {
  const sync = await fakeSync(page, SYNCED)
  await seedLocalSave(page, SYNCED)
  await seedSynced(page, { base: 1 })
  return sync
}

/**
 * Opens the deck and waits for the boot to have read the server — the
 * continuous sync up and running.
 *
 * The locale is a parameter so the conflict notice can be driven from inside
 * each language; the other callers keep the default one.
 */
async function openDeck(page: Page, sync: FakeSync, code: string = defaultLocale()): Promise<void> {
  await page.goto(localeUrl('/deck', code))
  await expect.poll(() => page.locator('.deck__pick').count()).toBeGreaterThan(0)
  await expect.poll(() => sync.gets(), 'o boot acertado lê o servidor').toBe(1)
}

/**
 * Escala a primeira carta — a jogada, sem sair da página.
 *
 * O `toPass` é a espera pela hidratação, como em `openWelcomePack`: antes dela o
 * clique cai em marcação e não faz nada.
 */
async function pickCard(page: Page): Promise<void> {
  await expect(async () => {
    await page.locator('.deck__pick').first().click()
    await expect.poll(() => page.locator('.deck-slot--empty').count(), { timeout: 1000 }).toBeLessThan(6)
  }).toPass({ timeout: 15_000 })
}

test('uma jogada sobe sozinha, depois do ócio, na versão em que se baseou', async ({ page }) => {
  const sync = await syncedDevice(page)
  await openDeck(page, sync)

  await pickCard(page)
  const played = Date.now()

  await expect.poll(() => sync.puts.length, { timeout: 12_000 }).toBe(1)

  // Subiu pelo ócio de ~5 s, e não na hora: sem o *debounce*, cada carta escalada
  // seria um `PUT`, e um deck montado seriam seis.
  expect(Date.now() - played, 'o envio esperou o ócio').toBeGreaterThanOrEqual(3000)
  expect(sync.puts[0]?.baseVersion).toBe(1)
  expect(sync.current()?.version).toBe(2)
})

/**
 * A prancha *Sync* pede envio garantido em `visibilitychange` e `pagehide`: é o
 * celular trocando de app antes dos 5 s, que é quando o navegador do celular mata
 * a aba.
 */
test('esconder a aba sobe na hora, sem esperar o ócio', async ({ page }) => {
  const sync = await syncedDevice(page)
  await openDeck(page, sync)

  await pickCard(page)
  expect(sync.puts, 'o ócio ainda não passou').toHaveLength(0)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // Dois segundos, contra os cinco do ócio: se subiu, foi pelo envio garantido.
  await expect.poll(() => sync.puts.length, { timeout: 2000 }).toBe(1)
})

/**
 * One test per locale, and the reason is the notice and not the sync: it is a
 * boot-time surface that draws over any route, the one sentence of the sync
 * that is not in the chip, and no per-screen measurement of this phase reached
 * it. The sync half runs in both languages because the notice only exists at the
 * end of it.
 */
for (const code of localeCodes()) {
  test(`another device saved first: this one wins, the other copy is backed up, and the notice speaks ${code}`, async ({ page }) => {
    const foreign = localeCodes()
      .filter(other => other !== code)
      .flatMap(other => namespaceLabels('conflict.', code, other))

    // The other side of the subtraction: an empty list would sweep for nothing.
    expect(foreign.length, `nothing foreign to look for against ${code}`).toBeGreaterThan(0)

    const sync = await syncedDevice(page)
    await openDeck(page, sync, code)

    // The other device writes mid-session — after the boot, before the move.
    sync.elsewhere(OTHER)

    // Two cards inside one idle window, so the one `PUT` carries two changes. A
    // count that never reached `t()` renders the singular sentence, and at one
    // change the right call and the broken one would agree. The second pick is
    // a plain click: `pickCard` already waited for hydration.
    await pickCard(page)
    await page.locator('.deck__pick').first().click()
    await expect(page.locator('.deck-slot--empty')).toHaveCount(4)

    // The first `PUT` collides (base 1, server at 2) and the second wins (base 2).
    await expect.poll(() => sync.puts.length, { timeout: 12_000 }).toBe(2)
    expect(sync.puts.map(put => put.baseVersion)).toEqual([1, 2])
    expect(JSON.stringify(sync.current()?.data), 'this device won').toContain('"dust":100')

    // Nothing was destroyed: what the other device wrote is in this one's ring.
    const saved = await backups(page)
    expect(saved.some(raw => raw.includes('"dust":777'))).toBe(true)

    // The notice names the door that gives the other device's copy back, and has
    // a single button, because there is nothing to decide. Two changes won: the
    // plural sentence, which in Portuguese is a different verb and article and
    // not only a different number.
    const notice = page.locator('.conflict')
    await expect(notice).toContainText(label('conflict.title', code))
    await expect(notice).toContainText(message('conflict.won', code, { count: 2 }, 2))
    await expect(notice).toContainText(message('conflict.kept', code, {
      path: `${label('nav.settings', code)} → ${label('settings.backups.title', code)}`,
    }))

    expect(
      foreignPhrases(await screenText(notice), foreign),
      `the conflict notice in ${code} wrote a sentence from another language`,
    ).toEqual([])

    await notice.getByRole('button', { name: label('conflict.dismiss', code) }).click()
    await expect(notice).toHaveCount(0)
  })
}

test('boot com outro aparelho à frente: o aparelho limpo adota o servidor', async ({ page }) => {
  const sync = await syncedDevice(page)
  sync.elsewhere(OTHER)

  await page.goto('/')

  await expect.poll(() => localDust(page), 'o save do outro aparelho desceu').toBe(777)
  expect(sync.puts, 'adotar não sobe nada').toHaveLength(0)
})

/**
 * O indicador — os estados 01 e 02 da prancha *Estados de sync*, no canto da
 * conta. O tempo do *há X* depende do dia em que a suíte roda, e o que se afirma
 * é o estado, não o relógio.
 */
test('o indicador acompanha a jogada: enviando, e sincronizado de novo', async ({ page }) => {
  const sync = await syncedDevice(page)
  await openDeck(page, sync)

  const chip = page.locator('.sync')
  await expect(chip).toContainText('sincronizado')

  await pickCard(page)
  await expect(chip).toHaveText('enviando…')

  await expect.poll(() => sync.puts.length, { timeout: 12_000 }).toBe(1)
  await expect(chip).toContainText('sincronizado')
})

/**
 * O estado 03 cobre **toda fila que não subiu**, e não só a falta de rede — é a
 * divergência da prancha que o README registra neste PR. O teto de 60 escritas
 * por hora é o outro caminho até ele, e o que o separa do offline é que a
 * tentativa **acontece**: o `PUT` sai, o servidor recusa, e a fila espera a
 * próxima jogada em vez do evento `online`.
 */
test('o servidor recusando também conta a fila, sem falta de rede', async ({ page }) => {
  const sync = await syncedDevice(page)
  await openDeck(page, sync)

  // O teto fecha antes da jogada: o próximo `PUT` sai e volta 429.
  sync.capWrites(0)
  await pickCard(page)

  // A tentativa aconteceu — é o que distingue este caminho do offline, em que
  // nada chega a sair.
  await expect.poll(() => sync.puts.length, { timeout: 12_000 }).toBe(1)

  await expect(page.locator('.sync')).toHaveText('1 mudança na fila')
  expect(sync.current()?.version, 'e nada foi gravado').toBe(1)
})

/**
 * O estado 03: sem rede o jogo não muda em nada, o indicador conta a fila, e ela
 * sobe sozinha quando a conexão volta — pelo evento `online`, sem jogada nova.
 */
test('sem rede o indicador conta a fila, e ela sobe sozinha ao reconectar', async ({ page, context }) => {
  const sync = await syncedDevice(page)
  await openDeck(page, sync)

  await context.setOffline(true)
  await pickCard(page)

  const chip = page.locator('.sync')
  await expect(chip).toHaveText('1 mudança na fila')
  expect(sync.puts, 'offline, nada sai').toHaveLength(0)

  await context.setOffline(false)

  // Cinco segundos é o ócio inteiro: se subiu antes dele, foi pelo `online`.
  await expect.poll(() => sync.puts.length, { timeout: 4000 }).toBe(1)
  await expect(chip).toContainText('sincronizado')
})
