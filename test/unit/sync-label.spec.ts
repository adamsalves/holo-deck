import { describe, expect, it } from 'vitest'
import type { Translate } from '~~/shared/types/game'
import { syncLabel } from '~~/app/utils/sync-label'
import type { SyncStatus } from '~~/app/utils/sync-status'
import { localeCodes, message } from '../support/locales'

/**
 * What the sync indicator writes — the *Estados de sync* board, in both
 * languages.
 *
 * **This is the one screen text that renders on every other screen**: the chip
 * lives in the global bar, so a sentence left in Portuguese here shows up on the
 * Hub, the binder and the battle alike, in `/en`.
 *
 * The function's own job is picking a key and handing it the right values; the
 * words belong to the locale. So the two are asserted apart: `asks` reads the
 * key and the values directly, and the rendered assertions demand that the two
 * languages come out **different**. Comparing the rendered sentence against the
 * locale it was rendered from would agree with a hard-coded string just as
 * happily — the failure this repository keeps paying for.
 */

const NOW = new Date('2026-09-11T12:02:00.000Z')

/** A status with the fields a case does not care about filled in. */
function status(fields: Partial<SyncStatus> & Pick<SyncStatus, 'phase'>): SyncStatus {
  return { pending: 0, syncedAt: null, ...fields }
}

/** What `syncLabel` asked for, rather than what the locale answered. */
function asks(value: SyncStatus): { key: string, values: Record<string, unknown>, plural?: number } {
  let seen: { key: string, values: Record<string, unknown>, plural?: number } | null = null

  const spy: Translate = (key, values, plural) => {
    // The nested `agoLabel` call is not this function's sentence; the outer one
    // is the last to resolve, so recording every call and keeping the last would
    // read the wrong one. Only the first call that is not a `time.*` key counts.
    if (seen === null || !key.startsWith('time.')) {
      seen = { key, values: { ...values }, plural }
    }

    return key
  }

  syncLabel(value, NOW, spy)
  if (seen === null) throw new Error('syncLabel asked for no key at all')

  return seen
}

/** The sentence as one locale writes it, with `message()` refusing a missing value. */
function rendered(value: SyncStatus, code: string): string {
  const translate: Translate = (key, values, plural) => message(key, code, values, plural)

  return syncLabel(value, NOW, translate)
}

describe('o que o indicador de sync escreve', () => {
  // The other side of every loop below: one locale would prove nothing about
  // language, and none would run nothing at all.
  it('has more than one language to compare', () => {
    expect(localeCodes().length).toBeGreaterThan(1)
  })

  it('sending carries no number: what is in flight is one write', () => {
    expect(asks(status({ phase: 'sending', pending: 3 }))).toEqual({
      key: 'sync.sending',
      values: {},
      plural: undefined,
    })
  })

  /**
   * The count travels twice on purpose — once to fill the sentence, once to pick
   * the form — and this is the assertion that says so. Handing vue-i18n only the
   * value renders the pipe and both halves: *1 mudança na fila | 1 mudanças na
   * fila*, on screen.
   */
  it('the queue passes the count as a value and as the plural form', () => {
    expect(asks(status({ phase: 'queued', pending: 1 })))
      .toEqual({ key: 'sync.queued', values: { count: 1 }, plural: 1 })
    expect(asks(status({ phase: 'queued', pending: 3 })))
      .toEqual({ key: 'sync.queued', values: { count: 3 }, plural: 3 })
  })

  /** Measured as shape: one is not the other, and each spells its own count. */
  it('and the two forms really differ, in every language', () => {
    for (const code of localeCodes()) {
      const one = rendered(status({ phase: 'queued', pending: 1 }), code)
      const many = rendered(status({ phase: 'queued', pending: 3 }), code)

      expect(one, `the singular in ${code}`).toContain('1')
      expect(many, `the plural in ${code}`).toContain('3')
      expect(one, `the two forms coincide in ${code}`).not.toBe(many.replace('3', '1'))

      // A message rendered with its pipe intact is the defect this guards.
      expect(one, `a pipe reached the screen in ${code}`).not.toContain('|')
      expect(many, `a pipe reached the screen in ${code}`).not.toContain('|')
    }
  })

  it('synced says how long ago, by the server instant', () => {
    expect(asks(status({ phase: 'synced', syncedAt: '2026-09-11T12:00:00.000Z' })))
      .toEqual({ key: 'sync.syncedAgo', values: { ago: 'time.minutes' }, plural: undefined })
  })

  /**
   * A new account with nothing to send — `idle` on the first login — has no
   * server instant at all, and inventing one would claim a write that never
   * happened.
   */
  it('with no server instant, just synced', () => {
    for (const syncedAt of [null, 'ontem']) {
      expect(asks(status({ phase: 'synced', syncedAt })))
        .toEqual({ key: 'sync.synced', values: {}, plural: undefined })
    }
  })

  /**
   * And the other language, which is where a sentence left inside the function
   * would show up: every state has to read differently in the two locales.
   */
  it('writes a different sentence in each language, in every state', () => {
    const cases: SyncStatus[] = [
      status({ phase: 'sending' }),
      status({ phase: 'queued', pending: 3 }),
      status({ phase: 'synced' }),
      status({ phase: 'synced', syncedAt: '2026-09-11T12:00:00.000Z' }),
    ]

    const [first, ...rest] = localeCodes()
    if (first === undefined) throw new Error('no locale to compare against')

    for (const value of cases) {
      const mine = rendered(value, first)

      expect(mine, `${value.phase} came out empty in ${first}`).not.toBe('')

      for (const other of rest) {
        expect(rendered(value, other), `${value.phase} reads the same in ${first} and ${other}`)
          .not.toBe(mine)
      }
    }
  })
})
