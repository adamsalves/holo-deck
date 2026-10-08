# Sistema de design

Tema **Holo TCG**, escuro-único. Não é limitação: o foil holográfico depende de
`mix-blend-mode: color-dodge`, que clareia — sobre fundo claro ele estoura em
branco e o efeito deixa de existir. A especificação visual é o canvas de 18
pranchas aprovado antes da implementação; divergir dele é decisão consciente,
anotada no commit que diverge e listada em [Divergências do
canvas](canvas-divergences.md).

Tudo mora em [`app/assets/css/main.css`](../app/assets/css/main.css), em duas
camadas — que é como o Nuxt UI 4 já se organiza, e a razão de plugarmos nele em
vez de manter um sistema paralelo:

| | |
|---|---|
| **Primitivos** | a escada `ink` de 16 degraus, as 18 cores de tipo, as 5 de raridade, o verde de progresso, os 4 chanfros, o raio e as duas famílias |
| **Semânticos** | superfície e fio: `--bg` `--surface` `--surface-raised` `--surface-sunken` `--surface-cell` `--border` `--border-strong` · texto: `--text` `--text-body` `--text-muted` `--text-faint` · papel: `--accent` `--focus` `--shiny` `--forge` `--deficit` `--progress-high` `--progress-mid` `--progress-low` `--progress-track` `--coin` `--hp` `--synced` `--caution` `--conflict` |

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

A Fase 6 acrescentou `--coin`, `--hp` e `--brand` pelo mesmo caminho — o `--brand`, miolo
vermelho do emblema da barra, saiu na Fase 8, quando o ícone do app virou a marca —, e a Fase 7
os três do sync ao vivo: `--synced` (o verde do *sincronizado há 2 min*),
`--caution` (o amarelo que a prancha dá à fila offline, ao *SÓ NESTE APARELHO* e ao
*Restaurar versão anterior* — isto não está no servidor, ou vai substituir o que
está) e `--conflict` (o roxo do único estado que fala com o jogador). Os cinco que
seguem no tema estão na matriz de contraste e na linha dos semânticos acima.

**Regra dura: componente consome semântico. Nunca primitivo, nunca hex cru.** As
pranchas do canvas usam hex inline porque são mockup, e copiar da prancha para o
componente copia o hex junto — por isso a regra é cobrada por
[`test/unit/token-gate.spec.ts`](../test/unit/token-gate.spec.ts), que reprova hex,
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
até do piso de texto grande. [`test/unit/theme.spec.ts`](../test/unit/theme.spec.ts)
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

**Foil** ([`app/composables/useFoil.ts`](../app/composables/useFoil.ts)) só de raro
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
existe para isso, e **o único lugar que a chama continua sendo a `/styleguide`**.

`/settings` chegou na Fase 6 e **não** ganhou essa linha: a prancha *Ajustes* não
desenha nenhum controle de giroscópio, e a regra do projeto é que estado sem
prancha ganha desenho antes de virar código. A consequência é concreta e vale
saber: **num iPhone, a inclinação do foil não funciona fora da `/styleguide`**.
Está em aberto — ver *Em aberto, para quem escrever a fase*.

**Texto em português.** Os identificadores são em inglês e o documento é
`lang="pt-BR"` — um `{{ rarity }}` cru põe COMMON na carta e faz o leitor de tela
ler o enum no meio de uma frase em português. Desde a Fase 8 o vocabulário do
jogo mora em `i18n/locales/`: `rarityKey()` e `typeKey()`, em
[`shared/types/game.ts`](../shared/types/game.ts), devolvem **a chave**
(`rarity.common`, `type.electric`), e quem chama `t()` é sempre a tela —
`shared/` não fala idioma nenhum, e a chave não é texto.

