import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    // Sem isso o Vitest sai com erro em toda fase que ainda não trouxe teste,
    // travando o CI. O motor de jogo da Fase 4 é o que enche esta suíte.
    passWithNoTests: true,
    // Duas pastas por um motivo de tipagem, não de gosto: `test/nuxt/` é a
    // convenção que o `tsconfig.app.json` gerado pelo Nuxt já inclui, e é a
    // única onde `useState` e `createError` existem para o `yarn typecheck`.
    // Um teste de composable em `test/unit/` compila no Vitest e falha no
    // portão de tipos — os dois portões precisam concordar.
    include: ['test/unit/**/*.spec.ts', 'test/nuxt/**/*.spec.ts'],
    // Padrão node: `shared/game/` é headless de propósito. Teste que precisa de
    // DOM declara `// @vitest-environment nuxt` no topo do próprio arquivo.
    environment: 'node',
    /**
     * Vinte segundos, e não os cinco do padrão.
     *
     * Não é folga para teste lento: os testes de unidade rodam em milissegundos,
     * e o de 100 mil aberturas leva ~100 ms. O que passa dos cinco segundos é o
     * **custo de montar** — `mountSuspended(DexGrid)` com as 151 de Kanto
     * encosta nos 5 s numa máquina de desenvolvimento comum, e o resultado é um
     * portão que reprova por velocidade de CPU em vez de por defeito. Um teste
     * que falha por motivo alheio ao código é pior que um teste lento: ele
     * ensina a re-rodar até passar.
     */
    testTimeout: 20_000,
  },
})
