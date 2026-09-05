# Holo Deck

Deck battler holográfico sobre o dex da PokeAPI: abrir packs, montar um deck de 6
e enfrentar os 9 ginásios. Nuxt 4 + Vue 3, tema escuro-único, dados de jogo
gerados em build-time.

> **Em construção.** Este é o estado da Fase 5 — a Pokédex, o motor de batalha
> (ainda sem tela) e o ciclo de pack e coleção. Deck, Liga, loja e a tela da
> batalha entram na Fase 6. O README completo é reescrito na Fase 8.

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
                 # `yarn preview`, que serve .output/. Se a 3000 estiver ocupada
                 # nesta máquina, use `PORT=3100 yarn test:e2e` — ver abaixo
yarn data:build  # regera o dex; só é preciso quando o pipeline muda — ver abaixo
```

O `reuseExistingServer` do Playwright reaproveita um servidor que já esteja de
pé na porta configurada — e ele confere que **alguém** atende, não **quem**. Um
serviço alheio na 3000 faz a suíte inteira rodar contra ele e reprovar dizendo
que a página não tem os elementos certos, o que é verdade e não é o defeito. Por
isso a porta vem de `process.env.PORT`: o `yarn preview` herda a mesma variável,
e os dois lados não têm como discordar. No CI nada muda — lá o
`reuseExistingServer` já é `false`.

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
branco e o efeito deixa de existir. A especificação visual é o canvas de 18
pranchas aprovado antes da implementação; divergir dele é decisão consciente,
anotada no commit que diverge e listada em [Divergências do
canvas](#divergências-do-canvas).

Tudo mora em [`app/assets/css/main.css`](app/assets/css/main.css), em duas
camadas — que é como o Nuxt UI 4 já se organiza, e a razão de plugarmos nele em
vez de manter um sistema paralelo:

| | |
|---|---|
| **Primitivos** | a escada `ink` de 16 degraus, as 18 cores de tipo, as 5 de raridade, o verde de progresso, os 4 chanfros, o raio e as duas famílias |
| **Semânticos** | superfície e fio: `--bg` `--surface` `--surface-raised` `--surface-sunken` `--surface-cell` `--border` `--border-strong` · texto: `--text` `--text-body` `--text-muted` `--text-faint` · papel: `--accent` `--focus` `--shiny` `--forge` `--deficit` `--progress-high` `--progress-mid` `--progress-low` `--progress-track` |

Dois deles — `--surface-sunken` e `--text-faint` — estão declarados à frente do
consumidor, e o portão de tema reprova qualquer terceiro que apareça: token sem
leitor é receita não verificada, e as duas exceções ficam escritas no teste em
vez de descobertas depois.

Os cinco papéis da última linha entraram na Fase 5, e quatro deles nasceram de o
portão de token ter **recusado** um componente lendo primitivo — ele estava
certo, e a recusa é o que os transformou em nome:

| token | por que tem nome próprio |
|---|---|
| `--color-progress` (`#8BD674`) | o único hex novo da fase. Não é `rarity-uncommon` nem `type-grass`, apesar de os três serem verdes: um diz tier, outro diz elemento, e este diz **quanto do dex já foi capturado** |
| `--shiny` | shiny rola sobre qualquer tier e pinta *por cima* da raridade. Um componente escrevendo `--color-type-ice` afirmaria que shiny é gelo |
| `--forge` | forjar um comum a 20 pó usa o mesmo painel roxo; ler `--color-rarity-ultra` ali afirmaria uma raridade que a tela não está exibindo |
| `--deficit` | é o número que o jogador **não pode pagar**, não um erro. `--error` faria a primeira mensagem de erro de verdade herdar o significado de "junte mais pó" |

Os três degraus de progresso e os cinco papéis entraram também na matriz de
contraste, que hoje cobra `--accent`, `--focus` e os `--text-*` sobre **todas** as
superfícies descobertas no tema.

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

## Divergências do canvas

O canvas é a especificação visual, e divergir dele é decisão do dono do projeto,
não do código. Esta seção é onde as divergências aceitas ficam — antes espalhadas
por comentário de módulo e corpo de commit, o que as tornava impossíveis de
conferir de uma vez.

A varredura de **02/09/2026** comparou as pranchas com o repositório inteiro e é
de onde vem a lista atual. Ela também moveu a maior parte do que achou: o que
está aqui é só o que sobrou de propósito.

### O código diverge, e a prancha continua como está

