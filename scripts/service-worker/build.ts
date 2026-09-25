import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { ROOT_GUARD_ID, rootGuardScript } from '../../app/utils/locale-preference'
import { LOCALES } from '../../app/utils/locales'
import type { PrecacheEntry } from '../../app/utils/offline'
import {
  OFFLINE_SHELL_PATH,
  PRECACHE_CACHE,
  SERVICE_WORKER_PATH,
  SPRITE_CACHE_PREFIX,
  dexUrl,
  spriteCacheName,
} from '../../app/utils/offline'
import { revisionOf } from './revision'

/**
 * Writes the service worker into the build's public output — called from
 * `nuxt.config.ts` once the prerender is done.
 *
 * **The worker is ours, with no library under it.** The spike of Phase 8's PR 5
 * measured `@vite-pwa/nuxt` against this repository: with its defaults it
 * installed the 2,104 `_payload.json` and not one script, it rewrote `200.html`
 * to `/200` — a 404, so the worker never activated —, and it cost 1,932 lines
 * of lockfile and 211 packages. What the game needs is a list of files and
 * three rules, and a list built here from the sources is the same one the gate
 * over the build (`test/e2e/offline-precache.spec.ts`) holds up against what
 * the pages load.
 *
 * Everything that decides is a pure function, tested in
 * `test/unit/service-worker-build.spec.ts`; `writeServiceWorker` only reads the
 * disk and writes to it.
 */

/** The shell, as a path of the public output. */
const SHELL_FILE = OFFLINE_SHELL_PATH.slice(1)

const FONT_FACE = /@font-face\s*\{([^}]*)\}/g
const FONT_FILE = /_fonts\/([^)"'\s]+\.woff2)/g
const UNICODE_RANGE = /unicode-range\s*:\s*([^;}]+)/

/**
 * `A`. A face whose range covers it is one of the faces pt-BR and English are
 * drawn with: Google's Latin subset reaches from the basic letters through the
 * accents of Portuguese to the punctuation the game prints (`—`, `…`, `×`).
 */
const LATIN_CAPITAL_A = 0x41

/** Whether a CSS `unicode-range` covers one code point — ranges and wildcards included. */
function covers(range: string, codePoint: number): boolean {
  return range.split(',').some((part) => {
    const token = part.trim().replace(/^U\+/i, '')

    if (token.includes('?')) {
      return codePoint >= Number.parseInt(token.replaceAll('?', '0'), 16)
        && codePoint <= Number.parseInt(token.replaceAll('?', 'F'), 16)
    }

    const [from = '', to = from] = token.split('-')

    return codePoint >= Number.parseInt(from, 16) && codePoint <= Number.parseInt(to, 16)
  })
}

/**
 * The font files of every face that draws Latin text, as paths of the public
 * output.
 *
 * `@nuxt/fonts` writes one file per family, weight, style **and script** — 36
 * today —, and the browser only ever downloads the ones whose `unicode-range`
 * meets the text on screen. Ten of them are Latin (147 KB); the Latin
 * extension, Cyrillic, Greek and Vietnamese are 170 KB neither language asks
 * for. A face with no range draws everything, so it counts.
 */
export function latinFontFiles(css: string): string[] {
  const files = new Set<string>()

  for (const [, face = ''] of css.matchAll(FONT_FACE)) {
    const range = UNICODE_RANGE.exec(face)?.[1]
    if (range !== undefined && !covers(range, LATIN_CAPITAL_A)) continue

    for (const [, file = ''] of face.matchAll(FONT_FILE)) files.add(`_fonts/${file}`)
  }

  return [...files].sort()
}

/**
 * The files of the public output the worker installs with, out of all of them.
 *
 * **Five sources, each required by name**, and the build fails naming the one
 * that came up empty: an output without the shell, the code, the dex, one
 * language's messages or the fonts would install a worker that takes over and
 * then breaks offline — where nobody sees the error and nobody can retry.
 *
 * The messages are looked up per language of `LOCALES`, so a third language is
 * installed the day it is declared, and a build that lost one fails instead of
 * shipping a game that goes quiet in that language offline.
 */
export function precachePaths(files: readonly string[], css: string): string[] {
  const present = new Set(files)

  if (!present.has(SHELL_FILE)) {
    throw new Error(`service worker: ${SHELL_FILE} is not in the output — it is prerendered from nitro.prerender.routes`)
  }

  // The code, and the SVG art it imports — the app's icon, which the tab shows
  // on every page and the bar on every page with a layout. Vite writes both
  // under `_nuxt/` with the hash in the name.
  const code = files.filter(path => path.startsWith('_nuxt/') && !path.startsWith('_nuxt/builds/') && /\.(?:js|css|svg)$/.test(path))
  if (!code.some(path => path.endsWith('.js'))) throw new Error('service worker: no code under _nuxt/')

  const dex = files.filter(path => /^data\/[^/]+\.json$/.test(path))
  if (dex.length === 0) throw new Error('service worker: no dex under data/')

  const messages = LOCALES.map(({ code: locale }) => {
    const found = files.filter(path => path.startsWith('_i18n/') && path.endsWith(`/${locale}/messages.json`))
    if (found.length !== 1) {
      throw new Error(`service worker: expected one _i18n/…/${locale}/messages.json, found ${found.length}`)
    }

    return found[0] ?? ''
  })

  const fonts = latinFontFiles(css)
  if (fonts.length === 0) throw new Error('service worker: the stylesheets have no Latin font face')

  const lost = fonts.filter(path => !present.has(path))
  if (lost.length > 0) throw new Error(`service worker: the stylesheets name ${lost.join(', ')}, which the output does not have`)

  return [SHELL_FILE, ...code, ...dex, ...messages, ...fonts].sort()
}

