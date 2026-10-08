# Verificação e hooks de git

## Verificação

```bash
yarn lint        # ESLint 10 flat config, com as regras de tipagem honesta
yarn typecheck   # vue-tsc sobre app/, shared/, scripts/, test/ e os configs
yarn test        # Vitest — unitários, headless
yarn build       # saída Nitro em .output/
yarn test:e2e    # Playwright — exige `yarn build` antes: o webServer sobe
                 # `yarn preview`, que serve .output/. Se a 3000 estiver ocupada
                 # nesta máquina, use `PORT=3100 yarn test:e2e` — ver abaixo
yarn data:build  # regera o dex; só é preciso quando o pipeline muda — ver abaixo
```

O preset da Vercel, que é o que vai ao ar, tem o seu par de comandos:

```bash
yarn build:vercel         # apaga .output e .vercel/output e constrói com o preset da Vercel
yarn check:vercel-bundle  # confere a saída do preset; exige o build:vercel antes
```

O `build:vercel` **apaga o `.output`**, de propósito. No preset da Vercel, o
prerenderer do Nitro segue lendo os estáticos de `.output/public`, e responde cada
rota com o arquivo que um build anterior deixou lá em vez de renderizá-la. Com o
`.output` de um build Node inteiro em disco saem 19 rotas, todas velhas, em vez
das 4.211 de um build limpo, e o build morre no hook do service worker. Com um
`.output` de uma página só o build **passa**, com a página velha dentro — e quem
acusa é o `check:vercel-bundle`, porque página que o build não renderizou não tem
payload ao lado. Por isso o e2e roda antes do `build:vercel`, ou pede `yarn build`
de novo. O que o `check:vercel-bundle` cobra está em *Pokédex*, onde o defeito
que ele vigia é contado.

Dois dos portões da Fase 7 são **manuais**, e a razão de estarem escritos aqui é
que nada no CI os dispara:

```bash
yarn db:verify       # o CAS de `PUT /api/save` contra o Postgres do .env
yarn db:seed-remote  # semeia um save remoto, para testar o primeiro login à mão
```

**O SQL do save fica descoberto no CI, e isso é decisão, não descuido.** A decisão
4 da fase fechou o e2e contra um servidor falso em memória, sem banco, para o CI
não depender de rede nem de segredo — o que cobre o cliente e a tela, e deixa de
fora o `update` que copia a linha para `previous*` dentro do próprio comando, que
é exatamente o tipo de coisa que passa em revisão e falha no banco. **Rodar
`yarn db:verify` antes de mexer em `server/db/save-store.ts`** é o que fecha a
lacuna, e é trabalho de quem edita lembrar.

O que dá para automatizar sem banco está no CI: o passo *migrations acompanham o
schema* roda `drizzle-kit generate` com credencial falsa — ele lê o schema e não
abre conexão — e reprova se sobrar migration por gerar.

**Login não se valida em preview da Vercel**, e também não é defeito: cada deploy
tem URL própria, que nunca casa com a redirect URI registrada no OAuth App do
GitHub nem com o `BETTER_AUTH_URL`, e os previews estão atrás do Vercel
Authentication. Valida-se em `localhost` e em produção.

**O terceiro portão manual é o login em produção, e os passos são estes.** Sem
eles, "entrar e ver a coleção subir" não é observável: o sync de entrada roda em
segundo plano e, se o `GET` falha, a tela fica idêntica à do sucesso.

1. No navegador de sempre, entre pelo GitHub. O canto da barra passa a mostrar o
   avatar e *SAIR*, e o indicador ao lado deles diz *sincronizado há X*.
2. No mesmo navegador, confira que `holodeck:syncedWith` existe no Local Storage e
   guarda o **id do usuário**: ele só é escrito quando o acerto de entrada termina.
3. Numa janela anônima **intocada** — sem abrir pack antes, o que trocaria `adopt`
   por `ask` —, entre pelo GitHub. O Hub tem de mostrar a mesma contagem de cartas,
   insígnias e raridades do primeiro navegador.
