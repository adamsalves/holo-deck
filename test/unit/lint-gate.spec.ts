import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import eslintConfig from '../../eslint.config.mjs'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * O portão que verifica a si mesmo.
 *
 * A família `no-unsafe-*` é o que impede `any` de *entrar* pela fronteira de
 * dados — `JSON.parse`, `$fetch`, round-trip de `localStorage`. Ela só existe
 * com informação de tipo, então vive num bloco com `files` próprio. E esse
 * `files` já ficou para trás **três vezes**:
 *
 * - Fase 0: o glob do lint e o do `tsconfig` discordavam entre si;
 * - Fase 1: `app/` virou fronteira de dados (`useDex()` lendo JSON por HTTP) e
 *   não estava na lista — o mesmo `JSON.parse` dava três erros em `shared/` e
 *   passava limpo em `app/`;
 * - Fase 2: o glob dizia `*.ts`, então `<script setup>` ficava de fora, bem na
 *   fase que enche o repositório de componente.
 *
 * O padrão é sempre o mesmo: **o código muda de lugar e o portão fica onde
 * estava**. Um teste que trave um caso específico (um `.vue`, uma pasta) morre
 * na próxima mudança de lugar. Este anda pelo disco: se existir arquivo capaz
 * de carregar TypeScript fora do alcance do bloco, ele falha — sem precisar
 * saber de antemão qual pasta ou extensão alguém inventou.
 *
 * Os outros três portões da mesma checagem não são verificáveis daqui e
 * continuam sendo trabalho de review ao criar pasta nova de TS:
 * `tsconfig.tools.json`, os aliases do Vitest, e a escolha entre `test/nuxt/`
 * e `test/unit/`.
 */

const BLOCK = 'holo-deck/typing-honesty-type-aware'

/** Extensões que carregam TypeScript — `.vue` inclusa, pelo bloco `<script setup>`. */
const TS_BEARING = ['.ts', '.mts', '.cts', '.tsx', '.vue']

/**
 * Arquivos de configuração da raiz, deliberadamente fora do bloco type-aware.
 *
 * Eles não são fronteira de dados: rodam no build, com entrada que o próprio
 * repositório escreve. Estão listados aqui — e não silenciados por um glob
 * genérico — para que a exceção seja visível: um arquivo novo na raiz reprova
 * até alguém decidir conscientemente em qual dos dois lados ele fica.
 */
const UNGUARDED_CONFIG = [
  'commitlint.config.mjs',
  'eslint.config.mjs',
  'lint-staged.config.mjs',
  'nuxt.config.ts',
  'playwright.config.ts',
  'vitest.config.ts',
]

/** Um glob do bloco, na única forma que ele usa: `<raiz>/**\/*.<ext>`. */
interface ParsedGlob {
  root: string
  ext: string
}

function parseGlob(glob: string): ParsedGlob | null {
  const match = /^([\w-]+)\/\*\*\/\*(\.\w+)$/.exec(glob)
  if (!match) return null

  const [, root, ext] = match
  if (root === undefined || ext === undefined) return null

  return { root, ext }
}

/** Diretórios que o próprio `eslint.config.mjs` manda ignorar, mais os de sempre. */
function skippedDirs(ignores: readonly string[]): Set<string> {
  const fromConfig = ignores
    .map(pattern => /^([\w-]+)\//.exec(pattern)?.[1])
    .filter(dir => dir !== undefined)

  return new Set([...fromConfig, 'node_modules'])
}

describe('portão de tipagem type-aware', () => {
  it('alcança todo arquivo que carrega TypeScript', async () => {
    const config = await eslintConfig
    const block = config.find(entry => entry.name === BLOCK)
    const ignores = config.find(entry => entry.name === 'holo-deck/ignores')?.ignores ?? []

    expect(block, `bloco \`${BLOCK}\` sumiu do eslint.config.mjs`).toBeDefined()

    const globs = (block?.files ?? []).map(glob => (typeof glob === 'string' ? parseGlob(glob) : null))

    // Um glob que este teste não sabe ler é um buraco que ele não sabe medir:
    // reprova em vez de dar verde por não entender a pergunta.
    expect(globs, `todo glob do bloco precisa ter a forma \`<raiz>/**/*.<ext>\``).not.toContain(null)

    const covered = globs.filter(glob => glob !== null)
    const reach = (file: string) =>
      covered.some(({ root, ext }) => file.startsWith(`${root}/`) && file.endsWith(ext))

    const sources = walkFiles(REPO_ROOT, skippedDirs(ignores), hasExtension(TS_BEARING))
    const unguarded = sources.filter(file => !reach(file) && !UNGUARDED_CONFIG.includes(file))

    expect(unguarded, 'arquivos de TypeScript fora do bloco type-aware').toEqual([])
  })

  it('cobre as raízes de código que o plano declara', async () => {
    const config = await eslintConfig
    const block = config.find(entry => entry.name === BLOCK)
    const roots = new Set(
      (block?.files ?? []).flatMap(glob =>
        typeof glob === 'string' ? (parseGlob(glob)?.root ?? []) : [],
      ),
    )

    expect([...roots].sort()).toEqual(['app', 'scripts', 'server', 'shared', 'test'])

    /**
     * **`server/` nasceu na Fase 3, e o armado valeu.**
     *
     * O glob estava posto desde a Fase 0 esperando a Fase 7, e a pasta chegou
     * antes: `server/routes/__dex/` é a rota interna que o SSR usa para ler o
     * dex. Ela nasceu dentro do bloco type-aware, que era exatamente o ponto de
     * armar antes — pela quinta aparição do defeito, a pasta nova não nasceu
     * fora do portão.
     *
     * Este `expect` era `toBe(false)`, com a mensagem *"server/ nasceu:
     * conferir os outros três portões"*. Ele disparou, os três foram conferidos
     * e nenhum precisou mudar: o glob do ESLint já listava `server/**\/*.ts`, o
     * `tsconfig.server.json` que o `nuxt prepare` gera já cobre a pasta — o que
     * `tsconfig-gate.spec.ts` verifica sozinho —, e os aliases do Vitest não
     * entram porque nenhum teste importa de `server/`.
     *
     * A asserção fica invertida em vez de apagada: a pasta ter sumido enquanto o
     * glob continua armado é o mesmo defeito de cabeça para baixo.
     */
    expect(existsSync(join(REPO_ROOT, 'server')), 'server/ sumiu, e o glob continua armado').toBe(true)
  })
})
