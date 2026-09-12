import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * O dex vai dentro da função da Vercel — a issue #15.
 *
 * `test/e2e/server-runtime.spec.ts` prova que o servidor construído responde 404
 * sem vazar caminho, rodando fora da raiz do projeto. **Mas ele mede o preset
 * `node-server`**, que é o que o `yarn build` do CI produz, e a Vercel constrói com
 * o preset `vercel`. Ali o dex só chega à função por `serverAssets` (ver
 * `nuxt.config.ts`): sem ele, `public/data/` vai para a CDN e a função não recebe
 * cópia nenhuma, e `/pokemon/qualquer-coisa` volta a responder 500. Um
 * `serverAssets` removido por engano passaria por todos os outros portões — e o
 * preview, atrás do Vercel Authentication, não serve de medida.
 *
 * **A lista sai da fonte**: cada `.json` de `public/data/` precisa de um
 * `chunks/raw/<nome>.mjs` dentro da função. Um arquivo novo no dex entra sozinho
 * na conferência, e a pasta de saída sumindo — o Nitro mudando o layout do preset
 * — reprova alto em vez de passar sem ter o que conferir.
 *
 * Roda depois de `NITRO_PRESET=vercel yarn build`.
 */

const DATA = 'public/data'
const RAW = '.vercel/output/functions/__fallback.func/chunks/raw'

const sources = readdirSync(DATA).filter(name => name.endsWith('.json'))

if (sources.length === 0) {
  console.error(`::error::${DATA} não tem nenhum .json — o portão não teria o que conferir`)
  process.exit(1)
}

if (!existsSync(RAW)) {
  console.error(`::error::${RAW} não existe: a função da Vercel não recebeu dex nenhum (ou o build não foi com NITRO_PRESET=vercel)`)
  process.exit(1)
}

const missing = sources.filter(name => !existsSync(join(RAW, `${basename(name, '.json')}.mjs`)))

for (const name of missing) {
  console.error(`::error::${DATA}/${name} não foi embarcado na função da Vercel`)
}

if (missing.length > 0) process.exit(1)

console.log(`${sources.length} arquivos do dex conferidos dentro da função da Vercel`)
