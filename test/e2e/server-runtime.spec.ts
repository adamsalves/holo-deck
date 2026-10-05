import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { probeServer } from '../support/server-probe.ts'

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
 *
 * What is asked of that server lives in `test/support/server-probe.ts`: the 404s
 * in every language, with the good side asserted. `scripts/check-vercel-bundle.ts`
 * asks the same questions of the Vercel function, so the two presets answer to
 * one probe and this file only decides where the server runs from.
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

test('the built server answers every language from outside the project root: 404 with no path leaked, and the real page', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'holo-deck-cwd-'))
  const child = spawn(process.execPath, [OUTPUT_SERVER], {
    cwd,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const ready = AbortSignal.timeout(30_000)
    await waitForServer(ready)

    // The temporary working directory and the folder the server file lives in:
    // the two places the 500 used to print.
    expect(await probeServer(BASE, [cwd, dirname(OUTPUT_SERVER)])).toEqual([])
  }
  finally {
    child.kill('SIGTERM')
    await rm(cwd, { recursive: true, force: true })
  }
})
