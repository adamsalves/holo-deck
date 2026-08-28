# Holo Deck

Deck battler holográfico sobre o dex da PokeAPI: abrir packs, montar um deck de 6
e enfrentar os 9 ginásios. Nuxt 4 + Vue 3, tema escuro-único, dados de jogo
gerados em build-time.

> **Em construção.** Este é o estado da Fase 0 — a fundação. O jogo entra a
> partir da Fase 1. O README completo é reescrito na Fase 8.

## Rodando

Requer Node na versão do [`.nvmrc`](.nvmrc) e yarn.

```bash
nvm use
yarn install
yarn dev
```

## Verificação

```bash
yarn lint        # ESLint 10 flat config, com as regras de tipagem honesta
yarn typecheck   # vue-tsc sobre app/, server/, shared/ e test/
yarn test        # Vitest — unitários, headless
yarn test:e2e    # Playwright, sobre a build de produção
yarn build       # saída Nitro em .output/
```

## Créditos

Dados e sprites vêm da [PokeAPI](https://pokeapi.co), usada aqui de forma
**não-comercial**, como pede sua política de fair use. Pokémon é marca registrada
da Nintendo / Creatures Inc. / GAME FREAK inc. Este projeto é portfólio, sem
qualquer vínculo com os detentores da marca.
