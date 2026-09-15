import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './source-tree'

/**
 * Os locales como o tradutor os escreveu, lidos do disco.
 *
 * **Ler o arquivo, e não importá-lo, é o que faz este módulo servir aos dois
 * lados.** Dentro do Vitest, `import ptBR from '~~/i18n/locales/pt-BR.json'`
 * devolve a mensagem já **compilada** pelo `@intlify/unplugin-vue-i18n` que o
 * `@nuxtjs/i18n` registra no Vite (`VueI18nPlugin.vite` com `include:
 * localePaths`): cada rótulo chega como nó de AST, e `nav.base` deixa de existir
 * como chave — vira `nav.base.loc.start.line`. O Playwright roda fora do Vite e
 * recebe a string. `readFileSync` devolve a mesma coisa nos dois, que é o que
 * permite ao portão unitário e ao e2e medirem a mesma fonte.
 *
 * Ele mora em `test/support/` pela regra do `CLAUDE.md` — helper de portão mora
 * aqui —, e porque a primeira versão, co-locada em `test/e2e/support.ts` com o
 * `pt-BR` fechado dentro da função, não podia ser usada nem pelo portão unitário
 * nem por um e2e em inglês. Era o helper que impedia de medir o idioma que o PR
 * entrega.
 */

/** Onde os arquivos de tradução moram. */
export const LOCALE_DIR = join(REPO_ROOT, 'i18n/locales')

/**
 * Os códigos de locale que existem em disco, em ordem alfabética.
 *
 * Montada do **diretório**, e não escrita à mão: um idioma novo é medido por
 * existir. Uma lista de entrada aqui deixaria o terceiro locale fora de toda
 * asserção, em silêncio, que é o modo de falhar que este repositório já pagou.
 */
export function localeCodes(): string[] {
  return readdirSync(LOCALE_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
}

/**
 * O locale como dado cru.
 *
 * `JSON.parse` devolve `any`, que é por onde o `any` entrou na Fase 0 — ele sai
 * daqui anotado como `unknown` e só passa adiante pelas guardas abaixo, que é o
 * padrão das outras fronteiras de parse deste repositório.
 */
export function readLocale(code: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), 'utf8'))

  return parsed
}

/** Aceita objeto e recusa array e `null`, que `typeof` chama de `'object'`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Toda folha do arquivo, como `[chave em notação de ponto, valor cru]`.
 *
 * Devolve o **valor** junto da chave de propósito: uma versão anterior colhia só
 * chaves e procurava rótulo vazio com `.find` entre os locales, que para no
 * primeiro. Um rótulo vazio só no inglês passava, porque o português respondia
 * antes e não estava vazio. Par por par, cada locale é medido por si.
 *
 * Recursivo porque o arquivo é aninhado e vai aninhar mais: comparar só o
 * primeiro nível diria que dois locales combinam quando um deles tem `nav` pela
 * metade.
 */
export function leafEntries(value: unknown, prefix = ''): [string, unknown][] {
  if (!isRecord(value)) return [[prefix, value]]

  return Object.entries(value).flatMap(([key, child]) => (
    leafEntries(child, prefix === '' ? key : `${prefix}.${key}`)
  ))
}

/**
 * O rótulo traduzido de uma chave, no locale pedido — o que a tela renderiza.
 *
 * Lança em vez de devolver a chave: no e2e, procurar um link chamado
 * `nav.collection` falharia com "elemento não encontrado", e o teste diria que a
 * barra sumiu quando o que faltou foi tradução.
 */
export function label(key: string, code: string): string {
  const leaves = leavesOf(code)

  if (!leaves.has(key)) throw new Error(`sem chave \`${key}\` no locale ${code}`)

  const value = leaves.get(key)
  if (typeof value !== 'string') {
    throw new Error(`a chave \`${key}\` do locale ${code} não é texto: ${typeof value}`)
  }

  return value
}

/**
 * The leaves of one locale, parsed once per run.
 *
 * `label()` is called once per key, and the e2e asks for 24 of them in each
 * language — without this, that is 48 reads and 48 parses of the same two files.
 * It caches the **parse**, never the question: every call still looks the key up
 * in what the file actually says, and a key that is missing still throws.
 */
const LEAVES = new Map<string, Map<string, unknown>>()

function leavesOf(code: string): Map<string, unknown> {
  const cached = LEAVES.get(code)
  if (cached !== undefined) return cached

  const leaves = new Map(leafEntries(readLocale(code)))
  LEAVES.set(code, leaves)

  return leaves
}

/**
 * O locale que não leva prefixo de URL, lido do `nuxt.config.ts`.
 *
 * Lido da configuração e não escrito aqui: com `prefix_except_default`, quem
 * decide a forma de toda URL do jogo é aquele campo. Uma cópia nesta pasta
 * envelheceria ao lado da regra que ela vigia, e o e2e passaria a visitar
 * endereços que não existem — dizendo que a tela sumiu quando o que mudou foi a
 * estratégia de rota.
 */
export function defaultLocale(): string {
  const source = readFileSync(join(REPO_ROOT, 'nuxt.config.ts'), 'utf8')
  const found = /defaultLocale:\s*'([^']+)'/.exec(source)?.[1]

  if (found === undefined) throw new Error('`defaultLocale` não encontrado em nuxt.config.ts')

  return found
}

/** O caminho de `path` no locale pedido — sem prefixo no padrão, `/<code>` no resto. */
export function localeUrl(path: string, code: string): string {
  if (code === defaultLocale()) return path

  return path === '/' ? `/${code}` : `/${code}${path}`
}
