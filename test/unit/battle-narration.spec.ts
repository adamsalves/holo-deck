import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpeciesId } from '~~/shared/types/brand'
import { isGymId, isMoveId, MOVE_COUNT } from '~~/shared/types/brand'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import { AILMENT_NAMES } from '~~/shared/types/dex'
import type { BattleContext, BattleEvent, BattleState } from '~~/shared/game/battle'
import type { Condition } from '~~/shared/game/status'
import { startBattle } from '~~/shared/game/engine'
import type { Translate } from '~~/app/utils/battle-narration'
import { NARRATION_KEYS, narrate, UNKNOWN_MOVE_KEY } from '~~/app/utils/battle-narration'
import { readAllSpecies, readCore, readGeneration } from '../support/generated-dex'
import { localeCodes, message } from '../support/locales'
import { REPO_ROOT, stripComments } from '../support/source-tree'

/**
 * Every line the turn log can print, in every language the game ships.
 *
 * The narrator is the one piece of screen text with no component around it: it
 * builds sentences inside a plain function, and until this file **nothing in the
 * suite ever called it** — ten kinds of event and twenty-one sentences with no
 * test at all.
 *
 * Phase 8 rewrites all of them, because the old shape interpolated *fragments*
 * into sentences — `${name} ficou ${adjective}.` — and that only ever worked in
 * Portuguese, where `sleep` is an adjective (*dormindo*). English wants the verb
 * (*fell asleep*), so the fragment maps dissolve and each event gets a whole
 * message with named placeholders.
 *
 * Three things can break in that rewrite, and there is one assertion for each:
 * an event kind that stops producing a line, a key the narrator asks for but
 * never published, and a sentence left written inside the function. The second
 * one is also what keeps `i18n-gate` honest: `t()` is called here with a
 * computed key, which no source scan can see, so `NARRATION_KEYS` is the list
 * that gate unions in. A key that drifts out of it is reported there as an
 * orphan — and the orphan assertion deletes the translation of a line that is
 * on screen.
 */

const core = readCore()
const species = new Map<number, SpeciesEntry>(readAllSpecies().map(entry => [entry.id, entry]))

const context: BattleContext = {
  dexVersion: core.dexVersion,
  matrix: core.effectiveness,
  moves: new Map<number, MoveEntry>(core.moves.map(move => [move.id, move])),
  speciesById: id => species.get(id),
  speciesOfGeneration: generation => readGeneration(generation).species,
}

function speciesId(slug: string): SpeciesId {
  const found = [...species.values()].find(entry => entry.slug === slug)
  if (found === undefined) throw new Error(`${slug} is not in the dex`)

  return found.id
}

function gym(number: number) {
  if (!isGymId(number)) throw new Error(`${number} is not a gym`)

  return number
}

const DECK = ['pikachu', 'charizard', 'blastoise', 'venusaur', 'snorlax', 'gengar'].map(speciesId)

/**
 * A real battle, from the real dex, used only for the names and the teams.
 *
 * The events below are written by hand instead of played out: driving a battle
 * into paralysis, then into a residual tick, then into a faint, would measure
 * the engine — which `engine.spec.ts` already does — and would leave the rarest
 * lines to luck. What this file owes the reader is that **every** kind narrates,
 * and the only way to get all ten is to name them.
 */
const STATE = startBattle({ gymId: gym(1), seed: 7, team: DECK }, context)

const KNOWN_MOVE = STATE.player.team[0]?.slots[0]?.move.id
if (KNOWN_MOVE === undefined) throw new Error('the starting team came with no move')

/**
 * A real move id the battle dex does not carry, for the fallback name.
 *
 * Searched for rather than written down. A number picked by hand is either
 * outside `isMoveId` — and then it never reaches the narrator, because the
 * engine cannot emit it — or inside the dex one build later, and the sample
 * would quietly start exercising a real name instead of the fallback.
 */
const UNKNOWN_MOVE = (() => {
  for (let id = MOVE_COUNT; id >= 1; id -= 1) {
    if (isMoveId(id) && !context.moves.has(id)) return id
  }

  throw new Error('the dex carries every move id; the fallback name is unreachable')
})()

/** One of each condition — the sleep is the only one that carries a counter. */
const CONDITIONS: readonly Condition[] = [
  { kind: 'paralysis' },
  { kind: 'burn' },
  { kind: 'poison' },
  { kind: 'sleep', turns: 2 },
]

/** The active of the player's side, wearing a condition the residual tick can blame. */
function withCondition(state: BattleState, condition: Condition): BattleState {
  const team = state.player.team.map((pokemon, index) => (
    index === state.player.active ? { ...pokemon, condition } : pokemon
  ))

  return { ...state, player: { ...state.player, team } }
}

