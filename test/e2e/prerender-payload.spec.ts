import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { GYM_COUNT } from '../../shared/types/brand.ts'
import { defaultLocale, localeCodes } from '../support/locales.ts'

/**
 * O dado pré-renderizado de `useAsyncData` é JSON, e a mesma chave vale o mesmo
 * em toda página.
 *
 * **Este arquivo existe por causa de um time do líder que sumiu.** No pré-render
 * o Nuxt 4 reaproveita o resultado de uma chave entre as páginas que a usam,
 * guardando-o num storage que só serializa JSON. `useLeague` devolvia um `Map`: o
 * `setItem` lançava, o próprio Nuxt engolia o erro, e `/` recebia `null` para
 * `league-teams:1` enquanto `/league` recebia o time certo. No cliente `null`
 * conta como dado carregado, então o Hub abria sem time para todo jogador sem
 * insígnia — desde a `v0.7.0`, com build verde e console limpo.
 *
 * As duas perguntas leem o que a build **produziu**, não o código:
 *
 * - **Nenhum valor carrega tipo que não seja JSON.** A lista é de quem pode ficar
 *   — os invólucros de reatividade que o próprio Nuxt põe em volta do dado —, e
 *   todo outro tipo do devalue reprova: `Map` hoje, `Set` ou `Date` amanhã. É o
 *   que pega o defeito mesmo quando a ordem do pré-render o esconde: se as duas
 *   páginas pegassem o `Map` ainda na memória, nada divergiria, e ele continuaria
 *   lá esperando a próxima build.
 * - **Chave presente em mais de uma página tem o mesmo valor em todas.** É o
 *   contrato do cache compartilhado; divergir é ele ter falhado em silêncio.
 *
 * O render fica com `hub-team.spec.ts`. Aqui é o payload.
 */

const PUBLIC = fileURLToPath(new URL('../../.output/public', import.meta.url))

/** Os invólucros que o Nuxt serializa em volta do dado, e que o cliente desfaz. */
const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'])
const EMPTY_REFS = new Set(['EmptyRef', 'EmptyShallowRef'])

/** Os especiais negativos do devalue que não são JSON. -1 e -2 são ausência. */
const NOT_JSON_SPECIALS: Readonly<Record<number, string>> = { [-3]: 'NaN', [-4]: 'Infinity', [-5]: '-Infinity' }

async function payloadFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter(entry => entry.isFile() && entry.name === '_payload.json')
    .map(entry => join(entry.parentPath, entry.name))
}

/** Segue os invólucros de reatividade até o valor que eles embrulham. */
function unwrap(table: readonly unknown[], index: unknown): unknown {
  let current = index
  for (let hops = 0; hops < 8; hops += 1) {
    if (typeof current !== 'number' || current < 0) return undefined
    const value = table[current]
    if (!Array.isArray(value) || typeof value[0] !== 'string' || !WRAPPERS.has(value[0])) return value
    current = value[1]
  }
  return undefined
}

/**
 * Remonta um valor do devalue, anotando em `foreign` todo tipo que não é JSON.
 *
 * O tipo estranho vira um marcador em texto em vez de ser reconstruído: o que se
 * pergunta é se ele está lá, e comparar dois marcadores iguais entre páginas
 * continua servindo para a segunda pergunta.
 */
function decode(table: readonly unknown[], index: unknown, foreign: Set<string>, depth = 0): unknown {
  if (typeof index !== 'number') return index
  if (index < 0) {
    const special = NOT_JSON_SPECIALS[index]
    if (special !== undefined) foreign.add(special)
    return special === undefined ? undefined : `<${special}>`
  }
  if (depth > 64) throw new Error('payload fundo demais para ser dado de jogo')

  const value = table[index]
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    // `Array.isArray` estreita `unknown` para `any[]`; o tipo explícito impede
    // que o `any` entre pela desestruturação.
    const items: readonly unknown[] = value
    const [head, ...rest] = items
    if (typeof head === 'string') {
      if (WRAPPERS.has(head)) return decode(table, rest[0], foreign, depth + 1)
      if (EMPTY_REFS.has(head)) return undefined
      foreign.add(head)
      return `<${head}>`
    }
    return items.map(item => decode(table, item, foreign, depth + 1))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decode(table, item, foreign, depth + 1)]),
  )
}

