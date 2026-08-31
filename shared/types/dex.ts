import type { MoveId, SpeciesId } from './brand.ts'
import { GYM_COUNT, isMoveId, isSpeciesId } from './brand.ts'

/**
 * O contrato dos arquivos gerados em `public/data/`. Este módulo é a fonte única
 * da forma do dex: `scripts/build-dex.ts` valida a saída contra ele com `zod`,
 * `useDex()` tipa a leitura a partir dele, e o motor da Fase 4 lê a matriz de
 * efetividade daqui.
 *
 * Deliberadamente **sem `zod`**: `shared/` viaja para o bundle do cliente, e o
 * plano decidiu validar o shape no build, não em runtime. Quem amarra os
 * schemas a estes tipos é a anotação `z.ZodType<...>` em `scripts/lib/schema.ts`.
 *
 * **Import relativo dentro de `shared/` leva `.ts` explícito.** `scripts/build-dex.ts`
 * carrega este módulo em Node puro, que não tem a resolução sem extensão do Vite —
 * um `from './brand'` aqui quebra o `yarn data:build` e nada mais, o que o torna
 * exatamente o tipo de defeito que só aparece no dia do rebuild.
 */

/**
 * As 18 chaves da matriz de efetividade, na ordem de id da PokeAPI (1..18).
 * `stellar` (19), `unknown` (10001) e `shadow` (10002) ficam de fora: nenhum
 * dos três participa da tabela de dano de uma batalha normal.
 */
export const TYPE_NAMES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock',
  'bug', 'ghost', 'steel', 'fire', 'water', 'grass',
  'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const

export type TypeName = typeof TYPE_NAMES[number]

export const TYPE_COUNT = TYPE_NAMES.length

/**
 * Ordem fixa de `baseStats`. Existe como constante porque o array `stats[]` da
 * PokeAPI **não** garante ordem — ler por índice é a forma silenciosa de trocar
 * Ataque por Defesa numa espécie só, e nenhum teste de contagem pegaria isso.
 */
export const STAT_NAMES = [
  'hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed',
] as const

export type StatName = typeof STAT_NAMES[number]

/** Tupla de 6 na ordem de `STAT_NAMES`. O tamanho fixo é o que faz `[i]` ser seguro. */
export type BaseStats = readonly [number, number, number, number, number, number]

export const STAT_COUNT = STAT_NAMES.length

/**
 * As 9 gerações do dex. É o mesmo 9 de `GYM_COUNT` — um ginásio por geração é a
 * regra da Liga — e fica derivado dele para que os dois nunca divirjam.
 */
export const GENERATION_COUNT = GYM_COUNT

/**
 * Quantos golpes cada espécie carrega no dex. O jogo usa 4 numa batalha; os
 * outros 4 são a margem de cobertura de tipo que a escolha da Fase 4 precisa
 * para ter o que escolher.
 *
 * Vive aqui, e não em `scripts/`, porque três lugares precisam concordar sobre
 * ele: o schema de escrita, o guarda de leitura e a seleção do moveset. Quando
 * discordam, o build grava um arquivo que o próprio leitor recusa.
 */
export const MOVES_PER_SPECIES = 8

/** Multiplicadores possíveis numa casa da matriz. */
export type Effectiveness = 0 | 0.5 | 1 | 2

export type DamageClass = 'physical' | 'special'

/**
 * Golpe de dano. Só golpes de status ficam fora do catálogo — o jogo não os usa,
 * e carregá-los custaria ~40 KB sem leitor.
 *
 * `accuracy` é `null` de propósito: em Swift e Aerial Ace ele significa "nunca
 * erra", que é diferente de 100. Colapsar os dois para 100 apagaria a regra.
 */
export interface MoveEntry {
  readonly id: MoveId
  readonly slug: string
  readonly displayName: string
  readonly type: TypeName
  readonly power: number
  readonly accuracy: number | null
  readonly pp: number
  readonly priority: number
  readonly damageClass: DamageClass
}

export interface GenerationMeta {
  readonly generation: number
  readonly region: string
  readonly displayName: string
  readonly speciesCount: number
}