interface Sample {
  /** The state **before** the turn, which is where the narrator reads names and conditions. */
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

/**
 * At least one sample per kind of event, and one per branch inside a kind.
 *
 * Keyed by `BattleEvent['kind']` so the compiler asks for a sample when the
 * engine grows an eleventh event — the same trick that makes `NARRATION_KEYS`
 * complete. The assertion below asserts the other half, that no kind arrived
 * here with an empty list: a `Record` is satisfied by `[]`, and an empty list
 * narrates nothing while looking measured.
 */
const SAMPLES: Record<BattleEvent['kind'], readonly Sample[]> = {
  'switch': [{ state: STATE, events: [{ kind: 'switch', side: 'player', to: 1 }] }],
  'potion': [{ state: STATE, events: [{ kind: 'potion', side: 'player', healed: 40 }] }],
  'blocked': CONDITIONS.map(condition => ({
    state: STATE,
    events: [{ kind: 'blocked', side: 'player', condition }],
  })),
  'miss': [
    { state: STATE, events: [{ kind: 'miss', side: 'player', moveId: KNOWN_MOVE }] },
    { state: STATE, events: [{ kind: 'miss', side: 'player', moveId: UNKNOWN_MOVE }] },
  ],
  'hit': [
    {
      state: STATE,
      events: [{
        kind: 'hit',
        side: 'player',
        moveId: KNOWN_MOVE,
        damage: 12,
        effectiveness: 1,
        critical: false,
      }],
    },
    {
      state: STATE,
      events: [{
        kind: 'hit',
        side: 'player',
        moveId: KNOWN_MOVE,
        damage: 30,
        effectiveness: 2,
        critical: true,
      }],
    },
  ],
  'ailment': CONDITIONS.map(condition => ({
    state: STATE,
    events: [{ kind: 'ailment', side: 'opponent', condition }],
  })),
  'no-effect': [{ state: STATE, events: [{ kind: 'no-effect', side: 'player', moveId: KNOWN_MOVE }] }],
  'residual': [
    { state: STATE, events: [{ kind: 'residual', side: 'player', damage: 6 }] },
    ...CONDITIONS.map(condition => ({
      state: withCondition(STATE, condition),
      events: [{ kind: 'residual', side: 'player', damage: 6 } as const],
    })),
  ],
  'faint': [{ state: STATE, events: [{ kind: 'faint', side: 'player' }] }],
  'outcome': [
    { state: STATE, events: [{ kind: 'outcome', outcome: 'won' }] },
    { state: STATE, events: [{ kind: 'outcome', outcome: 'lost' }] },
  ],
}

/** Every key the narrator publishes, flattened — the list `i18n-gate` unions in. */
const PUBLISHED: readonly string[] = [
  ...Object.values(NARRATION_KEYS).flat(),
  UNKNOWN_MOVE_KEY,
]

/**
 * A translator that answers from the locale on disk and writes down what it was
 * asked.
 *
 * `message()` throws on a key the file does not carry and on a placeholder with
 * no value, so a sentence that asks for `{damage}` and is handed nothing fails
 * here instead of rendering `{damage}` to the player.
 */
function recorder(code: string): { translate: Translate, asked: Set<string> } {
  const asked = new Set<string>()

  return {
    asked,
    translate: (key, values) => {
      asked.add(key)

      return message(key, code, values)
    },
  }
}

function linesOf(sample: Sample, translate: Translate): readonly string[] {
  return narrate(sample.state, sample.events, context.moves, translate).lines
}

describe('the turn log', () => {
  /**
   * The other side of both lists.
   *
   * A kind with an empty sample list is narrated by nobody and still satisfies
   * the `Record`; a condition added to the engine and not to `CONDITIONS` leaves
   * three of the four branches measured and the fourth silent. Neither shows up
   * as a failure anywhere else — they show up as a gate that got smaller.
   */
  it('has a sample for every kind of event, and one per condition', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(NARRATION_KEYS).sort())

    for (const [kind, samples] of Object.entries(SAMPLES)) {
      expect(samples.length, `no sample narrates a \`${kind}\` event`).toBeGreaterThan(0)
    }

    expect(CONDITIONS.map(condition => condition.kind).sort())
      .toEqual([...AILMENT_NAMES].sort())
  })

  /** And that there is more than one language to ask, which is the whole point. */
  it('reads every locale that exists on disk', () => {
    expect(localeCodes().length).toBeGreaterThan(1)
  })

