# Holo Deck — regras locais

Deck battler sobre o dex da PokeAPI, em Nuxt 4 + Vue 3. Dados de jogo gerados em build-time e
commitados; o jogo roda do `localStorage` e sincroniza para o Postgres quem tem conta.

## Antes de começar

- **A prancha é a especificação.** Implementar o que está desenhado, na disposição desenhada. Tela,
  painel ou estado sem prancha **não começa** — ganha prancha primeiro, e é o usuário que aprova.
  Inconsistência entre prancha e código vira aviso na hora, nunca conserto silencioso; divergência
  aceita fica registrada.
- **Nunca commit direto na `main`.** Toda mudança entra por PR revisável.
- **Teto de PR: ~25 arquivos e ~1.500 linhas adicionadas.** Conferir com `git diff --stat` antes de
  abrir. Estourar o teto é motivo de partir o PR — antes do review começar, não depois.

## Contexto custa caro

- **Não puxar o canvas publicado para o contexto.** Ele tem ~3,4 MB. Extrair só a prancha necessária
  para um arquivo local pequeno.
- **Preferir o `code-review-graph` (MCP) a `grep`/`read` amplo** para achar onde as coisas moram.
- **Ler o arquivo do assunto**, não varrer o README inteiro.
- **Conferir a própria medição antes de planejar sobre ela.** Um `grep` com backreference já devolveu
  zero num lugar que tinha seis mapas de rótulo, e isso quase sub-dimensionou uma fase.

## Verificação

```bash
yarn lint                    # ESLint 10 flat config
yarn typecheck               # vue-tsc
yarn test                    # Vitest
yarn build                   # saída Nitro
PORT=3100 yarn test:e2e      # a 3000 é do Grafana nesta máquina; exige build antes
yarn check:vercel-bundle     # o dex dentro da função da Vercel
```

Manuais, porque nada no CI os dispara: `yarn db:verify` (o CAS do `PUT /api/save` contra o Postgres)
e `yarn db:seed-remote`. Login **não** se valida em preview da Vercel — só em `localhost` e produção.

Ao criar pasta nova de TypeScript, o `include` de um `tsconfig`, o glob type-aware do
`eslint.config.mjs` e os aliases do Vitest precisam concordar. Quando discordam, um portão passa e o
outro não — e há dois portões (`lint-gate`, `tsconfig-gate`) que medem isso pelo disco.

## Como escrever portão

Um portão errado é pior que nenhum: ele dá a impressão de que a regra está guardada.

- **Enumerar quem SAI, nunca quem entra** — lista de entrada falha em silêncio.
- **Montar a lista da FONTE**, não à mão; lista escrita à mão envelhece ao lado da regra que vigia.
- **Afirmar o outro lado**, senão `[] === []` passa.
- **Provar reintroduzindo o defeito e vendo a mensagem de erro** — e também medir contra entrada boa,
  senão um portão que reprova sempre parece igualmente saudável.
- **Comparar conjuntos, não contagens.** Contagem é o disfarce mais comum de portão que não confere.
- **Piso por fonte, nunca piso sobre a soma.** Uma asserção do tipo "achei mais que N" é sustentada
  por qualquer parcela que ainda funcione: quando o total tem duas origens, matar uma inteira não
  muda a cor do portão. Cobrar cada origem **pelo nome** é o que torna cada uma provadamente viva.
- Portão de disco não alcança o que chega à tela: o portão importa a mesma lista que o componente
  renderiza, e o e2e itera sobre ela.
- **Asserção que lê a mesma fonte que o código lê não mede nada.** Comparar a saída contra o próprio
  locale, ou montar a expectativa a partir do arquivo que o componente resolve, concorda com uma
  frase cravada tão bem quanto com uma traduzida — os dois lados mudam juntos. O que distingue é
  medir a **forma** (a frase nua não pode ser a frase com valor menos o objeto) ou medir no **outro
  idioma**, que é onde o literal aparece.
- Helper de portão mora em `test/support/`.

