# Holo Deck

Deck battler holográfico sobre o dex da PokeAPI: abrir packs, montar um deck de 6
e enfrentar os 9 ginásios. Nuxt 4 + Vue 3, tema escuro-único, dados de jogo
gerados em build-time.

> **Em construção.** Este é o estado da Fase 3 — a Pokédex. Packs, coleção, deck
> e batalha entram a partir da Fase 4. O README completo é reescrito na Fase 8.

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
[`tsconfig.tools.json`](tsconfig.tools.json). Os testes de ponta a ponta ganharam
um sexto projeto, o [`tsconfig.e2e.json`](tsconfig.e2e.json): o corpo de
`page.evaluate` roda **dentro** do navegador e precisa da lib `dom`, que nenhum
outro projeto da suíte deve ter. Os dois são referenciados pelo `tsconfig.json`
da raiz.

Ao criar uma pasta nova de TypeScript, o `include` de um desses projetos, o glob
type-aware do [`eslint.config.mjs`](eslint.config.mjs) e os aliases do Vitest
precisam concordar — quando discordam, um portão passa e o outro não.

O glob type-aware cobre `app/` desde a Fase 1 e os `.vue` desde a Fase 2. Ele
existe para a família `no-unsafe-*`, que é o que impede `any` de entrar por
`JSON.parse` e `$fetch`. Na Fase 1 foi `app/` que ficou de fora ao ganhar a
primeira fronteira de dados, em `useDex()`; na Fase 2 foi o bloco `<script
setup>`, bem quando o repositório se encheu de componente. Nos dois casos o mesmo
código dava três erros num arquivo e passava limpo no outro.

O padrão se repetiu três vezes, então virou teste:
[`test/unit/lint-gate.spec.ts`](test/unit/lint-gate.spec.ts) anda pelo disco e
reprova se existir arquivo capaz de carregar TypeScript fora do alcance do bloco
— sem precisar saber de antemão que pasta ou extensão alguém inventou.

Na quarta vez o defeito mudou de portão: a Fase 3 criou `test/e2e/` e ela nasceu
fora de todos os projetos de `tsconfig`, com o sintoma apontando para o código
(`Cannot find name 'document'`, e o ESLint recusando o arquivo inteiro) em vez de
para a configuração. Isso também virou teste:
[`test/unit/tsconfig-gate.spec.ts`](test/unit/tsconfig-gate.spec.ts) pergunta ao
**próprio TypeScript** quais arquivos cada projeto cobre e reprova se algum ficar
de fora — ou se algum projeto ficar vazio, que é como o `tsconfig.e2e.json`
nasceu, com o `exclude` herdado do `extends` anulando o `include` dele.

## Sistema de design

Tema **Holo TCG**, escuro-único. Não é limitação: o foil holográfico depende de
`mix-blend-mode: color-dodge`, que clareia — sobre fundo claro ele estoura em
branco e o efeito deixa de existir. A especificação visual é o canvas de 17
pranchas aprovado antes da implementação; divergir dele é decisão consciente e
está anotada no commit que diverge.

Tudo mora em [`app/assets/css/main.css`](app/assets/css/main.css), em duas
camadas — que é como o Nuxt UI 4 já se organiza, e a razão de plugarmos nele em
vez de manter um sistema paralelo:

| | |
|---|---|
| **Primitivos** | a escada `ink` de 16 degraus, as 18 cores de tipo, as 5 de raridade, os 4 chanfros, o raio e as duas famílias |
| **Semânticos** | `--bg` `--surface` `--surface-raised` `--surface-sunken` `--surface-cell` `--border` `--border-strong` `--text` `--text-body` `--text-muted` `--text-faint` |

Dois deles — `--surface-sunken` e `--text-faint` — estão declarados à frente do
consumidor, e o portão de tema reprova qualquer terceiro que apareça: token sem
leitor é receita não verificada, e as duas exceções ficam escritas no teste em
vez de descobertas depois.