/**
 * `core.json` — carregado uma vez e usado por toda tela. A matriz é indexada por
 * posição em `TYPE_NAMES`: `effectiveness[atacante][defensor]`.
 */
export interface CoreData {
  readonly types: readonly TypeName[]
  readonly effectiveness: readonly (readonly Effectiveness[])[]
  readonly moves: readonly MoveEntry[]
  readonly generations: readonly GenerationMeta[]
}

/**
 * Uma espécie no grid. `habitat` é `null` da geração 6 em diante — a PokeAPI
 * parou de preencher o campo, e inventar um valor mentiria na aba Sobre.
 */
export interface SpeciesEntry {
  readonly id: SpeciesId
  readonly slug: string
  readonly displayName: string
  readonly types: readonly [TypeName] | readonly [TypeName, TypeName]
  readonly baseStats: BaseStats
  readonly height: number
  readonly weight: number
  readonly isLegendary: boolean
  readonly isMythical: boolean
  readonly isBaby: boolean
  readonly captureRate: number
  readonly habitat: string | null
  readonly baseHappiness: number
  readonly color: string
  readonly evolutionChainId: number
  readonly moveIds: readonly MoveId[]
}

/** `gen-N.json` — carregado sob demanda, uma geração por vez. */
export interface GenerationData {
  readonly generation: number
  readonly region: string
  readonly species: readonly SpeciesEntry[]
}

/**
 * Condição de uma aresta da árvore de evolução. Todo campo além de `trigger` é
 * opcional e **omitido quando não se aplica** — com 18 campos e ~700 arestas,
 * serializar os nulos custaria ~175 KB para dizer "nada aqui".
 */
export interface EvolutionCondition {
  readonly trigger: string
  readonly minLevel?: number
  readonly item?: string
  readonly heldItem?: string
  readonly knownMove?: string
  readonly knownMoveType?: string
  readonly minHappiness?: number
  readonly minAffection?: number
  readonly minBeauty?: number
  readonly timeOfDay?: string
  readonly location?: string
  readonly gender?: number
  readonly tradeSpecies?: string
  readonly partySpecies?: string
  readonly partyType?: string
  readonly relativePhysicalStats?: number
  readonly needsOverworldRain?: true
  readonly turnUpsideDown?: true
  readonly needsMultiplayer?: true
  readonly nearSpecialRock?: true
}

export interface EvolutionNode {
  readonly speciesId: SpeciesId
  readonly slug: string
  /**
   * Ausente na raiz da cadeia. Quase sempre presente numa aresta descendente —
   * mas não sempre: a PokeAPI lista `phione → manaphy` sem nenhum
   * `evolution_details`, e o build relata a aresta em vez de inventar uma
   * condição. Quem exibe a árvore precisa tratar o caso.
   */
  readonly via?: EvolutionCondition
  readonly evolvesTo: readonly EvolutionNode[]
}

/** `chains.json` — as 541 cadeias já resolvidas, chaveadas por id de cadeia. */
export type ChainsData = Readonly<Record<string, EvolutionNode>>

/** `flavor-N.json` — descrição da espécie, chaveada por id. Separado por peso. */
export type FlavorData = Readonly<Record<string, string>>

/**
 * Posição do tipo na matriz, ou `-1` quando o nome não é um dos 18 — que é o
 * caso de `stellar`, `unknown` e `shadow`, e o motivo de a checagem existir.
 */
export function typeIndex(name: string): number {
  return TYPE_NAMES.findIndex(known => known === name)
}

/**
 * `TYPE_NAMES.includes(value)` não compila com `value: string`: o `includes` de
 * uma tupla `as const` só aceita os próprios literais. O `some` com comparação
 * explícita faz o mesmo trabalho sem um único cast.
 */
export function isTypeName(value: string): value is TypeName {
  return TYPE_NAMES.some(known => known === value)
}

