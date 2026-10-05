import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LOCALES, pathInLocale } from '../../app/utils/locales.ts'
import { isIndexData } from '../../shared/types/dex.ts'
import { REPO_ROOT } from './source-tree.ts'

/**
 * The questions a built server has to answer, asked of whichever preset's server
 * is listening — one list, so the preset that `yarn build` makes and the one
 * Vercel makes cannot be measured by two different probes.
 *
 * **It returns problems instead of asserting**, because its two callers report
 * them differently: `test/e2e/server-runtime.spec.ts` compares them to `[]`, and
 * `scripts/check-vercel-bundle.ts` prints one `::error::` each. It runs in plain
 * `node` (that script has no bundler), so everything it imports spells the
 * `.ts` extension out and is erasable syntax — which is also why it does not
 * reuse `test/support/locales.ts`.
 *
 * The URLs come from the sources, never from a list written here:
 *
 * - **Every language of `LOCALES`**, through `pathInLocale`. A third language is
 *   probed the day it is declared, and an address the server answers in one
 *   language only is a failure in the other.
 * - **The bad side**: an unknown species and an unknown generation answer 404,
 *   and neither the status line nor the body carries a server path. The 500 this
 *   was written for carried the absolute path in both. Each is asked twice — the
 *   way `fetch` asks, which gets the error as JSON, and with `Accept: text/html`,
 *   which gets the error page a visitor and a crawler get: two renderers, and
 *   either one can leak. An unknown address is the one class of **page** that
 *   reaches the server in production, since every valid page is prerendered
 *   (`/api/*` and the dex route below reach it too) — and answering the species
 *   one means reading the index to learn it is not there, which is the whole
 *   path the defect broke.
 * - **The good side, through the mechanism the bad side runs on.** A 404 only
 *   says the species is unknown if the server could read the index, so the probe
 *   asks the server for the index itself, by the route its own `useDex()` reads
 *   it through: 200, and the real species in it. This is the question that tells
 *   a healthy server from a blind one in **both** presets, and the pages below
 *   cannot stand in for it. In the Node preset a valid page is a prerendered
 *   file, answered by the static middleware before the app is asked anything: a
 *   server whose dex read was back on `process.cwd()`, with the route's own
 *   "absent is 404", answered 404 to the unknown species — for the wrong reason
 *   — and 200 to the real one. Measured: the spec passed on that build.
 * - **And each 404 has its 200 next to it**: a real species and a real
 *   generation answer 200 and name a species in the body. Without them, a server
 *   that answered 404 to everything would pass — `[] === []` again. On Vercel
 *   these are the function rendering the page from the dex it ships, because
 *   there the static pages are on the CDN.
 * - **The bad inputs are checked against the source too.** If `missingno` ever
 *   becomes a slug, or `gen-99.json` a file, the probe says the *input* went
 *   stale and does not blame the server for answering 200.
 */

const DATA = join(REPO_ROOT, 'public/data')

/** A slug the index does not have, and a generation the dex has no file for. */
const UNKNOWN_SPECIES = 'missingno'
const UNKNOWN_GENERATION = 99

/**
 * The route the server's own `useDex()` reads the index through
 * (`app/composables/useDex.ts`; served by `server/routes/__dex/[file].get.ts`).
 */
const DEX_INDEX = '/__dex/index.json'

/** What a browser asks with: it picks the HTML error page over the JSON one `fetch` gets. */
const AS_BROWSER = 'text/html'

/**
 * The roots a Node server or a Lambda runs from: what a leaked path starts with.
 *
 * A backstop, and a list of three: the measure that does not depend on a list is
 * by value, in `probeServer` — the folders the caller started the server in, and
 * the repository.
 */
const PATH_LEAK = /\/(?:var\/task|home|tmp)\//

/** A request that never answers is a problem, not a hung job. */
const REQUEST_TIMEOUT_MS = 10_000

type Reply = { status: number, statusText: string, body: string } | { problem: string }

/** The request as the messages name it: `GET /x`, or `GET /x (Accept: text/html)`. */
function named(path: string, accept?: string): string {
  return accept === undefined ? `GET ${path}` : `GET ${path} (Accept: ${accept})`
}

