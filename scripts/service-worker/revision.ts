import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Revisions: the hashes that tell one build's copy of a file from another's.
 *
 * A module of its own, apart from `build.ts`, because `nuxt.config.ts` reads the
 * dex's revision on every `nuxt` command, and `build.ts` brings the TypeScript
 * compiler with it.
 */

/**
 * A file's revision: the start of a hash of its content. Sixteen hex digits —
 * a collision between two builds' copies of one file is not a risk worth more.
 *
 * The worker checks what it downloads against this with `crypto.subtle`, so the
 * two have to stay the same computation: SHA-256, the first eight bytes in hex.
 */
export function revisionOf(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * One revision for a whole folder of files — each file's name and content, in
 * name order, so a file renamed, added, removed or changed moves it.
 */
export function folderRevision(files: readonly { readonly name: string, readonly content: Uint8Array }[]): string {
  const hash = createHash('sha256')
  const sorted = [...files].sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))

  for (const { name, content } of sorted) hash.update(name).update('\0').update(content).update('\0')

  return hash.digest('hex').slice(0, 16)
}

/**
 * The revision of the files under `dir`, read from the disk — the dex for every
 * page's addresses (`dexUrl`), the thumbnails for the name of their cache.
 *
 * An empty folder throws: its revision would be the same constant for every
 * build, and the addresses built from it would stop changing with the content.
 */
export function folderRevisionOf(dir: string): string {
  const names = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).replaceAll(sep, '/'))

  if (names.length === 0) throw new Error(`revision: ${dir} has no files`)

  return folderRevision(names.map(name => ({ name, content: readFileSync(join(dir, name)) })))
}
