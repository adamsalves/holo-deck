import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { ROOT_GUARD_ID } from '../../app/utils/locale-preference.ts'
import { LOCALES } from '../../app/utils/locales.ts'
import { defaultLocale, localeCodes, localeUrl } from '../support/locales.ts'

/**
 * What every built page tells a search engine about its language — read from
 * the HTML the build wrote, which is what a crawler receives.
 *
 * **Issue #39 is why this exists.** `useLocaleHead` was switched off in PR 1 of
 * this phase for two measured reasons: with the screens still in Portuguese,
 * its alternate links made the crawler write a thousand `/en/…` pages declaring
 * English over Portuguese text; and with no `baseUrl` it wrote every link
 * relative, which Google ignores in an `hreflang` annotation. The screens are
 * translated and the config names the site's origin now, so it is back on — and
 * both failures are silent. A relative `hreflang` renders nothing and breaks
 * nothing; the page looks exactly as it did.
 *
 * So this asks the **form** of each link, not its presence:
 *
 * - **Absolute, `https`, and one origin across every page.** A relative link is
 *   the #39 defect; an `http://localhost` is what a `baseUrl` taken from the
 *   request would bake in, because every page is rendered by the prerenderer on
 *   the build machine. One origin, because a canonical pointing at a preview
 *   host would split the site in two for the index.
 * - **Each alternate points at this page, in the language it names.** The
 *   expected path is built by `localeUrl` from `test/support/`, not by the
 *   module or by `pathInLocale`: an expectation from the code that wrote the
 *   link agrees with it when both are wrong.
 * - **Every language of the game has its alternate, plus `x-default`** — the
 *   list is `LOCALES`, so a third language is asked for the day it is declared,
 *   on every page. And an alternate naming a language the game does not have is
 *   a failure too, which is how a language registered in the config around the
 *   list would show up.
 * - **The canonical and `og:url` are this page in its own language.**
 * - **`lang`, `dir` and `og:locale` declare the language of the URL.** `dir` was
 *   written by hand in `app.vue` until this PR; the module writes it now, and
 *   this is what says it still does.
 * - **The root guard is in the root and nowhere else** — see `rootGuardScript`.
 *   On any other page it would send a player who chose English out of a
 *   Portuguese link they were sent.
 *
 * One test and not six: `fullyParallel` hands each test of a file to its own
 * worker, and each would read the 2.104 pages again. The rules are `soft`, so a
 * failing build names every rule it breaks in one run.
 */

const PUBLIC = fileURLToPath(new URL('../../.output/public', import.meta.url))

/** One tag of the head, as `name → value` for each attribute it carries. */
type Attributes = ReadonlyMap<string, string>

interface BuiltPage {
  /** The route with no locale prefix — `/pokemon/pikachu` for both languages. */
  readonly route: string
  readonly code: string
  readonly html: Attributes
  readonly links: readonly Attributes[]
  readonly metas: readonly Attributes[]
  readonly guarded: boolean
}

/**
 * The attributes of a tag the head manager wrote.
 *
 * A regex over the build's own output, not a general HTML parser: unhead writes
 * every attribute double-quoted, and escapes a quote inside a value. The one
 * entity these values can carry is `&amp;`, in a query no link here has.
 */
function attributesOf(tag: string): Attributes {
  return new Map([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(
    ([, name = '', value = '']): [string, string] => [name, value],
  ))
}

/** Every `<link>`, `<meta>` or `<script>` opening tag inside `head`. */
function tagsIn(head: string, name: 'link' | 'meta' | 'script'): Attributes[] {
  return [...head.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(([tag]) => attributesOf(tag))
}

/**
 * Every prerendered page, with its route and its language read from where it
 * sits on disk — the one thing about a page the head cannot lie about.
 */
async function builtPages(): Promise<BuiltPage[]> {
  const entries = await readdir(PUBLIC, { withFileTypes: true, recursive: true })
  const prefixed = localeCodes().filter(code => code !== defaultLocale())
  const pages: BuiltPage[] = []

  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== 'index.html') continue

    const folder = relative(PUBLIC, entry.parentPath)
    const path = folder === '' ? '/' : `/${folder}`
    const prefix = prefixed.find(code => path === `/${code}` || path.startsWith(`/${code}/`))
    const code = prefix ?? defaultLocale()
    const route = prefix === undefined ? path : path.slice(prefix.length + 1) || '/'

    const source = await readFile(join(entry.parentPath, entry.name), 'utf8')
    const head = source.slice(0, source.indexOf('</head>'))

    pages.push({
      route,
      code,
      html: attributesOf(/<html\b[^>]*>/.exec(source)?.[0] ?? ''),
      links: tagsIn(head, 'link'),
      metas: tagsIn(head, 'meta'),
      guarded: tagsIn(source, 'script').some(script => script.get('id') === ROOT_GUARD_ID),
    })
  }

  return pages
}

