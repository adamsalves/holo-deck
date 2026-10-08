# Primeira carga

O que uma tela declara antes de poder rodar — o script de entrada, os `modulepreload`
dos chunks que ele puxa e as folhas de estilo — é o custo que nenhum jogador evita, e
até o PR 7a nada na suíte o pesava. Esta seção guarda o que foi medido em 06/10/2026
(a `0fa2e03` antes, o PR depois) e o que passou a vigiar cada número.

### O teto de cada tela

[`test/e2e/first-load-budget.spec.ts`](../test/e2e/first-load-budget.spec.ts) lê o HTML que
o build escreveu em `.output/public`, para cada página de `app/pages` nos dois idiomas,
e soma o que ele declara em bytes **crus**
([`test/support/first-load.ts`](../test/support/first-load.ts)): `script type=module` e
`modulepreload` para o JS; `stylesheet` e o que vem dentro do próprio HTML, em `<style>`,
para o CSS. Crus e não comprimidos, porque quem escolhe a codificação é o host, e um
teto que andasse com ela mediria a CDN. O gêmeo `/en` pesa o mesmo que a página em
português, então cada tela tem **um par de tetos, pelo nome**, com JS e CSS separados:
um teto sobre a soma é sustentado por quem ainda cabe, e o CSS dobraria com o JS ainda
folgado.

**O CSS dentro do HTML conta.** O Nuxt escreve em `<style>` o CSS `scoped` dos
componentes que o servidor renderizou, ao lado das variáveis de cor do Nuxt UI: de 21 a
28 KB por página, e é ali que mora a maior parte do CSS do próprio jogo — as folhas são,
quase inteiras, o tema da biblioteca e a folha global. O medidor nasceu lendo só
`<link rel="stylesheet">`, e o review mostrou o buraco: 42 KB plantados no
`<style scoped>` de `/settings` deixavam o teto verde. As mesmas regras chegam de novo
em arquivo quando os chunks da página carregam, sem o HTML declarar; aqui contam uma
vez.

| tela               | JS antes → agora  | teto de JS | CSS antes → agora | teto de CSS |
| ------------------ | ----------------- | ---------- | ----------------- | ----------- |
| `/`                | 628.759 → 630.324 | 661.000    | 265.464 → 150.557 | 159.000     |
| `/battle/1`        | 628.927 → 630.480 | 661.000    | 264.813 → 149.906 | 158.000     |
| `/collection`      | 633.544 → 635.109 | 666.000    | 267.467 → 152.560 | 161.000     |
| `/deck`            | 632.872 → 634.437 | 665.000    | 266.921 → 152.014 | 160.000     |
| `/league`          | 625.019 → 626.584 | 657.000    | 265.884 → 150.977 | 159.000     |
| `/login`           | 619.191 → 620.756 | 651.000    | 261.054 → 146.147 | 154.000     |
| `/packs`           | 632.428 → 633.993 | 665.000    | 271.223 → 156.316 | 165.000     |
| `/pokedex`         | 754.715 → 756.280 | 793.000    | 261.783 → 146.876 | 155.000     |
| `/pokedex/1`       | 766.217 → 767.782 | 805.000    | 270.085 → 155.178 | 163.000     |
| `/pokemon/pikachu` | 792.720 → 794.285 | 833.000    | 268.866 → 153.959 | 162.000     |
| `/rules`           | 628.191 → 629.756 | 660.000    | 264.107 → 149.200 | 157.000     |
| `/settings`        | 634.124 → 635.689 | 666.000    | 267.057 → 152.150 | 160.000     |

O teto de JS é o medido na `0fa2e03` mais 5%; o de CSS, o medido depois da detecção de
componentes (abaixo), também mais 5%, ambos arredondados para cima no KB. O JS de hoje
é o de antes mais ~1,5 KB dos ícones e 12 bytes do `prefetch`: o PR não o emagrece.

O que o portão cobra além do teto: página de `app/pages` sem teto reprova, e teto de
página que não existe também, os dois por nome e como conjuntos; cada página tem JS,
folha de estilo e CSS inline contados (> 0), cada origem pelo nome, senão o teto
passaria qualquer coisa — um piso sobre a soma do CSS seria sustentado pela origem que
ainda fosse lida; e um endereço declarado que não é arquivo do build, um script de
terceiros por exemplo, é acusado em vez de descartado. **Subir um teto é decisão, escrita no PR que engordou a página**; descer é
no PR que a emagreceu. O portão só tem teto, de propósito, e um teto longe da página
não mede nada. O medidor tem o seu teste, sobre um documento escrito para a pergunta:
com os `modulepreload` ignorados o orçamento seguia verde, e só ele reprovava.

