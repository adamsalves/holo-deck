import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeServer } from '../test/support/server-probe.ts'
import { withFunctionServer } from '../test/support/vercel-function-server.ts'

/**
 * O dex vai dentro da função da Vercel — a issue #15.
 *
 * `test/e2e/server-runtime.spec.ts` prova que o servidor construído responde 404
 * sem vazar caminho, rodando fora da raiz do projeto. **Mas ele mede o preset
 * `node-server`**, que é o que o `yarn build` do CI produz, e a Vercel constrói com
 * o preset `vercel`. Ali o dex só chega à função por `serverAssets` (ver
 * `nuxt.config.ts`): sem ele, `public/data/` vai para a CDN e a função não recebe
 * cópia nenhuma, e `/pokemon/qualquer-coisa` volta a responder 500. Um
 * `serverAssets` removido por engano passaria por todos os outros portões — e o
 * preview, atrás do Vercel Authentication, não serve de medida.
 *
 * **A lista sai da fonte**: cada `.json` de `public/data/` precisa de um
 * `chunks/raw/<nome>.mjs` dentro da função. Um arquivo novo no dex entra sozinho
 * na conferência, e a pasta de saída sumindo — o Nitro mudando o layout do preset
 * — reprova alto em vez de passar sem ter o que conferir.
 *
 * **E três coisas que ele mede porque passar sem elas seria passar por acaso:**
 *
 * 1. **O `serverAssets` que ele vigia é o que está escrito hoje.** A lista de
 *    arquivos vem de `public/data/`, que é o destino de **uma** entrada; uma
 *    segunda entrada (`public/rules`, sprites, o que for) não seria conferida e
 *    o portão continuaria verde enquanto ela não embarcasse. Enumerar a
 *    declaração e reprovar quando ela muda é o que transforma isso em decisão de
 *    alguém, em vez de omissão.
 * 2. **Arquivo presente não é arquivo embarcado.** Um `.mjs` de zero byte
 *    passava pela conferência de existência.
 * 3. **A função medida precisa continuar sendo a que serve `/pokemon/*`.** Hoje
 *    as outras rotas são symlink para `__fallback.func`; no dia em que o Nitro
 *    emitir funções separadas, medir só a de fallback seria medir a errada.
 *
 * **And then it starts the function and asks it.** Files in place are not files
 * read: a function that reads the dex through `process.cwd()` has every chunk
 * above in place and still answers 500 from anywhere but the project root. So
 * the last step runs the function from a temporary directory
 * (`test/support/vercel-function-server.ts`) and puts the probe of
 * `server-runtime.spec.ts` to it (`test/support/server-probe.ts`): the same 404s,
 * in every language, and a real species answering 200 as the good side. It comes
 * last on purpose — a build that lost the dex fails above, by name, and not here
 * as a 500.
 *
 * Roda depois de `yarn build:vercel`.
 */

/**
 * A raiz, pelo módulo e não pelo `cwd`.
 *
 * É o que os portões de `test/support/source-tree.ts` já fazem, e pelo mesmo
 * motivo: caminho relativo amarra o portão ao diretório de onde ele foi chamado,
 * que é o defeito de "o portão rodava no único `cwd` em que o código quebrado
 * funcionava".
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const DATA = 'public/data'
const FUNCTIONS = '.vercel/output/functions'
const FALLBACK = '__fallback.func'
const RAW = join(FUNCTIONS, FALLBACK, 'chunks/raw')

/** As entradas de `serverAssets` que este portão sabe conferir. */
const COVERED = ['../public/data']

/** Os `dir` declarados no `serverAssets` do `nuxt.config.ts`, na ordem. */
function declaredAssetDirs(): string[] {
  const config = readFileSync(join(REPO_ROOT, 'nuxt.config.ts'), 'utf8')
  const block = /serverAssets:\s*\[(.*?)\]/s.exec(config)
  if (block === null) return []

  return [...(block[1] ?? '').matchAll(/dir:\s*'([^']+)'/g)].map(hit => hit[1] ?? '')
}

const declared = declaredAssetDirs()
if (declared.join('|') !== COVERED.join('|')) {
  console.error(
    `::error::o serverAssets do nuxt.config.ts declara [${declared.join(', ') || 'nada'}] e este portão só confere [${COVERED.join(', ')}] — estenda-o antes de seguir`,
  )
  process.exit(1)
}

const sources = readdirSync(join(REPO_ROOT, DATA)).filter(name => name.endsWith('.json'))

if (sources.length === 0) {
  console.error(`::error::${DATA} não tem nenhum .json — o portão não teria o que conferir`)
  process.exit(1)
}

const functionsRoot = join(REPO_ROOT, FUNCTIONS)
if (!existsSync(functionsRoot)) {
  console.error(`::error::${FUNCTIONS} não existe (o build não foi com yarn build:vercel?)`)
  process.exit(1)
}

// Toda rota que não a de fallback precisa continuar sendo symlink para ela,
// senão este portão mede uma função e o `/pokemon/*` é servido por outra.
const split = readdirSync(functionsRoot)
  .filter(name => name.endsWith('.func') && name !== FALLBACK)
  .filter(name => !lstatSync(join(functionsRoot, name)).isSymbolicLink())

if (split.length > 0) {
  console.error(
    `::error::${split.join(', ')} deixaram de ser symlink para ${FALLBACK} — este portão mede só a função de fallback, e agora há outra servindo rota`,
  )
  process.exit(1)
}

const rawRoot = join(REPO_ROOT, RAW)
if (!existsSync(rawRoot)) {
  console.error(`::error::${RAW} não existe: a função da Vercel não recebeu dex nenhum`)
  process.exit(1)
}

const missing = sources.filter((name) => {
  const chunk = join(rawRoot, `${basename(name, '.json')}.mjs`)
  return !existsSync(chunk) || statSync(chunk).size === 0
})

for (const name of missing) {
  console.error(`::error::${DATA}/${name} não foi embarcado na função da Vercel (ausente ou vazio)`)
}

if (missing.length > 0) process.exit(1)

console.log(`${sources.length} arquivos do dex conferidos dentro da função da Vercel`)

const functionDir = join(functionsRoot, FALLBACK)

let problems: string[]
try {
  problems = await withFunctionServer(functionDir, (base, cwd) => probeServer(base, [cwd, functionDir]))
}
catch (error) {
  // `%0A` is how a workflow command carries a line break, so the stderr of a
  // function that never started stays inside the annotation.
  console.error(`::error::${(error instanceof Error ? error.message : String(error)).replaceAll('\n', '%0A')}`)
  process.exit(1)
}

for (const problem of problems) console.error(`::error::${problem}`)
if (problems.length > 0) process.exit(1)

console.log('the function answered the probe: 404 with no path leaked, and the real species page, in every language')