/**
 * The address a page asks for an installed file by — its path, except for the
 * dex, whose address carries the dex's revision (see `dexUrl`). The worker
 * answers by exact address, so this and the pages have to agree to the query.
 */
export function addressOf(path: string, dexRevision: string): string {
  const dex = /^data\/([^/]+\.json)$/.exec(path)?.[1]

  return dex === undefined ? `/${path}` : dexUrl(dex, dexRevision)
}

/**
 * The shell, with the root guard as the first thing in its head.
 *
 * Offline the shell is what `/` opens as, and it is rendered with no app on the
 * server — so the guard `app.vue` gives the root's own HTML is not in it. Without
 * one, a player who chose English and opens the installed app offline gets the
 * Hub in Portuguese: measured in the spike of this PR, before this existed.
 *
 * First in the head, ahead of every stylesheet and script, for the reason
 * `rootGuardScript` gives: the redirect has to leave before there is anything to
 * paint.
 */
export function withRootGuard(html: string): string {
  if (html.includes(`id="${ROOT_GUARD_ID}"`)) {
    throw new Error(`service worker: the shell already carries #${ROOT_GUARD_ID}, and a second would run twice`)
  }

  const heads = [...html.matchAll(/<head\b[^>]*>/g)]
  const [head] = heads
  if (heads.length !== 1 || head === undefined) {
    throw new Error(`service worker: the shell has ${heads.length} <head> tags, and the guard needs exactly one`)
  }

  const at = head.index + head[0].length

  return `${html.slice(0, at)}<script id="${ROOT_GUARD_ID}">${rootGuardScript()}</script>${html.slice(at)}`
}

/**
 * The worker's TypeScript as the browser will run it.
 *
 * A service worker registered without `type: 'module'` is a classic script, and
 * that is the only kind every browser this game targets installs. So the worker
 * imports nothing but types — which compile to nothing, and leave behind the
 * `export {}` the compiler writes to keep the file a module. That one line is
 * removed; any other module syntax left fails here, where it can be read, and
 * not as a worker that never parses.
 */
export function transpileWorker(source: string): string {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      removeComments: true,
    },
  })
  const script = outputText.replace(/^export \{\};\s*$/m, '')

  if (/^\s*(?:import|export)\b/m.test(script)) {
    throw new Error('service worker: the worker imports or exports at run time — it is served as a classic script, where that does not parse')
  }

  return script
}

/**
 * The worker as served: the names it shares with the pages, then its code.
 *
 * The entries and the thumbnails' cache go on lines of their own, as JSON — the
 * gate over the build and the offline suite read them back from `/sw.js` by
 * those lines.
 */
export function serviceWorkerScript(entries: readonly PrecacheEntry[], spriteCache: string, worker: string): string {
  return [
    `// Written by scripts/service-worker/build.ts — an edit here is lost at the next build.`,
    `const PRECACHE = ${JSON.stringify(entries)};`,
    `const PRECACHE_CACHE = ${JSON.stringify(PRECACHE_CACHE)};`,
    `const SPRITE_CACHE = ${JSON.stringify(spriteCache)};`,
    `const SPRITE_CACHE_PREFIX = ${JSON.stringify(SPRITE_CACHE_PREFIX)};`,
    `const OFFLINE_SHELL = ${JSON.stringify(OFFLINE_SHELL_PATH)};`,
    worker,
  ].join('\n')
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })

  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).replaceAll(sep, '/'))
}

const WORKER_SOURCE = fileURLToPath(new URL('./worker.ts', import.meta.url))

/**
 * Chooses the files, guards the shell, and writes the worker next to them.
 *
 * The shell is guarded **before** it is hashed, so the revision the worker
 * installs under is the one of the file the browser gets — and the one the
 * worker checks the download against.
 *
 * `dexRevision` and `spriteRevision` come from `nuxt.config.ts`, which gave the
 * same ones to every page: the addresses written here are the ones the pages ask
 * for, and the thumbnails' cache is the one *Download everything for offline*
 * fills.
 */
export async function writeServiceWorker(publicDir: string, dexRevision: string, spriteRevision: string): Promise<{ entries: number, bytes: number }> {
  const files = await filesUnder(publicDir)
  const cssFiles = files.filter(path => path.startsWith('_nuxt/') && path.endsWith('.css'))
  const css = (await Promise.all(cssFiles.map(path => readFile(join(publicDir, path), 'utf8')))).join('\n')

  const paths = precachePaths(files, css)

  const shell = join(publicDir, SHELL_FILE)
  await writeFile(shell, withRootGuard(await readFile(shell, 'utf8')))

  let bytes = 0
  const entries = await Promise.all(paths.map(async (path) => {
    const content = await readFile(join(publicDir, path))
    bytes += content.length

    return { url: addressOf(path, dexRevision), revision: revisionOf(content) }
  }))

  const spriteCache = spriteCacheName(spriteRevision)
  const worker = transpileWorker(await readFile(WORKER_SOURCE, 'utf8'))
  await writeFile(join(publicDir, SERVICE_WORKER_PATH.slice(1)), serviceWorkerScript(entries, spriteCache, worker))

  return { entries: entries.length, bytes }
}
