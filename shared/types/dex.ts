import type { MoveId, SpeciesId } from './brand.ts'
import { isMoveId, isSpeciesId } from './brand.ts'

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
  /** Ausente na raiz da cadeia; presente em toda aresta descendente. */
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
 * HTML ou um deploy servindo a versão anterior. Estes guardas existem para esse
 * caso, não para entrada adversária: sem eles, `$fetch` entrega `any` e o portão
 * de tipagem honesta para exatamente na porta por onde o problema passa.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEffectiveness(value: unknown): value is Effectiveness {
  return value === 0 || value === 0.5 || value === 1 || value === 2
}

export function isCoreData(value: unknown): value is CoreData {
  if (!isRecord(value)) return false

  const { types, effectiveness, moves, generations } = value

  if (!Array.isArray(types) || types.length !== TYPE_COUNT) return false
  if (!types.every((t, i) => t === TYPE_NAMES[i])) return false

  if (!Array.isArray(effectiveness) || effectiveness.length !== TYPE_COUNT) return false
  if (!effectiveness.every(row =>
    Array.isArray(row) && row.length === TYPE_COUNT && row.every(isEffectiveness),
  )) return false

  if (!Array.isArray(moves) || !moves.every(isMoveEntry)) return false
  if (!Array.isArray(generations) || !generations.every(isGenerationMeta)) return false

  return true
}

function isMoveEntry(value: unknown): value is MoveEntry {
  if (!isRecord(value)) return false
  return typeof value.id === 'number' && isMoveId(value.id)
    && typeof value.slug === 'string'
    && typeof value.displayName === 'string'
    && typeof value.type === 'string' && isTypeName(value.type)
    && typeof value.power === 'number'
    && (value.accuracy === null || typeof value.accuracy === 'number')
    && typeof value.pp === 'number'
    && typeof value.priority === 'number'
    && (value.damageClass === 'physical' || value.damageClass === 'special')
}

function isGenerationMeta(value: unknown): value is GenerationMeta {
  if (!isRecord(value)) return false
  return typeof value.generation === 'number'
    && typeof value.region === 'string'
    && typeof value.displayName === 'string'
    && typeof value.speciesCount === 'number'
}

export function isGenerationData(value: unknown): value is GenerationData {
  if (!isRecord(value)) return false
  return typeof value.generation === 'number'
    && typeof value.region === 'string'
    && Array.isArray(value.species)
    && value.species.every(isSpeciesEntry)
}

function isSpeciesEntry(value: unknown): value is SpeciesEntry {
  if (!isRecord(value)) return false

  const { types, baseStats, moveIds } = value

  if (!Array.isArray(types) || types.length < 1 || types.length > 2) return false
  if (!types.every(t => typeof t === 'string' && isTypeName(t))) return false

  if (!Array.isArray(baseStats) || baseStats.length !== STAT_COUNT) return false
  if (!baseStats.every(n => typeof n === 'number')) return false

  if (!Array.isArray(moveIds)) return false
  if (!moveIds.every(n => typeof n === 'number' && isMoveId(n))) return false

  return typeof value.id === 'number' && isSpeciesId(value.id)
    && typeof value.slug === 'string'
    && typeof value.displayName === 'string'
    && typeof value.height === 'number'
    && typeof value.weight === 'number'
    && typeof value.isLegendary === 'boolean'
    && typeof value.isMythical === 'boolean'
    && typeof value.isBaby === 'boolean'
    && typeof value.captureRate === 'number'
    && (value.habitat === null || typeof value.habitat === 'string')
    && typeof value.baseHappiness === 'number'
    && typeof value.color === 'string'
    && typeof value.evolutionChainId === 'number'
}

export function isChainsData(value: unknown): value is ChainsData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isEvolutionNode)
}

function isEvolutionNode(value: unknown): value is EvolutionNode {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.evolvesTo) || !value.evolvesTo.every(isEvolutionNode)) return false
  if (value.via !== undefined && !(isRecord(value.via) && typeof value.via.trigger === 'string')) return false
  return typeof value.speciesId === 'number' && isSpeciesId(value.speciesId)
    && typeof value.slug === 'string'
}

export function isFlavorData(value: unknown): value is FlavorData {
  if (!isRecord(value)) return false
  return Object.values(value).every(text => typeof text === 'string')
}