**Regra dura: componente consome semântico. Nunca primitivo, nunca hex cru.** As
pranchas do canvas usam hex inline porque são mockup, e copiar da prancha para o
componente copia o hex junto — por isso a regra é cobrada por
[`test/unit/token-gate.spec.ts`](test/unit/token-gate.spec.ts), que reprova hex,
`rgb()`/`oklch()`, primitivo de qualquer das três famílias, a paleta de fábrica
do Tailwind (`bg-slate-800` é mais fácil de escrever que `bg-muted`) e nome de
token montado por interpolação, que escapa de todas as outras regras.

Os semânticos ficam **fora** de `@theme` de propósito: ali gerariam um
`bg-surface` paralelo ao `bg-muted` do Nuxt UI — dois jeitos de dizer a mesma
coisa. Fora dele, ficam em `:root` sem camada, e regra sem camada ganha do
`@layer theme` onde o Nuxt UI declara os dele. O vocabulário que os componentes
escrevem é o dele, já carregando os nossos valores: `bg-default` `bg-muted`
`bg-elevated`, `text-highlighted` `text-default` `text-muted` `text-dimmed`,
`border-default` `border-accented`.

`--ui-radius` está nessa lista, e é a linha que faz o raio existir: o Nuxt UI
reencaixa a escala inteira do Tailwind na dele (`--radius-sm: var(--ui-radius)`,
`--radius-md: calc(var(--ui-radius) * 1.5)`), então todo `rounded-*` de
componente deriva dela e não de `--radius`. Sem o mapeamento, a decisão de 3px
fica declarada e inerte enquanto todo `UButton` continua no raio de fábrica.

**Contraste, e contra qual fundo.** Um texto não tem uma razão de contraste — tem
uma por superfície em que pode cair, e a que decide é sempre a da superfície mais
clara. Este sistema tem cinco, e a mais clara é `--surface-raised`: os pares
abaixo são (sobre `--bg` / sobre ela).

| papel | razão | piso |
|---|---|---|
| `--text` | 17,19 / 14,62 | AA |
| `--text-body` | 7,57 / 6,43 | AA |
| `--text-muted` | 6,07 / 5,16 | AA |
| `--text-faint` | 4,73 / 4,02 | AA em texto grande |

Dois degraus entraram na escada por causa disso. `ink-350` pagou a dívida da Fase
0 — o plano apontava `--text-muted` para `ink-400` (3,34) e `--text-faint` para
`ink-500` (1,94), papéis de texto sobre degraus que não sustentam texto. E
`ink-325` pagou a dívida que a própria Fase 2 criou: escolher os quatro degraus
contra `--bg` valia enquanto existia um fundo só, e foi esta fase que declarou
cinco. Sobre a carta, `--text-muted` caía a 4,02 e `--text-faint` a 2,84 — abaixo
até do piso de texto grande. [`test/unit/theme.spec.ts`](test/unit/theme.spec.ts)
descobre as superfícies no próprio tema e cobra a matriz inteira, para a próxima
superfície entrar na conta sem ninguém lembrar de acrescentá-la.

A cor de tipo é preenchimento, não texto: ela vive sob o texto na etiqueta
(`--type` no fundo, `--bg` por cima) e como brilho atrás da arte. O portão cobra
esse par, e registra por escrito o que o sistema **não** garante — `dragon` dá
3,99 sobre `--surface-raised`, então tipo colorido como texto dentro de painel é
decisão que a Fase 4 ainda tem de tomar.

**Tipo e raridade são variáveis de escopo, não regras por papel.** `[data-type]`
publica `--type` e `[data-rarity]` publica `--rarity`, `--rarity-label` e
`--foil`; badge, brilho, barra e moldura derivam com `color-mix()`. Trocar a
identidade de um tipo é uma linha. O escopo aninha, e é isso que dá conta de uma
espécie de dois tipos sem token novo: cada brilho da carta publica o próprio
`--type`. `--rarity-label` é separado de `--rarity` porque `common` é `ink-500`,
que serve de fio e não sustenta texto.

