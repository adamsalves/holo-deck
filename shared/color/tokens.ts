/**
 * Ler o tema como dado.
 *
 * Um design system tem dois leitores que precisam concordar sobre os mesmos
 * valores: o portão, que reprova o build, e o espelho em `/styleguide`, que
 * mostra a escada e os papéis. Enquanto cada um mantinha a própria cópia, os
 * dois podiam mentir — o portão medindo um fundo que o tema não usa mais, o
 * espelho exibindo uma razão de contraste escrita à mão. Este módulo é o
 * analisador que os dois usam, e ele recebe o CSS como texto: quem sabe onde o
 * arquivo está é quem chama.
 *
 * Deliberadamente ingênuo. Não é um parser de CSS — é o suficiente para a forma
 * que `main.css` usa, e a forma que ele não entende ele recusa (`null`) em vez
 * de adivinhar.
 */

export interface Declaration {
  readonly name: string
  readonly value: string
}

/** Comentários fora do caminho: eles contêm chaves e dois-pontos. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Toda declaração `--nome: valor` do texto, na ordem em que aparece.
 *
 * Um nome pode ser declarado mais de uma vez — é o caso de `--rarity`, que cada
 * bloco `[data-rarity]` redefine. Por isso o retorno é uma lista de pares, e não
 * um mapa: quem precisa de valor único filtra, quem precisa de todos conta.
 */
export function declarations(source: string): Declaration[] {
  return [...stripComments(source).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => ({ name: name ?? '', value: (value ?? '').trim() }))
}

/**
 * O corpo da regra de um seletor, ou `null` se ele não existir.
 *
 * Existe para as perguntas que dependem de *onde* o token foi declarado — "a
 * raridade `rare` publica força de foil?" não se responde com a última
 * declaração do arquivo.
 */
export function blockFor(selector: string, source: string): string | null {
  const clean = stripComments(source)
  const at = clean.indexOf(selector)
  if (at === -1) return null

  const open = clean.indexOf('{', at + selector.length)
  if (open === -1) return null

  let depth = 0
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') {
      depth--
      if (depth === 0) return clean.slice(open + 1, i)
    }
  }

  return null
}

/** O valor literal de um token dentro de um bloco, sem seguir `var()`. */
export function declarationIn(block: string, name: string): string | null {
  return declarations(block).findLast(entry => entry.name === name)?.value ?? null
}

/**
 * O valor de um token, seguindo a cadeia de `var()` até o fim.
 *
 * Devolve `null` se o token não existir ou se a cadeia não terminar num valor
 * literal — que é o que acontece quando alguém aponta um papel para um token que
 * ninguém declarou.
 *
 * Quando o mesmo nome é declarado mais de uma vez, vale a **última**: é a que a
 * cascata usaria entre regras de igual especificidade. Para perguntar por um
 * escopo específico, use `blockFor` antes.
 */
export function resolveToken(name: string, source: string): string | null {
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

/** Os degraus da escada `ink`, em ordem decrescente de número — do fundo ao topo. */
export function inkLadder(source: string): { step: string, value: string }[] {
  return declarations(source)
    .flatMap(({ name, value }) => {
      const step = /^--color-ink-(\d{2,3})$/.exec(name)?.[1]
      return step === undefined ? [] : [{ step, value }]
    })
    .sort((a, b) => Number(b.step) - Number(a.step))
}
