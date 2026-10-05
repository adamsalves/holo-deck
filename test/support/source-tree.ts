import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Andar pelo código-fonte em disco, para os testes que verificam portão.
 *
 * Os portões deste repositório falham sempre do mesmo jeito: o código muda de
 * lugar e a configuração fica onde estava. Um teste que cite arquivos por nome
 * envelhece junto com a configuração que deveria vigiar — por isso estes
 * verificadores leem o disco em vez de uma lista.
 */

/** Raiz do repositório, resolvida a partir da posição deste arquivo. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Caminhos relativos à raiz, de todo arquivo sob `dir` que `keep` aceitar.
 *
 * Diretórios ocultos e os de `skip` não são visitados. A separação é sempre `/`,
 * inclusive onde o `node:path` usaria outra — os chamadores comparam com globs.
 */
export function walkFiles(
  dir: string,
  skip: ReadonlySet<string>,
  keep: (fileName: string) => boolean,
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []

    const full = join(dir, entry.name)
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : walkFiles(full, skip, keep)

    return keep(entry.name) ? [relative(REPO_ROOT, full).replaceAll(sep, '/')] : []
  })
}

/** `keep` para extensões: aceita o arquivo cujo nome termina em uma delas. */
export function hasExtension(extensions: readonly string[]) {
  return (fileName: string) => extensions.some(extension => fileName.endsWith(extension))
}

/** A sample value for each route parameter, so a dynamic page has an address to open. */
const SAMPLES: Readonly<Record<string, string>> = { gymId: '1', gen: '1', name: 'pikachu' }

const PAGES = 'app/pages'

/** `/styleguide` exists only in `yarn dev` — the build removes it (see `nuxt.config.ts`). */
const DEVELOPMENT_ONLY = new Set(['/styleguide'])

/**
 * The files of `app/pages` the build leaves out, from the same list that keeps
 * their addresses out of `pageAddresses` — a gate that reads the templates of
 * `app/` has to leave them out too, and one list is what keeps the two agreeing.
 */
export function developmentOnlyPages(): string[] {
  return [...DEVELOPMENT_ONLY].map(address => `${PAGES}${address}.vue`)
}

interface BuiltPage {
  readonly file: string
  readonly route: string
}

/**
 * The pages the build keeps, each with its route as `app/pages` spells it — the
 * parameter in brackets.
 */
function builtPages(): BuiltPage[] {
  const pages = walkFiles(join(REPO_ROOT, PAGES), new Set(), hasExtension(['.vue']))

  return pages.flatMap((file) => {
    const route = `/${relative(PAGES, file).replaceAll(sep, '/').replace(/\.vue$/, '')}`
      .replace(/\/index$/, '') || '/'

    return DEVELOPMENT_ONLY.has(route) ? [] : [{ file, route }]
  })
}

/** The address a page answers at: its route, with a sample in place of each parameter. */
function addressOf({ file, route }: BuiltPage): string {
  return route.replace(/\[(\w+)\]/g, (_, parameter: string) => {
    const sample = SAMPLES[parameter]
    if (sample === undefined) throw new Error(`${file}: no sample for [${parameter}]`)

    return sample
  })
}

/**
 * One address per page of `app/pages`, read from the disk: a page added later is
 * measured without anyone remembering to add it here. A parameter nobody gave a
 * sample for fails instead of being skipped.
 */
export function pageAddresses(): string[] {
  return builtPages().map(addressOf)
}

/**
 * The route of each page the build keeps, as `app/pages` spells it — `/pokedex/[gen]`,
 * with the parameter in brackets — from the same scan and the same
 * development-only exclusion as `pageAddresses`.
 *
 * It exists for what a page with a parameter expands to. `pageAddresses` swaps the
 * parameter for one sample so a gate has an address to open, which says nothing
 * about which values the build is meant to write a page for.
 *
 * It asks for no sample, on purpose. A page whose parameter nobody declared yet
 * still has a route, and `prerendered-routes.ts` is who says it has no source —
 * a throw from here used to get in first, with "no sample for [id]" in the place
 * of the message that names what to declare.
 */
export function pageRoutes(): string[] {
  return builtPages().map(page => page.route)
}

/**
 * The layout each page is drawn in, by address: what its `definePageMeta` says —
 * `none` for `layout: false` —, and `default` for a page that says nothing.
 *
 * It exists for what lives **around** the pages. A component put in a layout is
 * missing from every page drawn outside it, and a walk that only lands on pages
 * of one layout cannot tell: the route announcer, moved from `app.vue` into the
 * default layout, left the battle unannounced with its own test green.
 */
export function pageLayouts(): Map<string, string> {
  return new Map(builtPages().map((page) => {
    const address = addressOf(page)
    const source = stripComments(readFileSync(join(REPO_ROOT, page.file), 'utf8'))
    const layout = /definePageMeta\(\s*\{[^}]*?\blayout:\s*(false|'[\w-]+'|"[\w-]+")/.exec(source)?.[1]

    if (layout === undefined) return [address, 'default']
    return [address, layout === 'false' ? 'none' : layout.slice(1, -1)]
  }))
}

/**
 * Apaga comentário preservando as quebras de linha, para o número da linha na
 * mensagem de erro continuar certo.
 *
 * **Sem isto o portão reprova quem explica a própria regra.** Foi o que
 * aconteceu ao escrever `/rules`: o comentário que diz que ler
 * `--color-type-fire` direto seria pular a camada semântica foi acusado de fazer
 * exatamente isso. Uma regra que proíbe explicar o motivo da regra é pior que
 * não ter regra.
 *
 * **Mora aqui porque quatro portões precisam dela**, e o quarto foi o que
 * mostrou o custo de cada um ter a sua: `motion-gate` nasceu sem apagar
 * comentário e contornou o problema **excluindo `app/assets/css/main.css`
 * inteiro** da varredura — o arquivo cujo docblock desenha o par de exemplo.
 * A exclusão de arquivo é mais larga que o problema: ela também apagou do
 * alcance do portão qualquer regra de movimento de verdade que o tema venha a
 * ter. Apagar comentário resolve o caso e não abre esse buraco.
 *
 * `//` só conta como comentário quando não vem logo depois de `:`, senão o `//`
 * de uma URL apagaria o resto da linha — e com ele um token de verdade.
 */
export function stripComments(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<!:)\/\/[^\n]*/g,
    match => match.replaceAll(/[^\n]/g, ' '),
  )
}
