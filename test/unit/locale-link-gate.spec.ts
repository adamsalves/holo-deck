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
 * **Quoted values are consumed whole, and that is load-bearing.** A plain
 * `[^>]*?` stops at the first `>` — including one inside an attribute value. 21
 * attributes under `app/` carry one: 19 as a comparison, `v-if="count > 0"`
 * being the most common conditional here, and two as an arrow function
 * (`@drop="id => onDrop(…)"`), which truncates the tag just the same. A
 * truncated tag loses its `to=`, and a link with no destination is dropped by
 * `linksIn`, so the offender **leaves the sweep instead of failing it**.
 * Measured both ways: with the alternation the same 29 links are read; without
 * it, one broken link plus a `v-if` on the same tag left every assertion in this
 * file green with the defect on screen.
 *
 * That count was first written as 20, from a line-based `grep`. The one it
 * missed is a `:class="{…}"` spread over four lines in
 * `app/pages/battle/[gymId].vue` — a multi-line attribute, which is exactly the
 * shape this paragraph is about. Counted with `stripComments` over the file, not
 * line by line.
 *
 * The first version bet on a count to notice, and a count could not: `> 20`
 * against 29 links let eight vanish in silence — the ninth is what would have
 * tripped it. The other side is a set now — see
 * `it('reads every link tag on disk, and none of them truncated')`.
 *
 * **What it does not reach**, and should not be widened to: `<a href>`,
 * `navigateTo`, `router.push`, and `to=` on a Nuxt UI component (`UButton`,
 * `ULink`, `UCard`), which render a `NuxtLink` underneath and would never be
 * spelled with this tag name. None of the four exists under `app/` today —
 * measured, not assumed — and each needs its own reader the day it does.
 *
 * There is a fifth, and it is not hypothetical: `window.location.assign`, in
 * `app/composables/useAccount.ts`. It navigates without a tag at all, and it is
 * already localized — with `$localePath('/')`, because **it was this very defect
 * once**, as its own comment records. A blind-spot list that omits the shape
 * that has already produced the defect is the half of the rule that fails
 * silently: this reader cannot see the next composable that assigns a raw path.
 */
const LINK_TAG = /<(NuxtLink|NuxtLinkLocale)\b((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/g

/**
 * Where a link tag opens, which is the identity the completeness check compares.
 *
 * Deliberately the narrowest expression that can find a link: it stops at the
 * tag name and never looks at an attribute, so it cannot fail the way `LINK_TAG`
 * failed. That is the point — the two disagree exactly when the reader is losing
 * something.
 */
const TAG_OPENING = /<(?:NuxtLink|NuxtLinkLocale)\b/g

/** The destination, static (`to="…"`) or bound (`:to="…"`), in either quote. */
const TO_ATTRIBUTE = /(?<![\w:-])(:?)to=(['"])([\s\S]*?)\2/

/** A link, as the file spells it. */
interface Link {
  readonly file: string
  readonly tag: string
  /** The destination exactly as written — `/packs`, or `` `/battle/${gym}` ``. */
  readonly to: string
  /**
   * `file@offset` of the opening tag — the identity the completeness check
   * compares against `TAG_OPENING`. An offset and not a line: it is never read
   * by a human, only matched against the same sweep in the same run.
   */
  readonly at: string
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
function linksIn(file: string, source: string): Link[] {
  return [...stripComments(source).matchAll(LINK_TAG)].flatMap((match) => {
    const [, tag, attributes] = match
    const to = TO_ATTRIBUTE.exec(attributes ?? '')?.[3]

    if (tag === undefined || to === undefined) return []

    return [{ file, tag, to: to.trim(), at: `${file}@${match.index}` }]
  })
}

/** Every place a link tag opens under `LINK_AREA`, by the narrow expression. */
function allTagOpenings(): string[] {
  return walkFiles(join(REPO_ROOT, LINK_AREA), SKIP, hasExtension(['.vue'])).flatMap((file) => {
    const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

    return [...source.matchAll(TAG_OPENING)].map(match => `${file}@${match.index}`)
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
  'app/pages/login.vue → /',
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

  /**
   * And a `>` inside an attribute does not end the tag.
   *
   * This is the shape the first version lost, kept as input rather than as an
   * edit to a real screen. `v-if="count > 0"` truncated the match, `to=` fell
   * outside the capture, and the link left the sweep instead of failing it —
   * green gate, broken link on screen. Both quote styles, because a value in
   * single quotes fails the same way and is spelled differently.
   */
  it('reads a link whose attributes carry a `>`, in either quote', () => {
    const source = [
      '<NuxtLink v-if="count > 0" to="/packs">a</NuxtLink>',
      '<NuxtLink :title="a > b ? \'x\' : \'y\'" :to="localePath(\'/deck\')">b</NuxtLink>',
      '<NuxtLink v-if=\'count > 0\' to="/league">c</NuxtLink>',
    ].join('\n')

    const links = linksIn('sample.vue', source)

    expect(links.map(link => link.to)).toEqual(['/packs', 'localePath(\'/deck\')', '/league'])
    expect(links.filter(link => !isLocalized(link)).map(link => link.to)).toEqual([
      '/packs',
      '/league',
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
   * The other side of the sweep: every link tag on disk was read, and read
   * whole.
   *
   * **It compares sets, not counts, and that is a fix and not a preference.**
   * The first version asserted `links.length > 20` against 29 real links, which
   * hides nine disappearances — and disappearance is precisely how this reader
   * fails. A `>` inside an attribute truncates the tag, `to=` falls outside the
   * capture, and the link stops existing for the sweep rather than failing it.
   * Comparing what was read against the places a tag opens leaves no slack: a
   * truncated tag is an opening with no link, and it is named.
   *
   * A `<NuxtLink>` written with no `to=` would fail here too. None exists today,
   * and the day one does, the gate should stop and let someone decide what it
   * means — the same shape as every other rule in this file.
   *
   * There is no floor left on the localized side, and none is needed: both ways
   * `isLocalized` can break are already caught two assertions below. Broken to
   * always-false, the offender list gains thirteen names; broken to always-true,
   * every exception stops matching. A number here would only have been a third,
   * weaker copy of that.
   */
  it('reads every link tag on disk, and none of them truncated', () => {
    const openings = allTagOpenings()

    // `[] === []` passes: a walk that found no file would leave every assertion
    // in this file measuring nothing, and looking healthy for it.
    expect(openings).not.toEqual([])

    const read = new Set(allLinks().map(link => link.at))

    expect(openings.filter(opening => !read.has(opening))).toEqual([])
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