| divergência | por quê |
|---|---|
| `--radius: 3px` único | as pranchas usam `2px` 104 vezes e `3px` 65, sem papéis diferentes — é variação de mockup desenhado à mão, não decisão |
| `mix-blend-mode` no foil | o plano escreve `background-blend-mode`; o canvas usa `mix-blend-mode`, e é o segundo que renderiza |
| peso 700, não 800 | o canvas usa 800 em rótulo; `@nuxt/fonts` baixa 400 e 700, e um 800 sem face real vira negrito sintético |
| `ink-325` | não aparece em prancha nenhuma. Entrou porque a matriz de contraste pediu um degrau entre o corpo e o texto grande |
| chanfro em 4 degraus | as pranchas usam seis valores; a revisão normalizou nos quatro com papel distinto |
| barras de stat pelo teto do dex | o mockup escala por ~165; 255 é o HP da Blissey, e uma barra acima de 100% da trilha não é uma barra |
| `DexTypeBadge` sem chanfro | nenhuma prancha chanfra o chip de tipo, e a 11px do grid um chanfro de 9px come a última letra de VENENOSO |
| habitat em `--accent` | a prancha *Detalhe* pinta o valor com o verde de planta (`#5FE07A`), que não tem papel no sistema. `--accent` é o semântico que existe para "este valor se destaca" |
| habitat em português | a prancha escreve `ROUGH TERRAIN`, o identificador da PokeAPI. `--accent` faz dele o valor mais destacado do painel, e um documento `lang="pt-BR"` não destaca uma palavra em inglês — é o mesmo argumento que trocou `FLYING` por `VOADOR` nos chips. `HABITAT_LABELS` traduz os 9 |
| marca-d'água em `--text` a 3% | a prancha usa branco a **2,8%**. `color-mix` aceita o fracionário; o 3% é o passo redondo, e a diferença é invisível no papel que a própria prancha dá ao número (identidade, não leitura) |
| marca-d'água em `min(46cqw, 230px)` e `max(-30px, -5%)` | a prancha fixa `230px` e `left:-30px` numa coluna de 560. A página não tem `max-width`, então a coluna vai de 100% do viewport a 5/12 dele — os valores fixos só reproduziriam o desenho em 1440. A conta acompanha a coluna e para nos números da prancha |
| `hero__facts dd` a 20px só acima de 420px de conteúdo na coluna | os 20px são a escala da prancha, medida a 1440. Entre 900 e ~1080 a coluna cai para 310–375px e o bloco de fatos dobra de altura (131px contra 44px) — a escala da prancha aplicada a uma largura que não é a dela |
| barra do rodapé do grid em `--accent` | a prancha usa `#8BD674`, o verde de progresso. Ele ganhou token na Fase 5 (`--progress-high`), e a barra continua em `--accent` de propósito: ela mede **posição de rolagem**, não coleção, e gastar ali o verde que significa "capturado" tornaria as duas leituras indistinguíveis no mesmo grid |
| segundo brilho na carta de dois tipos | o canvas não o desenha, e sem ele `types[1]` chega à carta sem efeito nenhum |
| 18 chips de tipo no filtro | a prancha trunca em 6 + `+12 tipos`; a truncagem cobra um clique por um filtro cujo valor inteiro é ser imediato |
| linha evolutiva em grade de estágios | a prancha desenha uma fila com setas, e **Eevee tem oito filhos no mesmo degrau** |
| condição dentro da carta, não sob a seta | mesma razão: sob a seta, um estágio que ramifica não tem onde pôr oito condições |
| aba *Sobre* aberta, e abas que escondem | a versão aprovada marcava *Stats* na barra e desenhava os quatro blocos juntos — as duas coisas descrevem uma coluna sem abas. Decisão de 02/09: as abas ficam, abrindo em *Sobre*, e a prancha foi corrigida |
| times de ginásio pela regra | a prancha *Liga* desenha Onix como ace do Brock e Noctowl como ativo do Falkner; a regra produz Graveler e não inclui Noctowl. Composição de time é regra de jogo, e o canvas é a especificação **visual** — as duas artes passam a ser ilustrativas |
| barra de progresso em 3 degraus, com só um hex novo | a prancha desenha `#8BD674`, `#58ABF6` e `#B5B9C4`. O médio virou `--accent` e o baixo virou `ink-325` — os dois desenhados são vizinhos de valores que já existem, e inventar dois hexes para a diferença seria pagar em token o que é variação de mockup. Mesmo argumento que normalizou `2px`/`3px` num `--radius` só |
| separador de milhar em toda parte | a prancha escreve `custa 1.600 pó` e `FALTAM 1.260 PÓ`, e `1600` na tabela ao lado — inconsistência do mockup. Vale o separador em todo lugar: duas grafias do mesmo valor na mesma tela é pior que discordar de um canto da prancha |
| `PackOpener` em CSS, sem `motion-v` | o plano nomeia a biblioteca; a cascata é uma propriedade transformada com atraso por índice, o "foil só depois dos 90°" é um passo de keyframe a 50%, e `prefers-reduced-motion` desliga tudo por media query |
| carta não-possuída legível, não silhueta | a prancha anota "anel vazado"; aqui é moldura tracejada mais dessaturação leve. A Pokédex é **referência** antes de ser coleção, e apagar a arte de 900 espécies transformaria a tela numa lista de sombras |

### A prancha estava errada, e foi corrigida em 02/09

| o que dizia | o que vale |
|---|---|
| chips de tipo em inglês (`FIRE`, `FLYING`) nas 17 pranchas | o documento é `lang="pt-BR"` e quem lê a carta lê a frase inteira no mesmo idioma. As 18 pranchas passaram a `FOGO`, `VOADOR` — 75 rótulos |
| *Regras*: "a mediana de BST é 474" | é **450**. O 474 saiu da amostra de 129 do plano; sobre as 1025 do dex gerado a mediana é 450 |
| *Tokens*: "escala ink · 14 degraus" | são **16** — `ink-350` e `ink-325` entraram na Fase 2 |
| *Tokens*: `--text-muted → ink-400`, `--text-faint → ink-500` | `ink-325` e `ink-350`. Os dois originais dão 3,34:1 e 1,94:1 — papéis de texto sobre degraus que não sustentam texto |
| *Tokens*: sem `--surface-cell` | o papel existe (`ink-880`, célula de grid e pé de carta) e a própria anotação da escada já o descrevia |
| *Tokens*: "Sistema visual · game-generations" | o repositório se chama `holo-deck` desde 26/08 |
| *Detalhe*: barras de stat coloridas uma a uma | só o mais alto acende, na cor-luz do tipo — é o que a prancha *A carta* anota e o que o código sempre fez |
| *Pokédex*: célula de grid em 140×172 | a carta é 5:7, que é o que a prancha *A carta* especifica; a 140 de largura isso pede 196 de altura |

### A prancha estava certa, e foi o código que voltou para ela

| o que o código fazia | o que a prancha sempre disse |
|---|---|
| carta do binder com duas alturas — raridade dentro do rodapé da `PokeCard`, botão de moer fora do link e embaixo do artigo | `RARO` e `2 dup · 10 pó` no **mesmo slot**, com os mesmos estilos, numa carta de altura fixa. A issue #24 supunha uma decisão de canvas; não havia nenhuma |

