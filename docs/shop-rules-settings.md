# A loja, as regras e os ajustes

O que fecha a Fase 6: um lugar para gastar as moedas, a referência que se gera
sozinha, e a barra que liga as duas ao resto.

| Rota        | O que é                                                             |
| ----------- | ------------------------------------------------------------------- |
| `/packs`    | a loja — boas-vindas, diário e Pack Holo — e a abertura logo depois  |
| `/rules`    | raridade, packs, forja, dano, condições, Liga e economia, derivados  |
| `/settings` | exportar, importar e apagar o save; o interruptor de animação        |

### A loja: três fontes, três regras de cobrança

| Cartão | Custo | Some quando |
| --- | --- | --- |
| Pack de estreia | grátis, 3 vezes | os três acabam |
| Pack diário | grátis, 1 por dia | é aberto; volta à meia-noite local |
| Pack Holo | 150 moedas | nunca |

**A prancha desenha dois cartões e a tela mostra três.** Os packs de boas-vindas
existem desde a Fase 5 e precisam de onde ser abertos; virá-los o primeiro da
fileira os põe no mesmo padrão de desaparecimento que a prancha já dá ao diário.
A alternativa — a loja só aparecer depois deles — esconderia saldo e preço
justamente de quem está começando.

**As três creditam as cartas antes de cobrar por elas**, e a ordem é regra escrita
do plano: uma falha no meio dá um pack de graça em vez de cobrar por nada. É por
isso que o débito é uma função à parte da store, e não um efeito de `openPack` —
inverter a ordem exigiria mover uma linha, que é uma mudança que o review vê.

**O dia do diário é o de calendário do aparelho**, gravado como `AAAA-MM-DD`.
Decidido em 05/09 contra a espera de 24 horas, que empurra o horário para frente
toda vez até cair na madrugada. Comparar datas em vez de instantes tem um efeito
lateral bom: um relógio atrasado **devolve** o pack em vez de travar a loja.

A tela mantém um relógio de um segundo enquanto está aberta. Ele existe pelo
contador regressivo — `próximo em 14:22:07` —, mas é também o que faz o cartão
voltar sozinho à meia-noite com a aba aberta.

O relógio é [`useGameClock`](../app/composables/useGameClock.ts) e o formato é
`countdownLabel`, em `shared/game/economy.ts`. Os dois moravam copiados caractere
por caractere no Hub e na loja — a mesma dívida que justificou extrair o helper
das suítes e2e, achada pelo review no mesmo PR. **O relógio reativo não serve de
seed nem de carimbo**: quem sorteia um pack e quem grava o dia do diário leem
`new Date()` na hora, senão dois packs do mesmo tique saem idênticos e um clique
na virada da meia-noite grava o dia de ontem.

### `/rules` não contém número nenhum

A página é derivada de `shared/game/` inteira, e isso é contrato, não estilo:
trocar o pity de 10 para 8 muda a tela no mesmo commit. O motivo mais forte não é
o jogador — é que as regras estão espalhadas por três fases, e "spec espalhada"
foi o padrão de quase todo defeito que a revisão do plano encontrou.

[`test/unit/rules-gate.spec.ts`](../test/unit/rules-gate.spec.ts) monta a lista de
números proibidos **a partir do que o motor exporta**: ele importa o namespace de
todo módulo de `shared/game/` e `shared/types/` e policia todo número que sair de
lá. Um tier novo na escada de forja entra sozinho, um limiar movido passa a ser
cobrado no valor novo, e uma **constante nova** entra sem ninguém editar o teste.

A primeira versão dele enumerava à mão *quais* constantes policiar, e o review
mostrou o custo: `BATTLE_IV` (31), `TYPE_COUNT` (18), `RANDOM_MIN_PERCENT` (85),
`RANDOM_MAX_PERCENT` (100), `CRIT_CHANCE` e `BURN_DAMAGE_FRACTION` — seis
constantes que a página renderiza — ficaram de fora pela omissão, e escrevê-las à
mão passava no portão que existe para impedir isso. A lista de **módulos**
continua escrita, e o que impede ela de envelhecer é um teste que a compara com a
árvore em disco: arquivo novo em `shared/` reprova até ser incluído.

Ele afirma o outro lado também — os nove módulos continuam importados pela
página —, senão uma página vazia passaria.

Duas exceções ficam escritas no portão, em vez de escondidas:

- **A fórmula de dano**, recortada **pela chave** `rules.battle.formula`. O `5`,
  os dois `2` e o `/50` são a forma da conta da série, não a calibração dela. O
  nível, que **é** decisão do jogo, entra interpolado — e `BATTLE_LEVEL` está na
  lista de proibidos justamente por isso.
- **Constantes de um dígito.** A página pode e deve escrever `×0 a ×4` sobre
  efetividade, e um `4` na prosa é indistinguível de um `FORGE_RATIO` digitado.
  Cobrar os dois produziria falso positivo em cima de texto correto, que é como
  um portão deixa de ser levado a sério.