async function get(base: string, path: string, accept?: string): Promise<Reply> {
  try {
    const response = await fetch(`${base}${path}`, {
      headers: accept === undefined ? {} : { accept },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    return { status: response.status, statusText: response.statusText, body: await response.text() }
  }
  catch (error) {
    return { problem: `${named(path, accept)}: no answer (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** A short single-line piece of `text` around `at`, for the message to quote. */
function excerpt(text: string, at: number, length: number): string {
  return text.slice(Math.max(0, at - 24), at + length + 24).replaceAll(/\s+/g, ' ')
}

/** What of `forbidden`, or of a server-path shape, is in `text` — quoted with its surroundings. */
function leakIn(text: string, forbidden: readonly string[]): string | undefined {
  const shape = PATH_LEAK.exec(text)?.[0]
  const found = [...forbidden, ...(shape === undefined ? [] : [shape])]
    .find(part => part !== '' && text.includes(part))

  return found === undefined ? undefined : excerpt(text, text.indexOf(found), found.length)
}

async function expectNotFound(base: string, path: string, forbidden: readonly string[], accept?: string): Promise<string[]> {
  const request = named(path, accept)
  const reply = await get(base, path, accept)
  if ('problem' in reply) return [reply.problem]

  const problems: string[] = []
  if (reply.status !== 404) {
    problems.push(`${request}: answered ${reply.status} "${reply.statusText}" with body "${excerpt(reply.body, 0, 80)}", expected 404`)
  }

  // Both surfaces, because h3 writes the `statusMessage` into the status line
  // **and** into the body, and either one alone already leaks. Checked even when
  // the status is wrong: the defect that mattered answered 500 and leaked, and one
  // run should name both.
  for (const [surface, text] of [['status line', reply.statusText], ['body', reply.body]] as const) {
    const leak = leakIn(text, forbidden)
    if (leak !== undefined) problems.push(`${request}: the ${surface} leaks a server path, "…${leak}…", expected none`)
  }

  return problems
}

/** A real page answers 200 and its body names the species the sources say is on it. */
async function expectPage(base: string, path: string, name: string): Promise<string[]> {
  const reply = await get(base, path)
  if ('problem' in reply) return [reply.problem]

  if (reply.status !== 200) {
    return [`GET ${path}: answered ${reply.status} "${reply.statusText}" with body "${excerpt(reply.body, 0, 80)}", expected 200`]
  }

  return reply.body.includes(name) ? [] : [`GET ${path}: answered 200 but the body never names "${name}", expected the page that shows it`]
}

/** The server hands out the index it ships, and the real species is in it: it can read its own dex. */
async function expectIndex(base: string, slug: string): Promise<string[]> {
  const reply = await get(base, DEX_INDEX)
  if ('problem' in reply) return [reply.problem]

  if (reply.status !== 200) {
    return [`GET ${DEX_INDEX}: answered ${reply.status} "${reply.statusText}" with body "${excerpt(reply.body, 0, 80)}", expected 200 — the server cannot read the dex it ships, and every 404 it gives is for that reason`]
  }

  let index: unknown
  try {
    index = JSON.parse(reply.body)
  }
  catch {
    return [`GET ${DEX_INDEX}: answered 200 with a body that is not JSON, "${excerpt(reply.body, 0, 80)}", expected the index`]
  }

  return isIndexData(index) && index.some(entry => entry.slug === slug)
    ? []
    : [`GET ${DEX_INDEX}: answered 200 with something that is not the index, or an index without "${slug}"`]
}

/** The lowest generation the dex has a file for: a `/pokedex/N` that has to exist. */
function firstGeneration(): number | undefined {
  const generations = readdirSync(DATA).flatMap((name) => {
    const generation = /^gen-(\d+)\.json$/.exec(name)?.[1]

    return generation === undefined ? [] : [Number(generation)]
  })

  return generations.length === 0 ? undefined : Math.min(...generations)
}

/**
 * Asks the server at `base` for the index, for the unknown addresses and for the
 * real ones beside them, in every language, and lists what it got wrong. Empty is
 * healthy.
 *
 * `forbidden` is what the caller knows must never show up in a response: the
 * folder the server was started from, the one it lives in.
 */
export async function probeServer(base: string, forbidden: readonly string[]): Promise<string[]> {
  // The other side of the leak check: with nothing to look for, a clean answer
  // would only mean the pattern above did not match.
  if (forbidden.length === 0 || forbidden.includes('')) {
    return ['probe: the forbidden snippets are empty or hold an empty string, so the leak check would measure nothing']
  }

  // The repository is one more place no response may name, whoever the caller is:
  // a path the build baked in reads as this one wherever the server was started.
  const paths = [...forbidden, resolve(REPO_ROOT)]

  const raw: unknown = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
  if (!isIndexData(raw)) return ['probe: public/data/index.json did not pass the read guard, so there is no real species to ask for']

  const real = raw[0]
  if (real === undefined) return ['probe: public/data/index.json has no species to ask for']

  const problems: string[] = []
  const notFound: string[] = []
  const found = [{ path: `/pokemon/${real.slug}`, name: real.displayName }]

  if (raw.some(entry => entry.slug === UNKNOWN_SPECIES)) {
    problems.push(`probe: "${UNKNOWN_SPECIES}" is a slug of the index now, so /pokemon/${UNKNOWN_SPECIES} is not an unknown address — pick another`)
  }
  else {
    notFound.push(`/pokemon/${UNKNOWN_SPECIES}`)
  }

  if (existsSync(join(DATA, `gen-${UNKNOWN_GENERATION}.json`))) {
    problems.push(`probe: public/data/gen-${UNKNOWN_GENERATION}.json exists now, so /pokedex/${UNKNOWN_GENERATION} is not an unknown address — pick another`)
  }
  else {
    notFound.push(`/pokedex/${UNKNOWN_GENERATION}`)
  }

  // The 200 next to `/pokedex/99`. That 404 is decided by the range alone, before
  // anything is read, so it is the same answer with the dex unreadable.
  const generation = firstGeneration()
  const native = raw.find(entry => entry.generation === generation)
  if (generation === undefined || native === undefined) {
    problems.push('probe: public/data has no gen-N.json with a species of the index in it, so there is no real generation to ask for')
  }
  else {
    found.push({ path: `/pokedex/${generation}`, name: native.displayName })
  }

  problems.push(...await expectIndex(base, real.slug))

  for (const { code } of LOCALES) {
    for (const path of notFound) {
      for (const accept of [undefined, AS_BROWSER]) {
        problems.push(...await expectNotFound(base, pathInLocale(path, code), paths, accept))
      }
    }

    for (const page of found) {
      problems.push(...await expectPage(base, pathInLocale(page.path, code), page.name))
    }
  }

  return problems
}
