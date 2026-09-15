import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * Every in-app link carries the language the player is in — or it is written
 * below as an exception.
 *
 * **`NuxtLink` with a literal path is not localized by the module.** What
 * localizes is `localePath()` (or `<NuxtLinkLocale>`): with
 * `prefix_except_default`, `to="/deck"` renders `href="/deck"` from inside
 * `/en/collection` too, and one click drops the player back into Portuguese with
 * no way back that is not editing the URL. It is the defect the PR 1 review
 * measured in `.output`, and the one issue #37 inventories.
 *
 * **This gate reads source, and that is the opposite of what `nav-gate` does —
 * on purpose.** That one imports `NAV_DESTINATIONS` and refuses to ask the file
 * for a substring, because presence of a string is not a rendered link. The
 * question here is the other one: *how the link was written*. A template literal
 * — ``:to="`/battle/${gym}`"`` — is in no list anywhere, and only the file says
 * it exists. Two opposite methods inside one `describe` would hand the wrong
 * rule to whoever touches it next, so this lives in its own file.
 *
 * **It enumerates who is OUT.** A link added tomorrow is an offender by
 * omission. The exceptions are the links the following PRs of Phase 8 still own,
 * and they are asserted in both directions: an exception that stops matching
 * fails too, so the list can only shrink, and it empties at PR 4 — when the
 * language selector ships and issue #37 closes.
 *
 * Disk does not reach the screen, so this is half of the measurement.
 * `test/e2e/collection.spec.ts` walks `/en` and reads the rendered `href`.
 */

const SKIP = new Set(['node_modules'])

/**
 * Where a link can be written.
 *
 * `app/` whole, not the four screens of this PR: a gate that only looks where
 * the defect was fixed reports health about the place nobody is editing.
 */
const LINK_AREA = 'app'

/**
 * The opening tag of a link, with its attributes.
 *
 * `[^>]*?` stops at the first `>`, which is the end of the tag for every link in
 * this repository. A `>` inside an attribute value would truncate the match —
 * the count assertion below is what would notice.
 */
const LINK_TAG = /<(NuxtLink|NuxtLinkLocale)\b([^>]*?)\/?>/g

