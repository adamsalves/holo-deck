import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
 *   was written for carried the absolute path in both. An unknown address is the
 *   one class of URL that reaches the server in production, since every valid
 *   route is prerendered — and answering the species one means reading the index
 *   to learn it is not there, which is the whole path the defect broke.
 * - **The good side**: a species the index really has answers 200 and names
 *   itself in the body. Without it, a server that answered 404 to everything
 *   would pass — `[] === []` again. On Vercel this one is the function reading
 *   the dex it ships, because there the static pages are on the CDN.
 * - **The bad inputs are checked against the source too.** If `missingno` ever
 *   becomes a slug, or `gen-99.json` a file, the probe says the *input* went
 *   stale and does not blame the server for answering 200.
 */

const DATA = join(REPO_ROOT, 'public/data')

/** A slug the index does not have, and a generation the dex has no file for. */
const UNKNOWN_SPECIES = 'missingno'
const UNKNOWN_GENERATION = 99

/** The roots a Node server or a Lambda runs from: what a leaked path starts with. */
const PATH_LEAK = /\/(?:var\/task|home|tmp)\//

/** A request that never answers is a problem, not a hung job. */
const REQUEST_TIMEOUT_MS = 10_000

type Reply = { status: number, statusText: string, body: string } | { problem: string }

async function get(base: string, path: string): Promise<Reply> {
  try {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

    return { status: response.status, statusText: response.statusText, body: await response.text() }
  }
  catch (error) {
    return { problem: `GET ${path}: no answer (${error instanceof Error ? error.message : String(error)})` }
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

async function expectNotFound(base: string, path: string, forbidden: readonly string[]): Promise<string[]> {
  const reply = await get(base, path)
  if ('problem' in reply) return [reply.problem]

  const problems: string[] = []
  if (reply.status !== 404) {
    problems.push(`GET ${path}: answered ${reply.status} "${reply.statusText}" with body "${excerpt(reply.body, 0, 80)}", expected 404`)
  }

  // Both surfaces, because h3 writes the `statusMessage` into the status line
  // **and** into the body, and either one alone already leaks. Checked even when
  // the status is wrong: the defect that mattered answered 500 and leaked, and one
  // run should name both.
  for (const [surface, text] of [['status line', reply.statusText], ['body', reply.body]] as const) {
    const leak = leakIn(text, forbidden)
    if (leak !== undefined) problems.push(`GET ${path}: the ${surface} leaks a server path, "…${leak}…", expected none`)
  }

  return problems
}

async function expectSpecies(base: string, path: string, name: string): Promise<string[]> {
  const reply = await get(base, path)
  if ('problem' in reply) return [reply.problem]

  if (reply.status !== 200) {
    return [`GET ${path}: answered ${reply.status} "${reply.statusText}" with body "${excerpt(reply.body, 0, 80)}", expected 200`]
  }

  return reply.body.includes(name) ? [] : [`GET ${path}: answered 200 but the body never names "${name}", expected the species page`]
}

/**
 * Asks the server at `base` for the unknown addresses and for a real species, in
 * every language, and lists what it got wrong. Empty is healthy.
 *
 * `forbidden` is what the caller knows must never show up in a response: the
 * working directory the server was started from, the folder it lives in.
 */
export async function probeServer(base: string, forbidden: readonly string[]): Promise<string[]> {
  // The other side of the leak check: with nothing to look for, a clean answer
  // would only mean the pattern above did not match.
  if (forbidden.length === 0 || forbidden.includes('')) {
    return ['probe: the forbidden snippets are empty or hold an empty string, so the leak check would measure nothing']
  }

  const raw: unknown = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
  if (!isIndexData(raw)) return ['probe: public/data/index.json did not pass the read guard, so there is no real species to ask for']

  const real = raw[0]
  if (real === undefined) return ['probe: public/data/index.json has no species to ask for']

  const problems: string[] = []
  const notFound: string[] = []

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

  for (const { code } of LOCALES) {
    for (const path of notFound) {
      problems.push(...await expectNotFound(base, pathInLocale(path, code), forbidden))
    }

    problems.push(...await expectSpecies(base, pathInLocale(`/pokemon/${real.slug}`, code), real.displayName))
  }

  return problems
}