**Foil** ([`app/composables/useFoil.ts`](app/composables/useFoil.ts)) só de raro
para cima — a regra mora em `shared/types/game.ts`, headless, porque a
consequência é de custo. Ela está escrita duas vezes, em TypeScript e em
`--foil-strength`, e o portão de tema cobra que as duas concordem.

Uma carta não interativa não instala listener nenhum, e as 1025 do grid dividem
**uma** assinatura de `prefers-reduced-motion` — `usePreferredReducedMotion` é
`useMediaQuery` por baixo e o VueUse não o memoiza, então sem
`createSharedComposable` cada carta abriria a sua. O teste conta as duas coisas,
inclusive a da media query, que é onde a versão anterior era cega.

O repouso do composable é o mesmo gradiente estático que o CSS já desenha, então
a carta do grid mostra o foil sem rodar JavaScript. `prefers-reduced-motion`
desliga o rastreio na origem, não a animação no fim — e o foil continua visível
como gradiente estático, porque a raridade nunca é comunicada só por brilho: a
etiqueta textual está sempre lá.

O foil mede a **moldura** da carta, não a carta: `getBoundingClientRect()`
devolve a caixa já transformada, e medir o elemento que a gente mesmo inclina
realimenta a leitura com a saída dela.

Em aparelho sem ponteiro, o giroscópio faz o papel do cursor. No iOS 13+ ele
exige `DeviceOrientationEvent.requestPermission()` dentro de um gesto do usuário
— sem isso nenhum evento chega e nenhum erro é lançado. `requestTiltPermission()`
existe para isso; a tela de Ajustes da Fase 6 é quem vai chamá-la em produção, e
até lá o botão está na `/styleguide`.

**Texto em português.** Os identificadores são em inglês e o documento é
`lang="pt-BR"` — um `{{ rarity }}` cru põe COMMON na carta e faz o leitor de tela
ler o enum no meio de uma frase em português. `RARITY_LABELS` e `TYPE_LABELS`, em
`shared/types/game.ts`, são o que o jogador lê.

**Número** usa o utilitário `numeric`, que traz `JetBrains Mono` e
`tabular-nums` juntos. Separados, o modo de errar é escrever metade — e aí um HP
caindo de 110 para 99 empurra o texto ao lado a cada quadro.

Rodando `yarn dev`, **`/styleguide`** é o espelho de tudo isso: a escada, os
papéis, os chanfros, os 18 tipos e as 6 raridades em carta. Ela **lê o
`main.css`** pelo mesmo analisador que o portão usa
([`shared/color/tokens.ts`](shared/color/tokens.ts)) e calcula as razões de
contraste em runtime — um espelho que repete valores à mão é um espelho que pode
mentir. Existe só em desenvolvimento: o módulo em linha do `nuxt.config.ts` a
remove do build.

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
| `index.json`        | id, slug, nome, geração e tipos das 1025 — o que a busca global indexa e o que faz `/pokemon/[name]` achar a geração de um slug sem abrir os nove arquivos |
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

## Pokédex

Referência completa das 1025 espécies — **não** coleção. Elas aparecem todas,
possuídas ou não; quem cuida de posse, duplicata e pó é a `/collection`, que
chega na Fase 5.

| Rota               | O que é                                                   |
| ------------------ | --------------------------------------------------------- |
| `/pokedex`         | as 9 gerações como cartas de região                       |
| `/pokedex/[gen]`   | o grid da região, virtualizado                            |
| `/pokemon/[name]`  | a espécie: Sobre, base stats, relações de dano e evolução |

Busca global em `Cmd/Ctrl+K`, em qualquer uma das três. Ela indexa nome, número e
tipo — dá para procurar por `venenoso` ou por `0150` — e só baixa o `index.json`
quando abre pela primeira vez.

