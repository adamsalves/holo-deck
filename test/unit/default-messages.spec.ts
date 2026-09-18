import { describe, expect, it } from 'vitest'
import { fragmentOf, messagesFrom } from '../support/default-messages'

/**
 * The reader two component suites depend on, driven against its own failure
 * paths.
 *
 * `test/support/locales.ts` has `test/unit/locale-message.spec.ts` for exactly
 * this reason, written down there: *a failure path whose message has never been
 * seen is a failure path nobody has proven exists*. This helper arrived with
 * four `throw`s and a fragment builder, none of them exercised — and a helper
 * that silently returns the wrong string turns every assertion built on it into
 * a green line that measures nothing.
 *
 * The fixture is written here rather than read from `i18n/locales/`: these are
 * assertions about the **reader**, and pointing them at the real locale would
 * make them fail the day a translation changes, which is the self-assertion the
 * helper's own docblock warns against.
 */
const LOCALE = JSON.stringify({
  dex: {
    grid: {
      rendered: '{rendered} de {total} renderizados',
      virtualized: '{counted} · scroll virtualizado',
      note: 'A rolagem carrega o resto',
    },
    middle: 'de {count} no total',
    trailing: 'renderizados {count}',
    both: '{done} de {total} renderizados',
  },
  packs: { owned: 'nenhum pacote | um pacote | {count} pacotes' },
  broken: { leaf: 7 },
})

const message = messagesFrom(LOCALE)

describe('the default-locale reader', () => {
  it('fills every placeholder it is given', () => {
    expect(message('dex.grid.rendered', { rendered: 40, total: 151 }))
      .toBe('40 de 151 renderizados')
  })

  it('reads a message that takes no placeholder', () => {
    expect(message('dex.grid.note')).toBe('A rolagem carrega o resto')
  })

  /**
   * The two refusals split on **where** the path breaks, not on what is wrong
   * with the leaf — worth pinning, because the wording suggests otherwise. A
   * path that dies on a missing branch never reaches the leaf check and reads
   * *does not exist*; a path that walks to the end and finds no string reads
   * *is not a message*, including when the leaf is simply absent.
   */
  it('names the branch that is not there', () => {
    expect(() => message('nowhere.at.all')).toThrow(/`nowhere\.at\.all` does not exist/)
    expect(() => message('broken.leaf.deeper')).toThrow(/does not exist/)
  })

  it('refuses a node that is not a message, absent leaf included', () => {
    expect(() => message('dex.grid')).toThrow(/is not a message/)
    expect(() => message('broken.leaf')).toThrow(/is not a message/)
    expect(() => message('dex.grid.missing')).toThrow(/is not a message/)
  })

  /**
   * The plural is the one rule this helper does not own, and it says so by
   * throwing. Returning the raw `a | b | c` would read as a sentence and land
   * inside a `toContain` that then passes against any of the three forms.
   */
  it('refuses a plural rather than picking a form', () => {
    expect(() => message('packs.owned', { count: 3 })).toThrow(/is a plural/)
  })

  it('names the placeholder left without a value', () => {
    expect(() => message('dex.grid.rendered', { rendered: 40 }))
      .toThrow(/no value for `\{total\}`/)
  })
})

describe('the fixed half of a sentence', () => {
  it('drops a placeholder standing at either edge', () => {
    expect(fragmentOf(message, 'dex.grid.virtualized', 'counted'))
      .toBe('· scroll virtualizado')
    expect(fragmentOf(message, 'dex.trailing', 'count')).toBe('renderizados')
  })

  /**
   * The guard that matters, because its absence is invisible: with a
   * placeholder on each side the blanked halves weld together into a string
   * that appears in no rendering — so a `not.toContain` built from it passes
   * forever and looks like a guarded assertion.
   */
  it('refuses to weld two halves into a fragment nothing contains', () => {
    expect(() => fragmentOf(message, 'dex.both', 'done', 'total'))
      .toThrow(/welds the halves together/)
    expect(() => fragmentOf(message, 'dex.middle', 'count'))
      .toThrow(/welds the halves together/)
  })
})
