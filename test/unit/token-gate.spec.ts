import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * A disciplina de token, cobrada.
 *
 * O sistema tem duas camadas — primitivo (`ink-850`) e semântico (`--surface`) —
 * e uma regra dura: **componente consome semântico**. O valor disso é que trocar
 * o degrau de uma superfície é uma linha no `main.css`; um componente que
 * escreve `#121522` ou `bg-ink-850` transforma a mesma troca num commit de
 * refatoração, e o sistema já vazou no momento em que ele foi escrito.
 *
 * As 17 pranchas do canvas usam hex inline porque são mockup, e é justamente
 * essa a via de contágio: copiar da prancha para o componente copia o hex junto.
 * Um teste é a única coisa que percebe isso antes do review.
 *
 * Ele anda pelo disco pelo mesmo motivo que o portão de tipagem anda: pasta e
 * componente novos aparecem toda fase, e uma lista escrita à mão não os alcança.
 */

/** Onde o tema mora. É o único lugar do repositório que pode escrever um hex. */
const THEME = 'app/assets/css/main.css'

/**
 * Raízes varridas. `test/` fica de fora: um teste de tema precisa citar o valor
 * que verifica, e proibir isso seria proibir verificar.
 */
const SCANNED_ROOTS = ['app', 'shared', 'server']

/**
 * `.svg` fica de fora: arte carrega a própria cor, e um Pokébola vermelha não é
 * decisão de tema. O que vale para ela vale para as miniaturas do dex.
 */
const SOURCE_EXTENSIONS = ['.vue', '.ts', '.css']

const SKIP = new Set(['node_modules'])

/** Um hex de cor: 3, 4, 6 ou 8 dígitos. */
const RAW_HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi

/** Um primitivo da escada, em utilitário (`bg-ink-850`) ou em `var(--color-ink-850)`. */
const PRIMITIVE = /\bink-\d{2,3}\b/gi

function scannedFiles(): string[] {
  return SCANNED_ROOTS
    .map(root => join(REPO_ROOT, root))
    .filter(dir => existsSync(dir))
    .flatMap(dir => walkFiles(dir, SKIP, hasExtension(SOURCE_EXTENSIONS)))
    .filter(file => file !== THEME)
}

function offenders(pattern: RegExp): string[] {
  return scannedFiles().flatMap((file) => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')

    return source
      .split('\n')
      .flatMap((line, index) => {
        const hits = line.match(pattern) ?? []
        return hits.map(hit => `${file}:${index + 1} → ${hit}`)
      })
  })
}

describe('disciplina de token', () => {
  it('não deixa hex cru fora do tema', () => {
    expect(
      offenders(RAW_HEX),
      `hex fora de ${THEME}: o valor pertence a um token, e o componente cita o token`,
    ).toEqual([])
  })

  it('não deixa componente consumir primitivo', () => {
    expect(
      offenders(PRIMITIVE),
      `primitivo fora de ${THEME}: usar o semântico (--surface, --text-muted) ou o utilitário do Nuxt UI que ele alimenta (bg-muted, text-muted)`,
    ).toEqual([])
  })

  it('não deixa número escapar do utilitário que o alinha', () => {
    // `font-mono` sozinho dá a fonte e esquece `tabular-nums`, e aí os dígitos
    // têm largura própria: um HP caindo de 110 para 99 empurra o texto ao lado a
    // cada quadro. O utilitário `numeric` traz os dois, e não existe metade dele.
    expect(
      offenders(/\bfont-mono\b/g),
      'usar `numeric`, que traz a fonte e o `tabular-nums` juntos',
    ).toEqual([])
  })

  it('encontra o tema, e o tema é o que carrega os valores', () => {
    const theme = readFileSync(join(REPO_ROOT, THEME), 'utf8')

    // Se o `main.css` mudar de lugar, os dois testes acima passam varrendo um
    // repositório onde ninguém escreve hex porque ninguém escreve tema.
    expect(theme.match(RAW_HEX)?.length ?? 0).toBeGreaterThan(10)
  })
})
