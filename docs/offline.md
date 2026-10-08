# Offline

O jogo roda sem rede depois da primeira visita, por um service worker nosso
(`scripts/service-worker/worker.ts`), escrito pelo build no fim do pré-render
(`scripts/service-worker/build.ts`, chamado de um módulo em linha do `nuxt.config.ts`,
no hook `nitro:build:public-assets`). Em `yarn dev` não há worker.

**Duas camadas, como o plano desenha:**

| camada | o quê | peso | quando |
|---|---|---|---|
| instalada | o código e o ícone da barra (`_nuxt/`), o dex (`data/`), as mensagens dos dois idiomas (`_i18n/`), as fontes latinas e o shell `200.html` | 2,1 MB em disco, ~680 KB na rede (gzip; 144 KB são as fontes, que o woff2 já comprime) | inteira, antes de o worker assumir |
| guardada como vista | as 1025 miniaturas (`sprites/`) | 6,0 MB | à medida que as telas as mostram; *Baixar tudo para offline*, em *Ajustes*, enche o mesmo cache de uma vez |

Cada arquivo instalado leva a revisão do conteúdo (SHA-256, 16 dígitos): um build novo
baixa só o que mudou, e o worker confere o hash do que baixou — uma cópia de outro
build, servida por um deploy que entrou no meio da instalação, aborta a instalação em
vez de ficar guardada sob a revisão errada. Tudo menos o shell: o preview da Vercel
acrescenta o script da barra de feedback a todo HTML que serve, depois do `</html>`, e
com o shell conferido o worker nunca instalava num preview (medido). As fontes são as faces cujo `unicode-range`
cobre o latim — 10 dos 36 arquivos que o `@nuxt/fonts` escreve; extensão latina,
cirílico, grego e vietnamita nenhum dos dois idiomas pede, e o portão confere isso
perguntando ao navegador, com todo caractere dos locales e do dex.

**Todo endereço instalado muda com o conteúdo.** `_nuxt/`, `_fonts/` e `_i18n/` já
levam hash no caminho; o dex não, e por isso a página o pede com a revisão dele na
query (`dexUrl`: `/data/core.json?v=<revisão>`), calculada uma vez no `nuxt.config.ts`
e entregue às páginas (`runtimeConfig`) e ao builder. As miniaturas guardadas ficam
num cache cujo nome leva a revisão da arte (`holodeck-sprites-<revisão>`): um build que
troca a arte começa um cache vazio, e o velho é apagado quando o worker novo assume.
Só entra como miniatura uma imagem que veio sem redirect.

**A navegação vai à rede primeiro, e ao shell quando não há rede.** A página
pré-renderizada é a resposta melhor quando dá para tê-la. Offline, todo endereço
recebe o mesmo documento: `200.html`, que o Nuxt renderiza sem app no servidor e que
sobe o jogo no cliente para o endereço aberto, a partir do dex instalado. Instalar as
2.104 páginas seriam 109 MB — e cada uma lê seus dados de um `_payload.json` próprio
(~160 KB em `/`). Uma resposta que chega, inclusive 404 e 500, vai para a tela como
veio. Uma rede que conecta e não responde em **3 s** também cai no shell — sem prazo,
a página ficaria em branco pelo tempo que o navegador espera.

**A guarda da raiz vai junto.** Offline, `/` abre como o shell, e o shell sai do build
com a guarda do `app.vue` no topo do `<head>` — sem ela, quem escolheu inglês e abre o
app instalado sem rede via o Hub em português (medido no spike). Por isso a guarda
passou a conferir o caminho: no shell, todo endereço que não é `/` fica onde está.

**Versão nova espera todas as abas fecharem** — decidido em 23/09/2026. Sem
`skipWaiting`: até a última aba da versão velha fechar, o worker velho segue
respondendo com os arquivos do build dele, as únicas cópias que sobram, já que a
Vercel só serve o build mais novo. Assumir no meio da sessão entregaria a uma aba
aberta chunks de outro build, ou a recarregaria no meio de uma batalha. Por isso não
há aviso de atualização, nem prancha para ele.

Nesse meio-tempo, uma página que a rede traz é do build novo — uma aba nova, um
reload — e continua sob o worker velho. Ela não pede arquivo nenhum do build velho,
porque todo endereço instalado muda com o conteúdo (acima). E o save que o build novo
migrou não é sobrescrito pelo velho: offline, o shell velho lê um save de versão maior
que a dele como `unknown-version`, e a sessão joga **em memória** — não grava, não
carimba a última partida e não sincroniza (`holdsNewerSave`, em
`app/utils/save-driver.ts`). O build novo, quando assume, encontra o save onde o
deixou. Apagar ou importar em *Ajustes* é substituir de propósito, e libera a gravação.

