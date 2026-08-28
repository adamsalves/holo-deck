import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    // Sem isso o Vitest sai com erro em toda fase que ainda não trouxe teste,
    // travando o CI. O motor de jogo da Fase 4 é o que enche esta suíte.
    passWithNoTests: true,
    include: ['test/unit/**/*.spec.ts'],
    // Padrão node: `shared/game/` é headless de propósito. Teste que precisa de
    // DOM declara `// @vitest-environment nuxt` no topo do próprio arquivo.
    environment: 'node',
  },
})
