# Pokédex

Referência completa das 1025 espécies — **não** coleção. Elas aparecem todas,
possuídas ou não; quem cuida de posse, duplicata e pó é a `/collection`, que
chega na Fase 5.

| Rota               | O que é                                                   |
| ------------------ | --------------------------------------------------------- |
| `/pokedex`         | as 9 gerações como cartas de região                       |
| `/pokedex/[gen]`   | o grid da região, virtualizado                            |
| `/pokemon/[name]`  | a espécie: Sobre, base stats, relações de dano e evolução |

Busca global em `Cmd/Ctrl+K`, em qualquer uma das três. Ela indexa nome, número e
tipo — dá para procurar por `venenoso` ou por `0150` — e só baixa o `index.json`
quando abre pela primeira vez.

O grid filtra por tipo, por raridade e por **posse**. Tipo e raridade são
cumulativos — **OU** dentro de cada grupo, **E** entre eles. Posse é
**exclusiva**, e isso não é inconsistência: *Possuídos* e *Faltando* particionam
o mesmo conjunto, então ligar os dois é o mesmo que ligar nenhum.

O grupo de posse chegou na Fase 5, que é a que criou a coleção; antes dele um
filtro *Possuídos* que devolve zero sempre não seria um filtro incompleto, seria
um filtro mentiroso. Enquanto o save não carregou, a contagem é `null` e o grupo
inteiro não aparece — `0` afirmaria uma coleção vazia que ninguém verificou.

Quatro decisões desta fase que não se deduzem lendo o código:

- **O grid existe em duas formas.** O servidor renderiza as 151 cartas inteiras;
  o cliente monta a versão virtualizada por cima. Não é redundância: o HTML
  servido é a única coisa que linka as 1025 páginas de detalhe, e são elas que
  carregam o SEO. Um HTML pré-renderizado com as 18 cartas visíveis deixaria 133
  páginas de Kanto sem nenhuma referência apontando para elas. A troca é feita
  pelo `<ClientOnly>`, que garante que o HTML servido e o primeiro render do
  cliente sejam o mesmo. **E ela custa uma hidratação inteira**: o `ClientOnly`
  mostra o fallback enquanto `mounted` é `false`, e ele só vira `true` no
  `onMounted` — na hidratação, quem está montado é a forma completa. As 151
  cartas são hidratadas e descartadas um tick depois. O preço dos 151 links é
  esse, e é real.