**O vocabulário que `shared/` ainda carrega.** A
[issue #38](https://github.com/adamsalves/holo-deck/issues/38) lista seis mapas.
A medição achou **dez** produtores de texto de tela, e é a lista de dez que vale:

| produtor | o que escreve | quando sai |
| --- | --- | --- |
| `rarityKey` / `typeKey` | `Comum`, `Elétrico` | **entregue** |
| `REGION_LABELS` | `Kanto` — nome próprio, igual nos dois idiomas | **fica**, e é exceção nomeada do portão |
| `HABITAT_LABELS` → `habitatKey` | `Caverna`, `Ermo` | **entregue** |
| `AILMENT_LABELS` → `ailmentKey` | `paralisia` | **entregue** |
| `CONDITION_LABELS` → `conditionKey` | `PAR`, `QUE`, `ENV`, `SON` | **entregue** |
| `generationLabel` → `generationNumeral` | `Geração IV` | **entregue** |
| `shared/game/evolution.ts` | 43 condições (`Subir de nível`, `de dia`) | **entregue** |
| `gameNumber` / `gamePercent` (`shared/game/progress.ts`) | `1.600`, `0,4%` | [issue #49](https://github.com/adamsalves/holo-deck/issues/49) |

As três primeiras `entregue` saíram no PR das telas de batalha, e as duas do
meio pela mesma troca: a função devolve o **endereço** e quem resolve o `t()` é a
tela. `generationLabel` foi a exceção — dele sobrou só o algarismo, porque a
estrutura de regiões viaja num payload de pré-render sem locale dentro e não pode
carregar a palavra. `CONDITION_LABELS` mudou de arquivo junto: `status.ts` guarda
a regra, `game.ts` guarda o texto que o jogo inventa.

**`REGION_LABELS` é o único que fica, e os nove nomes de líder são a razão.**
`Kanto` e `Brock` são a mesma classe de palavra — nome próprio, idêntico nos dois
idiomas —, e `GYM_LEADERS` carrega nove deles dois arquivos adiante. Mandar as
regiões para o locale escreveria dezoito traduções iguais para calar um portão, ou
então deixaria o elenco do jogo aqui sem nada vigiando. As duas listas são
**exceção nomeada** de [`test/unit/shared-text-gate.spec.ts`](../test/unit/shared-text-gate.spec.ts),
montada a partir dos próprios valores: uma décima região é exceção no dia em que
for escrita.

Os dois últimos são os que a issue não via, e são de outra classe: eles não
escrevem palavra nenhuma — escrevem **número com o separador de `pt-BR` fixo**,
por `toLocaleString('pt-BR')`. Em `/en` a tabela de forja já sai `1.600` e o
shiny `0,4%`, que um leitor de inglês lê como 1,6 e 0,4. O erro não é de idioma,
é de **valor lido errado**, e é justamente por isso que uma varredura por palavra
não o encontra. O docblock de `gameNumber` justifica o locale fixo dizendo que o
número está no meio de uma frase em português — a premissa deixou de valer no dia
em que existiu uma frase em inglês.

Consequência para o plano: o portão de "`shared/` sem texto de tela" **não pode
fechar verde antes do PR do Detalhe**, que é quem leva os últimos. Escrito antes,
ele nasceria vermelho — e portão que nasce vermelho é o que a própria issue recusa.

**Número** usa o utilitário `numeric`, que traz `JetBrains Mono` e
`tabular-nums` juntos. Separados, o modo de errar é escrever metade — e aí um HP
caindo de 110 para 99 empurra o texto ao lado a cada quadro.

Rodando `yarn dev`, **`/styleguide`** é o espelho de tudo isso: a escada, os
papéis, os chanfros, os 18 tipos e as 6 raridades em carta. Ela **lê o
`main.css`** pelo mesmo analisador que o portão usa
([`shared/color/tokens.ts`](../shared/color/tokens.ts)) e calcula as razões de
contraste em runtime — um espelho que repete valores à mão é um espelho que pode
mentir. Existe só em desenvolvimento: o módulo em linha do `nuxt.config.ts` a
remove do build.
