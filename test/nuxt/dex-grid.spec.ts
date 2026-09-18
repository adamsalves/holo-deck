// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { isGenerationData } from '~~/shared/types/dex'
import DexGrid from '~/components/dex/DexGrid.vue'
import gen1 from '~~/public/data/gen-1.json'
import ptSource from '~~/i18n/locales/pt-BR.json?raw'
import { fragmentOf, messagesFrom } from '../support/default-messages'

/**
 * O rodapé do grid, que é a única evidência visível da promessa da Fase 3.
 *
 * Ele entrou sem teste e com uma frase que anunciava virtualização em telas onde
 * ela não estava retendo nada — `4 de 4 renderizados · scroll virtualizado`, com
 * a barra de extensão em 100%. O caso é alcançável por qualquer filtro estreito,
 * e nenhum portão o via: a verificação tinha sido feita à mão, no navegador.
 *
 * As espécies são as de Kanto lidas do dex commitado, e não uma fixture: os ids
 * são marcados (`SpeciesId`), e escrevê-los à mão exigiria um guarda por linha
 * para provar o que o arquivo gerado já prova.
 *
 * O import é estático, e não o `readGeneration()` de `test/support/`: aquele
 * resolve o caminho por `fileURLToPath(import.meta.url)`, e no ambiente `nuxt` o
 * `import.meta.url` é uma URL http — o helper morre no import. O guarda é o
 * mesmo que `useDex()` usa, então o dado entra marcado e sem um único cast.
 *
 * **O locale entra pelo mesmo caminho, e pela mesma razão.** As frases do rodapé
 * mudaram de lugar na Fase 8 — elas moram em `i18n/locales/` agora —, e uma
 * cópia em português escrita aqui passaria a afirmar contra si mesma: trocada a
 * tradução, este arquivo reprovaria sem que nada tivesse quebrado. `message()`
 * de `test/support/locales.ts` seria o certo e é o que a e2e usa; aqui ele não
 * alcança, pelo motivo do parágrafo acima.
 *
 * O leitor está em `test/support/default-messages.ts`, e o docblock de lá conta
 * por que ele existe ao lado do `locales.ts` e por que o import do JSON precisa
 * de `?raw`.
 */

const message = messagesFrom(ptSource)
const VIRTUALIZED = fragmentOf(message, 'dex.grid.virtualized', 'counted')

const raw: unknown = gen1
if (!isGenerationData(raw)) throw new Error('gen-1.json não passou pelo guarda de leitura')

const KANTO = raw.species

/** O que o `<footer>` diz, com o espaço em branco do template normalizado. */
function footerText(html: string): string {
  const footer = /<footer[^>]*>([\s\S]*?)<\/footer>/.exec(html)
  return (footer?.[1] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function cardCount(html: string): number {
  return (html.match(/class="[^"]*\bdex-card\b/g) ?? []).length
}

describe('a forma completa', () => {
  /**
   * Com uma fatia, e não com as 151: aqui o grid monta **todas** as cartas que
   * receber, e 151 `DexCard` reais custam ~5s de `mountSuspended` — mais do que
   * a suíte inteira. Que a forma servida traga as 151 é o que
   * `test/e2e/pokedex.spec.ts` já prova, contando os links do HTML que o
   * servidor mandou. O que falta provar é a regra do rodapé, e ela não depende
   * do tamanho da fatia.
   */
  it('conta todas e não anuncia virtualização — ali não há nenhuma', async () => {
    const grid = await mountSuspended(DexGrid, { props: { species: KANTO.slice(0, 40) } })
    const html = grid.html()

    expect(cardCount(html)).toBe(40)
    expect(footerText(html)).toContain(message('dex.grid.rendered', { rendered: 40, total: 40 }))
    // A ressalva aqui seria falsa: é a forma que o servidor renderiza inteira.
    expect(footerText(html)).not.toContain(VIRTUALIZED)
  })
})

describe('a forma virtualizada', () => {
  /**
   * O contrato inteiro do rodapé, nas duas pontas.
   *
   * Afirmar um número fixo mediria a altura da janela do happy-dom em vez do
   * componente. O que é sempre verdade é a relação: o rodapé conta o que está no
   * DOM, e só fala em virtualização quando sobra alguma coisa fora dele.
   */
  it('conta o que está de fato no DOM', async () => {
    const grid = await mountSuspended(DexGrid, {
      props: { species: KANTO, virtualize: true },
    })
    const html = grid.html()

    expect(footerText(html)).toContain(
      message('dex.grid.rendered', { rendered: cardCount(html), total: 151 }),
    )
  })

  it('não anuncia scroll virtualizado quando não está retendo nada', async () => {
    // Kanto filtrada por Lendário são 4 — o caso que a frase antiga errava.
    const grid = await mountSuspended(DexGrid, {
      props: { species: KANTO.slice(0, 4), virtualize: true },
    })
    const text = footerText(grid.html())

    expect(text).toContain(message('dex.grid.rendered', { rendered: 4, total: 4 }))
    expect(text).not.toContain(VIRTUALIZED)
  })

  it('anuncia quando está', async () => {
    const grid = await mountSuspended(DexGrid, {
      props: { species: KANTO, virtualize: true },
    })
    const html = grid.html()

    // Se o ambiente de teste renderizar as 151 numa janela infinita, a ressalva
    // não deve aparecer — é a mesma regra, e não uma exceção do teste.
    if (cardCount(html) < KANTO.length) {
      expect(footerText(html)).toContain(VIRTUALIZED)
    }
    else {
      expect(footerText(html)).not.toContain(VIRTUALIZED)
    }
  })

  it('não cita as 1025, que não são de tela nenhuma', async () => {
    // O grid é sempre de **uma** região, e a maior tem 156. O número não tinha
    // referente, e a frase ficava verdadeira e vazia ao mesmo tempo.
    const grid = await mountSuspended(DexGrid, {
      props: { species: KANTO, virtualize: true },
    })

    expect(footerText(grid.html())).not.toContain('1025')
  })
})

describe('a faixa de dex', () => {
  it('aparece quando a página a passa', async () => {
    const grid = await mountSuspended(DexGrid, {
      props: { species: KANTO.slice(0, 40), range: '#0001–0151' },
    })

    expect(footerText(grid.html())).toContain('#0001–0151')
  })

  it('some quando não há região — e sem imprimir a sentinela', async () => {
    const grid = await mountSuspended(DexGrid, { props: { species: KANTO.slice(0, 40) } })

    expect(grid.html()).not.toContain('grid-footer__range')
  })
})

describe('o grid vazio', () => {
  it('não desenha rodapé — não há o que contar', async () => {
    const grid = await mountSuspended(DexGrid, { props: { species: [] } })

    expect(grid.html()).not.toContain('grid-footer')
  })
})
