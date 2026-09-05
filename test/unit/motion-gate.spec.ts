import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

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
 * **Ele conta pares, e não ocorrências.** A pergunta não é "existe algum
 * `data-reduce-motion` no arquivo" — é se cada `@media` tem o seu. Um arquivo
 * com três animações e um `:root[...]` só passaria na leitura frouxa.
 *
 * Anda pelo disco pelo mesmo motivo dos outros portões: componente novo com
 * animação nova aparece toda fase, e uma lista escrita à mão não o alcança.
 */

const SCANNED = 'app'
const SKIP = new Set(['node_modules'])

/**
 * O tema é a exceção, e é a única: `main.css` **documenta** o par no comentário
 * do utilitário de movimento, com um exemplo de cada lado. Contá-lo faria o
 * portão reprovar a explicação da regra que ele existe para cobrar — o mesmo
 * cuidado que o portão de pureza toma ao apagar comentários antes de varrer.
 */
const THEME = 'app/assets/css/main.css'

/** `@media (prefers-reduced-motion: reduce)`, com espaçamento livre. */
const MEDIA = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g

/** `:root[data-reduce-motion]`, que é como o interruptor chega ao CSS. */
const SWITCH = /:root\[data-reduce-motion\]/g

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

const sources = walkFiles(join(REPO_ROOT, SCANNED), SKIP, hasExtension(['.vue', '.css']))
  .filter(file => file !== THEME)
  .map(file => ({ file, code: readFileSync(join(REPO_ROOT, file), 'utf8') }))

describe('portão do interruptor de movimento', () => {
  it('varre arquivos de verdade', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  /**
   * O par é conferido nos dois sentidos numa asserção só, e de propósito: a
   * mensagem de erro precisa dizer **qual arquivo** e **qual lado** falta, e
   * duas asserções separadas dariam dois relatórios parciais do mesmo defeito.
   */
  it('toda regra de movimento existe nas duas formas, arquivo por arquivo', () => {
    const unpaired = sources
      .map(({ file, code }) => ({
        file,
        media: count(code, MEDIA),
        toggle: count(code, SWITCH),
      }))
      .filter(({ media, toggle }) => media !== toggle)

    expect(unpaired).toEqual([])
  })

  /**
   * O portão só vale se houver o que contar. Sem esta linha, apagar as sete
   * regras de movimento do repositório o deixaria verde — que é exatamente o
   * modo de falha que a Fase 5 plantou e o review da Fase 6 pegou.
   */
  it('há regras de movimento para parear', () => {
    const paired = sources.filter(({ code }) => count(code, MEDIA) > 0)

    expect(paired.length).toBeGreaterThanOrEqual(7)
  })
})
