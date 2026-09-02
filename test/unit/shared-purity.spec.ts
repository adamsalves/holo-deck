import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * `shared/` é a camada pura, e este portão é o que a mantém assim.
 *
 * Três coisas dependem disso, e nenhuma delas avisa quando quebra:
 *
 * - **O replay da batalha.** O save é `{ gymId, seed, engineVersion, ações[] }` e
 *   reconstrói a luta rodando o motor de novo. Um `Math.random` no meio do
 *   caminho não derruba nada — só faz o mesmo log produzir um resultado
 *   diferente amanhã, o que aparece como "o jogo perdeu minha batalha".
 * - **O teste sem DOM.** Um import de `vue` dentro do motor obriga toda suíte a
 *   montar componente, e a Fase 4 é justamente a que tem valor por não precisar.
 * - **O `yarn data:build`.** O script carrega `shared/` em Node puro, sem a
 *   resolução sem extensão do Vite: um `from './brand'` ali quebra o build do
 *   dex e nada mais — o defeito que só aparece no dia do rebuild.
 *
 * Ele anda pelo disco, como os outros três portões deste repositório, porque o
 * defeito recorrente aqui é o código mudar de lugar e a regra ficar onde estava.
 */

const SCANNED = 'shared'
const SKIP = new Set(['node_modules'])

/**
 * O que não pode ser chamado dentro de `shared/`.
 *
 * `Math.random` e o relógio são os dois jeitos de uma função pura deixar de ser
 * — e o relógio é o mais fácil de escrever sem pensar, num `id: Date.now()`.
 * Quem precisa de sorteio recebe um `RngCursor`; quem precisa de tempo recebe o
 * instante de quem chamou.
 */
const IMPURE = /\b(?:Math\.random|Date\.now|performance\.now)\s*\(|\bnew\s+Date\s*\(/g

/** `from '…'`, `import '…'` e `import('…')`, que são as três formas. */
const SPECIFIER = /\bfrom\s+'([^']+)'|\bimport\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g

/**
 * Apaga comentário preservando as quebras de linha — o que mantém o número da
 * linha certo na mensagem de erro.
 *
 * Sem isto o portão reprovaria a própria documentação: o cabeçalho de `rng.ts`
 * explica por que `Math.random` não serve, e uma regra que proíbe explicar o
 * motivo da regra é pior que não ter regra.
 */
function stripComments(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    match => match.replaceAll(/[^\n]/g, ' '),
  )
}

const sources = walkFiles(join(REPO_ROOT, SCANNED), SKIP, hasExtension(['.ts']))
  .map(file => ({
    file,
    code: stripComments(readFileSync(join(REPO_ROOT, file), 'utf8')),
  }))

/**
 * Os specifiers do arquivo, **com a linha de cada um**.
 *
 * A versão anterior procurava a linha com `indexOf` na hora de montar a
 * mensagem, então dois imports do mesmo módulo apontavam os dois para a
 * primeira linha. O índice do `matchAll` já sabe a posição certa; usá-lo custa
 * a mesma coisa e não mente.
 */
function specifiersOf(code: string): { specifier: string, line: number }[] {
  return [...code.matchAll(SPECIFIER)].map(match => ({
    specifier: match[1] ?? match[2] ?? match[3] ?? '',
    line: code.slice(0, match.index).split('\n').length,
  }))
}

describe('pureza de shared/', () => {
  it('encontrou os arquivos que deveria varrer', () => {
    // Um portão que varre lista vazia passa sempre. Foi assim que o
    // `tsconfig.e2e.json` nasceu vazio, e é a primeira coisa a conferir.
    expect(sources.length).toBeGreaterThan(5)
    expect(sources.map(source => source.file)).toContain('shared/game/rng.ts')
  })

  it('não importa nada de fora de shared/', () => {
    const fora = sources.flatMap(({ file, code }) =>
      specifiersOf(code)
        .filter(({ specifier }) => {
          if (!specifier.startsWith('.')) return true
          const alvo = relative(join(REPO_ROOT, SCANNED), resolve(dirname(join(REPO_ROOT, file)), specifier))
          return alvo.startsWith('..') || alvo.startsWith(`..${sep}`)
        })
        .map(({ specifier, line }) => `${file}:${line} → ${specifier}`),
    )

    expect(
      fora,
      'shared/ viaja para o bundle do cliente e para o Node puro do build: só import relativo, e só para dentro de shared/',
    ).toEqual([])
  })

  it('todo import relativo carrega a extensão .ts', () => {
    const semExtensao = sources.flatMap(({ file, code }) =>
      specifiersOf(code)
        .filter(({ specifier }) => specifier.startsWith('.') && !specifier.endsWith('.ts'))
        .map(({ specifier, line }) => `${file}:${line} → ${specifier}`),
    )

    expect(
      semExtensao,
      '`yarn data:build` carrega shared/ em Node puro, que não resolve import sem extensão',
    ).toEqual([])
  })

  it('não sorteia e não lê o relógio', () => {
    const impuros = sources.flatMap(({ file, code }) =>
      code.split('\n').flatMap((line, index) =>
        (line.match(IMPURE) ?? []).map(hit => `${file}:${index + 1} → ${hit}`),
      ),
    )

    expect(
      impuros,
      'o replay da batalha reproduz o log com a mesma seed: sorteio vem do RngCursor, e instante vem de quem chama',
    ).toEqual([])
  })

  it('a varredura ignora comentário e não ignora código', () => {
    // A largura da ressalva, medida. Sem isto, um refactor que "simplificasse" o
    // `stripComments` apagaria o portão inteiro sem reprovar nada.
    const comentado = stripComments('// usa Math.random()\nconst a = 1\n')
    const emBloco = stripComments('/* Date.now()\n   e mais */\nconst b = 2\n')
    const codigo = stripComments('const c = Math.random()\n')

    expect(comentado).not.toMatch(IMPURE)
    expect(emBloco).not.toMatch(IMPURE)
    expect(codigo).toMatch(IMPURE)
    // A linha do código depois do bloco continua sendo a 3ª.
    expect(emBloco.split('\n')).toHaveLength(4)
  })
})
