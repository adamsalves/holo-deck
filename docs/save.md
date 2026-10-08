# O save

Um documento só, versionado, em `holodeck:save`.

O plano cita duas formas em seções diferentes — `pinia-plugin-persistedstate` com
uma chave por store, e um `SaveDriver` sobre save único — e elas não se compõem.
Ganhou a segunda, que é a única que sustenta o que vem depois: um `schemaVersion`
cobrindo o save inteiro, uma cadeia de migração que enxerga todas as seções ao
mesmo tempo, e os ~21 KB que a Fase 7 sobe numa requisição só.

```
shared/save/schema.ts        forma, guarda e migração — puro, não sabe que localStorage existe
app/utils/save-driver        LocalStorageDriver: a única camada que toca o navegador
app/utils/save-document      compor e hidratar o documento a partir das stores
app/plugins/save.client      o boot e a gravação a cada mutação
app/pages/settings.vue       exportar, importar e apagar — o caminho voluntário
app/components/SaveRecoveryNotice.vue  o aviso, que é a outra metade da regra
app/stores/*                 regra e estado; não tocam disco
```

A **ordem de hidratação carrega uma dependência real** — a coleção antes do
deck, porque `deck.hydrate` lê a coleção para descartar a espécie que o save
escalou e a coleção não tem mais — e por isso ela mora em `save-document.ts`, num
lugar só. O boot e a importação de `/settings` fazem a mesma coisa; duas cópias
da ordem é como uma delas fica para trás quando uma store nova entrar.

| versão | o que entrou |
| --- | --- |
| 1 | coleção, pó e progresso de pack |
| 2 | o deck |
| 3 | saldo, insígnias e a batalha em andamento |
| 4 | o dia do pack diário |

Cada passo é uma função pura indexada por posição na cadeia, e **passo novo entra
sempre no fim**: `MIGRATIONS[2]` leva de 3 para 4, e inserir no meio sem
renumerar gravaria a versão errada sem o guarda perceber — ele confere forma, não
número.

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
normal de quem voltou de uma build nova e tem tratamento próprio. O time do
`BattleLog` segue a mesma regra e o teto dele é natural: uma batalha entra com o
deck, e o deck tem `DECK_SIZE` slots — sem isso a lista vazia era recusada e a de
300 ids passava, com `buildSide` montando os 300 do outro lado.

**Apagar e importar por `/settings` passam pelo mesmo backup**, e é a mesma regra
lida ao contrário: ela fala de save que não se entende, e o argumento vale igual
para o clique voluntário — sem conta não existe segunda cópia em lugar nenhum. As
duas portas que isso exigiu (`readRaw` e `archive`) ficaram no
`LocalStorageDriver` e **não** na interface `SaveDriver`: o `HttpDriver` da Fase 7
não tem "o texto no disco", e exigi-lo obrigaria a rede a fingir um conceito
local.

Foi essa fronteira, escrita antes de haver backend, que faz a Fase 7 custar uma
implementação nova (`HttpDriver`, `SyncDriver`) em vez de uma reescrita —
nenhuma store muda de forma.