**A tradução da página mudou o que o portão precisa varrer.** A prosa saiu do
`.vue` e foi para `i18n/locales/*.json`: um portão lendo só o arquivo da página
acharia uma tela sem número nenhum e ficaria **verde medindo nada**, com um `475`
livre para ser digitado no JSON onde ele não olhava. Ele varre as duas coisas, e
cobra **cada origem pelo nome** — piso por fonte, e o defeito plantado reportado
uma vez por origem. A exceção da fórmula deixou de ser o padrão `` `dano = …` ``
pelo mesmo motivo: escrito em português, ele pararia de casar no instante em que
o inglês dissesse `damage = …`, e mudaria em silêncio o que era varrido. Chave é
igual nos dois idiomas.

A asserção nova de que **nenhuma exceção sobrevive à constante que ela perdoa**
achou as duas que existiam já mortas: `DEX_SIZE` virou `SPECIES_COUNT` na Fase 3,
e `PERCENT_BASE` foi apagada — nenhuma das duas existia no repositório fora da
linha que as perdoava.

O par disso é [`test/e2e/rules.spec.ts`](../test/e2e/rules.spec.ts), que lê os
números **na tela** e nos dois idiomas — o portão sozinho passaria numa página
que não renderiza nada, e nenhuma varredura de disco alcança a chave que o
`<i18n-t :keypath>` monta por variável. `test/e2e/shop.spec.ts` continua com a
escada de raridade.

### `/settings` entrega só o que tem dado

Entram o painel *Save* — exportar JSON, importar, apagar deste aparelho —, a
fileira de números, o interruptor de animação e a versão com o sha. **A Fase 7
trouxe a metade que dependia de conta**: o painel da conta com e-mail e estado do
sync, *Restaurar versão anterior* e *Excluir conta e save do servidor* — e o
título passa a dizer de quem é a tela (*Sua conta e seu save* com sessão, *Seu
save e este aparelho* sem). O último item da prancha, *baixar tudo para offline*,
chegou no 5b da Fase 8. Até lá ele aparecia **nomeado** num painel *Ainda não*, em
vez de virar controle cinza — um botão desligado promete uma coisa que o jogo não
faz —, e o painel saiu com ele. Ele chegou a nomear três coisas: o idioma saiu
chegando — o seletor é a primeira linha de *Preferências* desde o 4d-2 —, e o som
saiu da prancha, que deixou de desenhá-lo na versão 16.

**O idioma desta tela alcança duas coisas que não são desta tela.** O chip de
sync ([`app/utils/sync-label.ts`](../app/utils/sync-label.ts)) mora na barra global e
o aviso de save recuperado ([`SaveRecoveryNotice`](../app/components/SaveRecoveryNotice.vue))
é montado no `app.vue` — os dois renderizam em **toda** tela do jogo, então
deixá-los para depois espalharia *3 mudanças na fila* pelo `/en` inteiro enquanto
cada tela individual parecia pronta. As duas funções puras (`syncLabel`,
`agoLabel`) recebem o tradutor em parâmetro, como `narrate`, e `Translate` ganhou
um terceiro parâmetro para o plural: a contagem **escolhe** a frase e não só a
preenche, e passar só o valor renderiza o pipe e as duas metades na tela.

Ele também é o que deixa a contagem viajar **duas vezes**, com metades
diferentes: `gameNumber` preenche a frase e o número cru escolhe a forma. Entregar
o número para os dois papéis derrubava o separador do pt-BR — `1600 cartas` sob um
bloco de estatísticas ainda escrevendo `1.600` —, porque interpolação nomeada do
vue-i18n converte para texto e nunca formata.

Os outros dois painéis de boot do `app.vue` **não** vieram junto, e a seção
*Meio traduzido* acima os nomeia: a medição desta fase é por tela, e nenhum deles
é uma.

**Importar e apagar guardam o texto original antes de escrever por cima.** É a
regra inegociável do plano — save que não se entende vai para backup, nunca para
o lixo — aplicada ao caminho voluntário: sem conta não existe segunda cópia em
lugar nenhum, e um arquivo trocado por engano custaria a coleção. O anel continua
com teto de três cópias, então clicar todo dia não enche a cota.

**E dá para voltar por elas.** O painel *Cópias de segurança* lista o que existe,
com o instante, e restaurar guarda o save de agora antes — a operação é reversível
nos dois sentidos. Ele nasceu do review: as duas telas prometiam que a cópia ficava
guardada e o único caminho de volta era o DevTools. O argumento do aviso de boot
para não oferecer restauração — a chave crua é de uma versão que este código, por
definição, não soube ler — não vale aqui: nestes dois caminhos o texto arquivado é
um save que este mesmo código acabou de escrever. *Restaurar versão anterior* é outra
coisa: aquela é a versão do **servidor**, entregue na Fase 7, e mora no painel
*Save* ao lado de exportar e importar — só aparece com conta e só quando o
servidor tem uma.

