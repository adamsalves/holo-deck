# Divergências do canvas

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
| habitat traduzido, não `HABITAT MOUNTAIN` | a prancha *Detalhe* escreve o habitat em inglês e maiúsculas, que é o identificador da PokeAPI. `--accent` faz dele o valor mais destacado do painel, e um documento não destaca uma palavra de outro idioma — o mesmo argumento que trocou `FLYING` por `VOADOR` nos chips. Desde a Fase 8 ele tem **dois** valores (`Montanha` / `Mountain`), resolvidos por `habitatKey` no locale |
| busca no herói do Detalhe | a prancha *Detalhe* não desenha o `Buscar Pokémon ⌘K` no topo da coluna da arte. Estas são 1025 das 1.052 páginas de cada língua e é para cá que a própria busca leva: sem ela, sair da tela só pela trilha, e o `Cmd/Ctrl+K` que o resto da Pokédex promete não responderia justamente onde o jogador passa mais tempo |
| relações de dano completas | a prancha desenha **4** resistências e o Charizard tem **7**. O painel mostra quem foge do neutro, e truncar esconderia relação que decide batalha — o mockup escolheu o número que coube bonito nele |
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
| `PV` na barra e `HP` na prosa, em pt-BR | a prancha *Detalhe* especifica o conjunto de siglas (`PV ATQ DEF ATE DEE VEL`) e só especifica as **barras**. `HP` é a sigla do stat **e** a palavra que o jogo usa para o recurso em jogo: *"perdeu 20 HP"* nas 8 chaves de `battle.log` e *"do HP máximo"* em `/rules` falam da quantidade, não do eixo do gráfico. A barra é o eixo e a prosa é a quantidade — `test/unit/stat-label-gate.spec.ts` guarda as duas, com `HP` como a única exceção nomeada dos dois lados da varredura |

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

### A prancha *Regras* estava errada em três pontos, achados ao escrever a página

| o que dizia | o que vale |
|---|---|
| painel *Pó e forja*: `economy.ts` | a tabela mora em [`dust.ts`](../shared/game/dust.ts). `economy.ts` é moeda; pó e forja são o outro eixo |
| ordem do turno, passo 5: "no zero o golpe fica inselecionável" | o motor cai em **Struggle por slot** — `moveFromSlot` devolve Struggle quando o PP acaba, e o golpe continua clicável. É a mesma regra que o review do PR da Liga corrigiu na carta de golpe, e a prancha ficou para trás |
| *Vitória imaculada*: "bônus" | **+25%**, decidido em 04/09. Quando a prancha foi desenhada o número não existia |

**E a própria ordem dos seis passos diverge do motor em um deles**, achado no review
do PR de `/rules`. A prancha e a tela listam `pp` em quinto, depois de *acerto* e
*dano*; o motor gasta o PP **antes** de rolar a acurácia —
[`engine.ts:222`](../shared/game/engine.ts) contra `:226`. Para o jogador não muda nada
(o PP é gasto errando ou acertando dos dois jeitos), e a lista que a tela desenha é
a da prancha — então ela fica como está, e quem muda é a prancha, se mudar. O que
não pode é o código **afirmar** que a ordem é a do motor: o docblock de
[`app/utils/turn-order.ts`](../app/utils/turn-order.ts) dizia isso e foi corrigido.

**Nada em disco liga essa lista ao motor.** `test/e2e/rules.spec.ts` lê os seis
passos renderizados em ordem, o que mantém a **tela** honesta contra a lista — não
a lista honesta contra `engine.ts`. O primeiro docblock dizia que mantinha, e é a
forma que o `CLAUDE.md` nomeia: asserção que lê a mesma fonte que o código lê.

### A prancha estava certa, e foi o código que voltou para ela

| o que o código fazia | o que a prancha sempre disse |
|---|---|
| carta do binder com duas alturas — raridade dentro do rodapé da `PokeCard`, botão de moer fora do link e embaixo do artigo | `RARO` e `2 dup · 10 pó` no **mesmo slot**, com os mesmos estilos, numa carta de altura fixa. A issue #24 supunha uma decisão de canvas; não havia nenhuma |

### Decidido na Fase 7, contra o que o plano fechava

