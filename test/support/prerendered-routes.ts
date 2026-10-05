import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { LocaleCode } from '../../app/utils/locales.ts'
import { DEFAULT_LOCALE, LOCALES, pathInLocale } from '../../app/utils/locales.ts'
import { OFFLINE_SHELL_PATH } from '../../app/utils/offline.ts'
import { GYM_COUNT } from '../../shared/types/brand.ts'
import { isIndexData } from '../../shared/types/dex.ts'
import { pageRoutes, REPO_ROOT } from './source-tree.ts'

/**
 * The pages a build wrote, against the pages the sources say it should have —
 * for whichever preset's output folder it is given.
 *
 * **One list, asked of both presets.** `test/e2e/prerender-payload.spec.ts` hands
 * it `.output/public` (what `yarn build` makes) and `scripts/check-vercel-bundle.ts`
 * hands it `.vercel/output/static` (what Vercel serves). It returns problems
 * instead of asserting, the way `server-probe.ts` does, and for the same two
 * callers; and it runs in plain `node`, so everything it imports spells the `.ts`
 * extension out. That is also why it does not reuse `generated-dex.ts`, which
 * reaches the dex through an alias.
 *
 * **The expectation is the sources, by origin, and the origin has a name.**
 *
 * - the pages of `app/pages` that take no parameter, development-only ones out;
 * - `/pokedex/[gen]`, from the `gen-N.json` files of `public/data/`;
 * - `/pokemon/[name]`, from the slugs of `public/data/index.json`;
 * - `/battle/[gymId]`, from `GYM_COUNT`;
 * - the offline shell, `OFFLINE_SHELL_PATH`, which no route reaches.
 *
 * **Per origin, because a floor on the sum holds up the moment any one parcel
 * works.** This replaces `toBeGreaterThan(1000)`, which stayed green with the nine
 * battles gone, or the nine static pages. Each origin has to name at least one
 * route, so a source that came back empty fails by name instead of agreeing with
 * a build that wrote nothing — and the message of a miss says which origin it was.
 *
 * **Sets, in both directions, per language.** What the sources name and the build
 * did not write, and what the build wrote and no origin explains. The second is
 * how a page that appeared from nowhere gets noticed — and a route that looks
 * legitimate is a decision for a person, not an exemption to add here.
 *
 * **A page with a parameter and no declared source fails.** A new `[x].vue` has to
 * say where its addresses come from, and a declaration whose page is gone is as
 * stale as a list nobody reads.
 *
 * **And every page has its payload beside it, and every payload its page.** The
 * two are written by the same render, so a page alone is a page this build did
 * not render. That is what the Vercel preset does with a file a previous build
 * left in `.output/public`: Nitro's prerenderer answers the route with it instead
 * of rendering, and the old page goes into the output with nothing beside it.
 * Measured with one such file on disk: the build exits 0 with 4,210 routes
 * instead of 4,211, and every other question of the Vercel gate passes.
 */

const DATA = join(REPO_ROOT, 'public/data')

/** The file a page is, and the file its data travels in, side by side in the page's folder. */
const PAGE = 'index.html'
const PAYLOAD = '_payload.json'

/** More than this many routes in one message is a wall of text: the count says the rest. */
const LIST_LIMIT = 20

function generationRoutes(): string[] {
  return readdirSync(DATA).flatMap((name) => {
    const generation = /^gen-(\d+)\.json$/.exec(name)?.[1]

    return generation === undefined ? [] : [`/pokedex/${generation}`]
  })
}

function speciesRoutes(): string[] {
  const raw: unknown = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
  if (!isIndexData(raw)) throw new Error('public/data/index.json did not pass the read guard')

  return raw.map(entry => `/pokemon/${entry.slug}`)
}

function gymRoutes(): string[] {
  return Array.from({ length: GYM_COUNT }, (_, index) => `/battle/${index + 1}`)
}

/** Where the addresses of each page with a parameter come from, by the page's own route. */
const PARAMETER_SOURCES: Readonly<Record<string, () => string[]>> = {
  '/pokedex/[gen]': generationRoutes,
  '/pokemon/[name]': speciesRoutes,
  '/battle/[gymId]': gymRoutes,
}

interface Origin {
  readonly name: string
  readonly routes: readonly string[]
}

