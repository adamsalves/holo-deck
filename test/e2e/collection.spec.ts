import { expect, test } from '@playwright/test'
import { NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '../../app/utils/nav-links.ts'
import { navLabel, skipInvite } from './support'

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
  await expect(page.getByRole('heading', { level: 1, name: 'Packs' })).toBeVisible()
  await expect(page.getByText('Boas-vindas · 1 de 3')).toBeVisible()

  // O clique só vale depois da hidratação — antes dela o botão é marcação. Mesmo
  // `toPass` que a suíte da Pokédex usa pelas abas.
  await expect(async () => {
    await page.locator('.packs__buy--gift').click()
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  // Dez cartas, e a composição do pack: seis comuns, três incomuns, uma raro+.
  const cards = page.locator('.opener__slot')
  await expect(cards).toHaveCount(10)
  await expect(page.locator('.opener__slot[data-rarity="common"]')).toHaveCount(6)
  await expect(page.locator('.opener__slot[data-rarity="uncommon"]')).toHaveCount(3)

  // A tira termina em `10 / 10`, e não em `11 / 10`: o contador do opener é por
  // pack, e a instância do componente atravessa as três aberturas sem desmontar.
  const counter = page.getByText(/\d+ \/ 10 reveladas/)
  await expect(counter).toHaveText('10 / 10 reveladas')

  // Os dois packs restantes. A asserção do contador se repete aqui de propósito:
  // é no **segundo** pack que a contagem continuava de onde parou, e um laço que
  // só conte cartas veria dez das duas vezes sem notar `20 / 10` no cabeçalho.
  for (let pack = 2; pack <= 3; pack += 1) {
    await page.getByRole('button', { name: 'ABRIR O PRÓXIMO' }).click()
    await expect(cards).toHaveCount(10)
    await expect(counter).toHaveText('10 / 10 reveladas')
  }

  // Acabaram: o botão some e o baralho fica desabilitado.
  await expect(page.getByRole('button', { name: 'ABRIR O PRÓXIMO' })).toHaveCount(0)

  await page.goto('/collection')

  await expect(page.getByRole('heading', { level: 1, name: 'Binder' })).toBeVisible()
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
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await page.goto('/pokedex/1')

  // A contagem do cabeçalho e a do filtro saem de caminhos diferentes — uma
  // conta espécies da região no save, a outra recebe o mesmo número como prop.
  // Elas discordarem é o defeito que este teste existe para pegar.
  const ownedChip = page.getByRole('button', { name: /^Possuídos · / })
  await expect(ownedChip).toBeVisible({ timeout: 15_000 })

  const chipText = (await ownedChip.textContent()) ?? ''
  const ownedCount = Number(chipText.replace(/\D/g, ''))

  await expect(page.getByText(`${ownedCount} / 151 capturados`)).toBeVisible()

  // Possuídos e faltando particionam as 151: o rótulo de um é o complemento do
  // outro, e não há terceira classe.
  await expect(page.getByRole('button', { name: `Faltando · ${151 - ownedCount}` })).toBeVisible()

  await ownedChip.click()

  const shown = page.locator('.dex-card')
  await expect(shown).toHaveCount(ownedCount)
  await expect(page.locator('.dex-card--missing')).toHaveCount(0)

  // Ligar *Faltando* desliga *Possuídos* — posse é exclusiva, ao contrário de
  // tipo e raridade.
  await page.getByRole('button', { name: /^Faltando · / }).click()
  await expect(ownedChip).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.dex-card:not(.dex-card--missing)')).toHaveCount(0)
})

test('sem coleção, a Pokédex não afirma uma coleção vazia', async ({ page }) => {
  await page.goto('/pokedex/1')

  await expect(page.getByRole('heading', { level: 1, name: 'Kanto' })).toBeVisible()

  // Com save limpo a contagem é real e é zero — o que a tela não pode fazer é
  // escrever `0 / 151` **antes** de saber, que é o caso que `null` cobre. Aqui a
  // asserção é que o grupo de posse existe e diz a verdade.
  await expect(page.getByRole('button', { name: 'Possuídos · 0' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Faltando · 151' })).toBeVisible()
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
  const chegada: Record<string, { url: RegExp, titulo: string | null, raiz: string }> = {
    '/': { url: /\/$/, titulo: null, raiz: '.hub' },
    '/packs': { url: /\/packs$/, titulo: 'Packs', raiz: '.packs' },
    '/pokedex': { url: /\/pokedex$/, titulo: 'Pokédex', raiz: 'main' },
    '/collection': { url: /\/collection$/, titulo: 'Binder', raiz: '.collection' },
    '/deck': { url: /\/deck$/, titulo: 'Seu time', raiz: '.deck' },
    '/league': { url: /\/league$/, titulo: 'A Liga', raiz: '.league' },
    '/rules': { url: /\/rules$/, titulo: 'Regras', raiz: '.rules' },
    '/settings': { url: /\/settings$/, titulo: 'Seu save e este aparelho', raiz: '.settings' },
  }

  const destinos = [...NAV_LINKS, NAV_RULES, NAV_SETTINGS]

  // O par da lista de saída: todo destino que a barra declara é visitado abaixo.
  expect(destinos.filter(destino => !(destino.to in chegada)).map(d => d.to)).toEqual([])
  expect(destinos.length).toBeGreaterThan(5)

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
  for (const destino of destinos) {
    await expect(page.getByRole('link', { name: navLabel(destino.label), exact: true })).toBeVisible()
  }

  for (const destino of destinos) {
    const esperado = chegada[destino.to]
    if (esperado === undefined) continue

    await page.goto('/collection')
    await page.getByRole('link', { name: navLabel(destino.label), exact: true }).click()
    await expect(page).toHaveURL(esperado.url)

    /**
     * A Base é a única sem `<h1>` — o Hub não tem um, e a prancha *Hub* não
     * desenha nenhum. Ela é a única porta cuja chegada não pode ser afirmada
     * pelo título, então o que se afirma é a raiz da tela: sem isto ela seria
     * a única das oito a provar só a URL, que é o que a versão anterior deste
     * teste fazia sem escrever por quê.
     */
    if (esperado.titulo !== null) {
      await expect(page.getByRole('heading', { level: 1, name: esperado.titulo })).toBeVisible()
    }
    await expect(page.locator(esperado.raiz).first()).toBeVisible()
  }
})

/**
 * O `aria-current` acompanha o sublinhado, inclusive em rota aninhada.
 *
 * O `NuxtLink` pronto só emite `aria-current` em casamento **exato**, então em
 * `/pokedex/kanto` o sublinhado de *Pokédex* aparecia e quem navega por leitor
 * de tela não recebia indicação nenhuma de seção atual. As duas coisas saem do
 * mesmo booleano agora, e este teste é o que impede elas de divergirem de novo.
 */
test('a barra marca a seção atual, e só uma', async ({ page }) => {
  await page.goto('/pokedex/1')

  const atual = page.locator('.nav__link[aria-current="page"]')
  await expect(atual).toHaveCount(1)
  await expect(atual).toHaveText(navLabel('nav.pokedex'))

  // A raiz é o caso em que a marca e *Base* apontam para o mesmo lugar: só o
  // link da seção carrega `aria-current`, e a marca não.
  await page.goto('/')
  await expect(page.locator('[aria-current="page"]')).toHaveCount(1)
  await expect(page.locator('[aria-current="page"]')).toHaveText(navLabel('nav.base'))
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

  const pular = page.getByRole('link', { name: 'Pular para o conteúdo' })
  await expect(pular).toBeFocused()

  await pular.click()
  await expect(page.locator('#conteudo')).toBeFocused()
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
    await expect(page.getByText('/ 10 reveladas')).toBeVisible({ timeout: 1000 })
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
