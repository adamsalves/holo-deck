# Acessibilidade

### Estrutura de página

**Toda página tem um `<main>`, e um `<h1>` dentro dele.** É por ali que quem usa
leitor de tela chega ao conteúdo e sabe onde está. Medido em 26/09/2026 contra a
`main`, `/deck`, `/league` e a batalha não tinham `<main>`, e duas telas não
tinham `<h1>`: o Hub, e a batalha **durante a luta** — os quatro `<h1>` dela
moravam nas saídas de erro. O Lighthouse, rodado no Hub, no deck e na batalha,
acusou os dois `<main>` e nenhum dos cabeçalhos. Nada disso muda pixel: a troca de
tag foi conferida por screenshot contra a `main`, byte a byte, a 1280 e a 390 px.

| tela | o `<h1>` | por quê |
|---|---|---|
| Hub | **oculto** (`sr-only`), com o nome que a barra dá à tela: *Base* | a prancha *Hub* não desenha título — abre direto na faixa de retomar —, e um título visível mudaria a tela mais desenhada do canvas. Decidido em 26/09/2026 (#31, metade 1) |
| batalha | a faixa do topo: ginásio, líder, região e tipo | é a identidade que a prancha *Batalha* já desenha. Cada saída de erro mantém o seu, porque nelas a faixa não existe |

**A exceção é a tela de erro.** O 404 ainda é a página padrão do Nuxt: sem
`<main>`, com o código no `<h1>` e sem `lang`. Ela aparece em qualquer rota
inexistente, inclusive `/pokedex/99` e um `/pokemon/` com nome errado. Não mora em
`app/pages`, então o portão abaixo não a alcança; trocá-la pede prancha, e está na
#63.

O registro de turnos é uma região viva (`role="log"`, nomeada pelo rótulo *Registro
do turno*): o turno é lido quando entra, e não só quando alguém vai procurar. O
`role` mora num `<div>` em volta da lista, porque `log` não é papel permitido em
`<ol>`. **Cada entrada tem chave própria, e não o número do turno**: a troca forçada
não avança o turno, e com a chave repetida o Vue voltava a inserir na região, a
cada turno, linhas que já tinham sido lidas. Medido numa derrota semeada, o
registro de seis linhas chegou a 21, e 15 delas sobraram na revanche.

[`test/e2e/page-structure.spec.ts`](../test/e2e/page-structure.spec.ts) abre toda
página de `app/pages` — a lista sai do disco, com uma amostra por parâmetro de
rota — nos dois idiomas, e cobra um `<main>`, um `<h1>`, e o `<h1>` dentro do
`<main>`. Duas barreiras, as duas medidas: o save semeado tem time, senão a batalha
cai numa saída — que sempre teve `<h1>` — e o portão fica verde sem medir a luta
(medido: 2 de 2 verdes com o defeito); e a contagem espera a rede aquietar, senão
um segundo `<h1>` desenhado dentro de `<ClientOnly>` passa (13 de 20 verdes sem a
espera, 0 de 20 com ela). O `league.spec.ts` lê o registro pela região viva, no
nome de cada idioma, e joga essa derrota até o fim, uma batalha salva com semente
fixa, cobrando que cada ação ponha na região exatamente uma linha nova.

### O anel de foco

Um anel só, para todo controle, como o bloco *Foco* da prancha *Tokens* o desenha:
2 px de `--focus`, **3 px de folga**, com o corte do próprio controle — chanfro onde
há chanfro, raio onde há raio. A folga é o que separa o anel azul de um controle
azul, como o DESAFIAR da Nessa e a moldura da carta rara. E **foco não é hover**: o
foco é o repouso mais o anel. As 19 regras de hover que também respondiam a
`:focus-visible` — clarear o cheio, acender a borda, trocar a cor do rótulo, em 11
arquivos — passaram a responder só ao ponteiro.

Medido em 26/09/2026, 13 das 288 paradas de Tab de 12 rotas não mudavam um pixel
sob foco, com o estilo computado dizendo `2px solid`. As duas causas estão no
recorte da pintura: o `clip-path` do chanfro come o `outline`, e o
`content-visibility` dos `<li>` do binder e da lista de escalar traz
`contain: paint`, que cortava o anel da carta. Onde o anel mora agora:

| controle | o anel |
|---|---|
| sem chanfro | a regra base de `main.css`, em `@layer base`, para as regras dos componentes e os utilitários do Nuxt UI ficarem acima dela. Ela nomeia `a:focus-visible` porque a base do Nuxt UI zera o `outline-offset` dos links na mesma camada, com um seletor mais específico |
| chanfrado (`bevel-*`) | o próprio utilitário: no foco, o `clip-path` deixa passar a faixa de 3 a 5 px, e um `::after` a pinta. Sombra não serve — a diagonal do anel passa por dentro da caixa de borda, onde sombra externa não pinta. Em cores forçadas o `::after` guarda uma cor própria, a `Highlight` do sistema (`forced-color-adjust: none`): o navegador repinta todo fundo com a cor da página, e o anel ia junto |
| a forma é de outro elemento: o link que cobre a carta de ginásio, o `<input>` de 1 px do IMPORTAR | `data-focus-parent`, e o pai chanfrado desenha o anel. A carta de ginásio perdeu o `overflow: hidden`, que cortava o anel; o chanfro já corta o que ela pinta |
| carta (`PokeCard`) | um `::after` na moldura, com o polígono da própria prancha, e a mesma cor própria em cores forçadas |
| abas do Detalhe (`UTabs`) | a prop `ui`: o anel do Nuxt UI mede 1,51:1, e os utilitários dele ganham da regra base |
| lista com `content-visibility` | 5 px de folga dentro do `<li>`, devolvidos pela margem |

[`test/e2e/focus-ring.spec.ts`](../test/e2e/focus-ring.spec.ts) anda com o Tab por
toda página de `app/pages`, abre cada aba — o painel de uma aba inativa só se
alcança pelas setas — e fotografa cada parada duas vezes, com foco e sem. Mede
pixel, nunca estilo computado: um portão de estilo passaria nas 13. Cobra o anel de
3 a 5 px em cada lado e no meio de cada corte, a folga e o lado de fora iguais ao
repouso, e o **interior** igual ao repouso, que é onde o hover no foco aparece. As
quatro formas de desenhar o anel — regra base, chanfro, pai e moldura — são cobradas
pelo nome. Só o link de pular pode se mover sob foco; qualquer outro controle que se
mova reprova, porque um hover que também levanta o controle escaparia da comparação.

Anda também pelos estados que o save de nenhuma página desenha: o Hub com uma luta
em curso, a Liga com o deck por montar, um ginásio com outra luta aberta, a forja
com uma busca, a paleta de busca, o convite e uma conta; e a coleção abre com
duplicatas. **Toda classe que uma regra `:hover` de `app/` estiliza, lida do disco,
precisa ter sido medida numa parada.** Sem isso, 7 das 19 regras de hover que o anel
tirou do foco moravam em estados que o portão não abria, e devolver três delas ao
foco o deixava verde (medido no review do PR #77).

E anda três vezes. Em cores forçadas, o alto contraste do Windows: ali a cor é a do
sistema de quem joga, e o anel é o que o foco mudou de 3 a 5 px; o interior não é
cobrado, porque o próprio Chromium repinta em `Highlight` o fio de todo `<button>`
focado — medido num botão nu, com `outline: none` inclusive. Antes do conserto, o
DESAFIAR da Liga mudava 100 pixels sob foco ali, contra 3.815 sem cores forçadas, e
nenhum deles era anel. E num celular, a 360 px, o que a largura muda: a faixa de
chips da Pokédex, que rola de lado e cujo padding de 2 px cortava o anel em cima e
embaixo, e o painel de retomar luta do Hub, cujo `overflow: hidden` cortava o anel
das ações quando elas quebram linha e encostam na borda. Ali o portão cobra o anel
presente e a folga e o lado de fora iguais ao repouso. Onde o anel fica e o interior
são o mesmo CSS em toda largura e são medidos a 1280: no celular, uma posição
fracionária empurrava o anel pintado do botão de moer até 0,88 px para fora, e o ×
de um slot do deck sai rasterizado diferente quando o anel da carta passa por cima
dele. Medido de novo no 6b-2, lendo também as bordas e o interior a 360 px, com o
botão de moer e o × de 24 px: o botão de moer passa, e o × do primeiro slot ainda
muda 16 pixels sob o anel da carta. A leitura a 360 px segue como está.

Cada defeito foi reintroduzido e reprovou com a sua mensagem: o chanfro sem o anel,
as abas com o anel do Nuxt UI, os links sem o `a:`, a carta com o retângulo que a
prancha recusou (reprova só nos cortes), a lista sem folga, o `overflow` da carta
de ginásio, o IMPORTAR sem a marca, a #74, a folga de 2 px, o hover no foco — num
preenchimento e numa borda de 1 px —, e o anel pintado sem cor própria em cores
forçadas. A borda passou verde duas vezes antes de
reprovar, e cada vez ensinou uma coisa ao portão: a cadeia de evolução mora numa aba
inativa, que o Tab não alcança; e o menor hover do sistema, `--border` para
`--border-strong`, move 9 por canal, abaixo da tolerância de 24 que o anel pede.
Dentro do controle, foco e repouso são o mesmo render — o ruído medido é 1 —, e a
tolerância ali é 4. No review, mais catorze num build só, cada um reprovando com a sua
mensagem: o hover no foco em sete controles que só aparecem com estado, um hover que
também move o controle, a folha do convite com anel, a sugestão da forja sem
`z-index`, o Fechar da paleta com o anel do Nuxt UI, a faixa de chips com 2 px, o
painel do Hub com `overflow: hidden`, e uma regra de hover numa classe que nenhuma
caminhada foca. O menor hover real mudou 231 pixels dentro do controle.

**O que ele não alcança:** o que só abre no meio de um fluxo ou diante de um
conflito — a tela *Duas coleções*, os avisos de save e de conflito, a abertura de
pack, a troca forçada e o fim da batalha. As regras de foco desses controles foram
alinhadas lendo o código; o review do PR #77 mediu cada um uma vez, com o mesmo
`measure()`, menos o aviso de conflito. (O **foco** desses controles é outro
assunto, e o censo de [`keyboard-focus.spec.ts`](../test/e2e/keyboard-focus.spec.ts)
o cobra: a abertura de pack, a troca forçada e o fim da batalha entram nele; o
anel, não.) E o campo da paleta de busca segue com o `focus:outline-none` do Nuxt
UI: é a única exceção, e o portão a cobra pelo nome, como cobra a folha do
convite, que recebe o foco para ser lida e não é parada do Tab — nas duas, nenhum
anel. A barra do topo, que no celular mede 217 px e cobria o controle focado
(#78), deixou de ser assunto deste portão: a página tem o seu `scroll-padding-top`,
a altura medida da barra, e a passada a 360 px mede o real em vez de emular.

### Foco depois de uma ação

**O controle que o jogador acabou de usar não leva o foco embora.** Um botão que
sai da página, ou vira `disabled`, por causa da própria ação deixava o foco no
`<body>`, e o Tab seguinte recomeçava do topo do documento. Medido em 29/09/2026
apertando Enter em 214 paradas: 22 faziam isso — as seis do deck e da batalha, e
mais oito tipos de controle que ninguém tinha listado: a última poção, a revanche,
moer, ABRIR e COMPRAR, DESISTIR no Hub e na batalha, a sugestão da forja e o
convite. Lendo o código saíram mais duas, fora do censo: o PULAR da loja, que some
quando a virada termina, e o FORJAR, que fica `disabled` quando o pó acaba.

Uma regra só, em [`app/utils/focus.ts`](../app/utils/focus.ts) (`keepFocus`): depois
de a tela alcançar a ação, se o controle que tinha o foco saiu ou ficou
`disabled`, o foco vai para o alvo da transição — e para o `#content` quando não há
alvo. **Só se o teclado estava no controle**, que é `:focus-visible`, e não "ele
tinha o foco". A primeira versão perguntava a segunda coisa, pensando no Safari,
onde o clique não foca botão. No Chromium e no Firefox o clique foca: o helper agia
para todo mouse e todo dedo, e o `focus()` levava a rolagem junto — um clique no
último pick de uma lista longa ia de 5091 px ao topo da página (na `main`, 146 px,
da lista fechando), e o `×` da única carta, a 360 px, descia a página 863 px.
Medido em 01/10/2026, no review do PR #82. Quem aperta com ponteiro fica com o
foco e a rolagem onde o navegador os deixou.

**E uma tecla aperta um controle só.** A tecla que apertou ainda está baixa quando
o foco chega ao controle seguinte, e tecla segurada se repete: Enter num botão o
aperta a cada repetição. Enquanto o foco caía no `<body>` não havia nada sob a
tecla; com alvo, a repetição o apertava. Medido com Enter segurado 0,8 s: numa
sugestão da forja, dez FORJAR (400 de pó viraram 200); em COMPRAR, 1.200 moedas; no
`×` de um slot, o deck esvaziado e escalado de novo. Um toque de 80 ms fazia uma
coisa só, e por isso nenhuma caminhada viu. Quem move o foco (`moveFocus`) segura
as repetições da tecla até ela subir (`swallowRepeats`): o helper, o convite ao
devolver o foco, e a paleta de busca ao abrir e ao fechar — onde o Enter segurado
no gatilho escolhia o primeiro resultado, já na `main`.

| onde | o foco vai para |
|---|---|
| batalha, depois de golpe, troca, poção, revanche ou DESISTIR E COMEÇAR ESTA | pela fase que a ação deixou: o primeiro golpe; o primeiro pill habilitado, na troca forçada; LUTAR ou TENTAR DE NOVO, no fim |
| ESCALAR | o próximo ESCALAR (o anterior, se era o último); o campo de busca, se a busca não deixa mais nenhum; com o time completo, o link da carta que entrou |
| `×` do slot | o `×` do próximo slot ocupado, o do anterior, ou o primeiro ESCALAR (o campo de busca, se a busca não deixa nenhum) |
| DESISTIR, no Hub | a ação do painel do próximo líder: DESAFIAR, ou montar o deck |
| sugestão da forja | FORJAR, se o pó chega; senão o campo de busca |
| FORJAR que gasta o último pó | o campo de busca |
| moer duplicatas | o link da própria carta; no filtro *Duplicadas*, onde a carta sai da lista com o botão, o moer da carta seguinte (o da anterior, se era a última), e o `#content` quando não sobra nenhuma |
| ABRIR, COMPRAR, ABRIR O PRÓXIMO, PULAR e o fim da virada | a ação primária da abertura (`packs__skip--primary`) |
| VOLTAR À LOJA | o botão que abriu, ou o `#content` se ele sumiu |
| convite fechado (Agora não, Escape) | quem tinha o foco; o `#content` se era o `<body>` ou saiu da tela |

O `focused = 0` saiu de `play()` e de `again()`: o destaque acompanha o foco
(`@focus`), e Enter no terceiro golpe deixa o terceiro aceso — antes, o foco ficava
no terceiro e o primeiro é que acendia. Sem ninguém para voltá-lo, o destaque de
uma carta com menos golpes que a anterior apontava para fora da lista e nenhum
golpe acendia: ele cai no primeiro (`lit`), como a leitura do centro já caía. O
deck ganhou uma região `role="status"`, só falada, com três frases por idioma, que
o soltar de uma carta num slot também escreve; o `×` do slot passou a 24 px a 4 px do
canto, como a v22 desenha; e três nomes deixaram de dizer outra coisa que a tela:
o link do slot, que cravava `slot N` e `' e '` e no `/en` dizia *Grass e Poison*
(agora é do locale, com os tipos unidos por `Intl.ListFormat`); ESCALAR, que passa
a conter o número que desenha (*Escalar #0002 Ivysaur*, WCAG 2.5.3); e moer, que
começa pelo texto visível e ganhou alvo de 24 px (WCAG 2.5.8) sem mexer no
repouso: a `/collection` sai idêntica byte a byte contra a `main`, a 1280 (1x e
2x) e a 360, nos dois idiomas. `<NuxtRouteAnnouncer />` anuncia o título da página
nova a cada troca de rota, e o `AppNav` mede o `header.nav` e escreve
`--nav-height`, que o `main.css` lê em `scroll-padding-top`: 66 px a 1280, 83 a 768
e 217 a 360.

[`test/e2e/keyboard-focus.spec.ts`](../test/e2e/keyboard-focus.spec.ts) segura isso de
cinco lados. O **censo** aperta Enter em um botão de cada tipo, em cada estado, num
contexto novo, e mantém a tecla baixa. Cobra que o foco não termine no `<body>`,
desconectado ou `disabled` — nem no `#content`, que é para onde ele vai quando o
alvo não o pega: um seletor de alvo quebrado caía ali e passava, e quem termina ali
por desenho está nomeado com o motivo (`ENDS_ON_THE_CONTENT`). E cobra que a
repetição da tecla não aperte um segundo controle. Os estados são os de `sceneList`
(as páginas, os estados que nenhum save desenha e os fundos: um golpe de cada fase
da luta, a abertura do pack virando e revelada, o deck com vaga, a forja com o pó
exato): toda cena tem de apertar alguma coisa, menos as nomeadas como sem botão
(`PRESSES_NOTHING`), e as que apertam botão de biblioteca — as abas do Detalhe, o
Fechar da paleta — são comparadas pelo nome (`FROM_A_LIBRARY`). Os tipos vêm do
disco ([`test/support/buttons.ts`](../test/support/buttons.ts)): todo `<button>` de
`app/` foi apertado, ou está nomeado com o motivo. Os **alvos** de toda linha da
tabela acima são cobrados pelo nome, porque fora do `<body>` é só o piso — inclusive
o `×` do meio, o único caso em que a ordem "próximo, depois anterior" aparece. O
**ponteiro** cobra a outra metade da regra: um clique de verdade, que foca o botão,
não move o foco nem a rolagem, e o `click()` de um script, que não foca, também
não. O **anunciador** cobra o título da página nova depois de cada navegação — o
endereço primeiro, depois a região dizendo outra coisa que antes — e em todo
layout que o disco tem, porque a batalha é desenhada fora do padrão. E a **barra**
cobra, a 360 px e com Shift+Tab, que nenhuma parada fique inteira sob ela. Uma cena
abre com o cliente já de posse da página (`isHydrating`), porque um Enter antes
disso não roda handler e o portão passaria sobre um defeito que não chegou a
acontecer.

Os nomes acessíveis do `/en` são de
[`accessible-names.spec.ts`](../test/e2e/accessible-names.spec.ts), que faz duas
perguntas a cada `aria-label` e `alt`: se ele soletra um rótulo do outro idioma, e
se tem palavra que nem o locale da página nem os dados do jogo escrevem. A segunda
pega o que a primeira não vê — mensagem com valor interpolado e palavra digitada no
componente, que não está em locale nenhum. `Notifications (F8)`, a região de avisos
que o Nuxt UI desenha em toda página, é o único nome fora disso: é da biblioteca,
está nomeado com o motivo, e segue em inglês também no pt-BR, que nenhuma varredura
lê. Um pick e a linha de moer contêm o que desenham (2.5.3) nos dois idiomas.

Contra a `main`, o censo acha 26 perdas em 49 paradas; na árvore consertada,
nenhuma. Com um worker, o arquivo leva 3,5 min (o censo, 2,1). Cada defeito foi reintroduzido e
reprovou com a sua mensagem: a chamada do helper tirada do Hub, um `<button>` novo
num estado sem cena, o anunciador fora, o `scroll-padding` fora, o `focused = 0` de
volta, o `' e '` de volta, a guarda do convite que o impede de tomar o foco em toda
carga de página — que a comparação de pixels do binder achou primeiro —, e o helper
mexendo no foco de quem não o tinha. No review, mais dezoito em três builds,
agrupados de modo que nenhum par pudesse dar a mesma mensagem: a tecla sem ninguém
a segurando (18 paradas do censo, cada uma com o controle que a repetição apertou)
e o mesmo na paleta; a guarda de volta a "tinha o foco" (`scrolled: 863`); o
destaque lendo `focused`; o alvo do Hub e o do moer com o seletor quebrado (`left
the focus on the content`); o ramo do convite invertido; a ordem do `×` trocada; o
moer sem a carta seguinte e a lista vazia sem o campo de busca; o soltar sem
status; o campo de busca tomando o foco na carga (`Received: "input"`, onde o
`className` devolvia vazio); o anunciador movido para o layout e o anunciador
fora; *líder de ginásio* digitado no nome de um ginásio; `dups` no nome em inglês
do moer; uma página sem o seu único botão; e o Detalhe sem as abas.

**O que ele não alcança:**

- `SaveRecoveryNotice`, `SyncConflictNotice`, `SaveChoice` e o restaurar da versão
  anterior das Ajustes: nenhuma cena os desenha (pedem um save ilegível, um 409, duas
  coleções, uma conta com versão anterior), e o botão de cada um sai da página como
  os outros. Estão em `NO_SCENE`, com o motivo. **Não foram consertados nesta fase.**
- BAIXAR, em Ajustes, divide as classes com EXPORTAR, e a linha nem existe sem o
  service worker, que o e2e bloqueia. Pelo template, o clique troca o botão pelo
  indicador de progresso, e o foco deve cair no `<body>`: não foi medido, e o censo
  não vê. IMPORTAR é um `<label>`, e não entra: o censo é de `<button>`.
- A identidade de um tipo é a classe: dois botões com as mesmas classes são um
  tipo só, e apertar um vale pelos dois (EXPORTAR e BAIXAR; SAIR e restaurar uma
  cópia). O censo prova o tipo, não cada `<button>` do código.
- A batalha não tem `#content` (`layout: false`): o convite fechado depois de uma
  vitória, que abre por cima do golpe que já saiu da tela, deixa o foco no `<body>`.
- O Safari é medido só pelo `click()` de um script, que roda o handler e não move o
  foco, como o clique dele. O motor não é o do Safari, e o clique que foca o botão
  é medido só no Chromium.
- **Quem aciona por toque com leitor de tela deixou de ter o foco conduzido** onde
  o clique foca o botão. `:focus-visible` separa teclado de ponteiro, e um toque é
  ponteiro; antes, o helper agia para ele por engano. Decisão do review do PR #82,
  e nenhum leitor de tela foi medido, antes ou depois.
- Um alvo errado que aceita o foco só é pego onde um teste o nomeia. O censo separa
  o alvo que não pegou (`#content`) do que pegou, não o certo do errado.
- A repetição da tecla é medida em botão. O convite devolve o foco pelo mesmo
  `moveFocus`, mas o teste dele devolve a um link, e o Chromium não aciona link na
  repetição: devolver a um botão com a tecla segurada não foi medido.
- O `after` do helper passou a ser esperado também para quem clica, e isso não tem
  portão: hoje nada depois dele depende disso.
