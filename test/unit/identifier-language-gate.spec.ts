import { describe, expect, it } from 'vitest'
import { REGION_NAMES } from '~~/shared/types/game'
import { readAllSpecies } from '../support/generated-dex'
import { collectIdentifierWords, isEnglishWord, splitWords, templateAliases } from '../support/identifier-language'

/**
 * Every name in this repository is English, and now something says so.
 *
 * The rule has held since Phase 0 and lived only in `CLAUDE.md`. Nothing
 * executed it: `yarn lint`, `yarn typecheck` and the suite are all happy with
 * `const esperado`. 216 Portuguese identifiers grew in that gap across 44 files,
 * and the estimate that preceded the measurement was off by an order of
 * magnitude — so the gate exists as much to keep the count honest as to keep the
 * names English.
 *
 * **It asks whether a word is English, never whether it is Portuguese.** The
 * inverted question is what makes it fail safely: a name the dictionary does not
 * recognise lands on the exemption list below, in the open, where a person says
 * what it is. A Portuguese-word detector fails the other way, silently, and this
 * repository has the receipts — `revanche` and `dePe` both survived an AST-wide
 * rename, two dictionary sweeps and a review, and both are caught here.
 *
 * The exemption list is the whole design. It **enumerates what leaves**, the
 * species and region halves are built **from the dex itself**, and a second test
 * fails when an entry stops being reachable — so it cannot quietly rot beside
 * the rule it guards.
 */

/**
 * The dex names, straight out of the generated data.
 *
 * `onix` and `geodude` are not English and never will be, and there are 1025 of
 * them waiting to be typed into a test. Reading them from `public/data` is the
 * difference between an exemption that follows the dex and one that is a
 * snapshot of the day it was written.
 */
const DEX_NAMES = new Set([
  ...readAllSpecies().flatMap(species => splitWords(species.slug)),
  ...REGION_NAMES.flatMap(region => splitWords(region)),
])

/**
 * The platform's own vocabulary. Not English, not ours, not negotiable —
 * these are spelled by the runtime, the DOM, a wire format or the language
 * itself: `namespace` is a TypeScript keyword before it is anything else, and it
 * is also what `@nuxtjs/i18n` calls the prefix of a message key, and `keypath`
 * is how vue-i18n spells the attribute that carries one into `<i18n-t>`. They
 * are here and not in `DOMAIN` because this project did not coin them.
 */
const PLATFORM = [
  'api', 'args', 'argv', 'async', 'attrs', 'auth', 'config', 'crossorigin', 'css', 'ctx', 'cwd',
  'env', 'href', 'hreflang', 'html', 'http', 'init', 'ip', 'iso', 'json', 'keepalive', 'keypath',
  'namespace', 'nav', 'ok', 'onchange', 'pathname', 'proto', 'rect', 'sha', 'src', 'ui', 'uid', 'uint',
  'url',
]

/** The tools, by their own names. */
const TOOLING = [
  'deps', 'devtools', 'dirs', 'eslint', 'github', 'gunzip', 'gzip', 'nuxt', 'pinia', 'prerender',
  'repo', 'teardown', 'transpile', 'tsconfig', 'untracked',
]

/**
 * The words this project made up, and the two abbreviations it inherited.
 *
 * `bst` is *base stat total* and `dex` is the Pokédex — both are how the domain
 * writes itself, including in the PokeAPI payloads this game is built on.
 */
const DOMAIN = [
  'aa', 'ai', 'bst', 'crit', 'criticals', 'dex', 'dx', 'lede', 'luminance', 'matchup', 'metas',
  'moveset', 'normals', 'overworld', 'rematched', 'rng', 'shinies', 'styleguide', 'typeless',
]

/**
 * English the American dictionary happens not to carry.
 *
 * Mostly ordinary derivations — `-able`, `-ize`, `-s` on a word it does list —
 * plus two shortenings (`cond`, `pre`). `paralysed` is the odd one: it is the
 * British spelling, and the **only** one in the repository, at
 * `app/components/battle/Combatant.vue:34`. Measured, not assumed. A second
 * dictionary for one word costs more than this line does.
 */
const DERIVATIONS = [
  'backoff', 'cond', 'debounce', 'focusables', 'hrefs', 'namespaces', 'overscan', 'paralysed',
  'pre', 'precache', 'replayable', 'responder', 'resumable', 'urls', 'virtualize', 'virtualized',
  'virtualizer',
]

const BY_HAND = [...PLATFORM, ...TOOLING, ...DOMAIN, ...DERIVATIONS]

const EXEMPT = new Set([...DEX_NAMES, ...BY_HAND])

/** Every place code lives. A gate that silently stops visiting one is no gate. */
const AREAS = ['app', 'scripts', 'server', 'shared', 'test']