As três últimas entraram juntas, e da mesma raiz: o `i18n-gate` repetiu o mesmo defeito em três PRs
seguidos — fonte nova entrando no conjunto medido e não no piso — e o primeiro conserto somou um
termo ao piso, o que durou exatamente um PR porque tratava a instância e não a forma. No mesmo
ciclo, dois testes apresentados como prova de conserto ficaram verdes com o defeito reintroduzido,
porque comparavam a saída contra o arquivo de onde a saída vinha. **Conserto de portão que não muda
a forma da asserção reaparece no PR seguinte.**

## Commits e release

- **Merge commit sempre, nunca squash** — o release-please lê o assunto de cada commit em `main`.
- **Tipo em inglês, assunto em português, primeira letra minúscula** (`subject-case` reprova
  `Corrige o dano`). Corpo: ~100 caracteres por linha; os trailers `Co-Authored-By:` e
  `Claude-Session:` passam.
- Efeito na versão: `feat:` → minor; `fix:`/`perf:`/`revert:` → patch; `chore:` `docs:` `test:`
  `refactor:` `style:` `ci:` `build:` → **nada**. Escolher o tipo é escolher a versão.
- **Uma minor por fase.** Fase partida em vários PRs: o **release PR fica segurado** até o último
  entrar, com um comentário 🔒 e uma caixa por PR. Mergeá-lo no meio solta release com meia fase, e
  esse erro não avisa.
- Release fecha varrendo as branches mergeadas e apagando-as.

## Hooks de git

`commit-msg` roda commitlint; `pre-commit` roda ESLint `--fix` só no que está staged; `pre-push` roda
`vue-tsc` e Vitest. `common.sh` põe o Node do `.nvmrc` no PATH — hook roda em shell não-login, onde
nada do `~/.zshrc` existe. Ele não sourceia o nvm porque `sh` aqui é dash.

## Idioma

Todo **nome** é em inglês: variáveis, tipos, componentes, arquivos, rotas, tabelas, chaves de
`localStorage`, scripts e branches. Texto visível ao jogador não é nome — ele é i18n, e nasce em
pt-BR e EN; a *chave* segue a regra. Plano, commits e PRs em português.

**A prosa dentro do código também é inglês**: comentário, docblock, descrição de `describe`/`it` e
**mensagem de asserção** — tudo que se lê dentro de um arquivo de código, e não só o que a pessoa
comenta. Vale para tudo que se escreve a partir do PR 2 da Fase 8. O que já está em português fica
para uma varredura única depois do `1.0.0` — são ~7.600 linhas em 197 arquivos, e elas guardam
medição e motivo (*"Medido: a arte oficial pesa 118 KB"*), então traduzir mal custa mais que deixar.

Essa regra existe porque a lista de *nomes* acima e a lista do que segue em português eram ambas
fechadas, e comentário e descrição de teste não estavam em nenhuma das duas — foi nessa lacuna que
eles cresceram, sem ninguém quebrar regra. **A mensagem de asserção entrou na lista pelo mesmo
motivo, e uma fase depois:** ela não era nome, não era texto de jogador e não estava entre as três
que a regra nomeava, então o PR das telas de batalha escreveu oito delas em português com todo mundo
achando que estava seguindo a regra. Uma lista fechada de exemplos vira, na leitura de quem aplica,
uma lista fechada do que a regra alcança — e é por isso que ela agora diz *tudo que se lê dentro do
arquivo*, com os exemplos servindo de exemplo.

**Identificador em português é defeito, não estilo.** Conferir com a medição, não a olho: a
varredura por lista de palavras já subestimou o problema em uma ordem de grandeza, porque perde
parâmetro de arrow além do primeiro e perde palavra que existe nas duas línguas (`nome`, `valor`).

## Onde ler cada assunto

Hoje tudo está em `README.md`, por seção (*Verificação*, *Sistema de design*, *Divergências do
canvas*, *Dados do jogo*, *O save*, *Motor de batalha*, *Release*). O PR 8 da Fase 8 parte isso em
`docs/` — quando existir, ler o arquivo do assunto e atualizar esta seção.
