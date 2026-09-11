import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
 * `server/` nasceu na Fase 3, antes da API da Fase 7, e já estava na lista: é o
 * ponto de declarar a raiz antes de ela existir. A lista é filtrada por
 * existência, não podada.
 */
const SCANNED_ROOTS = ['app', 'shared', 'server', 'scripts', 'test']

/**
 * Os arquivos da **raiz** que carregam TypeScript.
 *
 * **Eles ficaram fora deste portão até a Fase 7, e o defeito que escapou por aí é
 * o mesmo que este arquivo existe para pegar.** `drizzle.config.ts` nasceu fora
 * dos seis projetos da solução, e a consequência é a que o docblock acima
 * descreve: o `yarn typecheck` passava por cima dele — um `out: 42` plantado
 * dentro passava limpo — e o ESLint recusava o arquivo inteiro. Quem acusou foi o
 * `lint-gate`, que mede outro portão; este, que mede exatamente o `tsconfig`,
 * dava verde, porque só andava por **diretório**.
 *
 * E o `README` afirmava que ele *"pergunta ao próprio TypeScript quais arquivos
 * cada projeto cobre e reprova se algum ficar de fora"* — verdade para as pastas
 * e falso para a raiz, que é onde o arquivo de configuração mora.
 *
 * Lido do disco como tudo aqui: configuração nova na raiz entra na medição por
 * existir, sem ninguém precisar lembrar de acrescentá-la a uma lista.
 */
function rootSources(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith('.') && hasExtension(TS_BEARING)(entry.name))
    .map(entry => entry.name)
}

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

const onDisk = [
  ...SCANNED_ROOTS
    .map(root => join(REPO_ROOT, root))
    .filter(existsSync)
    .flatMap(dir => walkFiles(dir, SKIP, hasExtension(TS_BEARING))),
  ...rootSources(),
]

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

  /**
   * O outro lado da varredura da raiz: ela não pode ficar vazia.
   *
   * `rootSources()` devolvendo `[]` — um `readdirSync` que passe a filtrar demais,
   * um `hasExtension` que mude de forma — faria a asserção de cobertura passar
   * sobre nada, e o buraco da Fase 7 voltaria a ser invisível exatamente aqui.
   * Os quatro de hoje são `drizzle`, `nuxt`, `playwright` e `vitest`.
   */
  it('e mede também os arquivos de configuração da raiz', () => {
    expect(rootSources().length).toBeGreaterThanOrEqual(4)
    expect(rootSources()).toContain('nuxt.config.ts')
  })
})
