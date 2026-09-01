import type { CoreData, Effectiveness, TypeName } from '../types/dex.ts'
import { TYPE_NAMES, typeIndex } from '../types/dex.ts'

/**
 * Consulta à matriz 18×18 — tipo duplo multiplicativo, imunidade inclusa.
 *
 * O plano a lista na Fase 4, junto com o motor. Ela chega antes pelo mesmo
 * motivo que a raridade: a prancha *Detalhe* desenha um painel inteiro de
 * *Relações de dano* (`ROCK ×4`, `GROUND ×0`) e anota, na própria prancha, que
 * ele é *calculado na matriz 18×18, tipo duplo multiplicativo*. A matriz já
 * viaja em `core.json` desde a Fase 1; sem este módulo a Pokédex ou perde o
 * painel ou o recalcula dentro de um componente.
 *
 * O que a Fase 4 acrescenta é a direção contrária — quanto o golpe *do atacante*
 * multiplica —, que é a mesma consulta lida de outro lado.
 */

/**
 * A casa `[atacante][defensor]` da matriz.
 *
 * O `?? 1` é inalcançável por contrato, não por otimismo: `isCoreData` só aceita
 * `effectiveness` com 18 linhas de 18 casas, e `TypeName` só admite os 18 nomes
 * — não existe índice fora da faixa a proteger. Ele está aqui porque
 * `noUncheckedIndexedAccess` tipa a leitura como possivelmente ausente, e a
 * alternativa seria um `!` ou um `as`, que o lint proíbe e que mentiriam sobre
 * de onde vem a garantia. Neutro é o único valor que não inventa vantagem nem
 * fraqueza se o impossível acontecer.
 */
function cell(
  matrix: CoreData['effectiveness'],
  attacker: TypeName,
  defender: TypeName,
): Effectiveness {
  return matrix[typeIndex(attacker)]?.[typeIndex(defender)] ?? 1
}

/**
 * Quanto um golpe de `attacker` multiplica contra uma espécie de `defenderTypes`.
 *
 * Tipo duplo é produto, e é o produto que produz os extremos que o jogador
 * enxerga: Charizard é fogo/voador, e pedra bate ×2 nos dois — ×4. Terrestre
 * bate ×2 em fogo e ×0 em voador — e ×0 vence tudo, porque zero absorve.
 */
export function effectivenessAgainst(
  matrix: CoreData['effectiveness'],
  attacker: TypeName,
  defenderTypes: readonly TypeName[],
): number {
  return defenderTypes.reduce(
    (product, defender) => product * cell(matrix, attacker, defender),
    1,
  )
}

export interface DamageRelation {
  readonly type: TypeName
  readonly multiplier: number
}

/**
 * As relações de dano *recebido*, já separadas nos dois grupos que a prancha
 * desenha. Neutro fica de fora dos dois: dizer que 11 dos 18 tipos batem ×1 é
 * gastar o painel inteiro para não informar nada.
 *
 * A ordem é a da prancha, e ela não é uma só. Fraqueza desce (×4 antes de ×2):
 * o pior caso primeiro. Resistência sobe (×¼ antes de ×½) e **imunidade fica no
 * fim**, apesar de ×0 ser o menor de todos — o grupo se chama *recebe menos /
 * nada*, e o `nada` é a categoria à parte que fecha a leitura.
 */
export function incomingDamageRelations(
  matrix: CoreData['effectiveness'],
  defenderTypes: readonly TypeName[],
): { readonly weak: readonly DamageRelation[], readonly resistant: readonly DamageRelation[] } {
  const relations = TYPE_NAMES.map(type => ({
    type,
    multiplier: effectivenessAgainst(matrix, type, defenderTypes),
  }))

  return {
    weak: relations
      .filter(relation => relation.multiplier > 1)
      .sort((a, b) => b.multiplier - a.multiplier),
    resistant: relations
      .filter(relation => relation.multiplier < 1)
      .sort((a, b) => sortKey(a.multiplier) - sortKey(b.multiplier)),
  }
}

/** Zero vai para o fim; o resto sobe pelo próprio valor. */
function sortKey(multiplier: number): number {
  return multiplier === 0 ? Number.POSITIVE_INFINITY : multiplier
}

/**
 * O multiplicador como a prancha o escreve: `×4`, `×2`, `×½`, `×¼`, `×0`.
 *
 * Fração e não decimal porque é o que a prancha desenha e o que se lê mais
 * rápido num chip de 10px — `×0,25` ocupa quase o dobro. As frações são as
 * únicas duas possíveis abaixo de 1 com dois tipos, então a tabela é exaustiva e
 * não precisa de caso geral; qualquer outro valor cairia no decimal, e ele não
 * existe nesta matriz.
 */
const MULTIPLIER_LABELS = new Map<number, string>([
  [0, '×0'],
  [0.25, '×¼'],
  [0.5, '×½'],
  [2, '×2'],
  [4, '×4'],
])

export function multiplierLabel(multiplier: number): string {
  return MULTIPLIER_LABELS.get(multiplier) ?? `×${multiplier}`
}