  /**
   * What the player reads: a sentence, in their language, with nothing left
   * showing through it.
   *
   * A key that never got a translation reaches the screen as `battle.log.faint`,
   * and a placeholder the narrator forgot to fill reaches it as `{damage}`. Both
   * are legible enough to survive a glance at the log and wrong enough to be a
   * defect.
   */
  it('narrates every kind of event in every language', () => {
    for (const code of localeCodes()) {
      const { translate } = recorder(code)

      for (const [kind, samples] of Object.entries(SAMPLES)) {
        for (const sample of samples) {
          const lines = linesOf(sample, translate)

          expect(lines.length, `\`${kind}\` narrates nothing in ${code}`).toBeGreaterThan(0)

          for (const line of lines) {
            expect(line.trim(), `\`${kind}\` narrates an empty line in ${code}`).not.toBe('')
            expect(line, `\`${kind}\` shows a raw key in ${code}`).not.toMatch(/battle\.log\./)
            expect(line, `\`${kind}\` leaves a placeholder in ${code}`).not.toMatch(/\{\w+\}/)
            expect(line, `\`${kind}\` narrates an undefined in ${code}`).not.toMatch(/undefined/)
          }
        }
      }
    }
  })

  /**
   * The list and the behaviour, compared as sets in both directions.
   *
   * A key asked for and not published is invisible to `i18n-gate`, which then
   * reports its translation as an orphan and has it deleted — the failure lands
   * in the locale file, two PRs away from the line that reads it. A key
   * published and never asked for is the inverse: a translation kept alive by a
   * list instead of by a screen, which is the debt this repository already pays
   * for elsewhere.
   */
  it('asks for exactly the keys it publishes', () => {
    const { translate, asked } = recorder('pt-BR')

    for (const samples of Object.values(SAMPLES)) {
      for (const sample of samples) linesOf(sample, translate)
    }

    expect([...asked].sort()).toEqual([...PUBLISHED].sort())
    expect(new Set(PUBLISHED).size, 'a key is published twice').toBe(PUBLISHED.length)
  })

  /**
   * The fallback name of a move the dex does not carry.
   *
   * It is the one key nobody would think to translate, because it only shows up
   * when something else is already wrong. The assertion on the id is what keeps
   * the sample honest: the day the dex ships move 9999, this stops exercising
   * the fallback and starts exercising a real name, silently.
   */
  it('names an unknown move from the locale', () => {
    expect(context.moves.has(UNKNOWN_MOVE), `${UNKNOWN_MOVE} is in the dex now`).toBe(false)

    const { translate, asked } = recorder('pt-BR')
    const lines = linesOf(
      { state: STATE, events: [{ kind: 'miss', side: 'player', moveId: UNKNOWN_MOVE }] },
      translate,
    )

    expect(asked.has(UNKNOWN_MOVE_KEY)).toBe(true)
    expect(lines).toHaveLength(1)
  })

  /**
   * An outcome that is still running prints nothing, on purpose.
   *
   * The engine emits `ongoing` at the end of every turn that settles nothing,
   * and a line for it would repeat *the fight goes on* after every exchange.
   * Written down because an empty return is indistinguishable from a bug at the
   * call site — and because the assertion above, which wants a line per kind,
   * would otherwise be the only opinion on the subject.
   */
  it('prints nothing for a battle that is still running', () => {
    const { translate } = recorder('pt-BR')
    const lines = linesOf({ state: STATE, events: [{ kind: 'outcome', outcome: 'ongoing' }] }, translate)

    expect(lines).toEqual([])
  })

  /**
   * No sentence left inside the function.
   *
   * The three assertions above all pass with a fragment hardcoded next to a
   * translated one: the narrator can ask for every key it publishes **and**
   * append ` Acerto crítico!` to the line. The only thing that sees that is the
   * source, so this reads it — the same rule the `shared/` gate will carry, run
   * early on the one file in `app/` that writes prose instead of markup.
   *
   * Key addresses (`battle.log.faint`) are literals too, and stay legal: they
   * carry no accent and no space between words, which is exactly what tells a
   * key from a sentence.
   */
  it('keeps no screen text inside the narrator', () => {
    const source = stripComments(
      readFileSync(join(REPO_ROOT, 'app/utils/battle-narration.ts'), 'utf8'),
    )

    // Each expression refuses a newline, which is not a detail: `[^']{2,}` pairs
    // the quote of `side === 'player'` with the next quote three lines down and
    // hands back the code in between as a sentence. The gate then fails on good
    // input, which is the way a gate gets switched off.
    const sentences = [...source.matchAll(/'([^'\n]{2,})'|"([^"\n]{2,})"|`([^`\n]{2,})`/g)]
      .map(match => match[1] ?? match[2] ?? match[3] ?? '')
      .filter(value => /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(value) || /\S\s+\S/.test(value))
      .filter(value => !value.startsWith('~~/'))

    expect(sentences, 'the narrator still writes text the locale should own').toEqual([])
  })
})