### Decidido na Fase 6, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| `dragon` em `#966BFF`, e não no valor do canvas | é o único dos 18 tipos que reprova AA sobre painel (3,99 em `--surface-raised`). A issue #11 dizia que a Fase 6 decidiria, e ela decidiu **limpar a exceção em vez de carregá-la** — não porque um consumidor tenha chegado (nenhuma tela pinta nome de tipo na cor do tipo), mas porque a alternativa obrigaria o portão a saber em qual superfície cada texto cai, sem traçar a cascata. O preço foram 3 pontos de L; o que se compra é `18 × 5 ≥ AA` sem exceção para consultar |
| *Deck* em stats de Lv50, não em base stat | a prancha escrevia `HP 35` e a *Batalha* `110` para o mesmo Pikachu. O deck é onde se decide quem entra em campo, então ele mostra o que entra; a *Detalhe* segue em base stat, e lá a aba **se chama** *Base stats*. A prancha *Deck* foi corrigida |
| `/deck` sem botão SALVAR | a prancha desenha um, cinza. O save é gravado a cada mutação — um botão que não salva nada é pior que nenhum, e um que salvasse exigiria um estado "não salvo" que o jogo não tem |
| `×2` de efetividade fora da carta do deck | a prancha o põe na linha do número de cada carta; ele está na coluna de cobertura logo abaixo, por tipo, que é onde informa mais — duas cartas do mesmo tipo dão a mesma linha. Na carta ficou o que muda decisão: a faixa `LEVA ×2` |
| chip de resumo em `--accent`, não no amarelo de terrestre | a prancha usa um primitivo de tipo para um aviso, e o portão de token recusa: cor de tipo é preenchimento de tipo. A tela já tem dois níveis — `--deficit` no risco concreto, `--accent` no resumo |

### Decidido no PR da Liga, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| carta de ginásio bloqueado legível | a prancha pinta o nome do líder num degrau de superfície sobre outro degrau de superfície — **1,5:1**, que some. É a mesma classe que a Fase 2 resolveu quando `--text-muted` e `--text-faint` deixaram de apontar para degraus que não sustentam texto. O cadeado e a moldura tracejada já dizem "fechado" |
| barra de HP em dois estados, não em três | a prancha desenha a do adversário em verde e a do jogador em amarelo com frações quase iguais (61% e 58%) — não é limiar, é estética de mockup. O corte aqui é `POTION_HP_THRESHOLD`, a mesma fração em que o líder da faixa B decide gastar a poção: a barra passa a mostrar a regra que o motor executa |
| `TROCAR` deixou de ser botão | a prancha o desenha ao lado de `ITEM`, e um botão `TROCAR` abriria um segundo painel para escolher entre cartas que já estão na tela, no banco, a 30 cm dele. A troca é o clique no próprio banco; `POÇÃO` continua botão porque não tem superfície própria |
| `?` no time do líder | a prancha *Hub* desenha dois sprites e um slot com `?`, mas destaca o **ace** entre os dois visíveis — o `?` é o terceiro membro que o mockup não tinha arte para desenhar, e não um ace escondido. Aqui aparecem os `teamSize` que a regra produz, com o ace destacado |
| `Seu deck: N ajustes` conta as cartas que apanham ×2 | a prancha escreve `1 ajuste` e não define o que conta. Esta é a única leitura que o código já produz — a mesma `coverage.incoming` que o deck builder desenha como faixa `LEVA ×2` na carta, e a que a anotação da prancha *Batalha* descreve ("Machop caiu exatamente como o deck builder avisou") |
| `N ajustes` em `--deficit`, não no amarelo de terrestre | mesmo argumento do chip de resumo do deck builder: a prancha usa um primitivo de tipo para um aviso, e o portão de token recusa |

### Estados sem prancha, escritos neste PR

A regra do projeto é que tela, painel ou estado que o canvas não desenha **ganha
prancha antes de virar código**. Estes cinco não têm, e é preciso saber disso ao
olhá-los: eles foram escritos na linguagem de painel das pranchas vizinhas —
mesmo chanfro, mesmo `eyebrow`, mesmos botões — e nenhum inventa vocabulário
novo. Se o canvas discordar depois, o custo é de estilo, não de estrutura.

| estado | quando aparece |
|---|---|
| **resultado da batalha** | fim de luta: vitória com as parcelas do prêmio, ou derrota dizendo que nada foi perdido |
| **ginásio fechado** | `/battle/N` de um ginásio que a insígnia anterior não abriu |
| **sem time** | menos de seis slots preenchidos |
| **você já está lutando** | uma batalha aberta em **outro** ginásio, com a escolha entre retomar e desistir |
| **o dex não carregou** | falha de rede montando o contexto do motor |

O terceiro e o quarto não são decoração: sem eles a tela ou oferece uma batalha
que o motor recusa, ou apaga o turno 12 de alguém em silêncio.

### Segurado até a fase que cria o dado

Não é divergência — é dado que ainda não existe. Inventar um zero desenha um
progresso que ninguém pode mover.

- ~~**Fase 5:** a contagem `98 / 151 capturados`, o anel de não possuída, o
  marcador de shiny, os filtros *Possuídos* e *Faltando*, e o verde de
  progresso.~~ **Entregue na Fase 5.**
- ~~**Fase 6:** a faixa de retomar batalha no Hub, o saldo de moedas e o painel
  do próximo ginásio.~~ **Entregues no PR da Liga.** Continuam segurados a **barra
  de navegação global** e o **contador do pack diário**: a primeira liga destinos
  que só existem no PR da loja (`/rules`, `/settings`, `/packs` como loja) e o
  segundo depende da economia que chega junto com ela. Até lá a fileira de portas
  do Hub continua, agora com a Liga.
- ~~**A Liga:** contra qual ginásio o `/deck` lê a cobertura.~~ **Entregue.** A
  constante de `useDeck` virou `progress.nextGym`, que foi exatamente a troca de
  uma linha que o comentário dela prometia.
