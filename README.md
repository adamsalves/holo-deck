# Holo Deck

Deck battler holográfico sobre o dex da PokeAPI: abrir packs, montar um deck de 6
e enfrentar os 9 ginásios. Nuxt 4 + Vue 3, tema escuro-único, dados de jogo
gerados em build-time.

> **Em construção.** Este é o estado da **Fase 7, primeira metade** — tudo da Fase
> 6 (a Pokédex, o ciclo de pack e coleção, o deck builder, a Liga com os nove
> ginásios e a tela de batalha, a loja, `/rules` e `/settings`), mais conta no
> GitHub e save no servidor. O jogo continua jogável **sem conta**, inteiro, a
> partir do `localStorage`. A sincronização contínua — fila offline, debounce, 409
> com reaplicação, indicador na barra — é a segunda metade da fase; até ela, a
> conta recebe a coleção no primeiro login e nada além disso. O README completo é
> reescrito na Fase 8.

## Rodando

Requer Node na versão do [`.nvmrc`](.nvmrc) e yarn.

```bash
nvm use
yarn install
yarn dev
```

Jogar não precisa de nada além disso. **Conta e save no servidor** precisam de um
`.env` — ver [`.env.example`](.env.example) —, e sem ele o jogo abre e funciona:
só `/api/auth/*` e `/api/save` respondem 500, que é o comportamento decidido para
um jogo local-first (ver o docblock de `server/utils/env.ts`).

Duas variáveis apontam para o **mesmo** banco e as duas são necessárias:
`DATABASE_URL` é a do pooler, que o runtime usa porque função serverless abre e
fecha conexão a cada requisição; `DATABASE_URL_UNPOOLED` é a direta, que só a
migração usa, porque o PgBouncer em modo transaction não sustenta os recursos de
sessão que DDL pede.

```bash
yarn db:generate        # gera a migration a partir de server/db/schema.ts
yarn db:migrate         # aplica as migrations no banco do .env
yarn db:generate:auth   # reescreve server/db/auth-schema.ts pelo CLI do better-auth
```

## Documentação

O resto da documentação mora em `docs/`, um arquivo por assunto:

- [`docs/verification.md`](docs/verification.md) — Verificação
- [`docs/design-system.md`](docs/design-system.md) — Sistema de design
- [`docs/canvas-divergences.md`](docs/canvas-divergences.md) — Divergências do canvas
- [`docs/i18n.md`](docs/i18n.md) — Idiomas
- [`docs/game-data.md`](docs/game-data.md) — Dados do jogo
- [`docs/pokedex.md`](docs/pokedex.md) — Pokédex
- [`docs/collection-and-deck.md`](docs/collection-and-deck.md) — Pack, coleção, forja e deck
- [`docs/league-and-battle.md`](docs/league-and-battle.md) — A Liga, a batalha e o motor
- [`docs/shop-rules-settings.md`](docs/shop-rules-settings.md) — A loja, as regras e os ajustes
- [`docs/accessibility.md`](docs/accessibility.md) — Acessibilidade
- [`docs/offline.md`](docs/offline.md) — Offline
- [`docs/performance.md`](docs/performance.md) — Primeira carga
- [`docs/save.md`](docs/save.md) — O save

## Release

Versionamento e changelog são automáticos, a partir das mensagens de commit. O
passo a passo — e a regra de merge commit que o processo exige — está no
[`RELEASE.md`](RELEASE.md).

O plano fecha **uma minor por fase**, e uma fase partida em vários PRs cortaria
uma minor por PR. A regra que resolve isso — **segurar o release PR até o último
PR da fase entrar** — também está lá, com o comentário 🔒 que a Fase 6 usou para
não esquecer.

## Créditos

Dados e sprites vêm da [PokeAPI](https://pokeapi.co), usada aqui de forma
**não-comercial**, como pede sua política de fair use. Pokémon é marca registrada
da Nintendo / Creatures Inc. / GAME FREAK inc. Este projeto é portfólio, sem
qualquer vínculo com os detentores da marca.

Os seis ícones da paleta de busca, em `app/assets/icons/lucide/`, são do
[Lucide](https://lucide.dev), licença ISC (© Lucide Icons and Contributors), na
versão 1.52.0 do `lucide-static`, com o aviso de licença que cada arquivo traz no
topo. Cinco deles — `arrow-left`, `check`, `chevron-right`, `search` e `x` —
derivam do Feather (MIT, © Cole Bemis), como o próprio Lucide registra em
[lucide.dev/license](https://lucide.dev/license). Moram no repositório, e não
vêm de um pacote, para a paleta não pedir ícone à rede: o motivo está em
`nuxt.config.ts`.
