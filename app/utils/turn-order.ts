/**
 * The six steps of a battle turn, as the ids `/rules` renders one message per.
 *
 * **It lives outside the page for the reason `NARRATION_KEY_LIST` does.** The
 * page loops over these ids and builds `rules.battle.steps.<id>` into an
 * `<i18n-t :keypath>`, so no sweep over the source can see the six keys spelled
 * out: `i18n-gate` would find six translations nobody asks for and report them
 * as orphans, and the honest-looking fix — deleting them — takes the text off a
 * screen that renders it. The gate imports this list instead, the same way it
 * imports the nav links and the log's keys.
 *
 * **The order is the page's, and it is not exactly the engine's.** `engine.ts`
 * runs the turn as control flow rather than as data, so there is no list in the
 * engine to derive this one from — and the two disagree on one step, measured:
 * `spendPp` runs at `engine.ts:222`, *before* the accuracy roll at `:226`, while
 * the page lists `pp` fifth, after `hit` and `damage`. The order shipped that way
 * before this PR and the difference is invisible to the player (PP is spent on a
 * miss either way), so it is registered in the README's divergences rather than
 * reordered here: the board draws this list, and reordering it is the board's
 * call, not a docblock's.
 *
 * Nothing on disk holds the two together. `test/e2e/rules.spec.ts` reads the
 * rendered steps in order, which keeps the **page** honest against this list —
 * not this list honest against the engine. Saying otherwise would be the shape
 * `CLAUDE.md` warns about: an assertion reading the same source the code reads.
 *
 * As ids and not as six written `<li>`: the page's marker has to be a real
 * element to take the `numeric` class (`::marker` takes no class), and writing
 * the ordinal beside each sentence would be the list's numbering kept by hand
 * next to the numbering the `<ol>` already gives.
 *
 * **Step 5 corrects the board.** It says "at zero the move becomes
 * unselectable", and the engine does the opposite: `moveFromSlot` returns
 * Struggle for the empty slot, and the move stays clickable — which is what the
 * review of the Phase 8 battle PR fixed on the move card, leaving the board
 * behind.
 *
 * **The sentences used to be `before` / `strong` / `after` triples** on the
 * page, and the split was the bold tag's fault: three fragments concatenated in
 * the template so the middle one could be emphasised. The order of those
 * fragments is Portuguese word order, and *no zero aquele slot vira Struggle*
 * does not land in the middle of the English sentence at all. Each step is one
 * message now, with the emphasis arriving as a slot — the same remounting
 * `evolution.ts` and `battle-narration.ts` each needed for the same reason.
 */
export const TURN_STEPS = ['order', 'blocked', 'hit', 'damage', 'pp', 'residual'] as const

export type TurnStep = typeof TURN_STEPS[number]

/** The keypath a step's sentence lives under. */
export function turnStepKey(step: TurnStep): string {
  return `rules.battle.steps.${step}`
}

/**
 * Every key the turn order asks for, the two emphasised fragments included.
 *
 * `seed` and `struggle` are spelled literally by the page and would be found by
 * the scan anyway; they are here so that the list reads as *what this feature
 * needs translated* rather than as *what the scan happened to miss*, which is
 * the distinction that decides whether a list gets maintained.
 */
export const TURN_STEP_KEYS: readonly string[] = [
  ...TURN_STEPS.map(turnStepKey),
  'rules.battle.steps.seed',
  'rules.battle.steps.struggle',
]