| divergência | por quê |
|---|---|
| **sem Redis** — sessão e rate limit no Postgres | o plano fechava um `secondaryStorage` escrito à mão sobre `@upstash/redis`, para consolidar sessão e rate limit no mesmo lugar. `secondaryStorage` é opcional (sem ele a sessão mora na tabela `session`, que existiria de qualquer forma) e `rateLimit` aceita `storage: 'database'`. **O argumento era a consolidação, e ele se dissolve quando não há Redis para consolidar** — sobrava escrever um adaptador à mão, porque o helper oficial pressupõe ioredis por TCP, ruim em serverless. O ganho de latência também não existia: `GET` e `PUT /api/save` precisam do Postgres no mesmo request que lê a sessão, então um Redis não evitaria acordar o compute do Neon — só somaria um segundo lugar capaz de estar fora do ar |
| tabela `save_rate_limit` nossa, ao lado da `rate_limit` do `better-auth` | a da biblioteca é gerada por `db:generate:auth` e a forma dela muda quando ela muda. Apoiar regra nossa nela criaria um acoplamento que nenhum portão daqui enxerga — inclusive o dia em que `rateLimit.storage` deixar de ser `'database'` e a tabela parar de ser mantida |
| o corpo que sincroniza é o próprio `SaveData`, com `battle` sempre nula | e não um tipo recortado sem o campo. Assim o mesmo guarda vale nos dois lados, sem uma segunda definição de "save válido" livre para divergir da primeira — o repositório já sabe o que acontece com duas definições da mesma regra |
| `GET /api/save` responde **404**, e não um save vazio | as duas respostas levam a ações opostas no cliente: sem linha, o local vence e sobe; com linha, entra a decisão do primeiro login. Um save vazio com 200 apagaria a diferença justamente no caso em que ela custa uma coleção |
| a entrada da conta é o **canto** da barra, não uma sétima seção | jogar nunca exige conta — o princípio que governa a fileira 4 do canvas. Um link entre *Packs* e *Liga* transformaria a conta em destino do jogo, que é o contrário do que a prancha *Convite* desenha. A prancha já punha o avatar de 32px à direita; o que mudou é que agora ele também é a porta de entrada de quem **não** tem conta |
| o convite aparece uma vez **por aparelho**, e não uma vez por jogador | ele só existe para quem não tem conta, e cada navegador sem conta guarda uma coleção que só ele tem. A marca mora em `holodeck:invite`, chave local fora do save, pela mesma razão de `holodeck:lastWrite`: dentro do save ela subiria junto com a coleção e passaria a valer para o outro aparelho. Um aparelho que **vê** uma sessão também se marca — senão o convite voltaria no dia em que a sessão não pudesse ser lida, dizendo a quem tem conta que a coleção existe só ali |
| o convite é **pedido** em três momentos, e uma regra só decide | a prancha diz "após o primeiro ginásio ou o primeiro ultra": pedem a vitória, no fim da batalha, e a última carta virada de um pack que trouxe ultra ou acima. O terceiro pedido é o do Hub, retroativo, para quem já cumpria antes de o convite existir. Quem confere as quatro travas — sem conta, com carta, uma vez por aparelho, recusável — é o `AccountInvite`, e é por isso que um pedido feito antes de a sessão ser lida espera em vez de se perder |
| a tela *Duas coleções* usa `h2`, não `h1` | a prancha desenha o título como o maior da tela, e ele continua sendo visualmente. Na marcação ele é `h2`: a página por baixo continua montada com o `h1` dela, e dois `h1` na mesma árvore é sumário quebrado para quem navega por cabeçalho |
| no 409, o documento deste aparelho vence **inteiro** — sem reaplicar mudança por mudança | o plano escreve que o cliente "reaplica sua mutação pendente sobre o save que o servidor devolveu", e reaplicar mudança por mudança exige guardar as operações e juntá-las com as do outro aparelho — é merge, que o mesmo parágrafo do plano recusa. O flag de sujo aplicado ao 409 é a regra do boot: local com mutação pendente vence. O custo aceito é o que o outro aparelho gravou no intervalo sair do save vivo, e ele não some: vai para as *Cópias de segurança* deste aparelho antes de ser sobrescrito, e o aviso diz onde. A prancha *Sync* dizia "reaplicamos suas 3 mudanças por cima" e foi corrigida no canvas |
| "N mudanças na fila" conta **gravações**, não operações | o sync sobe o documento inteiro, então não existe fila de operações para contar. O número é quantos documentos diferentes este aparelho gravou desde o último envio aceito, e turno de batalha não entra: ele não muda o documento que sobe |
| restaurar **troca** a versão atual e a anterior, e o servidor guarda o instante da anterior (`previous_updated_at`, migration `0002`) | o plano escreve "volta para `previousData`". Voltar sem trocar perderia a atual, e um restaurar sem querer não teria desfazer; com a troca, restaurar de novo desfaz. O instante é o que deixa a tela escrever "feita há 2 min", que a prancha *Ajustes* pede e a tabela do plano não guardava |
| excluir a conta é o `deleteUser` do `better-auth`, e não uma rota `DELETE /api/account` nossa | o endpoint da biblioteca apaga o usuário e as sessões e limpa o cookie; o save e o contador de escritas vão pelo `onDelete: 'cascade'` do banco, que o plano já previa. O que decide é a trava que vem junto: conta sem senha — todas aqui — só se exclui com sessão de menos de um dia (`freshAge`), então um aparelho esquecido logado não apaga a coleção de ninguém num clique. **O save deste aparelho fica**: excluir a conta não é *Apagar save deste aparelho* |

