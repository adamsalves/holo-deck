import { describe, expect, it } from 'vitest'
import type { Translate } from '~~/shared/types/game'
import { agoLabel } from '~~/app/utils/relative-time'
import { localeCodes, message } from '../support/locales'

/**
 * The *há 2 min* of the sync indicator.
 *
 * The case that matters is the clock: the instant comes from the server and the
 * "now" comes from the device, and the two need not agree.
 *
 * Split the same way `sync-label.spec.ts` is, and for the same reason: the
 * function picks a key and a count, the locale writes the words. Asserting the
 * rendered sentence against the locale it came from would pass just as happily
 * over a hard-coded `há 2 min`, so the key and the count are read directly and
 * the wording is measured **in the other language**.
 */

const SYNCED_AT = '2026-09-11T12:00:00.000Z'

function after(ms: number): Date {
  return new Date(Date.parse(SYNCED_AT) + ms)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * What `agoLabel` asked for, rather than what the locale answered.
 *
 * `count` is read through a guard rather than asserted: the values map is typed
 * `string | number`, and an assertion here would be this file promising what the
 * function under test is supposed to prove.
 */
function asks(now: Date): { key: string, count?: number, plural?: number } | null {
  let seen: { key: string, count?: number, plural?: number } | null = null

  const spy: Translate = (key, values, plural) => {
    const count = values?.count
    seen = { key, count: typeof count === 'number' ? count : undefined, plural }

    return key
  }

  return agoLabel(SYNCED_AT, now, spy) === null ? null : seen
}

/** The sentence as one locale writes it, with `message()` refusing a missing value. */
function rendered(now: Date, code: string): string | null {
  const translate: Translate = (key, values, plural) => message(key, code, values, plural)

  return agoLabel(SYNCED_AT, now, translate)
}

describe('quanto tempo desde a última sincronização', () => {
  it('has more than one language to compare', () => {
    expect(localeCodes().length).toBeGreaterThan(1)
  })

  it('under a minute is "now", and carries no count', () => {
    expect(asks(after(0))).toEqual({ key: 'time.now', count: undefined, plural: undefined })
    expect(asks(after(59_999))?.key).toBe('time.now')
  })

  /**
   * The device clock behind the server's. Without the floor the screen would
   * write `há -3 min` — and it is precisely the device clock that the plan lets
   * decide nothing.
   */
  it('a device clock behind the server is also "now", and never negative', () => {
    expect(asks(after(-3 * MINUTE))?.key).toBe('time.now')
  })

  it('minutes, hours and days, with the unit turning over at the boundary', () => {
    expect(asks(after(2 * MINUTE))).toMatchObject({ key: 'time.minutes', count: 2 })
    expect(asks(after(59 * MINUTE))).toMatchObject({ key: 'time.minutes', count: 59 })
    expect(asks(after(HOUR))).toMatchObject({ key: 'time.hours', count: 1 })
    expect(asks(after(23 * HOUR + 59 * MINUTE))).toMatchObject({ key: 'time.hours', count: 23 })
    expect(asks(after(DAY))).toMatchObject({ key: 'time.days', count: 1 })
    expect(asks(after(3 * DAY))).toMatchObject({ key: 'time.days', count: 3 })
  })

  /**
   * Days is the one unit that inflects, so it is the one that has to hand the
   * count over twice — as a value and as the plural form. Passing only the value
   * renders both halves of the message and the pipe between them.
   */
  it('days picks the plural form, and the singular is not the plural', () => {
    expect(asks(after(DAY))?.plural).toBe(1)
    expect(asks(after(3 * DAY))?.plural).toBe(3)

    for (const code of localeCodes()) {
      const one = rendered(after(DAY), code)
      const many = rendered(after(3 * DAY), code)

      expect(one, `one day in ${code}`).not.toBeNull()
      expect(one, `the two forms coincide in ${code}`).not.toBe(many?.replace('3', '1'))
      expect(one, `a pipe reached the screen in ${code}`).not.toContain('|')
    }
  })

  it('an unreadable instant does not become "now"', () => {
    expect(asks(new Date(Date.parse(SYNCED_AT)))).not.toBeNull()

    const translate: Translate = key => key
    expect(agoLabel('ontem', after(0), translate)).toBeNull()
  })

  /** And the other language, which is where a sentence left inside would show. */
  it('writes a different sentence in each language, at every scale', () => {
    const [first, ...rest] = localeCodes()
    if (first === undefined) throw new Error('no locale to compare against')

    for (const at of [after(0), after(2 * MINUTE), after(HOUR), after(3 * DAY)]) {
      const mine = rendered(at, first)
      expect(mine, `${at.toISOString()} came out empty in ${first}`).toBeTruthy()

      for (const other of rest) {
        expect(rendered(at, other), `${at.toISOString()} reads the same in ${first} and ${other}`)
          .not.toBe(mine)
      }
    }
  })
})
