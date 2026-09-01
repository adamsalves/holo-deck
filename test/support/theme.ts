import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './source-tree'

/**
 * Ler o tema como dado, para os testes verificarem o CSS que existe em vez de uma
 * cópia dele.
 *
 * A alternativa seria repetir a paleta no teste — e aí o teste passa a afirmar
 * que a cópia bate com a cópia. Aqui ele lê `main.css`, que é o arquivo que vai
 * para produção.
 */

export const THEME_PATH = 'app/assets/css/main.css'

export function themeSource(): string {
  return readFileSync(join(REPO_ROOT, THEME_PATH), 'utf8')
}

/**
 * Toda declaração `--nome: valor` do arquivo, na ordem em que aparece.
 *
 * Um nome pode ser declarado mais de uma vez — é o caso de `--rarity`, que cada
 * bloco `[data-rarity]` redefine. Por isso o retorno é uma lista de pares, e não
 * um mapa: quem precisa de valor único filtra, quem precisa de todos conta.
 */
export function declarations(source = themeSource()): { name: string, value: string }[] {
  return [...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => ({ name: name ?? '', value: (value ?? '').trim() }))
}

/**
 * O valor de um token, seguindo a cadeia de `var()` até o fim.
 *
 * `--text-muted` → `var(--color-ink-350)` → `#737C9F`. Devolve `null` se o token
 * não existir ou se a cadeia não terminar num valor literal — que é o que
 * acontece quando alguém aponta um papel para um token que ninguém declarou.
 */
export function resolveToken(name: string, source = themeSource()): string | null {
  const all = declarations(source)
  const seen = new Set<string>()
  let current = name

  while (!seen.has(current)) {
    seen.add(current)

    const declared = all.findLast(entry => entry.name === current)
    if (declared === undefined) return null

    const indirection = /^var\(\s*(--[\w-]+)\s*\)$/.exec(declared.value)
    if (indirection === null) return declared.value

    const next = indirection[1]
    if (next === undefined) return null
    current = next
  }

  return null
}
