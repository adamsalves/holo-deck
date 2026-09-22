import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * Every in-app link carries the language the player is in.
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
 * **It enumerates who is OUT, and today nobody is.** A link added tomorrow is an
 * offender by omission. Issue #37 was kept here as a list of exceptions, one per
 * link a later PR of Phase 8 still owed, asserted in both directions so it could
 * only shrink. It emptied with the last two — `/login` and the account invite,
 * the two boot-time surfaces translated just before the language selector — and
 * the list was **deleted, not kept empty**: an empty exception list with a test
 * proving every entry still applies is an assertion about nothing. The day a
 * link genuinely must not carry the locale, the argument belongs in the review
 * that brings the list back.
 *
 * **One link leaves the language on purpose, and it is not an exception to the
 * rule — it is a second rule.** The language selector links the page the player
 * is on to the same page in every other language (`switchLocalePath`). That link
 * is localized by the module, into the language it names; used anywhere else
 * it is the very defect above, a way out of the player's language. So a switch
 * is its own class, and the class has an address: `LANGUAGE_SELECTORS`, the one
 * place the board draws the selector.
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

/**
 * Whether the link goes to this page in another language — `switchLocalePath`.
 *
 * `isLocalized` does not forgive it — its pattern is a lower-case `localePath`
 * starting a word, and here it is capitalised, mid-word — and that is kept on
 * purpose. A switch is right in exactly one place and wrong everywhere else — a
 * `switchLocalePath('pt-BR')` used as a way home drops the player into
 * Portuguese as surely as `to="/"` — so it is asked separately, and where it is
 * written is asked too.
 */
function isLanguageSwitch(link: Link): boolean {
  return /\bswitchLocalePath\s*\(/.test(link.to)
}

/**
 * Where the language selector lives: *Settings*, the first row of
 * *Preferences*, which is where the board draws it.
 *
 * Written by hand because it is a decision and not a derivation. The day a
 * second place switches language, the argument belongs in its review, and this
 * list is where it has to be made. The test that reads it also fails when an
 * entry stops holding a switch, so it cannot outlive the selector it names.
 */
const LANGUAGE_SELECTORS: readonly string[] = ['app/pages/settings.vue']

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

/**
 * How an offender is named in the failure message — `file → destination`, never
 * a line number, so the message says what to fix and not where it used to be.
 */
function nameOf(link: Link): string {
  return `${link.file} → ${link.to}`
}

describe('locale link gate', () => {
  /**
   * The reader sees all three shapes, and tells them from a localized link.
   *
   * These samples are the proof by reintroduction, kept as input instead of as
   * an edit to a real screen: a `grep` for `to="/[a-z/-]*"` finds the first one
   * and misses the other two, which is how a gate written from the obvious
   * shape would have passed with five of the seven links still broken. The last
   * one is the language switch, which neither side may swallow: not forgiven as
   * localized, and not reported as a link that drops the language.
   */
  it('reads a static path, a query, a template literal — and a localized link', () => {
    const source = [
      '<NuxtLink to="/packs">a</NuxtLink>',
      '<NuxtLink to="/packs?open=daily">b</NuxtLink>',
      '<NuxtLink :to="`/battle/${gym}`">c</NuxtLink>',
      '<NuxtLink :to="localePath(\'/deck\')">d</NuxtLink>',
      '<NuxtLinkLocale to="/rules">e</NuxtLinkLocale>',
      '<NuxtLink :to="switchLocalePath(option.code)">f</NuxtLink>',
    ].join('\n')

    const links = linksIn('sample.vue', source)

    expect(links.map(link => link.to)).toEqual([
      '/packs',
      '/packs?open=daily',
      '`/battle/${gym}`',
      'localePath(\'/deck\')',
      '/rules',
      'switchLocalePath(option.code)',
    ])
    expect(links.filter(link => !isLocalized(link)).map(link => link.to)).toEqual([
      '/packs',
      '/packs?open=daily',
      '`/battle/${gym}`',
      'switchLocalePath(option.code)',
    ])
    expect(links.filter(isLanguageSwitch).map(link => link.to)).toEqual([
      'switchLocalePath(option.code)',
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
   * There is no floor on the localized side, and none is needed — but the reason
   * moved when the exception list went away. Broken to always-false,
   * `isLocalized` turns every real link into an offender and the assertion below
   * names all of them. **Broken to always-true it used to be caught by every
   * exception ceasing to match, and with no exceptions left that half fell to
   * the samples:** the first test of this file asks for exactly four
   * non-localized links out of six, so an `isLocalized` that forgives
   * everything returns none and fails there. A count of localized links here
   * would only have been a weaker copy of that.
   */
  it('reads every link tag on disk, and none of them truncated', () => {
    const openings = allTagOpenings()

    // `[] === []` passes: a walk that found no file would leave every assertion
    // in this file measuring nothing, and looking healthy for it.
    expect(openings).not.toEqual([])

    const read = new Set(allLinks().map(link => link.at))

    expect(openings.filter(opening => !read.has(opening))).toEqual([])
  })

  it('every link carries the locale', () => {
    const offenders = allLinks()
      .filter(link => !isLocalized(link) && !isLanguageSwitch(link))
      .map(nameOf)

    expect([...new Set(offenders)].sort(), 'these links drop the player back into the default locale')
      .toEqual([])
  })

  /**
   * And the links that change it live where the selector is — both ways.
   *
   * A set and not "no switch outside the list": a selector that stopped
   * switching, or moved to a component, would leave its entry naming a file
   * with nothing in it, and the next switch written there would be forgiven
   * without anyone having decided it.
   */
  it('and only the language selector changes it', () => {
    const switching = new Set(allLinks().filter(isLanguageSwitch).map(link => link.file))

    expect([...switching].sort(), 'these files switch the player\'s language, and only the selector may')
      .toEqual([...LANGUAGE_SELECTORS].sort())
  })
})
