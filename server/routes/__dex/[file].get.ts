/**
 * O dex, servido de dentro do app h3 — o caminho de leitura do **servidor**.
 *
 * Esta rota existe por uma razão só, e ela é estrutural. `useDex()` precisa ler o
 * dex durante o SSR, e nenhum dos caminhos óbvios funciona:
 *
 * - **`$fetch('/data/gen-1.json')`** não sai pela rede em servidor: ele chama
 *   este mesmo app h3 por dentro, e asset público **não é rota do h3** — é
 *   middleware estático na frente dele. O caminho cai no renderizador de páginas
 *   e volta o HTML de 404.
 * - **Ler o disco por `process.cwd()`** amarra a leitura ao diretório de
 *   trabalho, que só é a raiz do projeto no build e no `yarn preview`. Num
 *   deploy serverless o `cwd` é a raiz da função e o dex não está lá: no preset
 *   da Vercel ele vai inteiro para `.vercel/output/static/` e a função não
 *   recebe cópia nenhuma. Era o defeito que fazia `/pokemon/<slug inexistente>`
 *   responder 500 em produção, em vez do 404 que a página pede.
 * - **Importar `nitropack/runtime` do código de `app/`** resolve para uma
 *   **instância diferente** do módulo, com o storage vazio. Funciona no build,
 *   onde o Nitro empacota tudo num grafo só, e quebra em `dev`, onde o Vite
 *   carrega o código de app separado. Passa no `yarn build` e derruba o
 *   `yarn dev` — o pior dos dois mundos.
 *
 * Uma rota **é** rota do h3, então o `$fetch` relativo a alcança nos quatro
 * modos sem sair pela rede. E ela roda no contexto do Nitro, que é o único lugar
 * onde `useStorage('assets:dex')` enxerga o `serverAssets` declarado no
 * `nuxt.config.ts`.
 *
 * O prefixo `__` marca o que ela é: superfície interna do SSR, não API do jogo.
 * O dado que ela devolve já é público em `/data/` — é o mesmo arquivo, e é o
 * navegador que continua buscando lá, pela CDN.
 */
export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file')

  // O nome vem da URL, então é entrada até prova em contrário. O dex tem uma
  // forma de nome só, e casá-la é o que impede `..%2F` de virar travessia de
  // caminho dentro do storage.
  if (file === undefined || !/^[a-z]+(?:-\d+)?\.json$/.test(file)) {
    throw createError({ statusCode: 404, statusMessage: 'não é um arquivo do dex' })
  }

  const value = await useStorage('assets:dex').getItem(file)

  // Ausente é 404, e não 500: quem pergunta por `gen-99.json` errou a pergunta.
  // Um dex incompleto de verdade reprova antes, no portão de leitura de
  // `useDex()`, que é quem cobra forma.
  if (value === null || value === undefined) {
    throw createError({ statusCode: 404, statusMessage: `${file} não está no dex` })
  }

  return value
})
