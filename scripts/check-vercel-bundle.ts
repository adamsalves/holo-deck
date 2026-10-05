import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFunctionServer } from '../test/support/built-server.ts'
import { builtRouteProblems } from '../test/support/prerendered-routes.ts'
import { probeServer } from '../test/support/server-probe.ts'

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
 * **The Node it runs on is held to the repository's.** `.vc-config.json` names the
 * runtime Vercel starts the function with, and Nitro 2.13 only knows Node 18, 20
 * and 22: built on Node 24 it falls back to 22 without saying so. The config now
 * declares `nodejs24.x` — a literal, not derived from `.nvmrc`, so that a bump of
 * `.nvmrc` fails here and gets decided instead of moving production's runtime on
 * its own — and this step holds the declared major to the one in `.nvmrc`. A
 * missing file, or a `runtime` that is not `nodejs<N>.x`, is a failure and not a
 * pass: there is nothing it could be holding to.
 *
 * **The pages are measured too, by origin.** `.vercel/output/static` is what
 * Vercel serves and nothing else looked at it: the e2e that holds the Node output
 * to the sources (`prerender-payload.spec.ts`) cannot see a page the Vercel build
 * lost. The same helper (`test/support/prerendered-routes.ts`) holds this folder
 * to the same set — the static pages, the generations, the species, the nine
 * battles, the offline shell —, by name, in every language and in both directions.
 *
 * **And then it starts the function and asks it.** Files in place are not files
 * read: a function that reads the dex through `process.cwd()` has every chunk
 * above in place and still answers 500 from anywhere but the project root. So
 * the last step runs **a copy** of the function, in a temporary folder outside
 * the repository (`test/support/built-server.ts`) — which is what a deploy gets,
 * and what tells a function that carries everything it imports from one that
 * only runs where it was built — and puts the probe of `server-runtime.spec.ts`
 * to it (`test/support/server-probe.ts`): the index through the dex route, the
 * same 404s in every language, and the real pages beside them answering 200. It
 * comes last on purpose — a build that lost the dex fails above, by name, and not
 * here as a 500.
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
const STATIC = '.vercel/output/static'
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

/**
 * A check that threw — a source it could not read, a function that never started —
 * fails the run like one that found a problem, and is annotated the same way.
 * `%0A` is how a workflow command carries a line break, so the stderr of a
 * function that never started stays inside the annotation.
 */
function fail(error: unknown): never {
  console.error(`::error::${(error instanceof Error ? error.message : String(error)).replaceAll('\n', '%0A')}`)
  process.exit(1)
}

/** The major of the Node `.nvmrc` pins, and the major `.vc-config.json` declares, held to each other. */
function runtimeProblems(): string[] {
  const config = join(FUNCTIONS, FALLBACK, '.vc-config.json')
  if (!existsSync(join(REPO_ROOT, config))) return [`${config} does not exist, so the runtime of the function cannot be read`]

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(REPO_ROOT, config), 'utf8'))
  }
  catch {
    return [`${config} is not valid JSON, so the runtime of the function cannot be read`]
  }

  const runtime = typeof parsed === 'object' && parsed !== null && 'runtime' in parsed ? parsed.runtime : undefined
  const declared = typeof runtime === 'string' ? /^nodejs(\d+)\.x$/.exec(runtime)?.[1] : undefined
  if (declared === undefined) return [`${config} declares runtime ${JSON.stringify(runtime)}, which is not of the form nodejs<N>.x`]

  const pinned = /^v?(\d+)\./.exec(readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim())?.[1]
  if (pinned === undefined) return ['.nvmrc does not start with a Node version, so the runtime of the function has nothing to be held to']

  return declared === pinned
    ? []
    : [`${config} declares nodejs${declared}.x and .nvmrc pins Node ${pinned}: set nitro.vercel.functions.runtime in nuxt.config.ts to nodejs${pinned}.x`]
}

const runtimeFindings = runtimeProblems()
for (const problem of runtimeFindings) console.error(`::error::${problem}`)
if (runtimeFindings.length > 0) process.exit(1)

console.log('the function declares the Node major that .nvmrc pins')

let pageProblems: string[]
try {
  pageProblems = builtRouteProblems(join(REPO_ROOT, STATIC))
}
catch (error) {
  fail(error)
}

for (const problem of pageProblems) console.error(`::error::${problem}`)
if (pageProblems.length > 0) process.exit(1)

console.log(`the pages in ${STATIC} match what the sources name, in every language`)

const functionDir = join(functionsRoot, FALLBACK)

let problems: string[]
try {
  problems = await withFunctionServer(functionDir, (base, root) => probeServer(base, [root]))
}
catch (error) {
  fail(error)
}

for (const problem of problems) console.error(`::error::${problem}`)
if (problems.length > 0) process.exit(1)

console.log('a copy of the function, outside the repository, answered the probe: the index, 404 with no path leaked, and the real pages, in every language')
