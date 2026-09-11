import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

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