/** The root-level configuration files carry names too, and fall outside every area. */
const ROOT_CONFIG_FILES = ['nuxt.config.ts', 'eslint.config.mjs']

const sightings = collectIdentifierWords()

/** Every word the dictionary rejected, whether or not it is exempt. */
const unknown = sightings.filter(sighting => !isEnglishWord(sighting.word))

describe('the language of identifiers', () => {
  it('lets no name in that is built from a word English does not know', () => {
    const offenders = unknown
      .filter(sighting => !EXEMPT.has(sighting.word))
      .map(sighting => `${sighting.file}:${sighting.line} → ${sighting.identifier} (${sighting.word})`)

    expect(
      [...new Set(offenders)].sort(),
      'a Portuguese name is a defect, not a style: rename it. If the word is a technical or domain term, it joins one of the exemption lists in this file, with the reason written beside it',
    ).toEqual([])
  })

  /**
   * The other side, and the reason the list is allowed to be written by hand.
   *
   * An exemption that stops being reached is an exemption nobody is reading any
   * more, and it is exactly how a hand list decays into a place where anything
   * can hide. This fails the moment one goes cold.
   */
  it('fails the exemption that stopped being reached', () => {
    const reached = new Set(unknown.map(sighting => sighting.word))

    expect(
      BY_HAND.filter(word => !reached.has(word)).sort(),
      'exemption no identifier uses any more: delete the entry, not the rule',
    ).toEqual([])
  })

  /**
   * A gate that passes on a repository with no defect in it and a gate that
   * cannot fail look identical from the outside. This one is asked to fail.
   */
  it('catches the defect planted back in', () => {
    const planted = ['escada', 'degrau', 'chanfro', 'bancada', 'esperado', 'revanche', 'perdidas']

    expect(
      planted.filter(word => isEnglishWord(word) || EXEMPT.has(word)),
      'Portuguese word this gate would let through',
    ).toEqual([])
  })

  it('does not mistake real English for Portuguese', () => {
    const real = ['ladder', 'rung', 'bevel', 'harness', 'standing', 'rematch', 'missing', 'worst']

    expect(
      real.filter(word => !isEnglishWord(word)),
      'legitimate English this gate would reject: a gate that always fails looks just as healthy',
    ).toEqual([])
  })

  /**
   * The blind spot, measured rather than described.
   *
   * A word that is Portuguese **and** English is invisible to any instrument
   * built on a dictionary, and `CLAUDE.md` already names this pair. Writing it
   * down here is the difference between a known limit and a false sense that the
   * rule is fully guarded — if this test ever goes red because the dictionary
   * dropped one, the docblock above is what needs editing, not this list.
   */
  it('declares the width of its own blind spot', () => {
    const bothLanguages = ['nome', 'valor']

    expect(
      bothLanguages.filter(word => !isEnglishWord(word)),
      'the blind spot shrank: these words stopped counting as English, and the caveat can shrink with it',
    ).toEqual([])
  })

  /**
   * The template reader, measured against a fixture instead of against hope.
   *
   * **This test exists because the first version of that regex found nothing,
   * and the gate went green on it.** A detector that returns an empty list and a
   * repository with no offenders are the same six green ticks — and the silence
   * hid two real Portuguese aliases in `styleguide.vue`. Asserting the
   * instrument, not just its verdict, is the cheapest thing that separates them.
   */
  it('really reads what a template declares on its own', () => {
    const found = templateAliases(`<template>
      <li v-for="rung in ladder" :key="rung.step" />
      <li v-for="(sample, index) of samples" :key="index">{{ sample }}</li>
      <UTable #cell="{ row }">{{ row }}</UTable>
    </template>`).map(alias => alias.name).sort()

    // Only the declaring side. `ladder` and `samples` are references to what the
    // `<script>` already exposes, and `vue-tsc` answers for those — listing them
    // here would report the same name twice, each time for a different reason.
    expect(found, 'alias the template reader missed').toEqual(
      ['index', 'row', 'rung', 'sample'],
    )
  })

  /**
   * Reach, asserted as a set — because a gate that reads nothing and a gate that
   * finds nothing are the same green tick. Phase 3 shipped a gate that ran in the
   * one `cwd` where the broken code worked; this is the cheap guard against the
   * same shape of mistake, and it fails loudly the day `walkFiles` stops
   * descending into a folder.
   */
  it('reaches every area of the codebase, not just the easy one', () => {
    const reached = new Set(sightings.map(sighting => sighting.file.split('/')[0]))

    expect(
      [...AREAS, ...ROOT_CONFIG_FILES].filter(area => !reached.has(area)),
      'area this gate stopped visiting: it turns green without measuring anything',
    ).toEqual([])
  })
})
