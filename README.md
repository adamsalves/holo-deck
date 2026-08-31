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
yarn typecheck   # vue-tsc sobre app/, shared/, test/ e os configs
yarn test        # Vitest — unitários, headless
yarn build       # saída Nitro em .output/
yarn test:e2e    # Playwright — exige `yarn build` antes: o webServer sobe
                 # `yarn preview`, que serve .output/
```

Os quatro projetos que o `nuxt prepare` gera não cobrem `test/`, `scripts/` nem
os arquivos de configuração; quem fecha essa lacuna é o
[`tsconfig.tools.json`](tsconfig.tools.json), referenciado pelo `tsconfig.json`
da raiz. Ao criar uma pasta nova de TypeScript, o `include` dele, o glob
type-aware do [`eslint.config.mjs`](eslint.config.mjs) e os aliases do Vitest
precisam concordar — quando discordam, um portão passa e o outro não.

## Hooks de git

O [husky](https://typicode.github.io/husky/) instala três hooks no
`yarn install` — o script `prepare` cuida disso, não há passo manual:

| Hook         | Roda                                       | Custo hoje |
| ------------ | ------------------------------------------ | ---------- |
| `commit-msg` | `commitlint` sobre o assunto do commit     | ~0,3 s     |
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