### O tema do Nuxt UI, só do que o jogo usa

O Nuxt UI escrevia no CSS de cada página o tema de todos os componentes da biblioteca,
~240 KB iguais em toda tela, e o jogo desenha 4 deles: `UApp`, `UModal`, `UTabs` e
`UCommandPalette`, 17 contando o que eles usam por dentro.
`ui.experimental.componentDetection` entrega ao Tailwind só o tema dos componentes que
as fontes nomeiam, e toda página perdeu os mesmos 114.907 bytes de CSS (de -42% a -44%
do CSS da tela, contado o inline; de -47% a -48% das folhas) sem mexer no JS. Reintroduzir o defeito, tirando a opção, reprova os 24 tetos de CSS,
cada um com a página e os bytes na mensagem, e nenhum de JS.

**A detecção lê nomes.** Um componente que só se alcança por um nome que ela não lê,
`resolveComponent()` com variável ou `<component :is>`, ficaria sem tema, e o orçamento
não acusaria, porque só tem teto. As fontes não têm nenhum hoje; o comentário do
`nuxt.config.ts` diz onde declarar o dia em que tiverem.

### Os ícones da paleta, embarcados

A paleta de busca desenha seis ícones do Lucide que o Nuxt UI lê de
`appConfig.ui.icons`: buscar, fechar, carregando, item escolhido, grupo e voltar. Na
primeira abertura eles eram pedidos à rota de ícones do servidor, que repassava o
pedido a uma API pública, e um aparelho sem rede abria a paleta com quadrados em branco
no lugar do campo e do botão de fechar. Hoje são seis SVG em `app/assets/icons/lucide/`,
embarcados no cliente como coleção própria (`icon.customCollections`, `provider: 'none'`
e `serverBundle: false`, em `nuxt.config.ts`), ao custo de 1.553 bytes de JS por tela.
Com `provider: 'none'` um ícone que ninguém embarcou não é achado em lugar nenhum — o
módulo só pede ao próprio host um `undefined/lucide.json`, que dá 404 — e fica em
branco com ou sem rede: aparece na máquina de quem desenvolve, e não só no celular sem
sinal. **Quem reprova por ele é só o fluxo da paleta.** Medido no review com um ícone
plantado em `/login`: o build termina, todo portão fica verde, e a tela mostra um
quadrado em branco. As fontes não nomeiam ícone fora da paleta hoje; o primeiro que
nomear precisa da sua tela em `palette-icons.spec.ts`. O crédito do Lucide (ISC) está em
*Créditos*.

**O que embarca o ícone é o arquivo, e não o nome na lista.** A lista de
`clientBundle.icons` parece quem carrega, e medido não é: tirar um nome dela não muda
nada, porque a coleção própria entra inteira sempre que o provedor não é `server`, e o
Nuxt UI pede os ícones dele por nome também. Tirar o arquivo e o nome reprova os dois
portões abaixo, e tirar o arquivo deixando o nome faz o **build** falhar. A lista é a
checagem do build de que o arquivo existe.

- [`test/e2e/palette-icons.spec.ts`](../test/e2e/palette-icons.spec.ts) percorre a paleta
  — abrir pelo gatilho, digitar, setas, busca sem resultado, fechar, reabrir e escolher
  —, cobra por nome os ícones de cada passo, exige zero requisições de ícone e zero
  `.iconify` sem `mask-image`, que é o quadrado em branco que nenhuma outra asserção
  vê. O índice é segurado, para o ícone de carregando ficar na tela, e os dois
  instrumentos têm o seu teste do outro lado: o espião tem de ver, uma a uma, as três
  formas de pedido que procura, cada uma escrita para casar só com a sua alternativa.
- [`test/e2e/offline.spec.ts`](../test/e2e/offline.spec.ts) abre a paleta pela primeira
  vez sem rede, sob o worker. No build de antes do conserto o fluxo via três requisições
  a `lucide.json` e o offline via `search` e `x` sem imagem.