- **Sem dado no dex:** a lista de jogos da geração (`Red · Blue · Yellow`) que a
  prancha *Pokédex* põe no cabeçalho. `GenerationMeta` traz geração, região,
  nome e contagem — o campo teria de nascer no pipeline.

### Em aberto, para quem escrever a fase

- **Sincronização.** O plano fechou *last-write-wins* por `updatedAt`, sem merge.
  A prancha *Sync* diz o contrário, por escrito: o `updatedAt` "nunca é usado
  para resolver conflito", e a regra dos quatro estados é "local com mutação
  pendente vence; local limpo aceita o servidor, sem comparar relógio de
  aparelho". São regras diferentes, e a Fase 8 não pode escolher no meio da
  implementação.

Uma das perguntas desta lista **foi respondida na Fase 5**, e fica registrada
aqui porque o canvas não a respondia sozinho: as barras de progresso por região
aparecem em três cores sempre nas mesmas regiões, o que não distingue *escala de
progresso* de *cor da região*. Decidido: **escala**, com cortes em 50% e 15%,
e a regra mora em `shared/game/progress.ts` para `/rules` poder lê-la.

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
| `core.json`         | matriz de efetividade 18×18, catálogo de golpes — de dano e os 10 de status —, gerações |
| `chains.json`       | as 541 cadeias de evolução já resolvidas em árvore    |
| `gen-N.json`        | as espécies da geração N — o que o grid precisa       |
| `index.json`        | id, slug, nome, geração, tipos, BST e as duas marcas das 1025 — o que a busca global indexa, o que faz `/pokemon/[name]` achar a geração de um slug sem abrir os nove arquivos, e o que dá ao pack e ao binder a raridade de qualquer espécie |
| `flavor-N.json`     | as descrições, **em arquivo separado**: pesam mais que todo o resto do dex junto, e só a página de detalhe as usa |
| `sprites/{id}.webp` | miniatura de 128 px, recortada no alpha               |

Sete coisas que o pipeline decide e que não dá para deduzir lendo a saída:

- **O índice guarda os insumos da raridade, não a raridade.** `bst`,
  `isLegendary` e `isMythical` entraram na Fase 5, porque o pack sorteia sobre as
  1025 de uma vez e o binder conta tier de espécie de qualquer geração — e nenhum
  dos dois pode abrir 319 KB de `gen-N.json` para saber a que faixa pertence um
  id. Guardar `rarity` já calculada poria os limiares num JSON gerado que ninguém
  rebuilda ao mexer neles; a regra continua sendo `rarityFrom()`. Custo medido:
  92 → 141 KB crus, **15,1 → 18,5 KB comprimido**, porque `isLegendary:false`
  repetido 1025 vezes é quase de graça no gzip. O portão de `dex-index.spec.ts`
  confere os campos contra `gen-N.json` **e** o veredito de raridade pelos dois
  caminhos — sem o segundo, uma carta poderia mudar de raridade ao trocar de
  tela sem nenhum dos lados parecer errado no diff.

- **A versão de um moveset vem do campo `order`, nunca do id do version group.**
  `blue-japan` tem id 29 e `scarlet-violet` tem 25 — a PokeAPI cadastrou o
  relançamento japonês de 1996 depois. Ordenar por id dá às 1025 espécies o
  moveset de Game Boy, e o resultado é plausível o bastante para ninguém notar.
- **Menos de 4 golpes por nível completa com máquina e tutor**, do mesmo version
  group. Parar no primeiro método com resultado dava 2 golpes a Clefable,
  Ninetales, Poliwrath e Ludicolo: são evoluções por pedra, o grupo mais recente
  quase não lhes ensina por nível, e o mesmo grupo tem máquina e tutor de sobra.
  Sobram 19 espécies abaixo das 4 vagas — Metapod só sabe Harden, Magikarp só
  Splash e Tackle —, e o build lista as 19 no relatório.
- **Uma das oito vagas é reservada para golpe de status**, e ela é a razão de o
  catálogo ter deixado de ser só de dano na Fase 4. Sem ela nada no dex diz que
  Thunder Wave paralisa, e as quatro condições do motor ficam sem origem — só
  efeitos secundários dariam 36 golpes, alcançariam 383 espécies e deixariam o
  sono com um golpe único. **A vaga não disputa com os de dano**: o moveset de
  dano é escolhido primeiro, exatamente como antes, e a vaga custa a oitava
  posição de quem já a tinha cheia. Rodando o pipeline com e sem a mudança, 716
  espécies ficaram idênticas, 309 perderam só o oitavo golpe, e nenhuma mudou de
  outra forma. Hoje 515 das 1025 levam uma condição, e o desempate entre duas é
  por acurácia — Spore antes de Hypnosis —, nunca por qual condição é melhor.
- **Dez espécies não têm golpe de dano nenhum** e caem em Struggle, como nos
  jogos: Metapod, Kakuna, Abra, Ditto, Wobbuffet, Smeargle, Wynaut, Pyukumuku,
  Cosmog e Cosmoem. A PokeAPI dá `pp: 1` a Struggle por resíduo do dado de 1ª
  geração; o motor de batalha precisa tratá-lo como ilimitado, senão os dez
  atacam uma vez por batalha. Pyukumuku é a única das dez que sai com dois
  golpes: ela não sabe atacar, mas sabe envenenar, e leva Toxic ao lado de
  Struggle.
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

O grid filtra por tipo, por raridade e por **posse**. Tipo e raridade são
cumulativos — **OU** dentro de cada grupo, **E** entre eles. Posse é
**exclusiva**, e isso não é inconsistência: *Possuídos* e *Faltando* particionam
o mesmo conjunto, então ligar os dois é o mesmo que ligar nenhum.

