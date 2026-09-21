import type { RecoveryReason } from '~~/shared/save/schema'
import { RECOVERY_REASONS } from '~~/shared/save/schema'

/**
 * The two sentences a refused save produces, addressed by key.
 *
 * `RecoveryReason` is read in two places that say different things about the
 * same event: the boot notice explains what happened to a save the game could
 * not load (*"Seu save foi gravado por uma versão mais nova"*), and Settings
 * names the reason inside a sentence about a file the player just chose
 * (*"Esse arquivo não pôde ser lido: é de uma versão mais nova do jogo"*). One
 * is a paragraph, the other a clause — so they are two key families over one
 * enum, not one message used twice.
 *
 * **They live outside both components for the reason `TURN_STEPS` does.** Both
 * are addressed as `` t(`settings.reason.${reason}`) `` — a key no scan of the
 * source can see — so `i18n-gate` would find six translations nobody asks for
 * and report them as orphans, where the obvious fix is deleting text that is on
 * screen. The gate unions these lists instead.
 *
 * **The list itself lives in `shared/save/schema.ts`, with the enum derived
 * from it.** It was declared here as `readonly RecoveryReason[]` against a
 * union written by hand, and this docblock claimed a fourth reason would fail
 * to compile — it did not: `lint`, `typecheck` and the 761 unit tests all
 * passed with one added, and the notice would have drawn a raw key on screen.
 * A list that the type is derived from cannot be short.
 */
export { RECOVERY_REASONS }

/** The clause Settings drops into *"could not be read: …"*. */
export function reasonKey(reason: RecoveryReason): string {
  return `settings.reason.${reason}`
}

/**
 * The paragraph the boot notice writes when a save was refused.
 *
 * One sentence per reason, and none of them says *error*. The three are
 * different situations for whoever is on the other side — a corrupt file, a
 * newer game, a format that did not migrate — and the one wrong reaction is the
 * same generic line for all three, which is what teaches a player to stop
 * reading notices. The second of them is also the only one with a way out:
 * update the game.
 */
export function recoveryMessageKey(reason: RecoveryReason): string {
  return `save.recovery.${reason}`
}

/** Every key the two families publish, for the gate that cannot see them. */
export const RECOVERY_KEYS: readonly string[] = [
  ...RECOVERY_REASONS.map(reasonKey),
  ...RECOVERY_REASONS.map(recoveryMessageKey),
]
