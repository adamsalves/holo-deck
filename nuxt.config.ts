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
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim()
  }
  catch {
    return 'unknown'
  }
}

export default defineNuxtConfig({

  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt', '@vueuse/nuxt'],

  devtools: { enabled: true },

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR', class: 'dark' },
      title: 'Holo Deck',
    },
  },

  css: ['~/assets/css/main.css'],

  // Escuro-único: o foil holográfico depende de `background-blend-mode: color-dodge`,
  // que clareia — sobre fundo claro o efeito estoura em branco e deixa de existir.
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

  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-08-28',

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
})
