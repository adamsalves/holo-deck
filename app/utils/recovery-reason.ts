import type { RecoveryReason } from '~~/shared/save/schema'

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
 * A `Record` over the enum and not a template, so a fourth reason fails to
 * compile rather than failing to be translated.
 */
export const RECOVERY_REASONS: readonly RecoveryReason[] = [
  'corrupt',
  'unknown-version',
  'failed-migration',
]

/** The clause Settings drops into *"could not be read: …"*. */
export function reasonKey(reason: RecoveryReason): string {
  return `settings.reason.${reason}`
}

/** The paragraph the boot notice writes when a save was refused. */
export function recoveryMessageKey(reason: RecoveryReason): string {
  return `save.recovery.${reason}`
}

/** Every key the two families publish, for the gate that cannot see them. */
export const RECOVERY_KEYS: readonly string[] = [
  ...RECOVERY_REASONS.map(reasonKey),
  ...RECOVERY_REASONS.map(recoveryMessageKey),
]