- **O SSR lê o dex do `serverAssets`; o navegador busca por HTTP.** Em servidor
  o `$fetch` relativo não sai pela rede — ele chama o app h3 por dentro, e asset
  público não é rota do h3: o caminho cai no renderizador de páginas e volta o
  HTML de 404. A leitura em servidor passa pelo `serverAssets` do Nitro, que
  embarca `public/data/` junto do servidor.

  **Isso é correção de um defeito de produção.** A primeira versão montava
  `join(process.cwd(), 'public' | '.output/public', …)`, e esses dois caminhos só
  são a raiz do projeto no build e no `yarn preview`. Num deploy serverless o
  `cwd` é a raiz da função e o dex não está lá — no preset da Vercel ele vai
  inteiro para `.vercel/output/static/` e a função não recebe cópia nenhuma.
  Como toda rota válida é pré-renderizada, a única classe de URL que chega ao
  servidor é a inválida, que é justamente quando o índice precisa ser lido para
  responder 404: `/pokemon/<slug inexistente>` respondia **500, com o caminho
  absoluto do servidor na linha de status e no corpo**. O e2e que provava o 404
  não pegava porque roda contra `yarn preview` a partir da raiz do repositório —
  o único `cwd` em que o código quebrado funcionava. Agora quem prova, no preset
  do `yarn build`, é
  [`test/e2e/server-runtime.spec.ts`](../test/e2e/server-runtime.spec.ts), que sobe
  uma cópia do servidor construído, fora do repositório.

  **O alcance do portão, hoje.** Os dois presets respondem à mesma conferência, e
  o da Vercel — o que vai ao ar — tem o seu próprio comando
  (`yarn build:vercel` e `yarn check:vercel-bundle`):

  - **A mesma sonda, nos dois presets, em toda língua.**
    [`test/support/server-probe.ts`](../test/support/server-probe.ts) tira as URLs
    das fontes. Primeiro pede ao servidor o próprio índice, pela rota que o
    `useDex()` dele usa (`/__dex/index.json`): 200, com a espécie real dentro.
    Depois, para cada língua de `LOCALES`, `/pokemon/missingno` e `/pokedex/99`
    respondem 404 sem caminho na linha de status nem no corpo — pedidos como o
    `fetch` pede e com `Accept: text/html`, que é a página de erro que o
    visitante recebe —, e cada um tem o seu 200 ao lado: a primeira espécie do
    índice e a primeira geração do dex, com o nome de uma espécie no corpo. A
    entrada inválida é conferida contra a fonte: se `missingno` virar slug ou
    `gen-99.json` virar arquivo, a sonda acusa a entrada, e não o servidor.

    **Quem distingue o servidor que lê o dex do que não lê é a rota, e não as
    páginas.** No preset do `yarn build` a página de uma espécie real é um
    arquivo estático, respondido antes de o app ser consultado. Com a leitura de
    volta em `process.cwd()` na forma "ausente é 404", todo 404 seguia 404 pelo
    motivo errado, o 200 seguia 200, e o spec passava. Com a pergunta ao índice
    ele reprova: `GET /__dex/index.json: answered 404 …, expected 200`.
  - **Uma cópia do servidor, fora do repositório.**
    [`test/support/built-server.ts`](../test/support/built-server.ts) copia a pasta
    do servidor — `.vercel/output/functions/__fallback.func` num preset,
    `.output/server` no outro — para um diretório temporário e sobe a cópia num
    processo filho, com o `cwd` nela, que é a forma de `/var/task`. Rodando do
    lugar onde o build a deixou, a função achava o `node_modules` do projeto
    subindo pelos diretórios pais: com o dela renomeado, o portão passava. Antes
    de subir, cada arquivo da cópia é lido atrás do caminho do repositório, que é
    o que pega o build que deixou de rastrear dependências e passou a importar
    por caminho absoluto. O pronto é a linha que o próprio filho imprime com a
    porta, e não a porta respondendo: um servidor velho na mesma porta não
    responde no lugar dele. Na função não há página estática, então os 200 são
    SSR lendo o dex embarcado. Provado plantando de volta a leitura por
    `process.cwd()`: as conferências de disco seguem passando, e só a sonda
    acusa.
  - **Toda função é a de fallback.** O preset escreve 16 pastas `.func`, e 15 são
    link para `__fallback.func`. As aninhadas são as que o `config.json` roteia —
    `/pokemon/<name>` vai para `pokemon/[name].func` —, então o script anda a
    árvore inteira e cobra que cada uma resolva para a de fallback, que é a única
    que ele sobe, sonda e lê.
  - **As páginas, por origem, cada uma com o seu payload.**
    [`test/support/prerendered-routes.ts`](../test/support/prerendered-routes.ts)
    compara cada língua com o que as fontes nomeiam — as páginas de `app/pages`
    sem parâmetro, as gerações pelos `gen-N.json`, as espécies pelo índice, as
    batalhas por `GYM_COUNT` e o shell offline pelo nome —, nos dois sentidos, em
    `.output/public` no e2e e em `.vercel/output/static` no script. São 2.104
    páginas, 1.052 por língua, e 2.104 payloads: página sem `_payload.json` ao
    lado é página que o build não renderizou. O piso `> 1000` que havia antes
    ficou verde com as nove batalhas fora das duas línguas; agora o portão
    reprova nomeando as 18.
  - **O Node da função.** O Nitro 2.13 só conhece Node 18, 20 e 22 e caía para 22
    no build em Node 24. O `nuxt.config.ts` declara `nodejs24.x` por literal, e o
    script confere o major do `.vc-config.json` contra o do `.nvmrc`: uma subida
    do `.nvmrc` reprova o portão e é decidida, em vez de mudar o runtime de
    produção sozinha. O `engines.node` fica fora da conta porque o `yarn install`
    já recusa um Node fora da faixa dele.

  **O que continua fora:** o deploy de verdade, a terceira saída da #15. O
  preview fica atrás da autenticação da Vercel, então o que a Vercel faz com a
  saída — inclusive rodar a função no `nodejs24.x` — continua conferido à mão. E
  o `config.json`: o portão lê que a página foi escrita, e não os `overrides` que
  dão a cada arquivo o seu endereço na borda.
- **Tudo é pré-renderizado — 2.104 páginas, 1.052 por língua, ~40 s de build.**
  `crawlLinks` parte de `/pokedex`, alcança as nove regiões e, de cada grid, as
  1025 espécies. As
  três abas do detalhe são montadas mesmo fechadas (`unmount-on-hide` desligado):
  sem isso o HTML sai com a descrição e **sem** base stats, relações de dano e
  linha evolutiva, que é o conteúdo pelo qual a página seria encontrada.
- **A arte oficial do herói é um `<img>` cru, não `<NuxtImg>`.** O plano pedia
  `@nuxt/image`; com o otimizador no caminho, pré-renderizar as 1025 páginas vira
  1025 downloads de `raw.githubusercontent.com` durante o build — testado, e o
  GitHub derruba a conexão no meio. Trocar uma dependência de rede em runtime por
  uma em tempo de build é pior: ela quebra o deploy.

A raridade (`shared/game/rarity.ts`) e a matriz de tipos
(`shared/game/typechart.ts`) estavam marcadas para as fases 4 e 5 e chegaram
aqui, porque a Pokédex as exibe e nenhuma das duas depende de coleção. Os
limiares saem do percentil sobre as 1025, não do chute: com os originais do plano
a distribuição saía invertida, com *raro* virando o maior tier do jogo.