/**
 * Guardas de leitura para os arquivos gerados.
 *
 * O arquivo é artefato commitado deste mesmo repositório, já validado com `zod`
 * no build — mas chega por HTTP, e o modo real de falhar é um 404 devolvendo
 * HTML ou um deploy servindo a versão anterior. Sem eles, `$fetch` entrega `any`
 * e o portão de tipagem honesta para exatamente na porta por onde o problema
 * passa.
 *
 * **Eles cobram as mesmas restrições que `scripts/lib/schema.ts` cobra na
 * escrita** — faixa, teto, piso, string não vazia. Checar só a forma seria
 * cobrir o caso grosseiro (HTML no lugar de JSON) e deixar passar justamente o
 * caso que este projeto nomeia como alvo: o deploy parcial, que produz arquivo
 * bem-formado e errado. Um `moveIds: []` tem a forma certa e trava a batalha da
 * Fase 4; o portão de escrita o proíbe, e o de leitura precisa proibir também.
 *
 * O outro motivo é de princípio. Um type predicate que valida menos do que
 * afirma é a mesma mentira que um `as` — o compilador passa a acreditar em
 * `minLevel: number` porque alguém checou só `trigger` — só que sem a
 * palavra-chave que a tornaria visível no review. O `assertionStyle: 'never'`
 * do lint não alcança isso; alcançar é trabalho destas funções.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `Array.isArray` sobre um `unknown` estreita para `any[]`, e daí em diante todo
 * elemento é `any` — a família `no-unsafe-*` existe para pegar exatamente isso.
 * Este predicado diz a verdade (`readonly unknown[]`) e mantém os elementos
 * `unknown`, obrigando a checagem elemento a elemento que vem logo abaixo.
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/** `Number.isInteger` já recusa `NaN` e `Infinity`, que é metade do trabalho. */
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isPositiveInt(value: unknown): boolean {
  return isInt(value) && value > 0
}

function isNonNegativeInt(value: unknown): boolean {
  return isInt(value) && value >= 0
}

/** String não vazia: o schema de escrita usa `.min(1)` em toda string do dex. */
function isText(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function isGenerationNumber(value: unknown): boolean {
  return isInt(value) && value >= 1 && value <= GENERATION_COUNT
}

function isEffectiveness(value: unknown): value is Effectiveness {
  return value === 0 || value === 0.5 || value === 1 || value === 2
}

export function isCoreData(value: unknown): value is CoreData {
  if (!isRecord(value)) return false

  const { types, effectiveness, moves, generations } = value

  if (!isArray(types) || types.length !== TYPE_COUNT) return false
  if (!types.every((t, i) => t === TYPE_NAMES[i])) return false

  if (!isArray(effectiveness) || effectiveness.length !== TYPE_COUNT) return false
  if (!effectiveness.every(row =>
    isArray(row) && row.length === TYPE_COUNT && row.every(isEffectiveness),
  )) return false

  // Catálogo vazio não é "core sem golpes", é core que não terminou de gravar.
  if (!isArray(moves) || moves.length === 0 || !moves.every(isMoveEntry)) return false

  // `.length(9)` no schema: uma geração a menos deixa o grid sem uma aba, e é o
  // tipo de perda que ninguém nota sem contar.
  if (!isArray(generations) || generations.length !== GENERATION_COUNT) return false
  if (!generations.every(isGenerationMeta)) return false

  return true
}

function isMoveEntry(value: unknown): value is MoveEntry {
  if (!isRecord(value)) return false
  return isInt(value.id) && isMoveId(value.id)
    && isText(value.slug)
    && isText(value.displayName)
    && typeof value.type === 'string' && isTypeName(value.type)
    && isPositiveInt(value.power)
    // `null` é "nunca erra" (Swift, Aerial Ace); 0 ou negativo é dado corrompido.
    && (value.accuracy === null || isPositiveInt(value.accuracy))
    && isPositiveInt(value.pp)
    && isInt(value.priority)
    && (value.damageClass === 'physical' || value.damageClass === 'special')
}

function isGenerationMeta(value: unknown): value is GenerationMeta {
  if (!isRecord(value)) return false
  return isGenerationNumber(value.generation)
    && isText(value.region)
    && isText(value.displayName)
    && isPositiveInt(value.speciesCount)
}

export function isGenerationData(value: unknown): value is GenerationData {
  if (!isRecord(value)) return false
  // Geração sem espécie nenhuma não vira arquivo no build — se chegou aqui, o
  // arquivo é de outro build ou está truncado.
  if (!isArray(value.species) || value.species.length === 0) return false
  return isGenerationNumber(value.generation)
    && isText(value.region)
    && value.species.every(isSpeciesEntry)
}

function isSpeciesEntry(value: unknown): value is SpeciesEntry {
  if (!isRecord(value)) return false

  const { types, baseStats, moveIds } = value

  if (!isArray(types) || types.length < 1 || types.length > 2) return false
  if (!types.every(t => typeof t === 'string' && isTypeName(t))) return false

  if (!isArray(baseStats) || baseStats.length !== STAT_COUNT) return false
  if (!baseStats.every(isPositiveInt)) return false

  // Teto e piso, os mesmos do schema de escrita. Vazio trava a batalha da Fase 4
  // e mais que `MOVES_PER_SPECIES` estoura a suposição de quem lê o moveset.
  if (!isArray(moveIds)) return false
  if (moveIds.length < 1 || moveIds.length > MOVES_PER_SPECIES) return false
  if (!moveIds.every(n => isInt(n) && isMoveId(n))) return false

  return isInt(value.id) && isSpeciesId(value.id)
    && isText(value.slug)
    && isText(value.displayName)
    && isNonNegativeInt(value.height)
    && isNonNegativeInt(value.weight)
    && typeof value.isLegendary === 'boolean'
    && typeof value.isMythical === 'boolean'
    && typeof value.isBaby === 'boolean'
    && isNonNegativeInt(value.captureRate)
    && (value.habitat === null || isText(value.habitat))
    && isNonNegativeInt(value.baseHappiness)
    && isText(value.color)
    && isPositiveInt(value.evolutionChainId)
}

export function isChainsData(value: unknown): value is ChainsData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isEvolutionNode)
}

