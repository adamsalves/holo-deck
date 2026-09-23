import { execSync } from 'node:child_process'
import pkg from './package.json' with { type: 'json' }
import { DEFAULT_LOCALE, LOCALES, pathInLocale } from './app/utils/locales.ts'
import { OFFLINE_SHELL_PATH } from './app/utils/offline.ts'
import { GYM_COUNT } from './shared/types/brand.ts'

/**
 * Sha curto do commit em produção. Num jogo com save local, "que versão você está
 * rodando" é a primeira pergunta de qualquer relato de bug — por isso ele viaja
 * junto com a versão até a tela de Ajustes.
 */
function resolveGitSha(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA
  if (fromEnv) return fromEnv.slice(0, 7)

  try {
    // `stdio` explícito porque sem ele o stderr do git é herdado do processo pai:
    // o catch abaixo pega a exceção, mas um `fatal: not a git repository` já
    // vazou para a tela. Isso roda no postinstall, então qualquer build sem .git
    // (Docker COPY, tarball de fonte) assustaria durante o `yarn install`.
    return execSync('git rev-parse --short=7 HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  }
  catch {
    return 'unknown'
  }
}

/**
 * The site's own origin, for the links the i18n module writes into every head —
 * `hreflang`, `canonical` and `og:url`.
 *
 * **Production's, on every deploy, previews included.** Vercel sets
 * `VERCEL_PROJECT_PRODUCTION_URL` on preview builds too, and that is the point
 * of reading it: a preview is a copy of the site under a throwaway host, and its
 * canonical should name the page it copies. The variable carries no scheme, so
 * the `https://` is added here. The fallback is the same origin written out, for
 * every build that is not Vercel's — CI, `yarn build` on a laptop.
 *
 * **It is not the request's origin, on purpose.** Every page is prerendered, so
 * the request is the prerenderer's own `localhost` — an origin baked into 2.104
 * files that nobody outside the build machine can open. The module's fallback
 * without a `baseUrl` is worse: relative links, which Google ignores in an
 * `hreflang` annotation, and one warning per page (issue #39).
 */
function resolveSiteUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL

  return host ? `https://${host}` : 'https://holo-deck.vercel.app'
}

export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',

    /**
     * `/styleguide` existe só em desenvolvimento.
     *
     * Ela é o espelho do sistema de design — o lugar onde dá para ver que o foil
     * começa em raro e que `prefers-reduced-motion` para tudo. Isso é ferramenta
     * de quem constrói, não superfície do jogo: mantê-la fora do build evita
     * inventar uma rota que o plano não tem e não deixa uma página de tokens
     * pública e indexável.
     *
     * Módulo em linha, e não um `hooks:` no config, por causa do `nuxt` que ele
     * recebe: `nuxt.options.dev` é a fonte que o próprio Nuxt usa para decidir o
     * modo. `process.env.NODE_ENV` é uma sombra dela — sobrevive a um
     * `NODE_ENV=development yarn build` e publicaria a página.
     */
    (_options, nuxt) => {
      nuxt.hook('pages:extend', (pages) => {
        if (nuxt.options.dev) return

        const index = pages.findIndex(page => page.path === '/styleguide')
        if (index !== -1) pages.splice(index, 1)
      })
    },

    /**
     * **The service worker, written once the prerender is done** — see
     * `scripts/service-worker/build.ts` for what it installs, and
     * `scripts/service-worker/worker.ts` for how it answers.
     *
     * `nitro:build:public-assets` and not an earlier hook: it runs after the
     * prerender has written every page and after `public/` has been copied in,
     * so the shell the worker falls back on and the files it hashes are the ones
     * that ship — in `.output/public` and in `.vercel/output/static` alike. It
     * does not run in `yarn dev`, which has no worker.
     *
     * Imported inside the hook and not at the top of this file: the builder
     * brings the TypeScript compiler, and every `nuxt` command reads this file.
     */
    (_options, nuxt) => {
      nuxt.hook('nitro:build:public-assets', async (nitro) => {
        const { writeServiceWorker } = await import('./scripts/service-worker/build.ts')
        const { entries, bytes } = await writeServiceWorker(nitro.options.output.publicDir)

        console.info(`service worker: ${entries} files, ${Math.round(bytes / 1024)} KB installed on the first visit`)
      })
    },
  ],

  devtools: { enabled: true },

  app: {
    head: {
      // `lang` **não** mora mais aqui: quem o escreve é o `@nuxtjs/i18n`, a
      // partir do locale ativo. Fixo em `pt-BR`, ele mentiria em toda rota
      // `/en/…` — e mentir no `lang` é o leitor de tela lendo inglês com voz
      // portuguesa. A classe `dark` continua, que é tema e não idioma.
      htmlAttrs: { class: 'dark' },
      title: 'Holo Deck',
      // O `preconnect` da arte oficial **não** mora aqui: quem carrega imagem de
      // terceiro é só `/pokemon/[name]`, e no `app.head` as outras 11 rotas
      // pagariam um DNS+TLS que nunca usam. Ele vive num `useHead` da própria
      // página, que é onde o custo se paga.
    },
  },

  css: ['~/assets/css/main.css'],

  // Escuro-único: o foil holográfico depende de `mix-blend-mode: color-dodge`,
  // que clareia — sobre fundo claro o efeito estoura em branco e deixa de existir.
  // (O plano escreve `background-blend-mode`; quem renderiza é o `mix-`.)
  // Sem @nuxtjs/color-mode em runtime: a classe `dark` é fixa no <html>.
  ui: {
    colorMode: false,
  },

  runtimeConfig: {
    public: {
      appVersion: pkg.version,
      gitSha: resolveGitSha(),
    },
  },

  // Já é o default no Nuxt 4.5 — fica explícito como pino para a subida ao
  // Nuxt 5, que muda o default. Hoje não altera comportamento nenhum.
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-08-28',

  /**
   * A Pokédex inteira sai pronta do build.
   *
   * O plano põe o SEO nestas páginas, e SEO exige HTML com conteúdo — não uma
   * casca que preenche depois. Pré-renderizar também resolve uma segunda coisa
   * que não é opcional: o dex é lido do disco no servidor (ver `useDex`), e o
   * build é o único momento em que `public/data/` existe ao lado do processo.
   * Numa função da Vercel ele não estaria lá.
   *
   * `crawlLinks` é quem alcança as 1025: a raiz leva às nove regiões, e o grid
   * de cada região carrega um link por espécie no HTML servido. É a mesma razão
   * de o grid ser renderizado inteiro no servidor — sem esses links, o
   * rastreador pararia em nove páginas.
   */
  nitro: {
    prerender: {
      crawlLinks: true,
      /**
       * **The nine gyms, in every language — and nothing else, because every
       * other page comes out without a list.**
       *
       * What prerenders a page no link reaches is Nuxt's own prerender plugin
       * (`nuxt/dist/pages/runtime/plugins/prerender.server.js`, loaded because
       * `crawlLinks` is on): it queues every route of the router whose path has
       * no parameter. The i18n module registers each page once per language —
       * `/login` and `/en/login` are two routes — so every static screen comes
       * out in both, linked or not. `/pokedex`, `/league` and `/login` sat on
       * this list until the review of PR #65, on the belief that the crawler
       * could not reach them; measured, the build without the three is the same
       * 2.104 pages. Nor is it `@nuxtjs/i18n`, as this comment said for a PR:
       * its prerender hook only runs with `nitro.static`, which `nuxt build`
       * leaves off.
       *
       * `/battle/:gymId` has a parameter, so the plugin skips it, and no served
       * page links to it: the League's body is a `<ClientOnly>` — badges and deck
       * live in `localStorage` —, so the links to `/battle/N` exist in no served
       * HTML. Without this list `/battle/3` would be the first valid route of the
       * repository **not** prerendered, and the premise under the server's
       * `useDex()` would fall with it: today the only class of URL that reaches
       * the function is the invalid one, which is when it has to read the index
       * to answer 404. Until the list named the nine `/en/battle/N`, the English
       * battles were exactly that — served by the function, and carried by
       * `test/e2e/prerender-payload.spec.ts` as its one exception.
       *
       * `GYM_COUNT` and not a literal `9`: the number is the same contract the
       * store, the save guard and the League read, and a copy of it here would
       * only be found out by a new gym nobody can open in production. And
       * `LOCALES`, so a third language gets its nine the day it is declared.
       *
       * **And the offline shell, which no link reaches either.** `200.html` is
       * one of the addresses Nuxt's renderer serves with no app on the server
       * (`PRERENDER_NO_SSR_ROUTES`): an empty document that boots the game on the
       * client for whatever address it is opened at. It is what the service
       * worker answers every navigation with once the network is gone, so each
       * of the 2,104 pages is playable offline without the worker installing any
       * of them. `nuxt generate` adds it on its own; `nuxt build` only when told.
       */
      routes: [
        OFFLINE_SHELL_PATH,
        ...LOCALES.flatMap(({ code }) => Array.from(
          { length: GYM_COUNT },
          (_, index) => pathInLocale(`/battle/${index + 1}`, code),
        )),
      ],
    },

    /**
     * O dex viaja **junto do servidor**, e não só em `public/`.
     *
     * `public/` é servido pela CDN e não é embarcado na função: conferido no
     * preset da Vercel, onde `.vercel/output/static/data/` tem os arquivos e
     * `.vercel/output/functions/__fallback.func/` não tem nenhum. Toda rota
     * válida é pré-renderizada, então a função só é alcançada por URL inválida —
     * que é justamente quando `useDex()` precisa ler o índice para responder 404.
     * Sem esta cópia, `/pokemon/qualquer-coisa` respondia **500** em produção.
     *
     * `serverAssets` também é o que tira a leitura do `process.cwd()`: o caminho
     * em disco deixa de existir como conceito, e os quatro modos — dev,
     * pré-renderização, `node .output/server/index.mjs` e serverless — passam a
     * ler pelo mesmo lugar. `dir` é relativo ao `srcDir` do Nitro, que no Nuxt é
     * `server/`.
     *
     * Quem lê é `server/routes/__dex/[file].get.ts`, e não o composable direto:
     * `useStorage` só enxerga estes assets dentro do contexto do Nitro. Importar
     * `nitropack/runtime` de `app/` devolve outra instância do módulo, com o
     * storage vazio — passa no `yarn build`, onde o Nitro empacota tudo num grafo
     * só, e derruba o `yarn dev`, onde o Vite carrega o código de app separado.
     *
     * O preço é a função crescer de 3,4 MB para 5,3 MB, e ele é aceito: os
     * arquivos entram como chunks separados e só o pedido é carregado, então o
     * custo é de tamanho de deploy, não de cold start.
     */
    serverAssets: [
      { baseName: 'dex', dir: '../public/data' },
    ],
  },

  typescript: {
    strict: true,
    // O portão roda em `yarn typecheck` (CI e local), não a cada HMR.
    typeCheck: false,
  },

  eslint: {
    config: {
      // Regras de formatação no próprio ESLint, sem Prettier. Decidido na
      // Fase 0 para que nenhuma fase futura pague um commit de reformatação.
      stylistic: true,
    },
  },

  /**
   * As duas famílias do tema, declaradas em vez de deixadas para descoberta.
   *
   * O `@nuxt/fonts` acha a família varrendo o CSS, mas os **pesos** ele infere do
   * que encontra escrito — e peso usado só em componente que ainda não existe não
   * é encontrado. Declarar aqui faz o build baixar a mesma coisa hoje e na Fase 6.
   *
   * Chakra Petch vai até 700; o canvas usa 800 em rótulo, que o navegador
   * sintetizaria engordando o traço. O sistema usa 700, que é o negrito real.
   */
  fonts: {
    families: [
      { name: 'Chakra Petch', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 700] },
    ],
  },

  /**
   * pt-BR na raiz, inglês em `/en/…`.
   *
   * `prefix_except_default` é o que mantém as URLs de hoje intactas: o locale
   * padrão não recebe prefixo, então `/collection` continua sendo `/collection`
   * e nenhum link, rota pré-renderizada ou teste existente muda de endereço.
   *
   * O módulo também passa a ser o dono do atributo `lang` do `<html>` e das
   * tags `hreflang` — ver a nota em `app.head.htmlAttrs` acima.
   *
   * The languages themselves come from `app/utils/locales.ts`, and the file of
   * each one is named after its code — see that module for why the list left
   * this file.
   */
  i18n: {
    strategy: 'prefix_except_default',
    defaultLocale: DEFAULT_LOCALE,
    langDir: 'locales',
    baseUrl: resolveSiteUrl(),

    /**
     * **Desligada, e isto conserta um defeito medido.**
     *
     * O módulo liga a detecção por padrão, com `useCookie` e `redirectOn: 'root'`:
     * quem chega em `/` com `Accept-Language: en-US` é trocado para o inglês na
     * hidratação. O efeito é pior do que parece, porque o HTML **pré-renderizado**
     * da raiz é pt-BR — sai `lang="pt-BR"` com *Coleção* escrito — e a hidratação
     * reescreve a barra para *Binder*, *League*, *Sign in*. Um jogador brasileiro
     * de navegador em inglês via a tela trocar de idioma sozinha, com o `lang` do
     * documento discordando do texto.
     *
     * Medido no e2e: a árvore de acessibilidade da raiz vinha em inglês, porque o
     * Chromium do Playwright não declara locale e manda `en-US`. Quatro suítes
     * reprovaram procurando *Entrar* num link que dizia *Sign in*.
     *
     * O plano fecha **pt-BR na raiz e inglês em `/en/…`** — o idioma é escolha de
     * URL, e a partir da Fase 8 também do seletor em *Ajustes*. Adivinhar pelo
     * cabeçalho do navegador contradiz as duas coisas.
     */
    detectBrowserLanguage: false,
    locales: LOCALES.map(({ code, language }) => ({ code, language, file: `${code}.json` })),
  },

})