O grupo de posse chegou na Fase 5, que é a que criou a coleção; antes dele um
filtro *Possuídos* que devolve zero sempre não seria um filtro incompleto, seria
um filtro mentiroso. Enquanto o save não carregou, a contagem é `null` e o grupo
inteiro não aparece — `0` afirmaria uma coleção vazia que ninguém verificou.

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

## Pack, coleção e forja

O ciclo da Fase 5: abrir pack → creditar coleção → moer duplicata em pó → forjar
a carta que faltou.

| Rota          | O que é                                                  |
| ------------- | -------------------------------------------------------- |
| `/packs`      | a abertura carta a carta, com as taxas no cabeçalho      |
| `/collection` | o binder: progresso por região, filtros, pó e forja      |

A regra inteira mora em [`shared/game/`](shared/game/), headless como o motor —
100 mil aberturas rodam em ~100 ms sem montar componente nenhum.

| Módulo       | O que decide                                                |
| ------------ | ----------------------------------------------------------- |
| `packs.ts`   | 10 cartas (6/3/1), o slot raro+, o pity e o shiny           |
| `dust.ts`    | pó por duplicata e custo de forja, na razão 4×              |
| `progress.ts`| a fração capturada e o degrau que ela pinta                 |
| `economy.ts` | por enquanto só os packs de boas-vindas; o resto é Fase 6   |
| `deck.ts`    | os seis slots, o que é um deck válido, e a cobertura        |

### Os números, e de onde eles saem

| | |
| --- | --- |
| composição | 6 comuns, 3 incomuns, 1 raro+ |
| slot raro+ | raro 80% · ultra 15% · lendário 4,5% · mítico 0,5% |
| shiny | 1/256 **por carta** — 3,84% por pack, ou um a cada ~26 |
| pity | 10 packs sem ultra+ garantem o próximo |
| forja | 5/15/50/150/400 de pó; custo = pó × 4 |

O pity em 10 saiu de conta, não de gosto. A chance de um pack não trazer ultra+ é
`1 − 0,20 = 0,80`, então uma seca de N packs tem chance `0,8^N`: a 10 ela pega
**uma seca em nove** (10,7%), e a 20 pegaria uma em 87 — rede que quase ninguém
encosta, e uma proteção que não se sente é uma proteção que não existe.

**Cuidado com a unidade:** "1 em 9" é por **ciclo**, não por pack. Medida por
pack a rede dispara em ~2,3%, porque um ciclo dura 4,6 packs em média. Os dois
números descrevem a mesma coisa, e confundi-los faz um portão correto reprovar
código correto — foi o que aconteceu na primeira versão do teste estatístico, e é
por isso que ele hoje mede pesos puros e rede em série em blocos separados.

### Decisões que não se deduzem lendo o código

- **A ordem de revelação é embaralhada.** Os slots são sorteados em blocos, então
  revelar nessa ordem poria o raro+ sempre por último — um tell perfeito, que
  apaga o suspense das nove primeiras cartas. A prancha põe o raro na quarta
  posição de dez, e é isso que o Fisher-Yates reproduz. Tem portão próprio: todos
  os outros testes contam por tier, que é invariante à ordem.
- **Sem repetir espécie dentro do mesmo pack.** Com reposição a colisão é de ~3%
  e não distorce taxa nenhuma, mas a mesma carta duas vezes numa tira de dez lê
  como defeito, não como sorte.
