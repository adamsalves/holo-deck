import { execSync } from 'node:child_process'
import pkg from './package.json' with { type: 'json' }

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

export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt',
    '@vueuse/nuxt',

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
  ],

  devtools: { enabled: true },

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR', class: 'dark' },
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
      routes: ['/pokedex'],
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

})
