# Pack, coleção, forja e deck

## Pack, coleção e forja

O ciclo da Fase 5: abrir pack → creditar coleção → moer duplicata em pó → forjar
a carta que faltou.

| Rota          | O que é                                                  |
| ------------- | -------------------------------------------------------- |
| `/packs`      | a loja e, depois do clique, a abertura carta a carta     |
| `/collection` | o binder: progresso por região, filtros, pó e forja      |

A regra inteira mora em [`shared/game/`](../shared/game/), headless como o motor —
100 mil aberturas rodam em ~100 ms sem montar componente nenhum.

| Módulo       | O que decide                                                |
| ------------ | ----------------------------------------------------------- |
| `packs.ts`   | 10 cartas (6/3/1), o slot raro+, o pity e o shiny           |
| `dust.ts`    | pó por duplicata e custo de forja, na razão 4×              |
| `progress.ts`| a fração capturada e o degrau que ela pinta                 |
| `economy.ts` | boas-vindas, recompensa de ginásio, preço da loja e o diário |
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
  aqui contradiria aquela regra. Ver *O deck*.
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
  Com a loja eles viraram o **primeiro cartão da fileira**, que some quando os
  três acabam — ver [A loja, as regras e os ajustes](shop-rules-settings.md).
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

A regra mora em [`shared/game/deck.ts`](../shared/game/deck.ts), headless como o
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