/** How a page is named in a failure: its path as a visitor types it. */
function nameOf(page: BuiltPage): string {
  return localeUrl(page.route, page.code)
}

/**
 * The language an `hreflang` stands for: `x-default` is the root's, a full tag
 * is the language that declares it, and a bare language (`pt`) is the language
 * whose tag starts with it — the catch-all the module adds for a regional tag.
 */
function languageOf(hreflang: string): string | undefined {
  if (hreflang === 'x-default') return defaultLocale()

  return LOCALES.find(locale => locale.language === hreflang)?.code
    ?? LOCALES.find(locale => locale.language.split('-')[0] === hreflang)?.code
}

test('every built page declares its language, and links to itself in every other', async () => {
  const pages = await builtPages()

  // Floor per language and not on the sum: a build that lost one language
  // entirely would still clear a total, carried by the other.
  for (const code of localeCodes()) {
    expect(pages.filter(page => page.code === code).length, `${code}: no built pages — did the build run?`)
      .toBeGreaterThan(1000)
  }

  const origins = new Set<string>()
  const unreadable: string[] = []

  /** The path of an absolute `https` URL, noting its origin — or `null`, noted as a failure. */
  function pathOf(page: BuiltPage, what: string, href: string | undefined): string | null {
    const url = URL.canParse(href ?? '') ? new URL(href ?? '') : null

    if (url === null || url.protocol !== 'https:') {
      unreadable.push(`${nameOf(page)} ${what}: ${href ?? '(none)'}`)
      return null
    }

    origins.add(url.origin)
    return url.pathname
  }

  const wrongAlternates: string[] = []
  const missingAlternates: string[] = []
  const wrongCanonical: string[] = []
  const wrongLanguage: string[] = []

  for (const page of pages) {
    const own = LOCALES.find(locale => locale.code === page.code)
    const alternates = page.links.filter(link => link.get('rel') === 'alternate')

    for (const link of alternates) {
      const hreflang = link.get('hreflang') ?? '(none)'
      const target = languageOf(hreflang)
      const path = pathOf(page, `hreflang=${hreflang}`, link.get('href'))

      if (target === undefined) wrongAlternates.push(`${nameOf(page)} hreflang=${hreflang}: no such language`)
      else if (path !== null && path !== localeUrl(page.route, target)) {
        wrongAlternates.push(`${nameOf(page)} hreflang=${hreflang} → ${path}, not ${localeUrl(page.route, target)}`)
      }
    }

    const declared = new Set(alternates.map(link => link.get('hreflang')))
    for (const wanted of ['x-default', ...LOCALES.map(locale => locale.language)]) {
      if (!declared.has(wanted)) missingAlternates.push(`${nameOf(page)} hreflang=${wanted}`)
    }

    const canonicalLinks = page.links.filter(link => link.get('rel') === 'canonical')
    const urlMetas = page.metas.filter(meta => meta.get('property') === 'og:url')
    const canonical = canonicalLinks.length === 1 ? canonicalLinks[0]?.get('href') : undefined
    const canonicalPath = pathOf(page, 'canonical', canonical)

    if (canonicalPath !== null && canonicalPath !== nameOf(page)) {
      wrongCanonical.push(`${nameOf(page)} canonical → ${canonicalPath}`)
    }
    if (urlMetas.length !== 1 || urlMetas[0]?.get('content') !== canonical) {
      wrongCanonical.push(`${nameOf(page)} og:url ${urlMetas.map(meta => meta.get('content')).join(', ') || '(none)'} ≠ canonical`)
    }

    const openGraphLocale = page.metas.find(meta => meta.get('property') === 'og:locale')?.get('content')
    const declaredLanguage = [page.html.get('lang'), page.html.get('dir'), openGraphLocale].join(' ')
    const expectedLanguage = [own?.language, 'ltr', own?.language.replace('-', '_')].join(' ')

    if (declaredLanguage !== expectedLanguage) {
      wrongLanguage.push(`${nameOf(page)}: lang dir og:locale = ${declaredLanguage}, not ${expectedLanguage}`)
    }
  }

  expect.soft(unreadable, 'links that are not absolute https — the #39 defect, or a baseUrl from the request').toEqual([])
  expect.soft([...origins], 'every link names the same site').toHaveLength(1)
  expect.soft(wrongAlternates, 'alternates that do not point at this page in the language they name').toEqual([])
  expect.soft(missingAlternates, 'pages that do not link to themselves in every language').toEqual([])
  expect.soft(wrongCanonical, 'canonicals and og:url that are not this page in its own language').toEqual([])
  expect.soft(wrongLanguage, 'pages declaring a language other than the one of their URL').toEqual([])

  // The guard, by set: the root carries it, and no other page does.
  expect.soft(pages.filter(page => page.guarded).map(nameOf), 'pages carrying the root guard')
    .toEqual([localeUrl('/', defaultLocale())])
})
