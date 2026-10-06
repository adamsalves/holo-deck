import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { LOCALES, pathInLocale } from '../../app/utils/locales.ts'
import { declaredAssets, firstLoadOf } from '../support/first-load'
import { pageAddresses, REPO_ROOT } from '../support/source-tree'

/**
 * **The first load of every page has a ceiling, by name — the JavaScript and the
 * CSS apart.**
 *
 * What a page declares before it can run is the cost no player can avoid: the
 * entry, the chunks it preloads, the stylesheets. Nothing in the suite weighed
 * it, so a dependency or a theme could double it and every gate stay green.
 * `test/support/first-load.ts` reads it from the HTML the build wrote, and the
 * numbers below are what each page weighed when its ceiling was last set, plus 5%
 * and rounded up to the next KB. The twin of a page in the other language weighs
 * the same, so one pair serves both.
 *
 * **Each page has its own two numbers, and they are not a sum.** A floor or a
 * ceiling on the total is held up by whichever parcel still fits: the CSS could
 * double and the JavaScript, still under its share, would keep the sum green.
 * Asked apart and by name, a regression in one page's one half fails there, and
 * the message says which.
 *
 * **A page nobody declared fails, and so does a ceiling nobody needs.** The pages
 * come from `app/pages`, so one added later is measured the day it exists — with
 * no ceiling to measure it against, which is a failure and not a skip. Both
 * directions are compared as sets, by name: a count would agree with a table that
 * lost one page and gained another.
 *
 * **A ceiling that has to rise is a decision, written down in the PR that made
 * the page heavier — not a re-run until it passes.** One that can fall falls in
 * the PR that made the page lighter: the gate is one-sided on purpose, and a
 * ceiling left far above the page measures nothing.
 *
 * The page's data and what it fetches afterwards are not in the number, and
 * neither is anything the HTML does not declare. Reads `.output/public`, so it
 * needs `yarn build` first.
 */

const PUBLIC = join(REPO_ROOT, '.output/public')

interface Ceiling {
  readonly scripts: number
  readonly css: number
}

/** In raw bytes, by the address `pageAddresses()` spells — a sample for each parameter. */
const CEILINGS: Readonly<Record<string, Ceiling>> = {
  '/': { scripts: 661_000, css: 132_000 },
  '/battle/1': { scripts: 661_000, css: 132_000 },
  '/collection': { scripts: 666_000, css: 135_000 },
  '/deck': { scripts: 665_000, css: 135_000 },
  '/league': { scripts: 657_000, css: 132_000 },
  '/login': { scripts: 651_000, css: 132_000 },
  '/packs': { scripts: 665_000, css: 135_000 },
  '/pokedex': { scripts: 793_000, css: 133_000 },
  '/pokedex/1': { scripts: 805_000, css: 136_000 },
  '/pokemon/pikachu': { scripts: 833_000, css: 133_000 },
  '/rules': { scripts: 660_000, css: 132_000 },
  '/settings': { scripts: 666_000, css: 132_000 },
}

function bytes(count: number): string {
  return `${count.toLocaleString('en-US')} B`
}

test('every page has a ceiling by name, and every ceiling is for a page', () => {
  const pages = pageAddresses()

  // The other side: with no page found, both differences below are empty.
  expect(pages.length, 'app/pages has no page to weigh').toBeGreaterThan(0)

  // `soft`: a page renamed fails both at once, and seeing the two is the diagnosis.
  expect.soft(
    pages.filter(page => CEILINGS[page] === undefined),
    'page with no first-load ceiling: weigh it and declare one in this file',
  ).toEqual([])
  expect.soft(
    Object.keys(CEILINGS).filter(address => !pages.includes(address)),
    'first-load ceiling for an address app/pages does not have: delete it',
  ).toEqual([])
})

test('the first load of each page, in each language, stays under its ceiling', () => {
  expect(existsSync(PUBLIC), '.output/public does not exist — run `yarn build` first').toBe(true)
  // With one language there is no "each language" to speak of.
  expect(LOCALES.length).toBeGreaterThan(1)

  const problems: string[] = []

  for (const address of pageAddresses()) {
    const ceiling = CEILINGS[address]
    // The test above names a page with no ceiling.
    if (ceiling === undefined) continue

    for (const { code } of LOCALES) {
      const load = firstLoadOf(PUBLIC, pathInLocale(address, code))
      const where = `[${code}] ${address}`

      // The other side of each ceiling: a page counted as zero, or whose files
      // the meter did not reach, is under any ceiling there is.
      if (load.scriptBytes === 0) problems.push(`${where}: no JavaScript was counted, so its ceiling would pass anything`)
      if (load.cssBytes === 0) problems.push(`${where}: no CSS was counted, so its ceiling would pass anything`)
      if (load.external.length > 0) problems.push(`${where}: declares ${load.external.join(', ')}, which is no file of the build — no ceiling weighs it`)

      if (load.scriptBytes > ceiling.scripts) {
        problems.push(`${where}: JS is ${bytes(load.scriptBytes)} in ${load.scripts.length} file(s), over its ceiling of ${bytes(ceiling.scripts)} (+${bytes(load.scriptBytes - ceiling.scripts)})`)
      }
      if (load.cssBytes > ceiling.css) {
        problems.push(`${where}: CSS is ${bytes(load.cssBytes)} in ${load.css.length} file(s), over its ceiling of ${bytes(ceiling.css)} (+${bytes(load.cssBytes - ceiling.css)})`)
      }
    }
  }

  expect(problems, 'first load over its ceiling: lower what the page loads, or raise the ceiling and say why in the PR').toEqual([])
})

/**
 * The meter, asked of a document written for the question — the instrument and
 * not just its verdict. A reader that matched nothing would make every ceiling
 * above pass, and the page that reads wrong looks like the page that is light.
 */
test('the meter counts module scripts, modulepreloads and stylesheets, once each, and says what it cannot weigh', () => {
  const html = `<!DOCTYPE html><html><head>
    <script type="importmap">{"imports":{}}</script>
    <link rel="stylesheet" href="/_nuxt/entry.css" crossorigin>
    <link rel="stylesheet" crossorigin href="/_nuxt/page.css">
    <link rel="stylesheet" href="https://fonts.example/outside.css">
    <link rel="preload" as="fetch" crossorigin="anonymous" href="/_payload.json?_b=1">
    <link rel="modulepreload" as="script" crossorigin href="/_nuxt/entry.js">
    <link rel="modulepreload" as="script" crossorigin href="/_nuxt/chunk.js">
    <script type="module" src="/_nuxt/entry.js" crossorigin></script>
    <link rel="prefetch" as="script" crossorigin href="/_nuxt/later.js">
    <link rel="icon" href="/_nuxt/icon.svg" type="image/svg+xml">
    <script src="/classic.js"></script>
    <script type="application/json" id="__NUXT_DATA__" data-src="/_payload.json?_b=1">[]</script>
    <script>window.__NUXT__ = {}</script>
  </head></html>`

  const { scripts, css, external } = declaredAssets(html)

  expect([...scripts].sort()).toEqual(['/_nuxt/chunk.js', '/_nuxt/entry.js'])
  expect([...css].sort()).toEqual(['/_nuxt/entry.css', '/_nuxt/page.css', 'https://fonts.example/outside.css'])
  expect(external).toEqual(['https://fonts.example/outside.css'])
})