- **Moer consome as normais antes das shiny**, e aceita moer até a última cópia —
  a Fase 6 confirmou que moer uma carta do deck ativo esvazia o slot, e um limite
  aqui contradiria aquela regra. Ver [O deck](#o-deck).
- **Forjar credita a carta antes de debitar o pó**, pela ordem de escrita do
  plano: uma falha no meio dá carta de graça em vez de cobrar sem entregar. A
  carta forjada nunca é shiny — brilho é sorte de pack.
- **O `PackOpener` é CSS, não `motion-v`.** O plano nomeia a biblioteca; o que
  ela faria é uma `@keyframes` de `rotateY` com atraso por índice. O "o foil só
  acende depois dos 90°" da prancha é um passo de keyframe a 50%, e
  `prefers-reduced-motion` desliga tudo por media query.
- **Três packs de boas-vindas**, e eles chegaram uma fase antes do plano. O jogo
  tem um ciclo fechado na partida — carta para deck, deck para ginásio, ginásio
  para moeda, moeda para pack — e sem uma concessão inicial nenhuma porta abre.
  A loja e o pack diário continuam na Fase 6.
- **O binder não virtualiza; ele usa `content-visibility`.** A Pokédex virtualiza
  porque suas fileiras têm altura uniforme, e a carta do binder não tinha: a linha
  `2 dup · 10 pó` deixava uma fileira com repetida ~22px mais alta que uma sem, e
  um `estimateSize` único posicionaria errado a partir da primeira divergência.
  **A altura foi uniformizada na Fase 6** — raridade e linha de moer passaram ao
  mesmo slot do rodapé, que é onde a prancha sempre as desenhou —, então
  virtualizar passou a ser possível. Continua não sendo feito: falta a medição com
  1025 cartas em CPU limitada que a
  [issue #24](https://github.com/adamsalves/holo-deck/issues/24) pede, e sem esse
  número escolher entre os dois é preferência. `content-visibility: auto` cobre o
  custo de renderização, que é o dominante.

## O deck

Seis slots, a leitura de cobertura contra o próximo ginásio, e a regra que liga
os dois à coleção.

| Rota    | O que é                                                       |
| ------- | ------------------------------------------------------------- |
| `/deck` | os seis slots, a cobertura, e a coleção escalável ao lado      |

A regra mora em [`shared/game/deck.ts`](shared/game/deck.ts), headless como o
motor — `place`, `clear`, `remove`, o guarda de forma e `deckCoverage` rodam sem
montar componente nenhum.

### Três decisões que o código não deduz sozinho

- **`null` é um slot vazio, e precisa ser representável.** O plano manda que moer
  uma carta do deck ativo **esvazie o slot** em vez de bloquear a moagem — mais
  gentil que um erro, e a tela já sinaliza slot vazio. Uma lista compacta de ids
  perderia a posição, e as cartas seguintes andariam sozinhas para tapar o buraco.
- **`place` tira a carta de onde ela estava.** Um `place` que só escrevesse no
  destino deixaria a espécie nos dois slots, e o guarda só reprovaria na próxima
  leitura do save — depois de a tela já ter mostrado o deck errado.
- **A cobertura lê o tipo da carta, não os golpes dela.** Quem decide dano é o
  moveset, e `selectBattleMoves` só o resolve na batalha. A aproximação se
  sustenta porque aquela seleção é por cobertura e o STAB puxa para os tipos da
  própria espécie. O que a tela **não** faz é prometer: ela diz "seu time tem
  elétrico, e elétrico bate ×2", que é verdade sobre o time.

### Moer esvazia o slot, por dois caminhos

A regra vale em dois momentos, e eles precisam de mecanismos diferentes:

| quando | quem resolve |
| --- | --- |
| com o jogo aberto | o observador da store do deck sobre a coleção |
| no boot | `deck.hydrate`, que descarta na entrada a espécie que a coleção não tem |

O segundo não é redundante. O observador é `flush: 'pre'` e acorda **no tick
seguinte**: medido síncrono, logo depois de hidratar, o deck ainda segurava a
carta órfã. Pendurar a invariante no agendamento do Vue seria deixá-la quebrar no
dia em que alguém trocasse o `flush` por `'sync'` — e aí o observador rodaria
antes de `hydrate`, que é quando ele não tem nada para ver.

O portão desse caso **não** espera tick, e a ausência do `await nextTick()` nele
é o teste.

## A Liga e a batalha

Nove ginásios em sequência, uma batalha por turnos e a economia que ela paga.

| Rota              | O que é                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `/league`         | a trilha dos nove, o estado de cada um e o painel do próximo        |
| `/battle/[gymId]` | o campo, os quatro golpes, o registro do turno e o banco            |
| `/`               | o Hub: retomar batalha, próximo ginásio e coleção                   |

A regra continua em `shared/game/` — o motor é a Fase 4 e a economia é
[`economy.ts`](shared/game/economy.ts). As telas escolhem a ação, narram o que
voltou e desenham.

### A economia, e os três números que a fase fechou

| Fonte | Valor |
| --- | --- |
| Ginásio, primeira vitória | `200 + 100 × ginásio` — 300 no 1º, 1.100 no 9º, **6.300 na campanha** |
| Ginásio, revanche | **25%** da recompensa |
| Vitória imaculada | **+25%** sobre o que está sendo pago |

**A revanche existe porque sem ela a economia bate num muro.** Depois do nono
ginásio a renda cairia para um pack por dia, para sempre, e completar as 1025 é
projeto de centenas de packs — a campanha viraria uma fração pequena que acaba e
some. A 25% ela mantém a Liga rendendo sem tornar a estreia irrelevante: um ciclo
completo de revanches paga 1.575 contra os 6.300 da campanha.

**O bônus de imaculada não existia em número nenhum** — o plano escreveu "bônus"
e nenhuma prancha o desenha. Decidido em 04/09 na mesma taxa da revanche, e a
igualdade é deliberada: `/rules` explica uma fração só. Ele incide sobre o que
está sendo pago e não sobre o valor cheio, senão uma revanche imaculada valeria
mais que uma estreia normal. Campanha imaculada: 7.875.

**Pack diário e o preço de 150 na loja continuam fora do módulo.** A tabela do
contrato da fase punha `economy.ts` "completo" aqui, e a decisão de 04/09
corrigiu: eles só ganham consumidor com a loja, e constante de economia sem quem
a leia é o que o repositório recusa desde a Fase 0.

### Insígnia é contador, não lista

O desbloqueio é sequencial — cada líder só abre com a insígnia anterior —, então
todo conjunto legítimo de vencidos é um prefixo de 1..9. Uma lista conseguiria
representar `[9]`: insígnia do nono sem ter passado pelo primeiro, estado que o
jogo não produz e que um save editado à mão produz de graça. O contador não tem
como dizer isso.

A trava é cobrada na **store**, e a página da batalha a consulta antes de montar
o campo: `/battle/9` é uma URL, e um botão desabilitado na Liga não estaria lá
para impedir quem a digita.

Com as nove insígnias, `nextGym` continua devolvendo o nono em vez de `null`.
Não há "próximo", e um nulo obrigaria toda tela a tratar um caso que só significa
"você terminou" — inclusive o deck builder, que ficaria sem contra quem ler
cobertura. Quem precisa da diferença lê `leagueComplete`.

### A batalha é o log, e o estado é reproduzido

A store guarda duas coisas que não são a mesma:

| o quê | onde vive | tamanho |
| --- | --- | --- |
| `BattleLog` — seed, versões, time e ações | no save, gravado a cada turno | ~0,2 KB |
| `BattleState` — HP, PP, condição, cursor do RNG | só em memória, reproduzido | — |

O plugin de save roda **antes do mount e não tem dex nenhum**, então `hydrate`
guarda o log cru e quem traz `core.json` chama `resume`. Reconstruir na
hidratação pediria o catálogo mais um `gen-N.json` por geração do time antes da
primeira pintura da tela.

Retomar é o que o Hub faz ao abrir, e é lá que a batalha de uma build anterior é
descartada — `replayable` confere motor e dex antes de reproduzir, e a faixa
simplesmente não aparece. **Descartar é o caminho normal, não o excepcional**, e
é por isso que a pergunta existe em vez de um `try/catch` em volta do `replay`.

O fim da luta **paga antes de apagar o log**, nessa ordem: uma falha entre as
duas linhas deixa o jogador com a recompensa e uma batalha para refazer pelo
valor de revanche, e a ordem inversa apagaria a luta sem pagar por ela. Derrota
não cobra nada — revanche imediata, nada é perdido.

### Seis decisões de tela que o código não deduz sozinho

- **A leitura grande do centro segue o golpe em foco**, e a linha de baixo abre a
  conta tipo a tipo. É o que transforma `×2.0` numa explicação em vez de um
  número.
- **O golpe que não afeta continua clicável.** O motor executa, gasta o turno e
  narra `não afetou`; a interface ensina no ponto de decisão, e desabilitar o
  botão esconderia o `×0` em vez de mostrá-lo.
- **O golpe sem PP também continua clicável**, e pelo mesmo argumento.
  `moveFromSlot` cai em Struggle **por slot**, e não só quando os quatro acabam:
  clicar um slot gasto é jogada válida e o motor a resolve. A carta troca o
  multiplicador pelo aviso `SEM PP · STRUGGLE` e a leitura do centro abre a conta
  de Struggle, porque estampar a do golpe escrito ali seria explicar uma conta
  que não acontece — a mesma mentira que o `×2` sobre Thunder Wave era. Fechar o
  botão seria a saída errada: com os quatro zerados, sem banco vivo e sem poção
  não sobraria ação nenhuma, e o Struggle que o motor mantém para exatamente esse
  caso deixaria de existir para o jogador.
- **Uma batalha descartada cai no caminho de quem chega sem batalha, e ele
  começa pelo deck.** `replayable` recusar o log é o caminho normal — e virou o
  comum, porque `dexVersion` muda a cada rebuild do dex. Descartar não pode
  continuar de onde a retomada parou: o contexto foi montado para o time do
  **log**, e o deck pode ter esvaziado no meio da luta, já que nada trava o deck
  builder durante uma batalha. As duas coisas derrubam `buildSide`, e uma exceção
  num `onMounted` async não é pega por ninguém — a tela ficaria montando o campo
  para sempre, na única rota sem barra de navegação. Por isso `resume` **nunca
  derruba**: as versões ele pergunta, e o que só executando se descobre ele
  captura, com o mesmo destino.
- **A narração caminha pelos eventos mantendo o cursor de cada lado.** Ler o
  ativo depois do turno nomearia o Pokémon errado duas vezes: o motor resolve
  troca antes dos golpes e troca de novo no fim, quando alguém cai. O time nunca
  muda de ordem, então o índice é a referência estável.
- **O sprite animado vem do id, não do repositório.** É a regra que o plano já
  escrevia para a arte oficial; gerar as 1025 animações custaria ~27 MB
  commitados para uma tela que mostra dois Pokémon por vez. Nem todas existem no
  conjunto, e o recuo é a miniatura local de 128 px.

## O save

Um documento só, versionado, em `holodeck:save`.

O plano cita duas formas em seções diferentes — `pinia-plugin-persistedstate` com
uma chave por store, e um `SaveDriver` sobre save único — e elas não se compõem.
Ganhou a segunda, que é a única que sustenta o que vem depois: um `schemaVersion`
cobrindo o save inteiro, uma cadeia de migração que enxerga todas as seções ao
mesmo tempo, e os ~21 KB que a Fase 7 sobe numa requisição só.

```
shared/save/schema.ts        forma, guarda e migração — puro, não sabe que localStorage existe
app/utils/save-driver        LocalStorageDriver: a única camada que toca o navegador
app/plugins/save.client      o único lugar que faz IO de save
app/components/SaveRecoveryNotice.vue  o aviso, que é a outra metade da regra
app/stores/*                 regra e estado; não tocam disco
```

**A regra inegociável é nunca apagar, e ela tem duas metades.** Toda leitura que
dá errado copia o save cru para `holodeck:backup:<instante>` e devolve save limpo
**com motivo** — nunca um `null`, que a tela confundiria com jogador novo. O
instante entra na chave e não no valor: senão a segunda recuperação apagaria a
cópia que a primeira salvou.

A segunda metade é **avisar**. Quem abre a coleção e a encontra vazia não tem
como distinguir "o save estava ilegível e foi guardado" de "o jogo apagou tudo",
e as duas hipóteses levam a ações opostas porque só a primeira tem conserto —
por isso o motivo sobe até `$saveRecovery` e o `SaveRecoveryNotice` o mostra
acima do layout, com o endereço da cópia. Começar limpo em silêncio seria
guardar o backup para ninguém.

Guardar **tudo** que nunca entendemos não é a mesma regra: ficam as três cópias
mais recentes (`MAX_BACKUPS`), podadas pelo instante da chave antes de cada
gravação nova. Uma cota de 5 MB e um save de 21 KB que falhe em todo boot
enchem o armazenamento em algumas centenas de aberturas, derrubando justamente
a gravação do save novo.

O guarda de leitura recusa contagem sem ordem de grandeza — o save é texto num
navegador que o jogador controla, e um `c: 1e15` vira pó infinito na primeira
moagem. Recusar manda o cru para o backup em vez de reescrevê-lo menor em
silêncio; `schemaVersion` fica de fora do teto, porque número alto ali é o caso
normal de quem voltou de uma build nova e tem tratamento próprio.

Foi essa fronteira, escrita antes de haver backend, que faz a Fase 7 custar uma
implementação nova (`HttpDriver`, `SyncDriver`) em vez de uma reescrita —
nenhuma store muda de forma.

## Motor de batalha

Tudo em [`shared/game/`](shared/game/), TypeScript puro, sem uma linha de Vue —
o que faz a suíte do motor rodar sem montar componente nenhum. É a Fase 4, e
quem o consome é `/battle/[gymId]` — ver *A Liga e a batalha*.

| Módulo | O que decide |
| --- | --- |
| `rng.ts` | mulberry32 com seed; estado e seed são o mesmo uint32 |
| `stats.ts` | base stat → stat de Lv50 (IV 31, EV 0, natureza neutra) |
| `damage.ts` | a fórmula da geração V, com a ordem de modificadores fixa |
| `status.ts` | paralisia, queimadura, envenenamento e sono — uma por vez |
| `moveset.ts` | quais 4 dos 8 guardados entram em campo |
| `gyms.ts` | os nove líderes e a regra que monta o time de cada um |
| `ai.ts` | a decisão do líder: gulosa, com ruído que cai a cada ginásio |
| `battle.ts` | estado, ação, evento e `ENGINE_VERSION` |
| `engine.ts` | a máquina de estados, o log de ações e o replay |

**O motor é puro e o `shared/` inteiro é vigiado por
[`test/unit/shared-purity.spec.ts`](test/unit/shared-purity.spec.ts)**: só
import relativo, só para dentro de `shared/`, sempre com `.ts` explícito, e nada
de `Math.random`, `Date.now` ou `performance.now`. As três primeiras regras
existem porque `shared/` viaja para o bundle do cliente **e** para o Node puro
do `yarn data:build`; a última existe porque a batalha é salva como seed mais
lista de ações e reconstruída por replay — um sorteio fora do gerador com seed
não derruba nada, só faz o mesmo log produzir outra luta amanhã.

Oito coisas que o motor decide e que não dá para deduzir lendo o código:

- **A ordem dos modificadores de dano é fixa: crítico, aleatório, STAB,
  efetividade.** `floor` não comuta, e trocar a ordem muda o número na tela. Com
  o Pikachu e o Noctowl da prancha da Batalha, esta ordem produz de 62 a 74 de
  Thunderbolt, e os **68** que a prancha estampa saem do rolo 92.
- **`ENGINE_VERSION` não é a única trava — `dexVersion` é a outra.** A primeira
  cobre a ordem de consumo do RNG; ela não cobre a **entrada** do motor.
  `selectBattleMoves` lê o catálogo de `core.json` e `buildGymTeam` monta o time
  do líder a partir de `gen-N.json`: mudou qualquer um dos dois entre gravar e
  retomar, o mesmo log reproduz outra luta — outro moveset, outro adversário —
  sem erro e sem aviso. O build carimba o dex inteiro num sha-256 truncado em 8,
  o log o carrega, e `replay` o recusa como já recusava a versão do motor. O
  contrato da fase travou "hash de `core.json`" e subestimou o alcance; a decisão
  de 04/09 corrigiu para o dex inteiro, ao mesmo custo. Fecha a issue #18.
- **A ordem de consumo do RNG é o contrato de `ENGINE_VERSION`**: decisão da IA,
  desempate de Speed (só quando empatam), e por golpe — impedimento, acerto,
  crítico, aleatório de dano, chance da condição, turnos de sono. O fim de turno
  não rola nada. Uma rolagem a mais, a menos ou em outra ordem muda toda batalha
  já gravada, e o certo é subir a versão: um log de versão anterior é
  **recusado**, nunca reproduzido torto.
- **As rolagens de crítico e de aleatório acontecem mesmo contra imunidade.**
  Sair antes economizaria dois números e faria o consumo do fluxo depender do
  tipo do defensor — o que transforma um `×0` no meio da luta em divergência de
  replay.
- **O `BattleLog` guarda o time.** O plano descrevia `{ gymId, seed,
  engineVersion, ações[] }`; sem os seis ids, o replay dependeria do deck ativo
  na hora de retomar, e trocar uma carta no meio de um ginásio faria o mesmo log
  produzir outra luta em silêncio.
- **Struggle é sem tipo e sem PP — três exceções, não duas.** A PokeAPI lhe dá
  `pp: 1` por resíduo do dado de primeira geração, e o catálogo o guarda como
  `normal` porque é assim que ela o entrega. Sem elas, as nove espécies que só o
  têm atacariam uma vez por batalha, ganhariam 50% de bônus para isso e — a que
  custou mais caro — **não conseguiriam encostar num Fantasma**: `normal → ghost`
  é zero, e dois lados sem PP numa luta de Fantasma trocavam golpes de dano nulo
  sem a batalha terminar nunca. É por isso que o teste de terminação varre os
  nove ginásios, e não só o primeiro.
- **A troca da faixa C só acontece para um abrigo de verdade.** O líder foge de
  uma matchup de ×2, mas apenas para quem não está na mesma: sem esse filtro ele
  trocava por trocar, 113 vezes por batalha no nono ginásio, e a dificuldade
  **caía** do sétimo ao nono porque ele gastava o turno trocando em vez de
  atacar.
- **Condição respeita imunidade de tipo.** Thunder Wave não paralisa Terrestre e
  Toxic não envenena Aço. O golpe de dano já parava no `×0` da fórmula; o de
  status não passa por ela e precisa da checagem própria.
- **O líder usa o golpe de status enquanto o alvo estiver limpo**, e para quando
  a condição pega. A escolha gulosa nunca o pegaria: dano esperado zero perde de
  qualquer ataque, e a vaga que o pipeline reserva no moveset seria peso morto na
  mão dos nove. Não é "uma vez por batalha" — se Thunder Wave errar, ele tenta de
  novo. As faixas de comportamento são cumulativas pela mesma razão que a regra
  existe: um líder do nono ginásio que não usasse poção seria mais fraco que um
  do quarto.

Os times dos nove saem da regra (mesmo tipo, mesma geração, sob o teto de BST, os
N de maior BST, ace por último) e não de uma lista curada, o que os impede de
divergir do dex em silêncio. **A prancha *Liga* desenha Onix como ace do Brock e
a *Batalha* usa Noctowl como ativo do Falkner; a regra dá Graveler como ace e não
inclui Noctowl.** As duas artes são ilustrativas: composição de time é regra de
jogo, e o canvas é a especificação visual.

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
