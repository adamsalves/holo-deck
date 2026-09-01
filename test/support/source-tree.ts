import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Andar pelo código-fonte em disco, para os testes que verificam portão.
 *
 * Os portões deste repositório falham sempre do mesmo jeito: o código muda de
 * lugar e a configuração fica onde estava. Um teste que cite arquivos por nome
 * envelhece junto com a configuração que deveria vigiar — por isso estes
 * verificadores leem o disco em vez de uma lista.
 */

/** Raiz do repositório, resolvida a partir da posição deste arquivo. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Caminhos relativos à raiz, de todo arquivo sob `dir` que `keep` aceitar.
 *
 * Diretórios ocultos e os de `skip` não são visitados. A separação é sempre `/`,
 * inclusive onde o `node:path` usaria outra — os chamadores comparam com globs.
 */
export function walkFiles(
  dir: string,
  skip: ReadonlySet<string>,
  keep: (fileName: string) => boolean,
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []

    const full = join(dir, entry.name)
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : walkFiles(full, skip, keep)

    return keep(entry.name) ? [relative(REPO_ROOT, full).replaceAll(sep, '/')] : []
  })
}

/** `keep` para extensões: aceita o arquivo cujo nome termina em uma delas. */
export function hasExtension(extensions: readonly string[]) {
  return (fileName: string) => extensions.some(extension => fileName.endsWith(extension))
}