test('o dado pré-renderizado é JSON, e a mesma chave vale o mesmo em toda página', async () => {
  const files = await payloadFiles(PUBLIC)

  // O outro lado: sem payload nenhum, as duas perguntas passariam por vazio.
  expect(files.length, 'a build não tem payload pré-renderizado — rodar `yarn build`').toBeGreaterThan(100)

  const foreign: string[] = []
  const pagesByValue = new Map<string, Map<string, string[]>>()

  for (const file of files) {
    const page = `/${relative(PUBLIC, file).replace(/_payload\.json$/, '')}`
    const table: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(table)) throw new Error(`${page}: payload fora do formato do devalue`)

    const root: unknown = table[0]
    if (typeof root !== 'object' || root === null || !('data' in root)) continue

    const data = unwrap(table, root.data)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) continue

    for (const [key, index] of Object.entries(data)) {
      const types = new Set<string>()
      const value = decode(table, index, types)
      for (const type of types) foreign.push(`${page}  ${key}  ${type}`)

      const canonical = JSON.stringify(value) ?? 'undefined'
      const variants = pagesByValue.get(key) ?? new Map<string, string[]>()
      variants.set(canonical, [...variants.get(canonical) ?? [], page])
      pagesByValue.set(key, variants)
    }
  }

  // `soft` nas duas perguntas: um mesmo defeito costuma acusar nas duas, e ver as
  // duas de uma vez é o diagnóstico inteiro numa rodada de CI.
  expect.soft(foreign, 'valor pré-renderizado que não é JSON: o cache compartilhado do pré-render não o guarda').toEqual([])

  const shared = [...pagesByValue].filter(([, variants]) => [...variants.values()].flat().length > 1)

  // O outro lado da segunda pergunta: sem chave em duas páginas, ela não mede nada.
  expect(shared.length, 'nenhuma chave aparece em mais de uma página').toBeGreaterThan(0)

  const divergent = shared
    .filter(([, variants]) => variants.size > 1)
    .map(([key, variants]) => `${key}: ${[...variants.values()].map(pages => pages.join(' ')).join(' ≠ ')}`)

  expect.soft(divergent, 'a mesma chave com valores diferentes entre páginas: o cache compartilhado falhou').toEqual([])
})

/**
 * Every route the build writes in the default language, it also writes in the
 * other one — or the gap is named here.
 *
 * **This is the half of issue #37 that no browser can take.** The links are what
 * the crawler follows, so a screen whose `NuxtLink` still carries a literal path
 * does not fail a rendered assertion — it fails to **produce pages**, silently,
 * and `/en/pokemon/charizard` goes on being served by the function while every
 * gate stays green. Before the Pokédex screens were translated the crawler
 * stopped after nine `/en` pages, and the only symptom was a number nobody was
 * asserting.
 *
 * It enumerates who is OUT. The nine `/en/battle/N` are the whole exception, and
 * they are not a crawler failure: the League body is a `<ClientOnly>`, so the
 * links to `/battle/N` exist in no served HTML, and the pt-BR ones are only
 * prerendered because `nitro.prerender.routes` lists them by hand — in one
 * language. Whoever adds the locale prefix there deletes this exception, and
 * until then the `nuxt.config.ts` docblock that promises "every valid route is
 * prerendered" is true for 1.043 routes out of 1.052.
 *
 * Built from `GYM_COUNT`, so a tenth gym is exempt the day it is written and a
 * gym removed stops being forgiven.
 */
const ROUTES_ONLY_IN_DEFAULT: readonly string[] = Array.from(
  { length: GYM_COUNT },
  (_, index) => `/battle/${index + 1}`,
)

/**
 * Every route the build wrote, as a path with no locale prefix, by locale.
 *
 * The locale **root** is the case worth spelling out: `/en` is the home page of
 * the other language, not a page called *en* in this one. Matching only
 * `/en/…` files it in the default bucket, where it becomes a route `/en` that
 * the other language is then reported as missing — which is what the first
 * version of this did, and the failure names the wrong thing twice.
 */
async function prerenderedRoutes(): Promise<Map<string, Set<string>>> {
  const entries = await readdir(PUBLIC, { withFileTypes: true, recursive: true })
  const prefixed = localeCodes().filter(code => code !== defaultLocale())
  const byLocale = new Map<string, Set<string>>(localeCodes().map(code => [code, new Set<string>()]))

  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== 'index.html') continue

    const relativePath = relative(PUBLIC, entry.parentPath)
    const route = relativePath === '' ? '/' : `/${relativePath}`
    const code = prefixed.find(one => route === `/${one}` || route.startsWith(`/${one}/`))

    if (code === undefined) byLocale.get(defaultLocale())?.add(route)
    else byLocale.get(code)?.add(route.slice(code.length + 1) || '/')
  }

  return byLocale
}

test('toda rota pré-renderizada existe em cada idioma, ou está escrita como exceção', async () => {
  const byLocale = await prerenderedRoutes()
  const base = byLocale.get(defaultLocale()) ?? new Set<string>()

  // `[] === []` passa: uma build que não rodou, ou um diretório renomeado,
  // deixaria as duas comparações abaixo medindo nada e parecendo saudáveis.
  expect(base.size, 'nenhuma rota pré-renderizada — a build rodou?').toBeGreaterThan(1000)
  expect(localeCodes().length).toBeGreaterThan(1)

  for (const [code, routes] of byLocale) {
    if (code === defaultLocale()) continue

    const missing = [...base].filter(route => !routes.has(route)).sort()

    expect(
      missing.filter(route => !ROUTES_ONLY_IN_DEFAULT.includes(route)),
      `o pré-render não alcançou estas rotas em ${code}`,
    ).toEqual([])

    // E o outro lado: exceção que deixou de valer sai da lista, senão ela
    // sobrevive à rota que perdoava e passa a esconder a próxima.
    expect(
      ROUTES_ONLY_IN_DEFAULT.filter(route => routes.has(route)),
      `estas rotas já existem em ${code} e não precisam mais de exceção`,
    ).toEqual([])

    // Nenhuma rota só em `/en`: um prefixo que vazasse para dentro do caminho
    // (`/en/en/deck`) apareceria aqui, e em lugar nenhum acima.
    expect([...routes].filter(route => !base.has(route)).sort(), `rota só em ${code}`).toEqual([])
  }
})
