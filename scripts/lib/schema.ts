import { z } from 'zod'
import type {
  ChainsData,
  CoreData,
  EvolutionNode,
  FlavorData,
  GenerationData,
} from '../../shared/types/dex.ts'
import { TYPE_COUNT, TYPE_NAMES } from '../../shared/types/dex.ts'
import type { MoveId, SpeciesId } from '../../shared/types/brand.ts'
import { isMoveId, isSpeciesId } from '../../shared/types/brand.ts'

/**
 * Validação da **saída** — o que vai para `public/data/`.
 *
 * A anotação `z.ZodType<CoreData>` é o ponto do arquivo: ela faz o compilador
 * conferir que o schema produz exatamente o contrato declarado em
 * `shared/types/dex.ts`. Um campo que entra no schema e não no tipo (ou o
 * contrário) quebra o `yarn typecheck` — que é o único portão capaz de provar
 * isso, já que nenhum teste de runtime nota um tipo saindo de sincronia com o
 * schema que deveria descrevê-lo.
 */

/**
 * Ids marcados. `z.number().max(937)` produz `number`, e o contrato pede
 * `MoveId` — foi o `yarn typecheck` que apontou a diferença, que é justamente o
 * trabalho que a anotação `z.ZodType<...>` existe para fazer.
 *
 * `z.custom` declara o tipo de saída e valida com o **mesmo guarda** que o resto
 * do projeto usa: a faixa vive num lugar só, e nenhum `as` aparece para fingir
 * que um `number` qualquer é um id.
 */
const moveIdSchema = z.custom<MoveId>(
  value => typeof value === 'number' && isMoveId(value),
  { message: 'id de golpe fora da faixa 1..937' },
)

const speciesIdSchema = z.custom<SpeciesId>(
  value => typeof value === 'number' && isSpeciesId(value),
  { message: 'id de espécie fora da faixa 1..1025' },
)

const typeName = z.enum(TYPE_NAMES)

const effectiveness = z.union([
  z.literal(0),
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
])

const moveEntry = z.object({
  id: moveIdSchema,
  slug: z.string().min(1),
  displayName: z.string().min(1),
  type: typeName,
  power: z.number().int().positive(),
  accuracy: z.number().int().positive().nullable(),
  pp: z.number().int().positive(),
  priority: z.number().int(),
  damageClass: z.enum(['physical', 'special']),
})

const generationMeta = z.object({
  generation: z.number().int().min(1).max(9),
  region: z.string().min(1),
  displayName: z.string().min(1),
  speciesCount: z.number().int().positive(),
})

export const coreSchema: z.ZodType<CoreData> = z.object({
  // `.length(TYPE_COUNT)` em vez de `.min(1)`: uma matriz com 17 linhas é o
  // defeito que passa despercebido e produz dano errado numa batalha só.
  types: z.array(typeName).length(TYPE_COUNT),
  effectiveness: z.array(z.array(effectiveness).length(TYPE_COUNT)).length(TYPE_COUNT),
  moves: z.array(moveEntry).min(1),
  generations: z.array(generationMeta).length(9),
})

const speciesEntry = z.object({
  id: speciesIdSchema,
  slug: z.string().min(1),
  displayName: z.string().min(1),
  types: z.union([
    z.tuple([typeName]),
    z.tuple([typeName, typeName]),
  ]),
  baseStats: z.tuple([
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
  height: z.number().int().nonnegative(),
  weight: z.number().int().nonnegative(),
  isLegendary: z.boolean(),
  isMythical: z.boolean(),
  isBaby: z.boolean(),
  captureRate: z.number().int().nonnegative(),
  habitat: z.string().min(1).nullable(),
  baseHappiness: z.number().int().nonnegative(),
  color: z.string().min(1),
  evolutionChainId: z.number().int().positive(),
  // Vazio é defeito: espécie sem golpe trava a batalha da Fase 4.
  moveIds: z.array(moveIdSchema).min(1).max(8),
})

export const generationSchema: z.ZodType<GenerationData> = z.object({
  generation: z.number().int().min(1).max(9),
  region: z.string().min(1),
  species: z.array(speciesEntry).min(1),
})

const evolutionCondition = z.object({
  trigger: z.string().min(1),
  minLevel: z.number().int().positive().optional(),
  item: z.string().min(1).optional(),
  heldItem: z.string().min(1).optional(),
  knownMove: z.string().min(1).optional(),
  knownMoveType: z.string().min(1).optional(),
  minHappiness: z.number().int().nonnegative().optional(),
  minAffection: z.number().int().nonnegative().optional(),
  minBeauty: z.number().int().nonnegative().optional(),
  timeOfDay: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  gender: z.number().int().optional(),
  tradeSpecies: z.string().min(1).optional(),
  partySpecies: z.string().min(1).optional(),
  partyType: z.string().min(1).optional(),
  relativePhysicalStats: z.number().int().optional(),
  needsOverworldRain: z.literal(true).optional(),
  turnUpsideDown: z.literal(true).optional(),
  needsMultiplayer: z.literal(true).optional(),
  nearSpecialRock: z.literal(true).optional(),
})

const evolutionNode: z.ZodType<EvolutionNode> = z.object({
  speciesId: speciesIdSchema,
  slug: z.string().min(1),
  via: evolutionCondition.optional(),
  get evolvesTo() {
    return z.array(evolutionNode)
  },
})

export const chainsSchema: z.ZodType<ChainsData> = z.record(z.string(), evolutionNode)

export const flavorSchema: z.ZodType<FlavorData> = z.record(z.string(), z.string().min(1))