### Decidido no PR 5 da Fase 8, contra o que o plano fechava

| divergência | por quê |
|---|---|
| **sem `routeRules`**, e sem `ssr: false` nas rotas de jogo | o pré-render que o plano pedia já acontece pelo rastreador. `ssr: false` serviria as ~30 páginas de jogo como o shell é servido — `<html>` sem `lang`, sem `hreflang` e sem a guarda da raiz, que o 4d-2 acabou de pôr lá. O motivo era o offline, e o shell o resolve |
| **service worker nosso**, e não `@vite-pwa/nuxt` | o spike deste PR mediu o módulo (1.1.1, sem release para Nuxt 4): com o padrão, ele instalava os 2.104 `_payload.json` (7,5 MB) e nenhum JS; reescrevia `200.html` como `/200`, que responde 404, e o worker nunca ativava; e custava 1.932 linhas de lockfile e 211 pacotes. O que o jogo precisa é uma lista e três regras |
| **2,1 MB instalados, ~680 KB na rede**, e não "~310 KB" | o número do plano é de antes de o jogo existir. A lista do plano também não tinha o `index.json` (busca e Detalhe), as mensagens de i18n (o shell as busca por rede) nem as fontes. O orçamento é por fonte, em `offline-precache.spec.ts` |

### Decidido no PR 6 da Fase 8, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| **o painel do próximo líder cresce com o conteúdo** (`min-height: 250px`): mede 285,5 px e termina 35,5 px abaixo dos ginásios da fileira (287,5 e 37,5 com o deck vazio) | a prancha *Liga* o desenha na altura das cartas de ginásio, com o mesmo conteúdo, e o conteúdo não cabe: o DESAFIAR termina a 264 px do topo do painel (266 com o deck vazio), em todo viewport, e o padding de baixo vem depois. Na altura fixa, o chanfro cortava os 15 px de baixo do DESAFIAR — fora da vista, do clique e do anel de foco (#74). Crescer é a divergência menor. Decidido em 28/09/2026 com "~15 px"; medido no review, são 35,5, e a decisão foi mantida em 29/09 |

### Decidido no PR 5 da Fase 8, além do que a prancha desenhava

| decisão | por quê |
|---|---|
| **o herói cai na miniatura também com rede, e sem chip** | a prancha *Offline* desenha o recuo do herói como *sem rede*, com o chip `sem rede · mostrando a miniatura`. A arte oficial também falha com rede — o host fora do ar, ou bloqueado na rede de quem joga —, e ali o chip seria mentira. O recuo vale sempre; o chip, só enquanto `navigator.onLine` é falso, que acerta quando diz *offline* e pode errar quando diz *online*. Quando a rede volta, ele some e a arte é pedida de novo, como o próprio chip promete. Decidido em 25/09/2026, no 5b-2 |

