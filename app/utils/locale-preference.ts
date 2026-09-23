import { DEFAULT_LOCALE, LOCALES, pathInLocale } from './locales'

/**
 * The language this device opens in — the one thing the selector in *Settings*
 * remembers. The selector writes it (`rememberLocale`, in `settings.vue`); the
 * root reads it, and nothing else does.
 *
 * **Read in one place only: the root.** Whoever opens `/` — the bare domain, a
 * bookmark, the installed app of Phase 8's PR 5 — lands in the remembered
 * language. A direct link keeps the language of its URL: someone who chose
 * English and is sent `/pokemon/pikachu` reads Portuguese, because that is the
 * page they were sent. That is decision 2 of the 4d plan (21/09/2026).
 *
 * **A device preference, not a save field**, for the reason the board prints
 * under *Preferences* (`THIS DEVICE ONLY`) and the reduce-motion switch already
 * follows: the phone should not inherit the desktop's language through the sync.
 *
 * This module holds no storage access, and that is load-bearing: the unit suite
 * compiles without the DOM library, and a `window` reached through an import
 * here fails `yarn typecheck` for every test that asks the guard a question.
 */
export const LOCALE_KEY = 'holodeck:locale'

/** The `id` of the guard's `<script>` — how the build gate finds it in the HTML. */
export const ROOT_GUARD_ID = 'locale-root-guard'

/**
 * The inline script that sends the root to the remembered language **before the
 * first paint**.
 *
 * **Inline in the `<head>`, and not a plugin.** A plugin runs after the
 * prerendered Hub has been painted in Portuguese, so the player would watch the
 * screen switch language — the defect of the module's `detectBrowserLanguage`,
 * which PR 1 of this phase turned off for exactly that. Parsed in the `<head>`,
 * before the `<body>` exists, this runs before there is anything to paint — and
 * it goes out `critical`, ahead of every other script there, so nothing in
 * front of it delays the redirect (see `app.vue`).
 *
 * **And there never is anything: the navigation stops the parser where it
 * stands.** Measured in Chromium with the answer for the other language held
 * back 800 ms: the root's document sat at `readyState` complete with
 * `document.body` still `null`, and no paint entry at all. The review of PR #65
 * found the same in Firefox 153 and WebKit 26.5, the engine under every iOS
 * browser, with the answer held back 2 s: seven elements, all of them the
 * head's, and no paint. Hiding the document before leaving — the
 * obvious guard against the Hub painting while the answer travels — was written,
 * measured and left out: without it the paint test passed every run, delayed or
 * not, because there was no Hub to paint. A line whose reason cannot be measured
 * is a reason nobody can check.
 *
 * `replace` and not `assign`, so the back button does not return to a root that
 * would only send the player forward again. The query and the hash go along.
 *
 * The codes and their paths come from `LOCALES`, so a third language is followed
 * the day it is declared; strict equality over a list, and not a lookup on an
 * object, so that a stored `__proto__` or `constructor` is just an unknown value.
 * Storage that throws — a private window, blocked site data — means Portuguese,
 * which is what the root is without a preference.
 */
export function rootGuardScript(): string {
  const targets = LOCALES
    .filter(locale => locale.code !== DEFAULT_LOCALE)
    .map(locale => [locale.code, pathInLocale('/', locale.code)])

  return [
    '(function(){try{',
    `var c=localStorage.getItem(${JSON.stringify(LOCALE_KEY)}),t=${JSON.stringify(targets)};`,
    'for(var i=0;i<t.length;i++)if(t[i][0]===c){',
    'location.replace(t[i][1]+location.search+location.hash);return}',
    '}catch(e){}})()',
  ].join('')
}
