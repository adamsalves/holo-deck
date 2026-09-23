import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { LOCALE_KEY, rootGuardScript } from '../../app/utils/locale-preference'
import { defaultLocale, localeCodes } from '../support/locales'

/**
 * The inline guard that sends the root to the remembered language, run as the
 * browser runs it: the script text, evaluated against a `localStorage` and a
 * `location`.
 *
 * It is text and not a function because it goes into the `<head>` of the
 * prerendered root, before the app exists — so a test of the function that
 * builds it would test the builder, and this tests what the builder writes.
 *
 * The browser half — that it runs before the first paint, only on the root, and
 * not again on a client-side navigation — is `test/e2e/language.spec.ts`. What
 * is here is the part a browser never reaches in a suite: storage that throws,
 * and values nobody wrote through the selector.
 */

/**
 * Where the guard sent the page at `pathname`, given `stored` under its key — or
 * given a storage that throws, which is what a private window or blocked site
 * data looks like. Empty is "stayed".
 */
function runGuard(stored: string | null | 'throws', pathname = '/'): readonly string[] {
  const replacedWith: string[] = []

  runInNewContext(rootGuardScript(), {
    localStorage: {
      getItem(key: string): string | null {
        if (stored === 'throws') throw new Error('SecurityError: storage is blocked')

        return key === LOCALE_KEY ? stored : null
      },
    },
    location: {
      pathname,
      search: '?from=home-screen',
      hash: '#daily',
      replace(to: string): void {
        replacedWith.push(to)
      },
    },
  })

  return replacedWith
}

/** The languages that live under a prefix — the ones the root can be sent to. */
const PREFIXED = localeCodes().filter(code => code !== defaultLocale())

describe('the root guard', () => {
  // The other side: with no prefixed language, the first test below loops over
  // nothing and passes.
  it('has somewhere to send the root', () => {
    expect(PREFIXED.length).toBeGreaterThan(0)
  })

  /**
   * The destination is spelled here as the routing strategy spells it —
   * `/<code>` — and not asked of `pathInLocale`, which is what the script was
   * built from: an expectation built from the same function agrees with it when
   * both are wrong.
   */
  it('sends the root to the remembered language, keeping the query and the hash', () => {
    for (const code of PREFIXED) {
      expect(runGuard(code), code).toEqual([`/${code}?from=home-screen#daily`])
    }
  })

  it('leaves the root alone when the remembered language is the root\'s own', () => {
    expect(runGuard(defaultLocale())).toEqual([])
  })

  it('leaves the root alone when nothing was remembered', () => {
    expect(runGuard(null)).toEqual([])
  })

  /**
   * A value the selector never writes is Portuguese, whatever it looks like.
   *
   * `__proto__` and `constructor` are the reason the script compares with `===`
   * over a list instead of looking the value up on an object: a lookup hands
   * back `Object.prototype` for the first, which is truthy, and the root would
   * be sent to `/[object Object]`. The language tag and the capitalised code
   * are what a person editing storage by hand would plausibly type.
   */
  it('reads anything else as no preference at all', () => {
    const others = ['__proto__', 'constructor', 'toString', 'en-US', 'EN', '']

    for (const value of others) {
      expect(runGuard(value), value).toEqual([])
    }
  })

  it('and a storage that throws is the root in its own language, not an error', () => {
    expect(runGuard('throws')).toEqual([])
  })

  /**
   * **The offline shell answers every path, and the guard goes with it.**
   *
   * Online, the script only exists in the root's own HTML, so where it runs is
   * always `/`. Offline, the service worker answers any navigation with one
   * document — `200.html`, with this same script in its head — and without the
   * check a player who chose English and opens `/pokemon/pikachu` offline would
   * be sent to the English home page instead of the page they asked for.
   *
   * The paths are the other language's root, a page with no prefix and a page
   * with one: each is somewhere a shell can be opened, and none is the root.
   */
  it('leaves every other path alone, which is what the offline shell needs', () => {
    const elsewhere = ['/pokemon/pikachu', '/collection', ...PREFIXED.flatMap(code => [`/${code}`, `/${code}/deck`])]

    for (const pathname of elsewhere) {
      for (const code of PREFIXED) {
        expect(runGuard(code, pathname), `${pathname} with ${code} remembered`).toEqual([])
      }
    }
  })
})
