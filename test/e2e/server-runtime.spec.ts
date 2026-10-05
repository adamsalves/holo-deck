import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { withNodeServer } from '../support/built-server.ts'
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
 * What is asked of that server lives in `test/support/server-probe.ts`: the index
 * through the dex route, the 404s in every language, and the real pages beside
 * them. `scripts/check-vercel-bundle.ts` asks the same questions of the Vercel
 * function, so the two presets answer to one probe.
 *
 * Where the server runs from lives in `test/support/built-server.ts`, for both
 * presets too: **a copy of it, outside the repository**, in a child whose own
 * "listening" line is what the test waits for. The copy is what keeps the
 * project's `node_modules` out of reach, and the line is what keeps a server
 * someone else left on the port from answering in its place — with the port
 * merely answering as the signal, this test passed in 101 ms against one, on a
 * build it fails by itself.
 */

const OUTPUT = fileURLToPath(new URL('../../.output', import.meta.url))

test('the built server answers from a copy outside the repository, in every language: the index, 404 with no path leaked, and the real pages', async () => {
  // The temporary folder the copy runs in is what the 500 used to print.
  expect(await withNodeServer(OUTPUT, (base, root) => probeServer(base, [root]))).toEqual([])
})