### A pré-busca, medida

O `NuxtLink` observa os links visíveis e busca o `_payload.json` do destino antes do
clique. Dois casos, medidos em 06/10/2026 contra o `yarn build`:

- **As cartas do grid (#14).** Em `/pokedex/1`, a 1280×900: 21 payloads de espécie na
  carga inicial e 151 de 151 ao rolar o grid até o fim, que pesam 442.493 bytes crus e
  124.002 com brotli no nível 11. **Ficam como estão, em `visibility`**: o clique numa
  carta navega sem espera, Kanto inteira custa 124 KB, e o levantamento de 01/10/2026
  mediu que a pré-busca não atrasa o LCP. Pré-buscar por interação, ou desligar,
  trocaria latência de navegação por bytes que esse levantamento não mostrou custarem
  nada ao LCP.
- **O link das moedas**, que a #14 não via. Ele fica na barra, que está em toda tela, e
  pré-buscava `/packs/_payload.json` — 155.759 bytes crus, 33 KB com gzip — em toda
  primeira carga, para uma página que a maioria das visitas não abre por ali. Em
  `/rules`, o navegador pedia `/rules` e `/packs`; com `:prefetch="false"` pede só o
  próprio. Os outros links da barra são `custom`, que o `NuxtLink` não observa, e não
  pré-buscavam.

[`test/e2e/prefetch.spec.ts`](../test/e2e/prefetch.spec.ts) pergunta a `/settings`, uma tela
sem cartas cujo corpo tem um link pré-buscado de propósito: o do seletor de idioma, para
a mesma página em cada outro idioma. Tirando o payload da própria página e o desse link,
o que sobra veio da barra, e é comparado por nome com a lista permitida, vazia hoje, nos
dois idiomas: um link novo da barra que passe a pré-buscar reprova pelo endereço, e a
lista só cresce por decisão. A grade de `/pokedex/1` tem de continuar pré-buscando as
espécies. Provado no build de antes do conserto: `/packs/_payload.json` e
`/en/packs/_payload.json` acusados, e a grade passa.

**A lista é lida depois de uma testemunha, e não de uma espera.** O payload de um link
sai no fim de uma cadeia — dois idle callbacks, a resposta do observer, o manifesto do
app pela rede —, e o portão nasceu lendo a lista quando a rede ficava quieta. O
`waitForLoadState('networkidle')` responde na hora quando isso já aconteceu durante a
hidratação: com o `:prefetch="false"` removido e a CPU da página dez vezes mais lenta, o
teste passava em 8 de 20 rodadas, e a vinte vezes em 20 de 20. Agora ele espera o payload
do seletor, que só sai dessa mesma cadeia, e mais duas rodadas de idle e frame. Com o
defeito plantado reprova em 10 de 10 a 10× e a 20×, e em 40 de 40 sob carga real (48 e 96
processos de CPU em 12 núcleos); o build bom passa em todas, nas mesmas condições.

**O que segue pré-buscado, e não foi mexido:** os links do corpo das telas — o Hub
pré-busca `/packs` e `/deck`, a coleção pré-busca `/packs`, as preferências pré-buscam a
si mesmas no outro idioma — e o grid, pela decisão acima. A paleta carregada sob demanda
é a #85, fora deste PR.

### A barra, parada na primeira carga

A barra está em toda tela menos a batalha, e no celular ela quebra em três ou quatro
linhas: o que muda a altura dela empurra a página inteira. Para o jogador novo, sem
conta, duas coisas mudavam, medidas em 07/10/2026 no Chrome completo com emulação de
celular, CPU 4× e rede de 1,6 Mbps com 150 ms (a `d9f0e51` antes, o PR 7c depois; cinco
cargas por célula, três nas duas últimas linhas, todas com o mesmo valor). O servidor
da medição é o `yarn preview`, que não comprime, e a fonte de reserva é a DejaVu Sans
desta máquina; as duas coisas pesam nos números, e estão ditas onde pesam:

| tela | deslocamento antes | depois |
|---|---|---|
| `/rules` a 430 px | 0,418 | 0,003 |
| `/en/rules` a 430 px | 0,403 | 0,003 |
| `/pokemon/charizard` a 412 px | 0,462 | 0,003 |
| `/pokedex/1` a 412 px | 0,607 | 0,034 |
| `/collection` a 412 px | 1,045 | 0,434 |

- **O link das moedas só existe depois da hidratação**, porque o saldo é do jogador e o
  servidor não o escreve. Até lá a barra tinha 4 px a menos e os dois links seguintes
  ficavam 104 px à esquerda em pt-BR e 97 em inglês: 0,09 a 0,10 em toda largura de
  celular. O `ClientOnly` ganhou um `#fallback` com a caixa do link, invisível e fora da
  árvore de acessibilidade, com o rótulo no idioma da página — uma largura escrita no
  CSS erraria 7 px no outro idioma. A caixa é a de um saldo de um dígito, que é o do
  jogador novo: cada caractere a mais alarga o link 8,4 px, e quem volta com 10 moedas
  ou mais ainda vê os dois links seguintes andarem (#97).
- **As faces da barra chegavam depois da primeira pintura.** Uma face só é buscada
  quando o layout acha texto que precisa dela; a página era pintada na reserva e de novo
  na Chakra Petch, e entre 412 e 440 px os links ocupam uma linha a mais na reserva: a
  barra ia de 217 para 160 px (0,31 a 0,35). A faixa é a da DejaVu Sans; numa reserva
  com a métrica da Arial ela é de 412 a 414 px em pt-BR e 428 px em inglês, e fora dela
  a troca de fonte não muda a altura da barra. O `AppNav` declara o `preload` das duas
  faces em que a barra é escrita, a 600 e a 700 (20 KB). Na barra e não no `app.head`,
  porque a batalha não tem barra e não pede a 600.

**Duas faces, e não as quatro da tela.** A 400 do corpo e a JetBrains Mono seguem
trocando, e o que isso move é o 0,003 da tabela. As quatro (61 KB) custaram 216 ms ao
LCP do Detalhe, que é a arte; as duas custam cerca de 100 (4.520 → 4.624 ms na mediana
de cinco cargas; só com a caixa das moedas a mediana já era 4.556). Na segunda visita,
com o service worker respondendo as fontes, a troca acontecia do mesmo jeito (0,416 em
`/rules`) e cai para 0,012.

**Os tempos são de servidor sem compressão, e a folga do `preload` também.** O
`entry.css` sai do `yarn preview` com 125 KB e chega em 3,5 s nessa rede, contra 0,7 s
das duas faces: 2,8 s de folga. Comprimido ele tem 16 KB em brotli, menos que as faces.
Com o mesmo build atrás de um proxy que comprime, a folha chega em 0,74 s e as faces em
0,60: a folga cai para uns 140 ms, e a barra não se moveu em 52 cargas, de três telas
em quatro perfis de rede e CPU. O `preload` segue valendo num host que comprime; os LCP
desta seção são os do servidor sem compressão, maiores que os de um host (o FCP de
`/rules` é 3,6 s direto e 0,86 s comprimido).

**O endereço do `preload` leva um hash, e vai escrito no `AppNav`.** O `@nuxt/fonts` dá a
cada arquivo um nome derivado de onde ele veio e não oferece jeito de pedir "a 600"; a
opção `preload` do módulo emite um link só, para uma itálica que nenhuma tela usa.
Quando a família mudar de versão no provedor o hash muda, o link aponta para nada e a
página volta a trocar — quem avisa é o portão, pelo nome da face, e o conserto é copiar
os dois endereços novos. Três arquivos se chamam *Chakra Petch 600*, um por subconjunto,
e o que serve é o que a página pede sozinha: a mensagem do portão traz essa lista, com
o endereço de cada face.

[`test/e2e/layout-stability.spec.ts`](../test/e2e/layout-stability.spec.ts) guarda as duas
coisas, em `/rules` e nos dois idiomas, para o jogador sem conta — o teste responde a
sessão ele mesmo, em vez de depender do 500 que o servidor sem banco devolve:

- **A barra que o servidor escreveu é a barra hidratada**, a 360 e a 430 px: a altura,
  o lugar de cada link e a caixa reservada contra a do link, lidos com o JavaScript
  desligado e depois com a página hidratada. Com o `#fallback` retirado reprova nos
  quatro casos, com os 4 px e os 104 px na mensagem. Entre 412 e 416 px o *headless
  shell* do e2e quebra a barra diferente do Chrome completo, e por isso a largura não é
  uma dessas. **E a caixa reservada não se vê**: nenhuma peça dela tem `visibility`
  diferente de `hidden`, que é o que a tira da pintura e da árvore de acessibilidade de
  uma vez; o link hidratado, lido do mesmo jeito, tem de se ver.
- **Numa carga a frio, nada que se move é a barra nem o bloco logo abaixo dela.** O
  teste lê as fontes de cada `layout-shift`, sem o filtro de `hadRecentInput`, depois de
  empurrar ele mesmo a barra 120 px: o deslocamento plantado é a testemunha de que a
  sonda enxerga. Ele não cobra deslocamento zero porque as faces do corpo ainda trocam,
  dentro do bloco, e o quanto isso soma depende da fonte de reserva da máquina.
- **Na mesma carga, cada face pré-buscada é pedida uma vez só.** A barra mexer é a
  consequência, e ela depende da fonte de reserva: com a métrica da Arial um `preload`
  que a página não consegue usar não move nada a 430 px. O pedido não depende. Um
  `preload` usado é o único pedido do arquivo; sem `crossorigin` ele não serve à fonte,
  e o arquivo é pedido de novo quando o texto precisa dele.
- **Toda página declara o `preload` das faces da barra quando tem a barra, e de nenhuma
  quando não tem**, dito por família e peso lidos do `@font-face` do CSS construído. E
  **cada arquivo declarado é um que a página pede sozinha**, com o `preload` retirado do
  HTML e o JavaScript desligado — o nome não distingue o subconjunto latino do
  vietnamita, e o pedido distingue.

Provado com defeito plantado e build de verdade: sem o `preload`, as 22 páginas com
barra nomeadas e o bloco indo de 217 para 160; com um hash inexistente e a 700 do
subconjunto vietnamita, 22 páginas reprovadas pelo nome nas duas perguntas; com a 600 no
`app.head`, `/battle/1` e `/en/battle/1` acusadas. Sem o `crossorigin`, que as duas
perguntas de disco deixam passar, a carga a frio acusa `Chakra Petch 600, fetched 2
times` e a 700 igual. Com o `style` do `#fallback` trocado por uma classe sem regra, os
quatro casos da barra nomeiam as três peças que se veem; com só o rótulo de volta a
`visibility: visible`, nomeiam o rótulo.

**O teste segura a folha de estilo por 300 ms, e isso é um limite do `preload`, não só
do teste.** A face pré-buscada só serve se chegar antes de a página poder pintar. Numa
rede de verdade ela corre ao lado da folha de estilo e chega a tempo — zero trocas nas
cargas da tabela. Em `localhost` nada demora, e quem chegava primeiro era acaso: sem
segurar, o build bom reprovou 2 vezes em 40 com os seis workers da suíte e 18 em 40 com
a máquina saturada. Segurando, nenhuma carga do build bom moveu a barra (cerca de 400,
com a máquina livre e saturada) e as 80 do build sem o `preload` moveram. Quem abre o
jogo em rede muito rápida com a CPU ocupada ainda pode ver a barra trocar de altura. O
teste conta as folhas que segurou: se o caminho do CSS mudar e nenhuma passar por ele,
reprova dizendo isso, em vez de voltar à corrida calado.

**O que saiu por medição, e o que sobra:**

- O sprite da primeira tela sem `lazy` e o herói com `fetchpriority="high"` não mexeram
  no LCP (6.120 → 6.112 ms em `/pokedex/1`, 4.512 → 4.500 no Detalhe) e não entraram.
- A fonte de reserva com a métrica ajustada é a #94: o módulo não a gera, e escrita à
  mão ela só vale onde `local("Roboto")` ou `local("Arial")` resolve.
- O 0,034 de `/pokedex/1` é a grade, que o servidor escreve em uma coluna (#93); o 0,434
  de `/collection` é o corpo das telas de jogo, que pede prancha (#87).
- **Quem tem conta ainda vê a barra crescer 46 px** em toda primeira carga de celular
  (217 → 263 a 360 px, 160 → 206 a 430): o servidor escreve o canto da conta vazio, e a
  linha do avatar e do SAIR entra quando a sessão chega. Reservá-la muda o que a barra
  desenha, e é a #96.
- O saldo de mais de um dígito, que a caixa reservada não cobre, é a #97.