4. De volta ao navegador de sempre, escale uma carta no deck e espere ~5 s: o
   indicador vai a *enviando…* e volta a *sincronizado*. Feche **todas** as janelas
   anônimas — elas dividem o armazenamento —, abra uma nova, entre, e a carta
   escalada tem de estar no deck.

Dar diferente no passo 2 é sync de entrada que não concluiu; no 3, `GET /api/save`
que não voltou; no 4, `PUT /api/save` que não subiu — e o indicador do canto diz
em qual dos três o jogo parou.

O `reuseExistingServer` do Playwright reaproveita um servidor que já esteja de
pé na porta configurada — e ele confere que **alguém** atende, não **quem**. Um
serviço alheio na 3000 faz a suíte inteira rodar contra ele e reprovar dizendo
que a página não tem os elementos certos, o que é verdade e não é o defeito. Por
isso a porta vem de `process.env.PORT`: o `yarn preview` herda a mesma variável,
e os dois lados não têm como discordar. No CI nada muda — lá o
`reuseExistingServer` já é `false`.

Os quatro projetos que o `nuxt prepare` gera não cobrem `test/`, `scripts/` nem
os arquivos de configuração; quem fecha essa lacuna é o
[`tsconfig.tools.json`](../tsconfig.tools.json). Os testes de ponta a ponta ganharam
um sexto projeto, o [`tsconfig.e2e.json`](../tsconfig.e2e.json): o corpo de
`page.evaluate` roda **dentro** do navegador e precisa da lib `dom`, que nenhum
outro projeto da suíte deve ter. Os dois são referenciados pelo `tsconfig.json`
da raiz.

Ao criar uma pasta nova de TypeScript, o `include` de um desses projetos, o glob
type-aware do [`eslint.config.mjs`](../eslint.config.mjs) e os aliases do Vitest
precisam concordar — quando discordam, um portão passa e o outro não.

O glob type-aware cobre `app/` desde a Fase 1 e os `.vue` desde a Fase 2. Ele
existe para a família `no-unsafe-*`, que é o que impede `any` de entrar por
`JSON.parse` e `$fetch`. Na Fase 1 foi `app/` que ficou de fora ao ganhar a
primeira fronteira de dados, em `useDex()`; na Fase 2 foi o bloco `<script
setup>`, bem quando o repositório se encheu de componente. Nos dois casos o mesmo
código dava três erros num arquivo e passava limpo no outro.

O padrão se repetiu três vezes, então virou teste:
[`test/unit/lint-gate.spec.ts`](../test/unit/lint-gate.spec.ts) anda pelo disco e
reprova se existir arquivo capaz de carregar TypeScript fora do alcance do bloco
— sem precisar saber de antemão que pasta ou extensão alguém inventou.

Na quarta vez o defeito mudou de portão: a Fase 3 criou `test/e2e/` e ela nasceu
fora de todos os projetos de `tsconfig`, com o sintoma apontando para o código
(`Cannot find name 'document'`, e o ESLint recusando o arquivo inteiro) em vez de
para a configuração. Isso também virou teste:
[`test/unit/tsconfig-gate.spec.ts`](../test/unit/tsconfig-gate.spec.ts) pergunta ao
**próprio TypeScript** quais arquivos cada projeto cobre e reprova se algum ficar
de fora — ou se algum projeto ficar vazio, que é como o `tsconfig.e2e.json`
nasceu, com o `exclude` herdado do `extends` anulando o `include` dele.

Na quinta vez o defeito achou a metade que aquele portão **não** media. A Fase 7
criou `drizzle.config.ts`, e ele caiu fora de dois portões ao mesmo tempo: fora do
bloco type-aware e fora dos seis projetos de `tsconfig`. O `lint-gate` acusou a
primeira metade; a segunda passou, porque o `tsconfig-gate` só andava por
**diretório** e nunca por arquivo da raiz — e esta seção afirmava uma cobertura
que não existia onde o arquivo de configuração mora. Provado plantando `out: 42` e
vendo `yarn typecheck` passar limpo. Hoje os arquivos da raiz entram na medição
pelo disco, como tudo aqui: configuração nova é medida por existir.

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
`commitlint` também existe como job do [`ci.yml`](../.github/workflows/ci.yml).

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
