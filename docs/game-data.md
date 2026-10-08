# Dados do jogo

O dex **não** é buscado em runtime. Ele é gerado por
[`scripts/build-dex.ts`](../scripts/build-dex.ts), commitado em `public/data/` e
`public/sprites/`, e lido pelo composable `useDex()`. Nem o CI nem a Vercel
chamam a PokeAPI — o que respeita o fair use de uma API explicitamente
não-comercial, torna o build determinístico e é o que viabiliza grid de 1025
cartas, evolução sem requisição e o modo offline.

```bash
yarn data:build                    # o dex inteiro (1ª vez ~10 min; depois, cache)
yarn data:build --species 4,5,6 --out /tmp/dex   # ensaio, sem tocar public/data
```

O ensaio parcial **exige** o `--out`: ele grava exatamente os mesmos nomes de
arquivo do build completo, então sem a flag trocaria o dex de 1025 espécies por
um de 3 — e sairia com sucesso. O script recusa. Ele também recusa apagar um
diretório de saída que contenha qualquer coisa que não seja dex gerado, o que é
o que impede um `--out public` de levar os 1025 sprites junto.

As checagens da Fase 1 impressas no fim **reprovam o build**: um ✗ num build
completo sai com código 1. Num ensaio parcial elas falham por construção — três
espécies não somam 1025 — e ali o resultado é só informativo.

O crawl guarda tudo em `.cache/pokeapi/` (gitignorado, gzipado), então a segunda
execução não faz requisição nenhuma. **Rodar isto só é necessário quando o
pipeline muda**; para jogar ou desenvolver, os arquivos commitados bastam.

| Arquivo             | Conteúdo                                              |
| ------------------- | ----------------------------------------------------- |
| `core.json`         | matriz de efetividade 18×18, catálogo de golpes — de dano e os 10 de status —, gerações |
| `chains.json`       | as 541 cadeias de evolução já resolvidas em árvore    |
| `gen-N.json`        | as espécies da geração N — o que o grid precisa       |
| `index.json`        | id, slug, nome, geração, tipos, BST e as duas marcas das 1025 — o que a busca global indexa, o que faz `/pokemon/[name]` achar a geração de um slug sem abrir os nove arquivos, e o que dá ao pack e ao binder a raridade de qualquer espécie |
| `flavor-N.json`     | as descrições, **em arquivo separado**: pesam mais que todo o resto do dex junto, e só a página de detalhe as usa |
| `sprites/{id}.webp` | miniatura de 128 px, recortada no alpha               |

Sete coisas que o pipeline decide e que não dá para deduzir lendo a saída:

- **O índice guarda os insumos da raridade, não a raridade.** `bst`,
  `isLegendary` e `isMythical` entraram na Fase 5, porque o pack sorteia sobre as
  1025 de uma vez e o binder conta tier de espécie de qualquer geração — e nenhum
  dos dois pode abrir 319 KB de `gen-N.json` para saber a que faixa pertence um
  id. Guardar `rarity` já calculada poria os limiares num JSON gerado que ninguém
  rebuilda ao mexer neles; a regra continua sendo `rarityFrom()`. Custo medido:
  92 → 141 KB crus, **15,1 → 18,5 KB comprimido**, porque `isLegendary:false`
  repetido 1025 vezes é quase de graça no gzip. O portão de `dex-index.spec.ts`
  confere os campos contra `gen-N.json` **e** o veredito de raridade pelos dois
  caminhos — sem o segundo, uma carta poderia mudar de raridade ao trocar de
  tela sem nenhum dos lados parecer errado no diff.

- **A versão de um moveset vem do campo `order`, nunca do id do version group.**
  `blue-japan` tem id 29 e `scarlet-violet` tem 25 — a PokeAPI cadastrou o
  relançamento japonês de 1996 depois. Ordenar por id dá às 1025 espécies o
  moveset de Game Boy, e o resultado é plausível o bastante para ninguém notar.
- **Menos de 4 golpes por nível completa com máquina e tutor**, do mesmo version
  group. Parar no primeiro método com resultado dava 2 golpes a Clefable,
  Ninetales, Poliwrath e Ludicolo: são evoluções por pedra, o grupo mais recente
  quase não lhes ensina por nível, e o mesmo grupo tem máquina e tutor de sobra.
  Sobram 19 espécies abaixo das 4 vagas — Metapod só sabe Harden, Magikarp só
  Splash e Tackle —, e o build lista as 19 no relatório.
- **Uma das oito vagas é reservada para golpe de status**, e ela é a razão de o
  catálogo ter deixado de ser só de dano na Fase 4. Sem ela nada no dex diz que
  Thunder Wave paralisa, e as quatro condições do motor ficam sem origem — só
  efeitos secundários dariam 36 golpes, alcançariam 383 espécies e deixariam o
  sono com um golpe único. **A vaga não disputa com os de dano**: o moveset de
  dano é escolhido primeiro, exatamente como antes, e a vaga custa a oitava
  posição de quem já a tinha cheia. Rodando o pipeline com e sem a mudança, 716
  espécies ficaram idênticas, 309 perderam só o oitavo golpe, e nenhuma mudou de
  outra forma. Hoje 515 das 1025 levam uma condição, e o desempate entre duas é
  por acurácia — Spore antes de Hypnosis —, nunca por qual condição é melhor.
- **Dez espécies não têm golpe de dano nenhum** e caem em Struggle, como nos
  jogos: Metapod, Kakuna, Abra, Ditto, Wobbuffet, Smeargle, Wynaut, Pyukumuku,
  Cosmog e Cosmoem. A PokeAPI dá `pp: 1` a Struggle por resíduo do dado de 1ª
  geração; o motor de batalha precisa tratá-lo como ilimitado, senão os dez
  atacam uma vez por batalha. Pyukumuku é a única das dez que sai com dois
  golpes: ela não sabe atacar, mas sabe envenenar, e leva Toxic ao lado de
  Struggle.
- **Uma aresta de evolução chega sem condição.** `phione → manaphy` vem da
  PokeAPI com `evolution_details` vazio. O build relata a aresta em vez de
  inventar uma condição, e o `via` de `EvolutionNode` é opcional por causa dela.
- **Import relativo dentro de `shared/` leva `.ts` explícito.** O script carrega
  `shared/` em Node puro, que não tem a resolução sem extensão do Vite — um
  `from './brand'` ali quebra o `yarn data:build` e nada mais.