/** The destination, static (`to="…"`) or bound (`:to="…"`), in either quote. */
const TO_ATTRIBUTE = /(?<![\w:-])(:?)to=(['"])([\s\S]*?)\2/

/** A link, as the file spells it. */
export interface Link {
  readonly file: string
  readonly tag: string
  /** The destination exactly as written — `/packs`, or `` `/battle/${gym}` ``. */
  readonly to: string
}

/**
 * Whether the module will localize this link.
 *
 * `<NuxtLinkLocale>` localizes whatever it is handed; `NuxtLink` only when the
 * destination passed through `localePath()`. Everything else is an offender,
 * including `:to="link.to"` and `:to="NAV_ACCOUNT.to"`: a variable holding a raw
 * path renders exactly as literally as the path would, and reading the two as
 * "not a literal, so not the defect" is how they would survive the sweep.
 */
function isLocalized(link: Link): boolean {
  return link.tag === 'NuxtLinkLocale' || /\blocalePath\s*\(/.test(link.to)
}

/** Every link in one file's source, comments erased. */
export function linksIn(file: string, source: string): Link[] {
  return [...stripComments(source).matchAll(LINK_TAG)].flatMap(([, tag, attributes]) => {
    const to = TO_ATTRIBUTE.exec(attributes ?? '')?.[3]

    if (tag === undefined || to === undefined) return []

    return [{ file, tag, to: to.trim() }]
  })
}

/** Every link under `LINK_AREA`, swept from disk. */
function allLinks(): Link[] {
  return walkFiles(join(REPO_ROOT, LINK_AREA), SKIP, hasExtension(['.vue'])).flatMap(
    file => linksIn(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
  )
}

/** How an offender is named, in the exception list and in the failure message. */
function nameOf(link: Link): string {
  return `${link.file} → ${link.to}`
}

/**
 * The links the following PRs of Phase 8 still own — issue #37.
 *
 * Written as `file → destination`, never as a line number: renumbering a file is
 * not a change of rule, and a list that broke on it would be edited without
 * being read.
 *
 * **Each PR that translates a screen empties its own entries**, and the
 * assertion that no exception is stale is what forces that. What this shape does
 * not catch is a *second* link to a destination already excepted in the same
 * file — `battle/[gymId].vue` reaches `/league` three times and is one entry.
 * The file is already on this list to be fixed, and the alternative, a line
 * number, ages against every edit.
 */
const EXEMPT: readonly string[] = [
  'app/components/AccountInvite.vue → NAV_ACCOUNT.to',
  'app/components/dex/DexEvolutionChain.vue → `/pokemon/${node.slug}`',
  'app/components/dex/PokeCard.vue → link.to',
  'app/components/league/GymCard.vue → `/battle/${leader.gym}`',
  'app/pages/battle/[gymId].vue → /deck',
  'app/pages/battle/[gymId].vue → /league',
  'app/pages/battle/[gymId].vue → `/battle/${busyWith.gym}`',
  'app/pages/league.vue → /deck',
  'app/pages/league.vue → `/battle/${next.leader.gym}`',
  'app/pages/login.vue → /',
  'app/pages/pokedex/[gen].vue → /pokedex',
  'app/pages/pokedex/index.vue → `/pokedex/${region.generation}`',
  'app/pages/pokemon/[name].vue → /pokedex',
  'app/pages/pokemon/[name].vue → `/pokedex/${region?.generation ?? 1}`',
]

describe('locale link gate', () => {
  /**
   * The reader sees all three shapes, and tells them from a localized link.
   *
   * These four samples are the proof by reintroduction, kept as input instead of
   * as an edit to a real screen: a `grep` for `to="/[a-z/-]*"` finds the first
   * one and misses the other two, which is how a gate written from the obvious
   * shape would have passed with five of the seven links still broken.
   */
  it('reads a static path, a query, a template literal — and a localized link', () => {
    const source = [
      '<NuxtLink to="/packs">a</NuxtLink>',
      '<NuxtLink to="/packs?open=daily">b</NuxtLink>',
      '<NuxtLink :to="`/battle/${gym}`">c</NuxtLink>',
      '<NuxtLink :to="localePath(\'/deck\')">d</NuxtLink>',
      '<NuxtLinkLocale to="/rules">e</NuxtLinkLocale>',
    ].join('\n')

    const links = linksIn('sample.vue', source)

    expect(links.map(link => link.to)).toEqual([
      '/packs',
      '/packs?open=daily',
      '`/battle/${gym}`',
      'localePath(\'/deck\')',
      '/rules',
    ])
    expect(links.filter(link => !isLocalized(link)).map(link => link.to)).toEqual([
      '/packs',
      '/packs?open=daily',
      '`/battle/${gym}`',
    ])
  })

  /** A link inside a comment is not a link — and a multiline tag still is one. */
  it('ignores a commented-out link, and reads one split over lines', () => {
    const source = [
      '<!-- <NuxtLink to="/ghost">x</NuxtLink> -->',
      '<NuxtLink',
      '  class="btn"',
      '  to="/deck"',
      '>y</NuxtLink>',
    ].join('\n')

    expect(linksIn('sample.vue', source).map(link => link.to)).toEqual(['/deck'])
  })

  /**
   * The other side of the sweep: `[] === []` passes, and a reader that stopped
   * matching — a renamed component, a `>` swallowing a tag — would leave every
   * assertion below green with nothing to measure.
   */
  it('finds the links on disk, localized ones among them', () => {
    const links = allLinks()

    expect(links.length).toBeGreaterThan(20)
    expect(links.filter(isLocalized).length).toBeGreaterThan(3)
  })

  it('every link carries the locale, or is written as an exception', () => {
    const offenders = allLinks().filter(link => !isLocalized(link)).map(nameOf)

    expect([...new Set(offenders)].filter(name => !EXEMPT.includes(name)).sort()).toEqual([])
  })

  /**
   * And an exception that no longer applies is gone.
   *
   * This is the half that makes the list shrink instead of age: a screen fixed
   * in a later PR fails here until its entry is deleted, and the list empties at
   * PR 4 with issue #37.
   */
  it('and no exception outlives the link it forgives', () => {
    const offenders = new Set(allLinks().filter(link => !isLocalized(link)).map(nameOf))

    expect(EXEMPT.filter(name => !offenders.has(name))).toEqual([])
  })
})
