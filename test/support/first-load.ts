import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What a page costs before it can run, read from the HTML the build wrote for it.
 *
 * **The HTML says what the first load is, and the disk is the scale.** A page
 * declares what it needs up front — the module script, the `modulepreload` of
 * every chunk the entry pulls in, the stylesheets — and each file is weighed
 * where the build put it, in raw bytes. Raw and not compressed: the host picks
 * the encoding, and a ceiling that moved with it would be measuring the CDN
 * instead of the code. What the HTML does not declare is not counted: the
 * `prefetch` of a chunk for another route happens after the page is up, and the
 * data a page fetches is its own business.
 *
 * **The CSS inside the HTML is CSS of the first load.** Nuxt writes the `scoped`
 * styles of the components the server rendered into `<style>` tags of the page,
 * beside Nuxt UI's colour variables: 21 to 28 KB a page, and where most of the
 * game's own CSS is — the stylesheets are, nearly all of them, the library's
 * theme and the global sheet. A meter of `<link rel="stylesheet">` alone let a
 * component's CSS grow unseen: 42 KB planted in one page's `<style scoped>` left
 * that page under its ceiling. The same rules come once more as files when the
 * page's chunks load, which the HTML does not declare; they are counted here
 * once.
 *
 * It reads files and asks no browser, so it runs in plain `node` and can answer
 * for any output folder — `.output/public` is the one `yarn build` writes.
 */

/** What a page's HTML declares for its first load: the files, as it spells them, and its own CSS. */
export interface DeclaredAssets {
  readonly scripts: readonly string[]
  readonly css: readonly string[]
  /** The CSS written into the document itself, in `<style>`: there is no file to name, only bytes. */
  readonly inlineCssBytes: number
  /** Declared and not a path on the build's own host: there is no file here to weigh. */
  readonly external: readonly string[]
}

/** A page's first load: the files, and what the ones on disk weigh. */
export interface FirstLoad extends DeclaredAssets {
  readonly scriptBytes: number
  /** The stylesheets on disk and `inlineCssBytes`, together. */
  readonly cssBytes: number
}

/** Which list a tag feeds: the JavaScript, the CSS, or neither. */
function kindOf(tag: string): 'scripts' | 'css' | undefined {
  if (tag.startsWith('<script')) return /(?<![\w-])type="module"/.test(tag) ? 'scripts' : undefined
  if (/(?<![\w-])rel="modulepreload"/.test(tag)) return 'scripts'
  if (/(?<![\w-])rel="stylesheet"/.test(tag)) return 'css'

  return undefined
}

/** The CSS between each `<style>` of the document and its end, in bytes. */
function inlineCss(html: string): number {
  return Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g))
    .reduce((total, [, css = '']) => total + Buffer.byteLength(css), 0)
}

/**
 * The module scripts and the `modulepreload` links — the JavaScript —, and the
 * `stylesheet` links — the CSS — of one HTML document, each file once, and the
 * bytes of CSS the document carries in itself.
 *
 * **Anything declared that is not a path on the host goes to `external`, and is
 * not dropped.** A filter that only kept `/…` would let a third-party script into
 * the first load without a byte of it counted, and the ceiling would go on
 * reading as if it guarded the whole.
 */
export function declaredAssets(html: string): DeclaredAssets {
  const found = { scripts: new Set<string>(), css: new Set<string>() }
  const external = new Set<string>()

  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const kind = kindOf(tag)
    const address = /(?<![\w-])(?:src|href)="([^"]+)"/.exec(tag)?.[1]
    if (kind === undefined || address === undefined) continue

    found[kind].add(address)
    if (!address.startsWith('/') || address.startsWith('//')) external.add(address)
  }

  return { scripts: [...found.scripts], css: [...found.css], inlineCssBytes: inlineCss(html), external: [...external] }
}

/** The raw size, in the folder the build wrote, of each address that is a file there. */
function weigh(dir: string, addresses: readonly string[], external: readonly string[]): number {
  return addresses
    .filter(address => !external.includes(address))
    .reduce((total, address) => total + statSync(join(dir, address)).size, 0)
}

/**
 * The first load of the page the build wrote at `route` — `/deck`, `/en/deck`,
 * `/` for the root —, in the folder `dir`.
 */
export function firstLoadOf(dir: string, route: string): FirstLoad {
  const declared = declaredAssets(readFileSync(join(dir, route, 'index.html'), 'utf8'))

  return {
    ...declared,
    scriptBytes: weigh(dir, declared.scripts, declared.external),
    cssBytes: weigh(dir, declared.css, declared.external) + declared.inlineCssBytes,
  }
}