/** The origins the sources declare, and what is wrong with the declaration itself. */
function originsOfRoutes(): { origins: Origin[], problems: string[] } {
  const routes = pageRoutes()
  const problems: string[] = []
  const withParameter = routes.filter(route => route.includes('['))
  const origins: Origin[] = [{ name: 'app/pages, no parameter', routes: routes.filter(route => !route.includes('[')) }]

  for (const route of withParameter) {
    const source = PARAMETER_SOURCES[route]
    if (source === undefined) {
      problems.push(`app/pages has ${route}, a page with a parameter, and test/support/prerendered-routes.ts does not say where its addresses come from — declare its source`)
    }
    else {
      origins.push({ name: route, routes: source() })
    }
  }

  for (const route of Object.keys(PARAMETER_SOURCES)) {
    if (!withParameter.includes(route)) {
      problems.push(`test/support/prerendered-routes.ts declares a source for ${route} and app/pages has no such page — delete the declaration`)
    }
  }

  return { origins, problems }
}

/**
 * Every route the build wrote a `file` for — the page or its payload —, as a
 * path with no locale prefix, by locale.
 *
 * The locale **root** is the case worth spelling out: `/en` is the home page of
 * the other language, not a page called *en* in this one. Matching only
 * `/en/…` files it in the default bucket, where it becomes a route `/en` that
 * the other language is then reported as missing — which is what the first
 * version of this did, and the failure names the wrong thing twice.
 *
 * Both presets write a page as `<route>/index.html`, which was looked at in each
 * output folder and not assumed. The offline shell is the one file with another
 * name, which is why `builtRouteProblems` asks for it by name.
 */
function routesByLocale(dir: string, file: string): Map<string, Set<string>> {
  const prefixed = LOCALES.map(({ code }) => code).filter(code => code !== DEFAULT_LOCALE)
  const byLocale = new Map<string, Set<string>>(LOCALES.map(({ code }) => [code, new Set<string>()]))

  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== file) continue

    const relativePath = relative(dir, entry.parentPath).replaceAll(sep, '/')
    const route = relativePath === '' ? '/' : `/${relativePath}`
    const code = prefixed.find(one => route === `/${one}` || route.startsWith(`/${one}/`))

    if (code === undefined) byLocale.get(DEFAULT_LOCALE)?.add(route)
    else byLocale.get(code)?.add(route.slice(code.length + 1) || '/')
  }

  return byLocale
}

function listed(routes: readonly string[], code: LocaleCode): string {
  const shown = routes.slice(0, LIST_LIMIT).map(route => pathInLocale(route, code)).join(', ')

  return `${routes.length} route(s): ${shown}${routes.length > LIST_LIMIT ? `, … and ${routes.length - LIST_LIMIT} more` : ''}`
}

/**
 * What is wrong between the sources and the folder `dir` holds. Empty is healthy.
 *
 * `dir` is `.output/public` or `.vercel/output/static`; the messages name it
 * relative to the project, so the failure says which preset's output it was.
 */
export function builtRouteProblems(dir: string): string[] {
  const where = relative(REPO_ROOT, dir).replaceAll(sep, '/')
  if (!existsSync(dir)) return [`${where} does not exist — did the build run?`]

  const { origins, problems } = originsOfRoutes()

  // The other side: a source that names nothing agrees with any build at all.
  for (const origin of origins) {
    if (origin.routes.length === 0) problems.push(`origin ${origin.name} names no route, so it would agree with a build that wrote none of them`)
  }

  const explained = new Set(origins.flatMap(origin => origin.routes))
  const built = routesByLocale(dir, PAGE)
  const carried = routesByLocale(dir, PAYLOAD)

  for (const { code } of LOCALES) {
    const wrote = built.get(code) ?? new Set<string>()
    const data = carried.get(code) ?? new Set<string>()

    for (const origin of origins) {
      const missing = origin.routes.filter(route => !wrote.has(route))
      if (missing.length > 0) problems.push(`[${code}] ${origin.name}: ${where} lacks ${listed(missing, code)}`)
    }

    const unexplained = [...wrote].filter(route => !explained.has(route)).sort()
    if (unexplained.length > 0) problems.push(`[${code}] ${where} has routes no origin explains: ${listed(unexplained, code)}`)

    const alone = [...wrote].filter(route => !data.has(route)).sort()
    if (alone.length > 0) problems.push(`[${code}] ${where} has pages with no ${PAYLOAD} beside them, which is a page this build did not render: ${listed(alone, code)}`)

    const adrift = [...data].filter(route => !wrote.has(route)).sort()
    if (adrift.length > 0) problems.push(`[${code}] ${where} has a ${PAYLOAD} with no page beside it: ${listed(adrift, code)}`)
  }

  if (!existsSync(join(dir, OFFLINE_SHELL_PATH))) problems.push(`offline shell: ${where} lacks ${OFFLINE_SHELL_PATH}`)

  return problems
}