**O que o worker nunca toca:** outras origens, métodos que não sejam GET, e `/api/`.
Nada ali se guarda — o save responde por conta, e entrar é uma cadeia de redirects que
grava o cookie de sessão na volta —, então a requisição do navegador é a resposta
inteira: o login corre como correria sem worker, e offline um endereço de `/api/` falha
como a rede falha, em vez de abrir o jogo numa rota que não existe. *Navigation
preload* ficou desligado de propósito: ele dispara a requisição de toda navegação antes
de o worker decidir, inclusive as de `/api/auth/…` que o worker deixa ao navegador, e
se o navegador reaproveita essa resposta ou pede de novo não foi medido — um callback
de OAuth pedido duas vezes gastaria um código de uso único.

**Baixar tudo para offline** é a última linha de *Preferências*, nos quatro estados da
prancha *Offline*: repouso (com a contagem, quando o uso já guardou alguma), baixando,
no aparelho e parou — por *sem rede* ou *sem espaço*, com `CONTINUAR`. Quem baixa é a
**página**, e não o worker: a prancha desenha o download parando ao fechar a aba, e só
quem grava distingue os dois motivos — a escrita do worker (`keptAsShown`) engole a
própria falha, e um disco cheio passaria por download terminado. *Sem espaço* é só o
`QuotaExceededError`: o `Cache.put` lê o corpo, que ainda vem pela rede, e a conexão que
cai no meio dele rejeita a escrita com `NetworkError`, e o prazo que estoura, com
`AbortError` (medido no Chromium) — os dois são da rede. E a página pede **por cima do
worker** (`cache: 'reload'`, que o worker deixa à rede): enquanto o worker novo espera
as abas fecharem, quem responde é o do build velho, e ele daria do cache dele a arte
velha, que, guardada sob a revisão nova, o worker novo seguiria servindo até a próxima
troca de arte. A página grava no cache que o worker lê (o nome leva a revisão da arte,
calculada uma vez no `nuxt.config.ts` e entregue às páginas e ao builder, como a do
dex), seis miniaturas por vez, com 15 s de prazo cada, corpo incluído, e só guarda o que
o worker guardaria: resposta ok, sem redirect e `image/*` — o muro de login do preview
da Vercel seria guardado como miniatura. O estado mora em `useState`: sair de *Ajustes*
não para o download, fechar a aba para, e o que veio fica. Sem worker — navegador sem
suporte, `yarn dev`, a suíte que os bloqueia — a linha não existe. Os `6,0 MB` saem do
disco no build, na conta do tamanho do save (÷ 1024), no formato do idioma (`6.0 MB` em
inglês).

**O jogo é instalável.** O manifesto (`public/manifest.webmanifest`, ligado no `app.vue`
ao lado dos ícones) traz o que a prancha *O ícone do app* manda: nome *Holo Deck*,
`standalone`, fundo e tema `#0B0D14`, e os ícones de 192 e 512, rasterizados do mesmo
mestre no Chromium — cada um listado como `any` e de novo como `maskable`, e não como
`"any maskable"`, que o Chrome desaconselha; o mestre serve aos dois porque o baralho
cabe no círculo que a máscara preserva e o fundo vai até a borda. `start_url`, `scope` e
`id` são `/`, que a prancha não diz: sem isso, quem instala a partir da página de um
Pokémon abriria o app nela toda vez. Quem instala em inglês também abre em `/`, e a
guarda da raiz só leva a `/en` quem escolheu o idioma em *Ajustes*: quem chegou por um
link `/en/…` e nunca escolheu abre o Hub em português, até escolher. Decidido no review
do #70, contra um manifesto por idioma, que duplicaria a lista de ícones. Manifesto e
ícones ficam fora do precache — o navegador os pede fora da página, e o sistema os
guarda na instalação.

**Os portões.** `test/e2e/offline-precache.spec.ts` lê a lista do `/sw.js` servido e a
confronta com o que ela não gerou: o disco (todo arquivo de `.output/public` é
instalado ou sai por uma regra nomeada), o que as 12 páginas carregam no navegador nos
dois idiomas — servidas como página **e** subidas pelo shell, que é quem pede o dex —,
as fontes que o texto pede ao navegador, o servidor (toda entrada responde 200, sem
redirect) e um orçamento por fonte. `test/unit/service-worker-runtime.spec.ts` roda o
worker que o build serve num sandbox: o que ele deixa ao navegador, a instalação que
recusa cópia de outro build, o prazo da navegação, a miniatura que só entra como imagem
— no worker e no download, pela mesma tabela —, o download de uma página nova sob o
worker de outro build, e o `activate`. `test/e2e/offline.spec.ts` derruba a rede com o
worker instalado: página nunca aberta sobe pelo shell, `/en` sai em inglês, a raiz segue
a escolha, `/api/` falha como a rede, uma batalha vai até o fim — cada imagem recuando
uma vez, e nunca em laço —, a miniatura que falta vira o glifo, desenhado, na grade e
na busca, o herói cai na miniatura guardada e no glifo com o chip da prancha, nos dois
idiomas, e volta à arte quando a rede volta, e o *Baixar tudo* deixa no cache do worker exatamente as miniaturas do build — e nenhuma em
outro cache, de nome nenhum —, para por rede e por espaço, conta o que o aparelho tem e
continua longe de *Ajustes*. `test/unit/sprite-download.spec.ts` cobre o laço (o que guarda, o que pede,
que motivo cada falha dá, o prazo) e confere a lista de endereços contra o disco, como
conjunto.
`test/e2e/pokedex.spec.ts` derruba só o host da arte, antes da hidratação: o herói cai
na miniatura, sem chip. E, a 320 e 360 px, o recuo com o chip fica na caixa da arte, sem
nada saindo dela. `test/unit/token-gate.spec.ts` confere que o glifo segue a cor do token
que ele copia.
`test/e2e/app-icon.spec.ts` lê o manifesto como o navegador o recebe: nome, cores, o
conjunto de tamanhos e finalidades contra o da prancha, e cada ícone do tamanho que
declara e sem canal alfa. O resto da suíte roda com service worker bloqueado
(`playwright.config.ts`): o que o worker responde não passa pelo `page.route` — e é
também onde `settings.spec.ts` confere que, sem worker, a linha do download não existe.