### Decidido no PR 5 da Fase 8, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| **o recuo do herói na caixa da arte, até 340 px, e não na zona de 400** | a prancha *Offline* desenha o recuo numa zona de `height:400px`. A arte do Detalhe ocupa até 340 px, e é ela que diverge da prancha *Detalhe* (400×380, na #72). O recuo mora na caixa que a arte ocupava para a página abaixo não pular quando a arte falha; numa zona de 400, o número e o nome desceriam 60 px |
| **a miniatura do recuo sem sombra** | a prancha dá a ela `drop-shadow(0 30px 50px rgba(0,0,0,.7))`, a mesma que a prancha *Detalhe* dá à arte, e que o código também não tem (#72). As duas entram juntas, ou o recuo teria a sombra que a arte não tem |
| **o chip quebra linha no telefone** | o `.chip` da prancha tem `white-space:nowrap`. A 320 px a coluna tem 256 px, e o chip do glifo em inglês (*offline · the artwork arrives with the connection*) mede ~310: sem quebra, ele sairia da coluna. Quebra em duas linhas a 320 e 360 px, dentro da caixa |

### Decidido na Fase 7, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| o estado 03 do indicador cobre **toda fila que não subiu**, e não só a falta de rede | a prancha o chama de *offline*, e o chip escreve `N mudanças na fila` também quando o servidor responde 5xx ou quando o teto de 60 escritas por hora fecha. Para quem joga, "sem rede" e "o servidor não aceitou agora" levam à mesma ação — nenhuma —, e o jogo não muda em nada nos dois casos. O que difere é **quando** a fila sobe: no evento `online` ela sobe sozinha, e nos outros dois ela espera a próxima jogada, a aba sair de vista ou o próximo boot |

### Decidido na Fase 6, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| `dragon` em `#966BFF`, e não no valor do canvas | é o único dos 18 tipos que reprova AA sobre painel (3,99 em `--surface-raised`). A issue #11 dizia que a Fase 6 decidiria, e ela decidiu **limpar a exceção em vez de carregá-la** — não porque um consumidor tenha chegado (nenhuma tela pinta nome de tipo na cor do tipo), mas porque a alternativa obrigaria o portão a saber em qual superfície cada texto cai, sem traçar a cascata. O preço foram 3 pontos de L; o que se compra é `18 × 5 ≥ AA` sem exceção para consultar |
| *Deck* em stats de Lv50, não em base stat | a prancha escrevia `HP 35` e a *Batalha* `110` para o mesmo Pikachu. O deck é onde se decide quem entra em campo, então ele mostra o que entra; a *Detalhe* segue em base stat, e lá a aba **se chama** *Base stats*. A prancha *Deck* foi corrigida |
| `/deck` sem botão SALVAR | a prancha desenha um, cinza. O save é gravado a cada mutação — um botão que não salva nada é pior que nenhum, e um que salvasse exigiria um estado "não salvo" que o jogo não tem |
| `×2` de efetividade só nos tiles da lista da prancha, e em tile nenhum do código | na v22 da prancha *Deck* o `×2` saiu da carta do deck e ficou nos tiles da lista da direita. O código não o desenha em nenhum dos dois: a efetividade está na coluna de cobertura, por tipo, que é onde informa mais — duas cartas do mesmo tipo dão a mesma linha —, e na carta do deck ficou o que muda decisão, a faixa `LEVA ×2`. Os tiles da lista seguem sem ele |
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

### Decidido no PR da loja, contra o que a prancha desenhava

| divergência | por quê |
|---|---|
| a loja tem **três** cartões, e não dois | os packs de boas-vindas existem desde a Fase 5 e precisam de onde ser abertos. Virá-los o primeiro da fileira os põe no mesmo padrão de desaparecimento que a prancha já dá ao diário; a alternativa — a loja só aparecer depois deles — esconderia saldo e preço de quem está começando |
| sublinhado ativo em `--accent` em toda página | a prancha *Hub* o desenha azul e a *Loja* roxo, para o mesmo papel. É variação de mockup desenhado à mão, como o `2px`/`3px` que a Fase 2 normalizou num `--radius` só |
| ~~sem o avatar de 32px no canto da barra~~ | **Entregue na Fase 7**, e com um papel a mais do que a prancha desenhava: sem sessão, o mesmo canto é o link *Entrar*. Ver a linha correspondente em *Decidido na Fase 7* |
| ~~`/settings` sem o painel de offline — e sem os de conta, idioma e som~~ | **Entregue no 5b da Fase 8:** *Baixar tudo para offline* é a última linha de *Preferências*, nos quatro estados da prancha *Offline* (ver *Offline*), e o painel *Ainda não*, que o nomeava enquanto não havia prancha, saiu com ele. Os outros três já tinham saído: a conta entrou na Fase 7, o idioma no 4d-2 da Fase 8, e o som deixou de estar na prancha na versão 16, quando a fase o aposentou |
| apagar o save guarda uma cópia | a prancha põe *apagar local* na zona de perigo e não diz o que sobra. Sem conta não existe segunda cópia em lugar nenhum, e a regra inegociável do plano existe para a coleção de meses não depender de um clique não ter sido acidental. A tela avisa que a cópia fica |

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

**A lista tem sete, não cinco**, e a diferença virou a
[issue #29](https://github.com/adamsalves/holo-deck/issues/29): faltavam `loading`
("Montando o campo…", sem nenhuma saída) e `unknown-gym`. O primeiro é o que mais
importa — foi nele que o defeito crítico do review estacionava o jogador para
sempre.

O PR da loja acrescentou **mais um**, pelo mesmo mecanismo:

| estado | quando aparece |
| --- | --- |
| **pack diário indisponível** | o cartão do Hub e o da loja depois de o diário sair no dia |

O canvas só desenha o cartão em `Disponível agora`. Sumir com ele deixaria um
buraco na grade de duas colunas do Hub, então ele fica com o contador regressivo
e um caminho para a loja — que é o que a prancha *Loja* faz na mesma situação.

### Segurado até a fase que cria o dado

Não é divergência — é dado que ainda não existe. Inventar um zero desenha um
progresso que ninguém pode mover.

- ~~**Fase 5:** a contagem `98 / 151 capturados`, o anel de não possuída, o
  marcador de shiny, os filtros *Possuídos* e *Faltando*, e o verde de
  progresso.~~ **Entregue na Fase 5.**
- ~~**Fase 6:** a faixa de retomar batalha no Hub, o saldo de moedas e o painel
  do próximo ginásio.~~ **Entregues no PR da Liga.**
- ~~**A barra de navegação global e o cartão do pack diário.**~~ **Entregues no PR
  da loja**, que é o que criou os destinos da primeira (`/rules`, `/settings`,
  `/packs` como loja) e a economia do segundo. Com eles saíram a barra própria do
  Hub e a fileira provisória de portas.
- ~~**Fase 7, e o que `/settings` deixa de fora por causa dela:** o painel de
  conta, o estado de sincronização e *restaurar a gravação anterior do
  servidor*.~~ **Entregues no PR 2 da fase.** O painel de conta traz o e-mail, o
  estado do sync e *SAIR*; *Restaurar versão anterior* aparece quando o servidor
  tem uma, com o instante e a contagem de cartas dela, e espera a fila subir antes
  de trocar; a zona de perigo ganhou *Excluir conta e save do servidor*. O painel
  *Ainda não* ficou com três coisas, e as três são da Fase 8.
- ~~**Sem prancha para os estados:** *baixar tudo para offline*.~~ **Entregue no 5b
  da Fase 8**, nos quatro estados que a prancha *Offline* desenhou no ciclo de canvas
  antes dele. ~~O seletor de **idioma**~~ **entregue no 4d-2**, na primeira linha de
  *Preferências*, onde a prancha *Ajustes* o desenha; ~~o interruptor de
  **som**~~ **aposentado** em 12/09 — a prancha deixou de desenhá-lo na versão 16.
- ~~**A Liga:** contra qual ginásio o `/deck` lê a cobertura.~~ **Entregue.** A
  constante de `useDeck` virou `progress.nextGym`, que foi exatamente a troca de
  uma linha que o comentário dela prometia.
- **Sem dado no dex:** a lista de jogos da geração (`Red · Blue · Yellow`) que a
  prancha *Pokédex* põe no cabeçalho. `GenerationMeta` traz geração, região,
  nome e contagem — o campo teria de nascer no pipeline.

### Em aberto, para quem escrever a fase

- **A permissão de giroscópio no iOS.** `requestTiltPermission()` existe desde a
  Fase 2 e só a `/styleguide` a chama; sem ela, a inclinação do foil não funciona
  em iPhone nenhum. A prancha *Ajustes* não desenha o controle, e `/settings`
  respeitou isso — decidir onde ele mora é decisão de canvas, não de código.
Uma das perguntas desta lista **foi respondida na Fase 5**, e fica registrada
aqui porque o canvas não a respondia sozinho: as barras de progresso por região
aparecem em três cores sempre nas mesmas regiões, o que não distingue *escala de
progresso* de *cor da região*. Decidido: **escala**, com cortes em 50% e 15%,
e a regra mora em `shared/game/progress.ts` para `/rules` poder lê-la.

Outra **nunca foi pergunta**, e fica registrada pelo mesmo motivo. Esta lista
dizia que o plano fechava *last-write-wins* por `updatedAt` e que a prancha
*Sync* dizia o contrário. O plano fecha o **flag de sujo** — *local com mutação
pendente vence; local limpo aceita o servidor* —, pela mesma razão que a prancha
escreve: comparar relógio entre aparelhos faz um celular com a data errada ganhar
sempre. Quem punha os dois em lados opostos era este README, e a Fase 7
implementou a regra que os dois já diziam.