O grid filtra por tipo e por raridade: **OU** dentro de cada grupo, **E** entre
os dois. A prancha desenha um terceiro grupo — *Possuídos* e *Faltando* — que não
está aqui: posse é coleção, e coleção é Fase 5. Um filtro *Possuídos* que devolve
zero sempre não seria um filtro incompleto, seria um filtro mentiroso.

Quatro decisões desta fase que não se deduzem lendo o código:

- **O grid existe em duas formas.** O servidor renderiza as 151 cartas inteiras;
  o cliente monta a versão virtualizada por cima. Não é redundância: o HTML
  servido é a única coisa que linka as 1025 páginas de detalhe, e são elas que
  carregam o SEO. Um HTML pré-renderizado com as 18 cartas visíveis deixaria 133
  páginas de Kanto sem nenhuma referência apontando para elas. A troca é feita
  pelo `<ClientOnly>`, que garante que o HTML servido e o primeiro render do
  cliente sejam o mesmo. **E ela custa uma hidratação inteira**: o `ClientOnly`
  mostra o fallback enquanto `mounted` é `false`, e ele só vira `true` no
  `onMounted` — na hidratação, quem está montado é a forma completa. As 151
  cartas são hidratadas e descartadas um tick depois. O preço dos 151 links é
  esse, e é real.
- **O SSR lê o dex do `serverAssets`; o navegador busca por HTTP.** Em servidor
  o `$fetch` relativo não sai pela rede — ele chama o app h3 por dentro, e asset
  público não é rota do h3: o caminho cai no renderizador de páginas e volta o
  HTML de 404. A leitura em servidor passa pelo `serverAssets` do Nitro, que
  embarca `public/data/` junto do servidor.

  **Isso é correção de um defeito de produção.** A primeira versão montava
  `join(process.cwd(), 'public' | '.output/public', …)`, e esses dois caminhos só
  são a raiz do projeto no build e no `yarn preview`. Num deploy serverless o
  `cwd` é a raiz da função e o dex não está lá — no preset da Vercel ele vai
  inteiro para `.vercel/output/static/` e a função não recebe cópia nenhuma.
  Como toda rota válida é pré-renderizada, a única classe de URL que chega ao
  servidor é a inválida, que é justamente quando o índice precisa ser lido para
  responder 404: `/pokemon/<slug inexistente>` respondia **500, com o caminho
  absoluto do servidor na linha de status e no corpo**. O e2e que provava o 404
  não pegava porque roda contra `yarn preview` a partir da raiz do repositório —
  o único `cwd` em que o código quebrado funcionava. Agora quem prova é
  [`test/e2e/server-runtime.spec.ts`](test/e2e/server-runtime.spec.ts), que sobe
  o servidor construído de um diretório temporário.
- **Tudo é pré-renderizado — 1036 páginas, ~18 s de build.** `crawlLinks` parte
  de `/pokedex`, alcança as nove regiões e, de cada grid, as 1025 espécies. As
  três abas do detalhe são montadas mesmo fechadas (`unmount-on-hide` desligado):
  sem isso o HTML sai com a descrição e **sem** base stats, relações de dano e
  linha evolutiva, que é o conteúdo pelo qual a página seria encontrada.
- **A arte oficial do herói é um `<img>` cru, não `<NuxtImg>`.** O plano pedia
  `@nuxt/image`; com o otimizador no caminho, pré-renderizar as 1025 páginas vira
  1025 downloads de `raw.githubusercontent.com` durante o build — testado, e o
  GitHub derruba a conexão no meio. Trocar uma dependência de rede em runtime por
  uma em tempo de build é pior: ela quebra o deploy.

A raridade (`shared/game/rarity.ts`) e a matriz de tipos
(`shared/game/typechart.ts`) estavam marcadas para as fases 4 e 5 e chegaram
aqui, porque a Pokédex as exibe e nenhuma das duas depende de coleção. Os
limiares saem do percentil sobre as 1025, não do chute: com os originais do plano
a distribuição saía invertida, com *raro* virando o maior tier do jogo.

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
