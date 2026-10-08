# Holo Deck

A holographic deck battler on top of the PokeAPI dex: open packs, build a deck of 6 and take on the
9 gyms. Built with Nuxt 4 and Vue 3, with a dark-only theme and game data generated at build time.

The game is local-first: it runs from `localStorage` and needs no account, and an optional GitHub
account syncs the save to a server. It speaks Brazilian Portuguese and English, installs as an app
and plays offline after the first visit.

## Running

Requires Node at the version in [`.nvmrc`](.nvmrc), and yarn.

```bash
nvm use
yarn install
yarn dev
```

Playing needs nothing else. **An account and the server-side save** need a `.env` — see
[`.env.example`](.env.example) — and without one the game still opens and works: only
`/api/auth/*` and `/api/save` answer 500, which is the behavior decided for a local-first game
(see the docblock of `server/utils/env.ts`).

Two variables point at the **same** database and both are required: `DATABASE_URL` is the
pooler's, which the runtime uses because a serverless function opens and closes a connection on
every request; `DATABASE_URL_UNPOOLED` is the direct one, which only the migration uses, because
PgBouncer in transaction mode does not support the session features that DDL needs.

```bash
yarn db:generate        # generates the migration from server/db/schema.ts
yarn db:migrate         # applies the migrations to the database in .env
yarn db:generate:auth   # rewrites server/db/auth-schema.ts through the better-auth CLI
```

## Verifying

```bash
yarn lint        # ESLint 10 flat config, with the typing-honesty rules
yarn typecheck   # vue-tsc over app/, shared/, scripts/, test/ and the configs
yarn test        # Vitest, unit tests, headless
yarn build       # Nitro output in .output/
yarn test:e2e    # Playwright; needs `yarn build` first
```

[`docs/verification.md`](docs/verification.md) has the rest: the Vercel preset, the two manual
database checks and the git hooks.

## Documentation

Everything past the quick start lives in `docs/`, one file per subject. The files are in
Portuguese, the language they were written in, except `docs/canvas.md`; the translation is tracked
in [issue #46](https://github.com/adamsalves/holo-deck/issues/46).

- [`docs/verification.md`](docs/verification.md): the checks, the Vercel preset, the manual database
  checks and the git hooks.
- [`docs/design-system.md`](docs/design-system.md): the Holo TCG theme, why it is dark-only, its CSS
  tokens and the holographic foil.
- [`docs/canvas.md`](docs/canvas.md): the canvas boards and the screen each one specifies.
- [`docs/canvas-divergences.md`](docs/canvas-divergences.md): where the code departs from the
  approved canvas, and why.
- [`docs/i18n.md`](docs/i18n.md): the two languages: the three language gates, the switcher and how
  the root follows its choice, `hreflang`, and what is still untranslated.
- [`docs/game-data.md`](docs/game-data.md): how the dex is generated at build time and committed,
  instead of fetched from PokeAPI at runtime.
- [`docs/pokedex.md`](docs/pokedex.md): the Pokédex screens: all 1025 species, the region index and
  the species page.
- [`docs/collection-and-deck.md`](docs/collection-and-deck.md): packs, the collection, the forge and
  the deck.
- [`docs/league-and-battle.md`](docs/league-and-battle.md): the League and its economy, the battle
  screen and the battle engine.
- [`docs/shop-rules-settings.md`](docs/shop-rules-settings.md): the shop, `/rules`, `/settings`, the
  animation switch and the global bar.
- [`docs/accessibility.md`](docs/accessibility.md): page structure, the focus ring and where focus
  goes after an action.
- [`docs/offline.md`](docs/offline.md): the service worker, the two cache layers, installing the app
  and downloading everything for offline.
- [`docs/performance.md`](docs/performance.md): the first-load budget of each screen, prefetching
  and the stable top bar.
- [`docs/save.md`](docs/save.md): the save document, its migrations, backups and recovery.

## Release

Versioning and the changelog are automatic, from the commit messages. [`RELEASE.md`](RELEASE.md)
has the step by step, the merge commit rule the process requires, and the rule for holding the
release PR until the last PR of a phase split into several lands.

## Credits

Data and sprites come from [PokeAPI](https://pokeapi.co), used here **non-commercially**, as its
fair use policy asks. Pokémon is a registered trademark of Nintendo / Creatures Inc. / GAME FREAK
inc. This project is a portfolio piece, with no connection to the trademark holders.

The six icons of the search palette, in `app/assets/icons/lucide/`, are from
[Lucide](https://lucide.dev), ISC license (© Lucide Icons and Contributors), at version 1.52.0 of
`lucide-static`, with the license notice that each file carries at the top. Five of them —
`arrow-left`, `check`, `chevron-right`, `search` and `x` — derive from Feather (MIT, © Cole
Bemis), as Lucide itself records at [lucide.dev/license](https://lucide.dev/license). They live in
the repository rather than coming from a package, so that the palette does not ask the network for
an icon: the reason is in `nuxt.config.ts`.
