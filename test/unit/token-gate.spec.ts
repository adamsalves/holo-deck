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
 * escreve um hex ou um `bg-ink-850` transforma a mesma troca num commit de
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
 * O espelho do sistema é a única página autorizada a citar primitivo pelo nome —
 * mostrar os primitivos é literalmente o trabalho dela. A exceção fica escrita
 * aqui, e não escondida num comentário de desativação dentro do arquivo.
 */
const STYLEGUIDE = 'app/pages/styleguide.vue'

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

/**
 * Primitivo citado por componente, nas três formas em que ele aparece.
 *
 * A versão anterior olhava só a escada `ink`, e as outras duas famílias de
 * primitivo passavam limpas — `var(--color-type-fire)` e o utilitário
 * `bg-rarity-ultra` que o `@theme` gera são exatamente o vazamento que a regra
 * proíbe, só que com outro prefixo. Quem quer a cor de um tipo escreve
 * `data-type` e lê `--type`; quem quer a de uma raridade lê `--rarity`.
 */
const PRIMITIVE = /\b(?:ink|(?:--)?color-type|(?:--)?color-rarity)-[\w]+\b/gi

/**
 * Cor literal fora de hex.
 *
 * `#5C6484` não é a única forma de copiar uma cor da prancha para o componente:
 * `rgb(92 100 132)` e `oklch(...)` fazem o mesmo estrago e passavam inteiras.
 * `color-mix()` fica de fora de propósito — ela **deriva** de um token, que é o
 * mecanismo que o sistema usa para brilho e moldura.
 */
const LITERAL_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi

/**
 * A paleta de fábrica do Tailwind, que é a que o autocomplete oferece.
 *
 * Este é o vazamento mais provável de todos e o portão não o via: `bg-slate-800`
 * é mais fácil de escrever que `bg-muted`, e vem com a cara de template que o
 * tema inteiro existe para não ter. `neutral` está na lista mesmo tendo sido
 * remapeado para a escada `ink` — o componente ainda assim estaria citando a
 * escala do Nuxt UI em vez do papel.
 */
const TAILWIND_PALETTE = new RegExp(
  String.raw`\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow)`
  + String.raw`-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)`
  + String.raw`(?:-\d{2,3})?\b`,
  'g',
)

/**
 * Nome de token montado por interpolação.
 *
 * `var(--color-ink-${degrau})` cita um primitivo e nenhuma das regras acima o
 * enxerga — o nome só existe em runtime. Era como o próprio `/styleguide`
 * escapava do portão, o que deixava a exceção dele vazia e a brecha aberta para
 * qualquer componente.
 */
const INTERPOLATED_TOKEN = /var\(\s*--[\w-]*(?:\$\{|\{\{)/g

function scannedFiles(): string[] {
  return SCANNED_ROOTS
    .map(root => join(REPO_ROOT, root))
    .filter(dir => existsSync(dir))
    .flatMap(dir => walkFiles(dir, SKIP, hasExtension(SOURCE_EXTENSIONS)))
    .filter(file => file !== THEME && file !== STYLEGUIDE)
}

/** Lê uma vez só: são quatro varreduras sobre a mesma árvore. */
const sources = scannedFiles().map(file => ({
  file,
  lines: readFileSync(join(REPO_ROOT, file), 'utf8').split('\n'),
}))

function offenders(pattern: RegExp): string[] {
  return sources.flatMap(({ file, lines }) =>
    lines.flatMap((line, index) =>
      (line.match(pattern) ?? []).map(hit => `${file}:${index + 1} → ${hit}`),
    ),
  )
}

describe('disciplina de token', () => {
  it('não deixa hex cru fora do tema', () => {
    expect(
      offenders(RAW_HEX),
      `hex fora de ${THEME}: o valor pertence a um token, e o componente cita o token`,
    ).toEqual([])
  })

  it('não deixa cor literal entrar por outra notação', () => {
    expect(
      offenders(LITERAL_COLOR),
      `rgb()/hsl()/oklch() fora de ${THEME}: é a mesma cópia de valor que o hex. \`color-mix()\` é permitido — ele deriva de token`,
    ).toEqual([])
  })

  it('não deixa componente consumir primitivo', () => {
    expect(
      offenders(PRIMITIVE),
      `primitivo fora de ${THEME}: usar o semântico (--surface, --text-muted), a variável de escopo (--type, --rarity) ou o utilitário do Nuxt UI que eles alimentam (bg-muted, text-muted)`,
    ).toEqual([])
  })

  it('não deixa a paleta de fábrica do Tailwind entrar', () => {
    expect(
      offenders(TAILWIND_PALETTE),
      'a paleta padrão do Tailwind é o vazamento mais fácil de escrever: usar os papéis do sistema (bg-default, bg-muted, text-muted, border-default)',
    ).toEqual([])
  })

  it('não deixa nome de token ser montado por interpolação', () => {
    expect(
      offenders(INTERPOLATED_TOKEN),
      'token montado em runtime escapa de toda regra acima: escrever o nome inteiro, ou resolver pelo analisador de `shared/color/tokens.ts`',
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

    // Se o `main.css` mudar de lugar, os testes acima passam varrendo um
    // repositório onde ninguém escreve hex porque ninguém escreve tema.
    expect(theme.match(RAW_HEX)?.length ?? 0).toBeGreaterThan(10)
  })
})