**A arte que não está no aparelho**, como a prancha *Offline* desenha:

- **A miniatura que falta vira o glifo** de offline da prancha. Um listener de `error`
  em captura na `window` (`app/plugins/missing-sprite.client.ts`) troca toda `<img>` de
  `/sprites/` que falha e para o evento ali, antes dos listeners da própria imagem: o
  `UAvatar` da busca trocaria a imagem por um `<span>` vazio. O recuo da batalha
  (`fallbackSprite`) punha de volta o endereço que acabou de falhar — o laço de
  `onerror`, medido — e agora só recua a partir do GIF: o laço fecha nele, e não
  depende do listener. Um lugar só alcança todos os pontos que pedem miniatura — 15, em
  12 arquivos, fora o styleguide. O glifo é um `.svg` inlinado (`?inline`) com a cor escrita nele
  (`--color-ink-400`, a que a prancha dá na carta), porque imagem não lê variável CSS;
  o `viewBox` o deixa com 34 px a cada 96, como a carta da prancha, em qualquer
  tamanho de miniatura.
- **O herói de `/pokemon/[name]` cai em dois degraus**: da arte oficial para a
  miniatura em 2×, e dela para um glifo maior, em `--border-strong`, na caixa que a
  arte ocupava, com a altura dela também no telefone — a página abaixo não se move. A arte nunca fica no aparelho (são ~140
  MB, fora do *Baixar tudo* de propósito), então o recuo vale mesmo com tudo baixado.
  O herói sai do listener global (`data-own-fallback`), porque o glifo e o chip dele
  são outros.
- **O chip só enquanto o navegador diz que não há rede** (`navigator.onLine`, o sinal
  que o sync já lê, acompanhado pelo `useOnline`). Quando a rede volta, o chip some e
  a arte é pedida de novo: *a arte chega com a conexão*, como ele diz. Com rede, a arte que falha — o host fora do ar ou bloqueado — cai na
  miniatura sem chip: ver *Decidido no PR 5 da Fase 8, além do que a prancha
  desenhava*. A falha que chega antes da hidratação, na página pré-renderizada, se
  confere no `onMounted`, porque o `@error` ainda não estava ligado.
- A batalha já trocava o GIF pela miniatura; sem as duas, o mesmo glifo, uma vez por
  imagem.

**Limite conhecido:** o que a primeira página carregou antes de o worker assumir não
fica guardado — dali em diante, sim.

**Para conferir à mão:** `yarn build && yarn preview`, abrir `/rules` — não a raiz: o
`yarn preview` serve `/` sem `cache-control`, o navegador a reaproveita do cache HTTP, e
offline a raiz voltaria de lá e não do shell —, esperar o worker (*DevTools →
Application → Service workers*, `activated`) e derrubar o servidor com `Ctrl+C` no
`yarn preview`. Qualquer página, mesmo nunca aberta, sobe. Com *Baixar tudo* feito em
*Ajustes* antes de derrubar, o Pokédex de qualquer geração abre com as miniaturas; sem
ele, com o glifo onde a miniatura não foi vista. O chip do herói pede o navegador sem
rede, e servidor derrubado não é isso: `navigator.onLine` segue `true`, e o herói cai
sem chip. Para vê-lo, desligar a rede do computador; religada, o chip some e a arte
volta. O `context.setOffline` do
Playwright só chega ao documento que estava aberto: um documento novo, subido pelo
worker, lê `true` — medido contra o Chromium num namespace de rede sem interface, que
lê `false`. Por isso os testes do chip chegam ao herói pela grade e pela busca.

**Instalar não se confere no preview da Vercel**, como o login: o navegador pede o
manifesto sem credenciais, e a proteção do preview o redireciona para o SSO, junto com os
ícones (medido no #70: `302` e `ERR_FAILED`). Só em `localhost` e em produção.
