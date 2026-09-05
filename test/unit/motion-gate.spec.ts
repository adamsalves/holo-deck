import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * O par de movimento, cobrado.
 *
 * O jogo obedece a duas fontes: `prefers-reduced-motion` do sistema, que é o
 * único sinal que existe antes de o JavaScript rodar, e o interruptor de
 * `/settings`, que carimba `data-reduce-motion` no `<html>`. Media query e
 * seletor não se combinam em CSS, então **toda regra que para uma animação
 * aparece duas vezes** — e o modo de errar é escrever uma.
 *
 * Os dois lados falham de jeitos diferentes e nenhum dos dois faz barulho:
 * esquecer a media query faz o jogo ignorar quem configurou o sistema
 * operacional e nunca abriu `/settings`; esquecer o `:root[...]` faz o
 * interruptor da tela desligar parte da animação e deixar o resto correndo, que
 * é pior que não ter interruptor.
 *
 * **Ele compara seletores, e não contagens** — e a diferença não é teórica: a
 * primeira versão contava ocorrências das duas regexes por arquivo, o que
 * significa que acrescentar um segundo seletor **dentro** de um `@media` que já
 * existe não mudava nada. Um `@media` com duas regras e um `:root[...]` com uma
 * dava 1 e 1, e passava. O defeito que escapava era exatamente o que o parágrafo
 * acima descreve como o pior dos dois.
 *
 * **E ele apaga comentário em vez de excluir arquivo.** A primeira versão tirava
 * `app/assets/css/main.css` inteiro da varredura porque o docblock de lá desenha
 * o par de exemplo. A exclusão é mais larga que o problema: qualquer regra de
 * movimento de verdade que o tema ganhasse ficaria fora do portão para sempre.
 * `stripComments` resolve o exemplo e mantém o arquivo sob vigilância.
 *
 * Anda pelo disco pelo mesmo motivo dos outros portões: componente novo com
 * animação nova aparece toda fase, e uma lista escrita à mão não o alcança.
 */

const SCANNED = 'app'
const SKIP = new Set(['node_modules'])

/** `@media (prefers-reduced-motion: reduce) {`, com espaçamento livre. */
const MEDIA_OPEN = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g

/** `:root[data-reduce-motion]`, que é como o interruptor chega ao CSS. */
const SWITCH_PREFIX = ':root[data-reduce-motion]'

/** Um espaço entre partes, para `.a::after` e `.a  ::after` serem o mesmo. */
function normalize(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ')
}

/**
 * Os corpos dos blocos de media query, casando chaves.
 *
 * Contar chaves e não usar regex porque um `@media` pode conter mais de uma
 * regra, e é justamente a segunda regra que a versão antiga deixava passar.
 */
function mediaBodies(source: string): string[] {
  const bodies: string[] = []

  for (let open = MEDIA_OPEN.exec(source); open !== null; open = MEDIA_OPEN.exec(source)) {
    const start = open.index + open[0].length
    let depth = 1
    let index = start

    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }

    bodies.push(source.slice(start, index - 1))
  }

  return bodies
}

/** Cada lista de seletores que abre uma regra, já separada por vírgula. */
function selectorLists(css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, list]) => (list ?? '').split(','))
    .map(normalize)
    .filter(selector => selector.length > 0)
}

/**
 * O que cada lado do par declara, num arquivo.
 *
 * O lado do interruptor é lido **fora** dos blocos de media query: um
 * `:root[data-reduce-motion]` escrito dentro do `@media` não vale como par,
 * porque ali ele só se aplica a quem já configurou o sistema.
 */
function sidesOf(source: string): { media: string[], toggle: string[] } {
  const clean = stripComments(source)
  const bodies = mediaBodies(clean)
  const outside = bodies.reduce((rest, body) => rest.replace(body, ''), clean)

  return {
    media: bodies.flatMap(selectorLists).sort(),
    toggle: selectorLists(outside)
      .filter(selector => selector.startsWith(SWITCH_PREFIX))
      .map(selector => normalize(selector.slice(SWITCH_PREFIX.length)))
      .sort(),
  }
}

const sources = walkFiles(join(REPO_ROOT, SCANNED), SKIP, hasExtension(['.vue', '.css']))
  .map(file => ({ file, ...sidesOf(readFileSync(join(REPO_ROOT, file), 'utf8')) }))

describe('portão do interruptor de movimento', () => {
  it('varre arquivos de verdade', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  /**
   * O par é conferido nos dois sentidos numa asserção só, e de propósito: a
   * mensagem de erro precisa dizer **qual arquivo** e **qual seletor** falta, e
   * duas asserções separadas dariam dois relatórios parciais do mesmo defeito.
   */
  it('toda regra de movimento existe nas duas formas, seletor por seletor', () => {
    const unpaired = sources
      .map(({ file, media, toggle }) => ({
        file,
        semMediaQuery: toggle.filter(selector => !media.includes(selector)),
        semInterruptor: media.filter(selector => !toggle.includes(selector)),
      }))
      .filter(({ semMediaQuery, semInterruptor }) =>
        semMediaQuery.length > 0 || semInterruptor.length > 0)

    expect(unpaired).toEqual([])
  })

  /**
   * O portão só vale se houver o que contar: `[] === []` passa, e um repositório
   * sem nenhuma regra de movimento o deixaria verde para sempre.
   *
   * **O piso é um, e não a contagem de hoje.** Regra de movimento nasce e morre
   * com a animação que ela para — a loja apagou a do baralho selado ao trocar o
   * estado selado pelos três cartões, e um piso fixo teria reprovado uma remoção
   * correta. O que precisa ser verdade é só que ainda existe par a conferir.
   */
  it('há ao menos uma regra de movimento para parear', () => {
    const paired = sources.filter(({ media }) => media.length > 0)

    expect(paired.length).toBeGreaterThanOrEqual(1)
  })

  /**
   * A prova de que apagar comentário não cegou o portão: o tema **continua na
   * varredura**, e é o arquivo que a versão antiga excluía inteiro.
   */
  it('e o tema continua sendo varrido, e não excluído', () => {
    expect(sources.map(({ file }) => file)).toContain('app/assets/css/main.css')
  })
})
