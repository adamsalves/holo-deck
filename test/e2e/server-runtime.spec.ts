import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/**
 * O servidor construído responde certo **de qualquer diretório de trabalho**.
 *
 * Este arquivo existe por causa de um defeito que passou por todos os outros
 * portões. `useDex()` lia o dex do disco montando `join(process.cwd(), 'public',
 * …)` e `join(process.cwd(), '.output/public', …)` — dois caminhos que só são a
 * raiz do projeto no build e no `yarn preview`. Num deploy serverless o `cwd` é
 * a raiz da função e o dex não está lá: no preset da Vercel ele vai inteiro para
 * `.vercel/output/static/` e a função não recebe cópia nenhuma. Medido.
 *
 * O sintoma era `/pokemon/<slug inexistente>` — a **única** classe de URL que
 * chega ao servidor, já que toda rota válida é pré-renderizada — respondendo 500
 * em vez de 404, com o caminho absoluto do servidor na linha de status e no
 * corpo. Um 404 virando 500 é regressão de SEO e de correção; o caminho na
 * resposta é divulgação de informação.
 *
 * **Por que o e2e existente não pegava.** `pokedex.spec.ts` prova o 404, mas
 * roda contra o `webServer` do Playwright, que sobe `yarn preview` a partir da
 * raiz do repositório — exatamente o único `cwd` em que o código quebrado
 * funcionava. É o defeito recorrente deste repo outra vez: o portão medindo o
 * lugar onde o problema não está. Por isso este teste sobe o servidor **de um
 * diretório temporário**, que é o que reproduz a forma do deploy.
 */

const OUTPUT_SERVER = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url))
const PORT = 3311
const BASE = `http://127.0.0.1:${PORT}`

async function waitForServer(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await fetch(BASE, { signal })
      return
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
}

test('o servidor construído responde 404 e não vaza caminho, rodando fora da raiz do projeto', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'holo-deck-cwd-'))
  const child = spawn(process.execPath, [OUTPUT_SERVER], {
    cwd,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const ready = AbortSignal.timeout(30_000)
    await waitForServer(ready)

    // Um slug que não existe no índice. Ele não é pré-renderizado, então é o
    // servidor quem responde — e responder exige ler o índice para saber que a
    // espécie não existe. É o caminho inteiro que o defeito quebrava.
    const response = await fetch(`${BASE}/pokemon/missingno`)
    const body = await response.text()

    expect(response.status).toBe(404)

    // O 500 antigo carregava o caminho absoluto do servidor nos dois lugares.
    // Conferir os dois porque o h3 põe o `statusMessage` na linha de status
    // **e** no corpo, e um deles sozinho já vaza.
    for (const surface of [response.statusText, body]) {
      expect(surface).not.toContain(cwd)
      expect(surface).not.toMatch(/\/(?:var\/task|home|tmp)\//)
    }
  }
  finally {
    child.kill('SIGTERM')
    await rm(cwd, { recursive: true, force: true })
  }
})
