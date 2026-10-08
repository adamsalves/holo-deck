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
- **Ler o arquivo do assunto**, não varrer o `docs/` inteiro.
- **Conferir a própria medição antes de planejar sobre ela.** Um `grep` com backreference já devolveu
  zero num lugar que tinha seis mapas de rótulo, e isso quase sub-dimensionou uma fase.

## Verificação

```bash
yarn lint                    # ESLint 10 flat config
yarn typecheck               # vue-tsc
yarn test                    # Vitest
yarn build                   # saída Nitro
PORT=3100 yarn test:e2e      # a 3000 é do Grafana nesta máquina; exige build antes
yarn build:vercel            # apaga .output e .vercel/output, e constrói com o preset da Vercel
yarn check:vercel-bundle     # confere a saída do preset; exige o build:vercel antes
```

O `build:vercel` apaga o `.output`: o e2e roda antes dele, ou pede `yarn build` de novo.

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
- **O lado bom tem de ser respondido pelo mesmo mecanismo que o lado ruim.** Antes de chamar duas
  perguntas de par, conferir quem responde cada uma em cada ambiente medido: a página de uma espécie
  real era arquivo estático no preset Node, e o 404 ao lado dela seguia 404 com o dex ilegível.
- **Rodar o artefato no lugar mede o `cwd`, não o lugar.** O Node resolve import subindo pelos
  diretórios pais, então o que roda de dentro do repositório acha o `node_modules` do projeto. Subir
  uma cópia fora da árvore, e varrer a cópia pelo caminho do repositório — o import absoluto
  sobrevive à cópia na máquina que construiu.
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

*Piso por fonte* e *asserção que lê a mesma fonte* têm a mesma raiz: o conserto que trata a
instância e não a forma. Somar um termo ao piso quando entra uma fonte nova dura até a fonte
seguinte; e teste que compara a saída com o arquivo de onde ela vem fica verde com o defeito
reintroduzido, então não prova o conserto. **Conserto de portão que não muda a forma da asserção
reaparece no PR seguinte.**

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
comenta. Vale para toda linha que se escreve ou reescreve. A prosa em português que já está nos
arquivos fica para uma varredura única depois do `1.0.0` — são ~7.600 linhas em 197 arquivos, e
elas guardam medição e motivo (*"Medido: a arte oficial pesa 118 KB"*), então traduzir mal custa
mais que deixar.

A regra diz *tudo que se lê dentro do arquivo* porque uma lista fechada de exemplos vira, na leitura
de quem aplica, uma lista fechada do que a regra alcança: comentário, descrição de teste e mensagem
de asserção cresceram em português enquanto não estavam em lista nenhuma. A lista do parágrafo
acima exemplifica; não delimita.

**Identificador em português é defeito, não estilo.** Conferir com a medição, não a olho: a
varredura por lista de palavras já subestimou o problema em uma ordem de grandeza, porque perde
parâmetro de arrow além do primeiro e perde palavra que existe nas duas línguas (`nome`, `valor`).

## Onde ler cada assunto

Um arquivo por assunto em `docs/`; o release fica em `RELEASE.md`. Lê-se só o arquivo do assunto.
Arquivo novo em `docs/` entra nesta tabela e no índice do `README.md` no mesmo commit — o
`docs-gate` reprova quando as três listas discordam.

| Assunto | Arquivo |
| --- | --- |
| Verificação, portões e hooks de git | `docs/verification.md` |
| Sistema de design: tema, tokens, foil | `docs/design-system.md` |
| As pranchas do canvas e a tela de cada uma | `docs/canvas.md` |
| Divergências do canvas | `docs/canvas-divergences.md` |
| Idiomas: portões, seletor, `hreflang` | `docs/i18n.md` |
| Dados do jogo: o dex gerado em build-time | `docs/game-data.md` |
| Pokédex | `docs/pokedex.md` |
| Pack, coleção, forja e deck | `docs/collection-and-deck.md` |
| A Liga, a batalha e o motor | `docs/league-and-battle.md` |
| A loja, `/rules`, `/settings` e a barra global | `docs/shop-rules-settings.md` |
| Acessibilidade: estrutura, anel de foco, foco depois de uma ação | `docs/accessibility.md` |
| Offline | `docs/offline.md` |
| Primeira carga | `docs/performance.md` |
| O save | `docs/save.md` |
| Release | `RELEASE.md` |
