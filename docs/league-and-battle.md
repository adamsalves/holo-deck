# A Liga, a batalha e o motor

## A Liga e a batalha

Nove ginásios em sequência, uma batalha por turnos e a economia que ela paga.

| Rota              | O que é                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `/league`         | a trilha dos nove, o estado de cada um e o painel do próximo        |
| `/battle/[gymId]` | o campo, os quatro golpes, o registro do turno e o banco            |
| `/`               | o Hub: retomar batalha, próximo ginásio e coleção                   |

A regra continua em `shared/game/` — o motor é a Fase 4 e a economia é
[`economy.ts`](../shared/game/economy.ts). As telas escolhem a ação, narram o que
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

**Pack diário e o preço de 150 na loja ficaram para o PR seguinte.** A tabela do
contrato da fase punha `economy.ts` "completo" aqui, e a decisão de 04/09
corrigiu: eles só ganham consumidor com a loja, e constante de economia sem quem
a leia é o que o repositório recusa desde a Fase 0. Com a loja o módulo fechou —
ver [A loja, as regras e os ajustes](shop-rules-settings.md).

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

### O time do líder é JSON, e o Hub já abriu sem ele

`useLeague` monta o time de cada ginásio aberto num `useAsyncData`, e **o handler
devolve um objeto simples, não um `Map`**. A diferença apagava a fileira *Time do
líder* do Hub para todo jogador sem insígnia — a primeira tela de todo jogador
novo — desde a `v0.7.0`, com build verde, console limpo e `_errors` vazio no
payload. Foi achada em produção, testando o primeiro login numa janela anônima.

No pré-render, o Nuxt 4 reaproveita o resultado de uma chave entre as páginas que
a usam — `/` e `/league` dividem `league-teams:1` — guardando-o num storage que só
serializa JSON. Um `Map` não passa: o `setItem` lança, o próprio Nuxt engole o
erro, e a página gerada depois recebe `null`. No cliente, `null` conta como dado já
carregado — só `undefined` dispara busca —, então o time nunca chegava. Com uma
insígnia a chave vira `league-teams:2`, que não está no payload de página nenhuma,
a busca acontece, e o defeito se escondia justamente de quem já tinha jogado.

A regra vale para todo `useAsyncData` do repositório: o handler devolve JSON, e o
`Map` que a tela quiser nasce num `computed`, depois. O `useDeck` tinha a mesma
forma nos status de Lv50 e foi junto, antes de virar defeito — só `/deck` usa
aquela chave, então nenhuma página a recebia do cache. Para ler o que a build
gravou, o lugar é o `_payload.json` da rota: o HTML pré-renderizado só carrega o
`_errors`, e o `data` vai para o arquivo extraído.

Dois portões, e eles medem lugares diferentes:

- [`test/e2e/prerender-payload.spec.ts`](../test/e2e/prerender-payload.spec.ts)
  decodifica todos os `_payload.json` da build e reprova valor com tipo que não
  seja JSON e chave com valor diferente entre páginas. É o que pega a classe
  inteira, inclusive quando a ordem do pré-render esconde o defeito.
- [`test/e2e/hub-team.spec.ts`](../test/e2e/hub-team.spec.ts) confere o time na tela
  pelas quatro portas: carga direta do Hub, chegada ao Hub por outra página, Hub
  depois de adotar o save da conta, e carga direta da Liga.

Provados recolocando o `Map`: as duas perguntas do primeiro acusam
(`/league/ league-teams:1 Map` e `league-teams:1: / ≠ /league/`), e três dos quatro
testes do segundo reprovam com `Expected: 3, Received: 0`. O da Liga passa, e o
próprio teste diz por quê: com a ordem de hoje, quem perde é o Hub.

## Motor de batalha

Tudo em [`shared/game/`](../shared/game/), TypeScript puro, sem uma linha de Vue —
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
[`test/unit/shared-purity.spec.ts`](../test/unit/shared-purity.spec.ts)**: só
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
