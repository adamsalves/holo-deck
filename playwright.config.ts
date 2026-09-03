import { defineConfig, devices } from '@playwright/test'

/**
 * A porta, configurável — e a razão de ela ter deixado de ser uma constante.
 *
 * O `reuseExistingServer` abaixo é o padrão local do Playwright e é útil: ele
 * reaproveita um `yarn preview` que já esteja de pé. Só que ele não confere
 * **quem** atende — ele confere que alguém atende. Nesta máquina havia um
 * Grafana na 3000, e a suíte inteira rodou contra ele: nove testes falharam
 * dizendo que o `<h1>Pokédex</h1>` não existia, o que era verdade, porque a
 * página era outra.
 *
 * Com a porta vindo do ambiente, o contorno é `PORT=3100 yarn test:e2e`, e o
 * `yarn preview` herda a mesma variável — os dois lados não têm como discordar.
 * No CI nada muda: `reuseExistingServer` já é `false` lá, e a 3000 está livre.
 */
const PORT = Number(process.env.PORT ?? 3000)
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // O reporter `github` substitui o html padrão em vez de somar — sozinho, ele
  // deixa o CI sem relatório e sem trace justo quando um teste falha.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Sobe a build de produção, não o dev server: é o artefato que a Vercel serve.
  webServer: {
    command: 'yarn preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
