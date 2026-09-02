import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * Todo arquivo de TypeScript pertence a **algum** projeto da solução.
 *
 * Este é o portão que faltava, e ele fecha a quarta aparição do mesmo defeito.
 * O comentário de `lint-gate.spec.ts` o descrevia como não verificável — *"os
 * outros três continuam sendo trabalho de review ao criar pasta nova de TS:
 * `tsconfig.tools.json`, os aliases do Vitest, e a escolha entre `test/nuxt/` e
 * `test/unit/`"* — e a Fase 3 provou o custo disso: `test/e2e/` nasceu fora de
 * qualquer projeto, e o sintoma não foi um erro claro. Foi o `yarn typecheck`
 * acusando `Cannot find name 'document'` e o ESLint recusando o arquivo inteiro
 * com *was not found by the project service*, dois erros que apontam para o
 * código quando o problema é de configuração.
 *
 * A cobertura é medida pelo **próprio TypeScript**, não por um comparador de
 * globs escrito à mão: `parseJsonConfigFileContent` resolve `extends`, `include`
 * e `exclude` exatamente como o compilador resolve. Um matcher aproximado daria
 * um portão que concorda com o `tsc` na maioria dos casos, e é justamente o
 * caso raro que este teste existe para pegar.
 */

const SKIP = new Set(['node_modules', 'dist', 'coverage'])
const TS_BEARING = ['.ts', '.mts', '.cts', '.tsx']

/**
 * As raízes de código do repositório. `.nuxt/` e `.output/` são gerados.
 *
 * `server/` ainda não existe — ela chega com a API da Fase 7 —, e está na lista
 * de propósito: no dia em que nascer, ela já é medida. A lista é filtrada por
 * existência, não podada.
 */
const SCANNED_ROOTS = ['app', 'shared', 'server', 'scripts', 'test']

/** Os projetos referenciados pela solução da raiz. */
function solutionProjects(): string[] {
  const root = readJson(join(REPO_ROOT, 'tsconfig.json'))
  const references = root.references
  if (!Array.isArray(references)) return []

  return references.flatMap((reference) => {
    const path = isRecord(reference) ? reference.path : undefined
    return typeof path === 'string' ? [join(REPO_ROOT, path)] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readJson(file: string): Record<string, unknown> {
  const parsed: unknown = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8')).config
  return isRecord(parsed) ? parsed : {}
}

/** Os arquivos que um projeto cobre, resolvidos pelo próprio compilador. */
function filesOf(project: string): string[] {
  const config = ts.readConfigFile(project, path => readFileSync(path, 'utf8'))
  if (config.error !== undefined) throw new Error(`${project}: ${String(config.error.messageText)}`)

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(project), undefined, project)
  return parsed.fileNames.map(file => relative(REPO_ROOT, file).replaceAll(sep, '/'))
}

const projects = solutionProjects()

const covered = new Set(projects.flatMap(filesOf))

const onDisk = SCANNED_ROOTS
  .map(root => join(REPO_ROOT, root))
  .filter(existsSync)
  .flatMap(dir => walkFiles(dir, SKIP, hasExtension(TS_BEARING)))

describe('cobertura do tsconfig', () => {
  it('a solução referencia os projetos gerados e os escritos à mão', () => {
    // Se a raiz parar de referenciar alguém, a checagem abaixo passa a medir um
    // repositório menor do que o que existe — e passa por engano.
    expect(projects.length).toBeGreaterThanOrEqual(6)
    expect(projects.some(project => project.endsWith('tsconfig.tools.json'))).toBe(true)
    expect(projects.some(project => project.endsWith('tsconfig.e2e.json'))).toBe(true)
  })

  it('cada projeto cobre pelo menos um arquivo', () => {
    // Um projeto vazio é o modo silencioso de falhar: `include` e `exclude` que
    // se anulam produzem zero arquivo e nenhum erro. Foi assim que o
    // `tsconfig.e2e.json` nasceu quebrado — o `exclude` herdado do `extends`
    // apagava o `include` dele.
    const vazios = projects.filter(project => filesOf(project).length === 0)

    expect(vazios.map(project => relative(REPO_ROOT, project))).toEqual([])
  })

  it('não deixa nenhum arquivo de TypeScript fora de todos os projetos', () => {
    const fora = onDisk.filter(file => !covered.has(file))

    expect(
      fora,
      'arquivo sem projeto: o `yarn typecheck` passa por cima dele e o ESLint o recusa por inteiro',
    ).toEqual([])
  })

  it('encontrou código para medir', () => {
    // O `walkFiles` devolvendo vazio faria a asserção acima passar sobre nada.
    expect(onDisk.length).toBeGreaterThan(20)
  })
})