**Com conta, *APAGAR LOCAL* passa pelo `discardLocal`, e o vazio não sobe:** o
save deste aparelho é zerado, a cópia vai para o anel, e o do servidor é relido e
adotado — que é o que a tela promete ao escrever "com conta, ele volta na próxima
sincronização". **Quando essa releitura não acontece — sem rede, ou o servidor
fora —, o sync para e a tela diz isso**, num quarto estado que não tem prancha:
*"o da sua conta não pôde ser lido agora"*. Sem parar, a jogada seguinte já não
seria intocada, a guarda do envio não dispararia, a `baseVersion` ainda casaria, e
a coleção da conta viraria o save que o jogador acabou de apagar — em silêncio, e
contra o que a própria tela acabou de prometer. Foi o achado crítico do review do
PR 2 da fase.

O import recusa arquivo acima de 1 MB **antes** de o ler (o save realista tem ~3 KB
e o pior caso documentado 21 KB), e reinicia o `<input type="file">` num `finally`.
Sem esse reset no caminho de erro, escolher o mesmo arquivo duas vezes não dispara
`change` — e é no erro que repetir o mesmo arquivo é mais provável.

### O interruptor de animação: dois sinais, uma regra de escrita

Quem pede menos movimento diz isso de duas formas — pelo sistema
(`prefers-reduced-motion`) e pelo interruptor, que carimba `data-reduce-motion` no
`<html>`. Media query e seletor não se combinam em CSS, então **toda regra que
para uma animação aparece duas vezes**:

```css
@media (prefers-reduced-motion: reduce) {
  .x { animation: none; }
}

:root[data-reduce-motion] .x {
  animation: none;
}
```

A media query não sai, e é a metade que mais importa: ela é o único caminho que
funciona antes de o JavaScript rodar. [`test/unit/motion-gate.spec.ts`](../test/unit/motion-gate.spec.ts)
compara **os conjuntos de seletores** dos dois lados, arquivo por arquivo, e
reprova a metade — dos dois lados.

Ele contava *ocorrências* das duas formas na primeira versão, o que deixava passar
o caso mais provável: uma segunda regra **dentro** de um `@media` que já existe
não muda a contagem, e o interruptor da tela passaria a desligar parte da animação
e deixar o resto correndo. E ele excluía `app/assets/css/main.css` inteiro para
não reprovar o exemplo escrito no docblock de lá — exclusão mais larga que o
problema, que tirava do portão qualquer regra de movimento de verdade que o tema
viesse a ter. Agora ele apaga comentário, como os outros três portões já faziam.

Do lado do JavaScript, `useReduceMotion` soma os dois sinais e `useMotionSwitch`
devolve só o interruptor. A separação não é elegância: o plugin de boot precisa
carimbar sem assinar a media query, porque uma assinatura criada ali fica viva
para sempre e congela o `matchMedia` do app inteiro — foi o que fez
`use-foil.spec.ts` deixar de medir o que afirma, na primeira versão do módulo.

### A barra global

`Base · Packs · Pokédex · Coleção · Deck · Liga` à esquerda; saldo, *Regras* e o
ícone de ajustes à direita. Ela é um layout, e **duas telas ficam de fora por
decisão do canvas**: `/battle/[gymId]`, que a prancha *Batalha* desenha com uma
barra própria — ginásio, líder, região e tipo —, e `/styleguide`, que é o espelho
do sistema e não uma tela do jogo.

[`test/unit/nav-gate.spec.ts`](../test/unit/nav-gate.spec.ts) anda por `app/pages/` e
cobra os dois sentidos: toda tela está na barra ou está na lista de **saída**, e a
barra não aponta para tela que não existe. A lista é de saída de propósito — uma
página nova cai do lado de dentro por omissão e reprova. Lista de entrada falha
em silêncio, que foi o defeito do portão de tema na fase passada.

Ele **importa** [`app/utils/nav-links.ts`](../app/utils/nav-links.ts), que é a mesma
lista que o componente renderiza. A primeira versão lia o `.vue` e perguntava se a
string `'/deck'` estava lá dentro, o que é presença de texto e não link
renderizado: `v-if="false"` em volta do link, ou a rota citada só num comentário,
mantinham o portão verde com a tela fora da barra. O que o portão de disco ainda
não alcança — o link que existe no dado e não chega à tela — é
`test/e2e/collection.spec.ts`, que **itera sobre os mesmos destinos** e clica em
cada um.

### A seção atual, e um mecanismo que nunca existiu

O sublinhado do destino atual saía de `router-link-active`, com um comentário
dizendo que ela "casa por prefixo, que é o que acende *Pokédex* em `/pokedex/1`".
Ela não faz isso: casa por **registro de rota**, e `/pokedex` e `/pokedex/:gen`
são irmãs no roteamento por arquivos. O HTML pré-renderizado de toda rota
aninhada saía com a barra inteira apagada — sem sublinhado e sem `aria-current`.

`isCurrent` passou a decidir por prefixo de caminho, que é o que o comentário
afirmava, e o mesmo booleano escreve a classe e o `aria-current` — os dois não têm
como discordar. O `exact` da Base virou load-bearing pela primeira vez: `/` é
prefixo de toda rota.
