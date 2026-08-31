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
yarn typecheck   # vue-tsc sobre app/, shared/, scripts/, test/ e os configs
yarn test        # Vitest — unitários, headless
yarn build       # saída Nitro em .output/
yarn test:e2e    # Playwright — exige `yarn build` antes: o webServer sobe
                 # `yarn preview`, que serve .output/
yarn data:build  # regera o dex; só é preciso quando o pipeline muda — ver abaixo
```

Os quatro projetos que o `nuxt prepare` gera não cobrem `test/`, `scripts/` nem
os arquivos de configuração; quem fecha essa lacuna é o
[`tsconfig.tools.json`](tsconfig.tools.json), referenciado pelo `tsconfig.json`
da raiz. Ao criar uma pasta nova de TypeScript, o `include` dele, o glob
type-aware do [`eslint.config.mjs`](eslint.config.mjs) e os aliases do Vitest
precisam concordar — quando discordam, um portão passa e o outro não.

O glob type-aware cobre `app/` desde a Fase 1. Ele existe para a família
`no-unsafe-*`, que é o que impede `any` de entrar por `JSON.parse` e `$fetch`; e
foi na Fase 1 que `app/` ganhou a primeira fronteira de dados, em `useDex()`. Com
a pasta de fora, o mesmo código dava três erros em `shared/` e passava limpo em
`app/` — o portão virava uma questão de onde o arquivo calhou de estar.

## Dados do jogo

O dex **não** é buscado em runtime. Ele é gerado por
[`scripts/build-dex.ts`](scripts/build-dex.ts), commitado em `public/data/` e
`public/sprites/`, e lido pelo composable `useDex()`. Nem o CI nem a Vercel
chamam a PokeAPI — o que respeita o fair use de uma API explicitamente
não-comercial, torna o build determinístico e é o que viabiliza grid de 1025
cartas, evolução sem requisição e o modo offline.

```bash
yarn data:build                    # o dex inteiro (1ª vez ~10 min; depois, cache)
yarn data:build --species 4,5,6 --out /tmp/dex   # ensaio, sem tocar public/data
```

O ensaio parcial **exige** o `--out`: ele grava exatamente os mesmos nomes de
arquivo do build completo, então sem a flag trocaria o dex de 1025 espécies por
um de 3 — e sairia com sucesso. O script recusa. Ele também recusa apagar um
diretório de saída que contenha qualquer coisa que não seja dex gerado, o que é
o que impede um `--out public` de levar os 1025 sprites junto.

As checagens da Fase 1 impressas no fim **reprovam o build**: um ✗ num build
completo sai com código 1. Num ensaio parcial elas falham por construção — três
espécies não somam 1025 — e ali o resultado é só informativo.

O crawl guarda tudo em `.cache/pokeapi/` (gitignorado, gzipado), então a segunda
execução não faz requisição nenhuma. **Rodar isto só é necessário quando o
pipeline muda**; para jogar ou desenvolver, os arquivos commitados bastam.

| Arquivo             | Conteúdo                                              |
| ------------------- | ----------------------------------------------------- |
| `core.json`         | matriz de efetividade 18×18, catálogo de golpes, gerações |
| `chains.json`       | as 541 cadeias de evolução já resolvidas em árvore    |
| `gen-N.json`        | as espécies da geração N — o que o grid precisa       |
| `flavor-N.json`     | as descrições, **em arquivo separado**: pesam mais que todo o resto do dex junto, e só a página de detalhe as usa |
| `sprites/{id}.webp` | miniatura de 128 px, recortada no alpha               |

Cinco coisas que o pipeline decide e que não dá para deduzir lendo a saída:

- **A versão de um moveset vem do campo `order`, nunca do id do version group.**
  `blue-japan` tem id 29 e `scarlet-violet` tem 25 — a PokeAPI cadastrou o
  relançamento japonês de 1996 depois. Ordenar por id dá às 1025 espécies o
  moveset de Game Boy, e o resultado é plausível o bastante para ninguém notar.
- **Menos de 4 golpes por nível completa com máquina e tutor**, do mesmo version
  group. Parar no primeiro método com resultado dava 2 golpes a Clefable,
  Ninetales, Poliwrath e Ludicolo: são evoluções por pedra, o grupo mais recente
  quase não lhes ensina por nível, e o mesmo grupo tem máquina e tutor de sobra.
  Sobram 20 espécies abaixo das 4 vagas — Metapod só sabe Harden, Magikarp só
  Splash e Tackle —, e o build lista as 20 no relatório.
- **Dez espécies não têm golpe de dano nenhum** e caem em Struggle, como nos
  jogos: Metapod, Kakuna, Abra, Ditto, Wobbuffet, Smeargle, Wynaut, Pyukumuku,
  Cosmog e Cosmoem. A PokeAPI dá `pp: 1` a Struggle por resíduo do dado de 1ª
  geração; o motor de batalha precisa tratá-lo como ilimitado, senão os dez
  atacam uma vez por batalha.
- **Uma aresta de evolução chega sem condição.** `phione → manaphy` vem da
  PokeAPI com `evolution_details` vazio. O build relata a aresta em vez de
  inventar uma condição, e o `via` de `EvolutionNode` é opcional por causa dela.
- **Import relativo dentro de `shared/` leva `.ts` explícito.** O script carrega
  `shared/` em Node puro, que não tem a resolução sem extensão do Vite — um
  `from './brand'` ali quebra o `yarn data:build` e nada mais.

## Hooks de git

O [husky](https://typicode.github.io/husky/) instala três hooks no
`yarn install` — o script `prepare` cuida disso, não há passo manual:

| Hook         | Roda                                       | Custo hoje |
| ------------ | ------------------------------------------ | ---------- |
| `commit-msg` | `commitlint` — assunto e corpo do commit   | ~0,3 s     |
| `pre-commit` | `eslint --fix`, **só nos arquivos staged** | ~1 s       |
| `pre-push`   | `yarn typecheck` e `yarn test`             | ~5 s       |

O que eles são: feedback rápido. O que eles **não** são: o portão. Quem reprova
de verdade continua sendo o CI — hook é local, `--no-verify` burla, e commit
feito pela interface do GitHub não roda hook nenhum. É por isso que o
`commitlint` também existe como job do [`ci.yml`](.github/workflows/ci.yml).

A divisão por custo é deliberada. O `pre-commit` olha só o que está staged para
não crescer junto com o projeto: hook lento vira `--no-verify` no dedo, e hook
burlado é pior que hook nenhum, porque dá confiança falsa. Quando a Fase 4
trouxer a suíte do motor e o `pre-push` passar a incomodar, o certo é apagar o
arquivo — não conviver com a flag.

`.husky/common.sh` não é enfeite: hook roda em shell não-interativo, onde nada
do seu `~/.zshrc` existe. Num PATH cru desta máquina **nem `node` nem `yarn`
existem** — os dois vivem dentro do diretório de versão do nvm. Ele resolve o
`.nvmrc` montando esse caminho à mão, de propósito, em vez de sourcear o
`nvm.sh`: o husky roda os hooks com `sh`, que no Ubuntu é o dash, e sob dash o
`nvm use` responde que uma versão instalada *não está instalada*.

## Release

Versionamento e changelog são automáticos, a partir das mensagens de commit. O
passo a passo — e a regra de merge commit que o processo exige — está no
[`RELEASE.md`](RELEASE.md).

## Créditos

Dados e sprites vêm da [PokeAPI](https://pokeapi.co), usada aqui de forma
**não-comercial**, como pede sua política de fair use. Pokémon é marca registrada
da Nintendo / Creatures Inc. / GAME FREAK inc. Este projeto é portfólio, sem
qualquer vínculo com os detentores da marca.
