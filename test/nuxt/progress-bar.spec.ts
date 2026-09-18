// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProgressBar from '~~/app/components/collection/ProgressBar.vue'
import ptSource from '~~/i18n/locales/pt-BR.json?raw'
import { messagesFrom } from '../support/default-messages'

/**
 * A barra de progresso — o que o componente decide, e não o que `progress.ts`
 * decide.
 *
 * Os degraus e a fração já têm portão em `test/unit/progress.spec.ts`, e repetir
 * aquilo aqui seria testar a mesma função por cima de um `mount`. O que só
 * existe neste arquivo é a **largura**: ela é arredondamento, mora no
 * componente, e é onde uma barra pode dizer "tem alguma coisa" e não desenhar
 * nada.
 */

async function bar(owned: number, total: number) {
  return mountSuspended(ProgressBar, { props: { owned, total, label: 'Progresso em Kanto' } })
}

describe('a largura', () => {
  it('acompanha a fração', async () => {
    expect((await bar(98, 151)).find('.progress__fill').attributes('style')).toContain('65%')
  })

  /**
   * A primeira carta de uma região é 0,4% — arredondado, `width: 0%`: um
   * elemento na árvore e nada na tela. É o caso mais comum que existe, porque
   * todo jogador passa por ele, e 1% de 4px de altura é um fio, que é
   * exatamente o que a informação merece.
   */
  it('não desenha zero para quem já tem a primeira carta', async () => {
    const fill = (await bar(1, 251)).find('.progress__fill')

    expect(fill.exists()).toBe(true)
    expect(fill.attributes('style')).toContain('1%')
  })

  it('não desenha preenchimento nenhum para quem não tem nada', async () => {
    expect((await bar(0, 151)).find('.progress__fill').exists()).toBe(false)
  })

  it('chega a 100% com a região completa', async () => {
    expect((await bar(151, 151)).find('.progress__fill').attributes('style')).toContain('100%')
  })
})

describe('o que o leitor de tela lê', () => {
  /**
   * `aria-valuetext` diz `98 / 151 capturados`, e não "65%": o número que o
   * jogador persegue é a contagem, e a porcentagem é a forma da barra.
   *
   * A palavra sai do locale desde a Fase 8 — ela era a última frase em português
   * cravada num componente de coleção, e renderiza no `/en/pokedex`. O JSON entra
   * pelo `default-messages.ts` e não pelo `locales.ts`: aquele resolve caminho
   * por `fileURLToPath`, que não sobrevive ao ambiente `nuxt`.
   *
   * **O que esta asserção prova, e o que ela não prova.** Ela monta no idioma
   * padrão e compara contra o mesmo arquivo que o componente lê, então prova a
   * interpolação — que a contagem entra no lugar certo da frase. Ela **não**
   * distingue uma frase resolvida de uma cravada: devolvendo `capturados` para
   * dentro do template, os dois lados voltam a dizer a mesma coisa e este teste
   * continua verde. Nenhum idioma pode mostrar isso enquanto só um renderiza.
   *
   * Quem prova é o e2e, em `test/e2e/pokedex.spec.ts`: ele lê o `aria-valuetext`
   * em `/en/pokedex` e cobra a palavra do idioma da URL e a ausência da outra.
   * Atributo não entra em `innerText` e mensagem interpolada não entra em
   * `defaultOnlyLabels`, então ali é o único lugar de onde esse defeito é visível.
   */
  it('anuncia a contagem, o rótulo e a faixa', async () => {
    const progress = (await bar(98, 151)).find('[role="progressbar"]')

    expect(progress.attributes('aria-label')).toBe('Progresso em Kanto')
    expect(progress.attributes('aria-valuenow')).toBe('98')
    expect(progress.attributes('aria-valuemax')).toBe('151')
    expect(progress.attributes('aria-valuetext'))
      .toBe(messagesFrom(ptSource)('collection.progress.valueText', { progress: '98 / 151' }))
  })
})