/**
 * Os campos opcionais de `EvolutionCondition`, agrupados pelo formato que cada
 * um aceita.
 *
 * Listas em vez de 19 linhas de `&&` porque elas precisam ficar visivelmente
 * pareadas com `evolutionCondition` de `scripts/lib/schema.ts`: é o mesmo
 * contrato escrito duas vezes, e o jeito de os dois divergirem é um campo entrar
 * num e não no outro.
 */
const CONDITION_TEXT_FIELDS = [
  'item', 'heldItem', 'knownMove', 'knownMoveType',
  'timeOfDay', 'location', 'tradeSpecies', 'partySpecies', 'partyType',
] as const

const CONDITION_POSITIVE_INT_FIELDS = ['minLevel'] as const

const CONDITION_NON_NEGATIVE_INT_FIELDS = ['minHappiness', 'minAffection', 'minBeauty'] as const

const CONDITION_INT_FIELDS = ['gender', 'relativePhysicalStats'] as const

/** Os quatro que o build só grava como `true` — presente significa "sim". */
const CONDITION_TRUE_FIELDS = [
  'needsOverworldRain', 'turnUpsideDown', 'needsMultiplayer', 'nearSpecialRock',
] as const

function isEvolutionCondition(value: unknown): value is EvolutionCondition {
  if (!isRecord(value)) return false
  if (!isText(value.trigger)) return false

  const optional = (field: unknown, valid: (candidate: unknown) => boolean): boolean =>
    field === undefined || valid(field)

  return CONDITION_TEXT_FIELDS.every(key => optional(value[key], isText))
    && CONDITION_POSITIVE_INT_FIELDS.every(key => optional(value[key], isPositiveInt))
    && CONDITION_NON_NEGATIVE_INT_FIELDS.every(key => optional(value[key], isNonNegativeInt))
    && CONDITION_INT_FIELDS.every(key => optional(value[key], isInt))
    && CONDITION_TRUE_FIELDS.every(key => optional(value[key], candidate => candidate === true))
}

function isEvolutionNode(value: unknown): value is EvolutionNode {
  if (!isRecord(value)) return false
  if (!isArray(value.evolvesTo) || !value.evolvesTo.every(isEvolutionNode)) return false
  if (value.via !== undefined && !isEvolutionCondition(value.via)) return false
  return isInt(value.speciesId) && isSpeciesId(value.speciesId)
    && isText(value.slug)
}

export function isFlavorData(value: unknown): value is FlavorData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isText)
}
